const http = require('http');

const BASE = 'http://localhost:3000/api/v1';
const PRODUCT_ID = '7d2f0eee-887d-403b-85f5-4c8dc83c23eb';

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
          resolve({ ...parsed, _status: res.statusCode });
        }
        catch { resolve({ raw: data, _status: res.statusCode }); }
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

let passed = 0, failed = 0;
function assert(name, condition, detail) {
  if (condition) { passed++; console.log(`  [PASS] ${name}`); }
  else { failed++; console.log(`  [FAIL] ${name}${detail ? ' — ' + detail : ''}`); }
}

async function main() {
  console.log('=== PUBLIC SHIPMENT APIs TEST ===\n');

  // ── Setup: create a shipment to test with ──
  log('Setup: login driver + producer');
  const driverToken = await login('driver.flow@dawrha.com', 'Driver@123', '88888888-8888-8888-8888-888888888888', 'collector-app');
  const prodToken = await login('producer.flow@dawrha.com', 'Producer@123', '77777777-7777-7777-7777-777777777777', 'user-app');
  console.log('  Tokens acquired');

  log('Setup: producer creates request');
  const req = await request('POST', '/collection-requests', {
    lines: [{ product_id: PRODUCT_ID, quantity: 10 }],
    lat: 30.0444, lng: 31.2357,
    address_text: 'Public API Test', contact_name: 'PubTest', contact_phone: '01000000000',
  }, prodToken);
  console.log('  RAW:', JSON.stringify(req, null, 2));
  const reqId = req.data?.request_id || req.result?.request_id;
  console.log(`  Request ID: ${reqId}`);

  log('Setup: driver accepts request');
  const acc = await waitForOffer(driverToken, reqId);
  console.log(`  Status: ${acc.data.status}`);

  log('Setup: get shipment ID from driver list');
  await sleep(1000);
  const ships = await request('GET', '/shipments', null, driverToken);
  const ship = ships.data?.find(s => s.status !== 'DELIVERED' && s.status !== 'CANCELLED');
  const shipId = ship?.id;
  console.log(`  Shipment: ${ship?.shipment_number} | ID: ${shipId}`);

  // ── TEST 1: Public detail — no auth ──
  log('TEST 1: GET /shipments/:id WITHOUT auth');
  const detail = await request('GET', `/shipments/${shipId}`);
  assert('HTTP 200', detail._status === 200, `got ${detail._status}`);
  assert('Has id', !!detail.result?.id);
  assert('Has shipment_number', !!detail.result?.shipment_number);
  assert('Has status', !!detail.result?.status);
  assert('Has requests array', Array.isArray(detail.result?.requests));
  assert('Has lines in requests', Array.isArray(detail.result?.requests?.[0]?.lines));
  logData('Response', detail.result);

  // ── TEST 2: Public detail — authenticated also works ──
  log('TEST 2: GET /shipments/:id WITH auth (still works)');
  const detailAuth = await request('GET', `/shipments/${shipId}`, null, driverToken);
  assert('HTTP 200', detailAuth._status === 200, `got ${detailAuth._status}`);
  assert('Same shipment ID', detailAuth.result?.id === shipId);

  // ── TEST 3: Public detail — non-existent ID ──
  log('TEST 3: GET /shipments/:id with non-existent UUID');
  const fakeId = '00000000-0000-0000-0000-000000000000';
  const notFound = await request('GET', `/shipments/${fakeId}`);
  assert('HTTP 404', notFound._status === 404, `got ${notFound._status}`);

  // ── TEST 4: Public detail — invalid UUID ──
  log('TEST 4: GET /shipments/:id with invalid UUID');
  const badUuid = await request('GET', '/shipments/not-a-uuid');
  assert('HTTP 400', badUuid._status === 400, `got ${badUuid._status}`);

  // ── TEST 5: Public detail — empty string ──
  log('TEST 5: GET /shipments/ with no ID (404 or 404)');
  const emptyId = await request('GET', '/shipments/');
  assert('Not 200', emptyId._status !== 200, `got ${emptyId._status}`);

  // ── TEST 6: Public deliver — transition to DELIVERED ──
  log('TEST 6: PATCH /shipments/:id/deliver WITHOUT auth');
  const deliver = await request('PATCH', `/shipments/${shipId}/deliver`, { notes: 'Public deliver test' });
  assert('HTTP 200', deliver._status === 200, `got ${deliver._status}: ${JSON.stringify(deliver)}`);
  assert('Status DELIVERED', deliver.result?.status === 'DELIVERED', `got ${deliver.result?.status}`);
  assert('Has delivered_at', !!deliver.result?.delivered_at);
  assert('Correct ID', deliver.result?.id === shipId);
  logData('Deliver response', deliver.result);

  // ── TEST 7: Public detail after delivery — still returns data ──
  log('TEST 7: GET /shipments/:id after delivery');
  const detailAfter = await request('GET', `/shipments/${shipId}`);
  assert('HTTP 200', detailAfter._status === 200, `got ${detailAfter._status}`);
  assert('Status is DELIVERED', detailAfter.result?.status === 'DELIVERED');
  assert('Has delivered_at', !!detailAfter.result?.delivered_at);

  // ── TEST 8: Public deliver — double deliver (should fail 400) ──
  log('TEST 8: PATCH /shipments/:id/deliver again (should fail)');
  const doubleDeliver = await request('PATCH', `/shipments/${shipId}/deliver`, {});
  assert('HTTP 400 (transition error)', doubleDeliver._status === 400, `got ${doubleDeliver._status}: ${JSON.stringify(doubleDeliver)}`);

  // ── TEST 9: Public deliver — non-existent shipment ──
  log('TEST 9: PATCH /shipments/:id/deliver with non-existent UUID');
  const deliverFake = await request('PATCH', `/shipments/${fakeId}/deliver`, {});
  assert('HTTP 404', deliverFake._status === 404, `got ${deliverFake._status}`);

  // ── TEST 10: Public deliver — invalid UUID ──
  log('TEST 10: PATCH /shipments/:id/deliver with invalid UUID');
  const deliverBad = await request('PATCH', '/shipments/not-a-uuid/deliver', {});
  assert('HTTP 400', deliverBad._status === 400, `got ${deliverBad._status}`);

  // ── TEST 11: Driver's myShipments still requires auth ──
  log('TEST 11: GET /shipments (myShipments) WITHOUT auth — should fail');
  const myShips = await request('GET', '/shipments');
  assert('HTTP 401', myShips._status === 401, `got ${myShips._status}`);

  // ── TEST 12: Admin all still requires auth ──
  log('TEST 12: GET /shipments/admin/all WITHOUT auth — should fail');
  const adminAll = await request('GET', '/shipments/admin/all');
  assert('HTTP 401', adminAll._status === 401, `got ${adminAll._status}`);

  // ── Summary ──
  console.log('\n══════════════════════════════════════');
  console.log(`  PASSED: ${passed}  |  FAILED: ${failed}`);
  console.log('══════════════════════════════════════');

  if (failed > 0) console.log('\n=== SOME TESTS FAILED ===');
  else console.log('\n=== ALL TESTS PASSED ===');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('\nFATAL:', err);
  process.exit(1);
});
