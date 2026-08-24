#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════
 *  السيناريو الحرفي: دمج طلب جديد وسط جولة سائق عامل (Mid-Round Merge)
 * ═══════════════════════════════════════════════════════════════════
 *
 *  1. المستخدم يقدم طلباً → الخوارزمية تفرز لسائق متاح → يقبل
 *     → تنشأ شحنة تلقائياً عليها طلب واحد.
 *  2. السائق يستلم شاحنته (handover مفتوح)، يرسل موقعه GPS،
 *     يصل ويستلم الطلبية ويوزنها → الطلب PICKING.
 *  3. نفس المستخدم (قريب من موقع السائق) يقدم طلباً جديداً
 *     ← ★ يجب أن تفرزه الخوارزمية تلقائياً لنفس السائق
 *       ويضاف إلى الجولة ونفس الشحنة دون قبول جديد. ★
 *  4. السائق يكمل الجمع ويسلم بالمستودع → الشحنة تغلق (DELIVERED).
 *
 *  التشغيل (يتطلب سيرفر يعمل على :3000 + Redis):
 *    node test-mid-round-merge.js
 * ═══════════════════════════════════════════════════════════════════
 */

const http = require('http');
const { io } = require('socket.io-client');

const BASE = 'http://localhost:3000/api/v1';
const WS_URL = 'http://localhost:3000/tracking';
const PRODUCT_ID = '7d2f0eee-887d-403b-85f5-4c8dc83c23eb';

// مواقع قريبة جداً من بعضها (~100 متر بين كل نقطتين)
const REQ1_POS = { lat: 30.0444, lng: 31.2357 };
const DRIVER_FIX = { lat: 30.0448, lng: 31.2362 }; // بعد الوزن، السائق هنا
const REQ2_POS = { lat: 30.0455, lng: 31.2367 };   // الطلب الجديد بجوار السائق

