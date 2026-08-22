const http = require('http');

const BASE = 'http://localhost:3000/api/v1';
const PRODUCT_ID = '7d2f0eee-887d-403b-85f5-4c8dc83c23eb';
const DRIVER_PROFILE_ID = 'b4f371bd-ad85-4aca-8400-788d795cb24b';

let step = 0;
function log(msg) { step++; console.log(`\n[STEP ${step}] ${msg}`); }
function logData(label, data) { console.log(`  ${label}:`, JSON.stringify(data, null, 2)); }

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BASE}${path}`);
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const bodyStr = body ? JSON.stringify(body) : null;
    if (bodyStr) headers['Content-Length'] = Buffer.byteLength(bodyStr);
    const req = http.request(url, { method, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.success === false && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${parsed.message}`));
          } else {
            resolve(parsed);
          }
        }
        catch { resolve({ raw: data, statusCode: res.statusCode }); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function login(email, password, deviceId, endpoint) {
  const res = await request('POST', `/auth/login/${endpoint}`, { email, password, deviceId });
  const token = res.data?.details?.token?.accessToken || res.result?.details?.token?.accessToken;
  if (!token) throw new Error(`Login failed for ${email}: ${JSON.stringify(res)}`);
  return token;
}

async function waitForOffer(driverToken, requestId, maxWait = 20000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      const res = await request('PATCH', `/driver/collection-requests/${requestId}/accept`, {}, driverToken);
      return res;
    } catch (e) {
      if (e.message?.includes('No pending offer') || e.message?.includes('404')) {
        await sleep(1500);
        continue;
      }
      throw e;
    }
  }
  throw new Error(`No offer found for ${requestId} within ${maxWait}ms`);
}