let passed = 0, failed = 0;
function assert(name, condition, detail) {
  if (condition) { passed++; console.log(`  [PASS] ${name}`); }
  else {
    failed++;
    console.log(`  [FAIL] ${name}${detail ? ' — ' + JSON.stringify(detail).slice(0, 300) : ''}`);
  }
}

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BASE}${path}`);
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const bodyStr = body ? JSON.stringify(body) : null;
    if (bodyStr) headers['Content-Length'] = Buffer.byteLength(bodyStr);
    const req = http.request(url, { method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.success === false && res.statusCode >= 400) reject({ status: res.statusCode, message: parsed.message, body: parsed });
          else resolve({ ...parsed, _status: res.statusCode });
        } catch { resolve({ raw: data, _status: res.statusCode }); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(email, password, deviceId, endpoint) {
  const res = await request('POST', `/auth/login/${endpoint}`, { email, password, deviceId });
  const token = res.data?.details?.token?.accessToken || res.result?.details?.token?.accessToken;
  if (!token) throw new Error(`Login failed for ${email}: ${JSON.stringify(res)}`);
  return token;
}

/** يفتح socket تتبع باسم السائق ويرسل موقعه حتى يُخزن في Redis. */
function sendDriverFix(driverToken, truckId, pos) {
  return new Promise((resolve, reject) => {
    const socket = io(WS_URL, {
      auth: { token: driverToken },
      transports: ['websocket'],
      reconnection: false,
      timeout: 5000,
    });
    socket.on('connect', () => {
      socket.emit('truck:location', { truckId, lat: pos.lat, lng: pos.lng, heading: 45 }, (ack) => {
        socket.disconnect();
        if (ack?.status === 'ok') resolve();
        else reject(new Error(`Location ack failed: ${JSON.stringify(ack)}`));
      });
    });
    socket.on('connect_error', (e) => { socket.close(); reject(new Error(`WS connect failed: ${e.message}`)); });
    setTimeout(() => { socket.close(); reject(new Error('WS timeout')); }, 6000);
  });
}

async function main() {
  console.log('=== MID-ROUND MERGE TEST (السيناريو الحرفي) ===\n');

  // ── 0. الدخول ──
  console.log('[STEP 0] Login all actors');
  const adminToken = await login('admin@dawrha.com', 'Admin@123', '66666666-6666-6666-6666-666666666666', 'admin');
  const driverToken = await login('driver.flow@dawrha.com', 'Driver@123', '55555555-5555-5555-5555-555555555555', 'collector-app');
  const prodToken = await login('producer.flow@dawrha.com', 'Producer@123', '44444444-4444-4444-4444-444444444444', 'user-app');
  console.log('  Tokens acquired\n');

  // ── 0.5 نطاق الدمج = 5 كم (يُستعاد الأصلي عند الانتهاء) ──
  const cfg = await request('GET', '/admin/dispatch-config', null, adminToken);
  const originalMergeKm = cfg.data?.route_merge_max_km;
  await request('PATCH', '/admin/dispatch-config', { route_merge_max_km: 5 }, adminToken);
  console.log(`[STEP 0.5] Merge radius: ${originalMergeKm ?? '?'} km → 5 km\n`);

  try {
    await runScenario({ adminToken, driverToken, prodToken });
  } finally {
    if (originalMergeKm != null) {
      await request('PATCH', '/admin/dispatch-config', { route_merge_max_km: originalMergeKm }, adminToken);
      console.log(`\n  Merge radius restored to ${originalMergeKm} km`);
    }
  }

  // ── الخلاصة ──
  console.log('\n══════════════════════════════════════');
  console.log(`  PASSED: ${passed}  |  FAILED: ${failed}`);
  console.log('══════════════════════════════════════');
  process.exit(failed > 0 ? 1 : 0);
}

async function runScenario({ driverToken, prodToken }) {
  // ── 1. الطلب الأول: إنشاء + فرز + قبول ──
  console.log('[STEP 1] Producer creates REQ1 → algorithm elects a driver');
  const req1 = await request('POST', '/collection-requests', {
    lines: [{ product_id: PRODUCT_ID, quantity: 10 }],
    lat: REQ1_POS.lat, lng: REQ1_POS.lng,
    address_text: 'Merge Test 1', contact_name: 'M1', contact_phone: '01000000001',
  }, prodToken);
  const req1Id = req1.data?.request_id || req1.result?.request_id;

  if (req1.data?.status === 'QUEUED') {
    assert('REQ1 dispatched synchronously', false, {
      got: 'QUEUED',
      hint: 'السيرفر يعمل بكود قديم (الكود الجديد لا يُرجع QUEUED للطلبات الفورية) — أعد تشغيل السيرفر',
    });
    process.exit(1);
  }
  assert('REQ1 created + dispatched synchronously', req1._status === 201 && !!req1Id && req1.data.status === 'ASSIGNED', req1);

  const routeId = req1.data?.route_id;
  assert('REQ1 bound to a route synchronously', !!routeId, req1.data);

  await sleep(1000);
  const ships1 = await request('GET', '/shipments', null, driverToken);
  const ship = ships1.data?.find((s) => s.status !== 'DELIVERED' && s.status !== 'CANCELLED');
  const shipId = ship?.id;
  assert('Shipment auto-created (CREATED, 1 request)',
    !!ship && ship.status === 'CREATED' && ship.total_requests === 1, ship);

  // ── 2. السائق يستلم شاحنته ويرسل موقعه ثم يصل ويوزن ──
  console.log('\n[STEP 2] Driver picks up truck + sends GPS + arrives + weighs REQ1');
  const myTruck = await request('GET', '/driver/my-truck', null, driverToken);
  const truckId = myTruck.data?.truck?.id || myTruck.data?.truckId || myTruck.data?.assignment?.truck?.id;
  assert('Truck id resolved from my-truck', !!truckId, myTruck.data);

  await request('POST', '/driver/pickup', { lat: DRIVER_FIX.lat, lng: DRIVER_FIX.lng }, driverToken);
  await sendDriverFix(driverToken, truckId, DRIVER_FIX);
  console.log('  Live GPS fix stored in Redis');

  await request('PATCH', `/driver/collection-requests/${req1Id}/arrived`, {}, driverToken);
  const col1 = await request('PATCH', `/driver/collection-requests/${req1Id}/collected`, {
    actualWeightKg: 12,
    received_lines: [{ product_id: PRODUCT_ID, quantity: 12 }],
    truck_full: false,
  }, driverToken);
  assert('REQ1 weighed → PICKING (mid-round state)', col1.data?.status === 'PICKING', col1.data);

  // ── 3. ★ السيناريو الحرج: طلب جديد قريب من السائق العامل ★ ──
  console.log('\n[STEP 3] ★ NEW nearby request while driver is mid-round (PICKING) ★');
  let req2;
  try {
    req2 = await request('POST', '/collection-requests', {
      lines: [{ product_id: PRODUCT_ID, quantity: 5 }],
      lat: REQ2_POS.lat, lng: REQ2_POS.lng,
      address_text: 'Merge Test 2', contact_name: 'M2', contact_phone: '01000000002',
    }, prodToken);
  } catch (e) {
    assert('REQ2 created (algorithm had a candidate)', false,
      { status: e.status, message: e.message, hint: 'If 409 NoDriverAvailable: mid-round dispatch is broken again' });
    process.exit(1);
  }
  const req2Id = req2.data?.request_id || req2.result?.request_id;
  assert('REQ2 created', req2._status === 201 && !!req2Id, req2);
  assert('KEY: REQ2 auto-assigned mid-round (no manual accept)', req2.data?.status === 'ASSIGNED', req2.data);
  assert('KEY: REQ2 joined the SAME running tour', req2.data?.route_id === routeId,
    { expected: routeId, got: req2.data?.route_id });

  await sleep(800);
  const ships2 = await request('GET', `/shipments/${shipId}`, null, driverToken);
  assert('KEY: Same shipment now holds BOTH requests',
    ships2.data?.total_requests === 2 &&
    ships2.data?.requests?.some((r) => r.id === req2Id), ships2.data);

  // ── 4. إكمال الجولة وإغلاق الشحنة ──
  console.log('\n[STEP 4] Driver finishes the round → shipment closes at the warehouse');
  await request('PATCH', `/driver/collection-requests/${req2Id}/arrived`, {}, driverToken);
  await request('PATCH', `/driver/collection-requests/${req2Id}/collected`, {
    actualWeightKg: 7,
    received_lines: [{ product_id: PRODUCT_ID, quantity: 7 }],
    truck_full: false,
  }, driverToken);

  const del1 = await request('PATCH', `/driver/collection-requests/${req1Id}/delivered`, {}, driverToken);
  const del2 = await request('PATCH', `/driver/collection-requests/${req2Id}/delivered`, {}, driverToken);
  assert('Both requests delivered', del1._status === 200 && del2._status === 200);

  await sleep(2000);
  const finalShip = await request('GET', `/shipments/${shipId}`, null, driverToken);
  assert('Shipment closed automatically (DELIVERED)', finalShip.data?.status === 'DELIVERED', finalShip.data);
  assert('Totals recalculated (2 requests)', finalShip.data?.total_requests === 2, finalShip.data);
  assert('delivered_at stamped', !!finalShip.data?.delivered_at);

  // ── الخلاصة ──
  console.log('\n══════════════════════════════════════');
  console.log(`  PASSED: ${passed}  |  FAILED: ${failed}`);
  console.log('══════════════════════════════════════');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('\nFATAL:', err?.message || err);
  process.exit(1);
});