async function main() {
  console.log('=== SHIPMENT LIFECYCLE TEST ===\n');

  // Login
  log('Login all actors');
  const adminToken = await login('admin@dawrha.com', 'Admin@123', '99999999-9999-9999-9999-999999999999', 'admin');
  const driverToken = await login('driver.flow@dawrha.com', 'Driver@123', '88888888-8888-8888-8888-888888888888', 'collector-app');
  const prodToken = await login('producer.flow@dawrha.com', 'Producer@123', '77777777-7777-7777-7777-777777777777', 'user-app');
  console.log('  All tokens acquired');

  // --- REQ 1 ---
  log('Producer creates REQ1');
  const req1 = await request('POST', '/collection-requests', {
    lines: [{ product_id: PRODUCT_ID, quantity: 10 }],
    lat: 30.0444,
    lng: 31.2357,
    address_text: 'Cairo Test 1',
    contact_name: 'Test1',
    contact_phone: '01012345678',
  }, prodToken);
  const req1Id = req1.data.request_id;
  console.log(`  REQ1 ID: ${req1Id} | Status: ${req1.data.status}`);

  log('Wait for auto-dispatch offer then driver accepts REQ1');
  const acc1 = await waitForOffer(driverToken, req1Id);
  console.log(`  Status: ${acc1.data.status} | Route: ${acc1.data.route_id}`);

  log('Check shipment auto-created');
  await sleep(1000);
  const ships1 = await request('GET', '/shipments', null, driverToken);
  const active1 = ships1.data?.find(s => s.status !== 'DELIVERED' && s.status !== 'CANCELLED');
  const shipId = active1?.id;
  console.log(`  Shipment: ${active1?.shipment_number} | Status: ${active1?.status} | Requests: ${active1?.total_requests} | Weight: ${active1?.total_weight_kg}`);
  if (!active1 || active1.status !== 'CREATED') throw new Error('Shipment should be CREATED after first accept');

  // --- REQ 2 (before driver arrives, so merge is possible) ---
  log('Producer creates REQ2');
  const req2 = await request('POST', '/collection-requests', {
    lines: [{ product_id: PRODUCT_ID, quantity: 5 }],
    lat: 30.0555,
    lng: 31.2457,
    address_text: 'Nasr City Test 2',
    contact_name: 'Test2',
    contact_phone: '01098765432',
  }, prodToken);
  const req2Id = req2.data.request_id;
  console.log(`  REQ2 ID: ${req2Id} | Status: ${req2.data.status}`);

  log('Wait for REQ2 dispatch + driver accepts');
  const acc2 = await waitForOffer(driverToken, req2Id);
  console.log(`  Status: ${acc2.data.status} | Route: ${acc2.data.route_id}`);

  log('Check shipment now has 2 requests');
  await sleep(1000);
  const ships2 = await request('GET', '/shipments', null, driverToken);
  const active2 = ships2.data?.find(s => s.id === shipId);
  console.log(`  Shipment: ${active2?.shipment_number} | Status: ${active2?.status} | Requests: ${active2?.total_requests} | Weight: ${active2?.total_weight_kg}`);
  if (!active2 || active2.total_requests < 2) throw new Error('Shipment should have 2 requests after adding REQ2');

  // --- Pickup Truck ---
  log('Driver picks up truck');
  await request('POST', '/driver/pickup', { lat: 30.01, lng: 31.21 }, driverToken);
  console.log('  Truck picked up');

  // --- ARRIVE REQ1 ---
  log('Driver arrives at REQ1');
  const arr1 = await request('PATCH', `/driver/collection-requests/${req1Id}/arrived`, {}, driverToken);
  console.log(`  REQ1 Status: ${arr1.data.status}`);

  log('Check shipment auto-departed to IN_TRANSIT');
  const ships3 = await request('GET', '/shipments', null, driverToken);
  const active3 = ships3.data?.find(s => s.id === shipId);
  console.log(`  Shipment Status: ${active3?.status}`);
  if (active3?.status !== 'IN_TRANSIT') throw new Error(`Shipment should be IN_TRANSIT, got ${active3?.status}`);

  // --- COLLECT REQ1 ---
  log('Driver collects REQ1 (weight=12kg, received lines)');
  const col1 = await request('PATCH', `/driver/collection-requests/${req1Id}/collected`, {
    actualWeightKg: 12,
    received_lines: [{ product_id: PRODUCT_ID, quantity: 12 }],
    truck_full: false,
    driver_note: 'received ok',
  }, driverToken);
  console.log(`  REQ1 Status: ${col1.data.status}`);
  console.log(`  Truck capacity:`, JSON.stringify(col1.data.truck_capacity));

  // --- ARRIVE + COLLECT REQ2 ---
  log('Driver arrives at REQ2');
  const arr2 = await request('PATCH', `/driver/collection-requests/${req2Id}/arrived`, {}, driverToken);
  console.log(`  REQ2 Status: ${arr2.data.status}`);

  log('Driver collects REQ2 (weight=7kg, received lines)');
  const col2 = await request('PATCH', `/driver/collection-requests/${req2Id}/collected`, {
    actualWeightKg: 7,
    received_lines: [{ product_id: PRODUCT_ID, quantity: 7 }],
    truck_full: true,
  }, driverToken);
  console.log(`  REQ2 Status: ${col2.data.status}`);
  console.log(`  Truck capacity:`, JSON.stringify(col2.data.truck_capacity));

  // --- DELIVER REQ1 ---
  log('Driver delivers REQ1');
  const del1 = await request('PATCH', `/driver/collection-requests/${req1Id}/delivered`, {}, driverToken);
  console.log(`  REQ1 Status: ${del1.data.status}`);

  // --- DELIVER REQ2 (last - should auto-complete shipment) ---
  log('Driver delivers REQ2 (last request)');
  const del2 = await request('PATCH', `/driver/collection-requests/${req2Id}/delivered`, {}, driverToken);
  console.log(`  REQ2 Status: ${del2.data.status}`);

  // --- FINAL CHECKS ---
  log('Final shipment status');
  await sleep(2000);
  const finalShip = await request('GET', `/shipments/${shipId}`, null, driverToken);
  const fs = finalShip.data;
  console.log(`  Status: ${fs.status}`);
  console.log(`  Delivered at: ${fs.delivered_at}`);
  console.log(`  Requests: ${fs.total_requests}`);
  console.log(`  Weight: ${fs.total_weight_kg}`);

  log('Admin shipments list');
  const adminShips = await request('GET', '/shipments/admin/all', null, adminToken);
  console.log(`  Total: ${adminShips.result?.total}`);
  adminShips.result?.data?.forEach(s =>
    console.log(`    ${s.shipment_number}: ${s.status} | Requests: ${s.total_requests}`)
  );

  // --- VERIFY ---
  console.log('\n=== VERIFICATION ===');
  const checks = [
    { name: 'Shipment created automatically', pass: !!active1 && active1.status === 'CREATED' },
    { name: 'Shipment auto-departed on arrival', pass: active3?.status === 'IN_TRANSIT' },
    { name: 'REQ2 added to same shipment', pass: active2?.total_requests >= 2 },
    { name: 'REQ1 delivered', pass: del1.data?.status === 'DELIVERED' || del1.data?.status === 'COMPLETED' },
    { name: 'REQ2 delivered', pass: del2.data?.status === 'DELIVERED' || del2.data?.status === 'COMPLETED' },
    { name: 'Shipment auto-completed', pass: fs?.status === 'DELIVERED' },
    { name: 'Shipment has delivered_at', pass: !!fs?.delivered_at },
  ];
  let allPass = true;
  checks.forEach(c => {
    const icon = c.pass ? 'PASS' : 'FAIL';
    console.log(`  [${icon}] ${c.name}`);
    if (!c.pass) allPass = false;
  });

  console.log(allPass ? '\n=== ALL TESTS PASSED ===' : '\n=== SOME TESTS FAILED ===');
  process.exit(allPass ? 0 : 1);
}

main().catch(err => {
  console.error('\nFATAL:', err);
  process.exit(1);
});
