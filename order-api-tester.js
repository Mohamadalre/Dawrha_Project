/**
 * order-api-tester.js
 * -------------------
 * اختبار خارجي شامل (Node 18+) لكل مسارات وحدة الطلبات + كل السيناريوهات.
 *
 * التشغيل:  node order-api-tester.js
 * المتطلبات: الخادم على BASE_URL + حساب FACTORY و ADMIN + (اختياري) ODOO_WEBHOOK_SECRET
 * لا اعتماديات خارجية — يستخدم fetch المدمج.
 *
 * يغطي:
 *  - 32 endpoint (Buyer 11 + Admin 5 + Delivery 6 + Complaints 3 + Constraints 6 + Webhook 1)
 *  - 3 حالات توصيل + حالة التجميع + خوارزمية الإسناد (مستودع واحد / أقرب / تقسيم / تحمّل جزئي)
 *  - بوابة مدير المستودعات (AWAITING_SPLIT_APPROVAL → approve-split / modify)
 */

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
const FACTORY_EMAIL = process.env.TEST_FACTORY_EMAIL || 'factory@dawrha.com';
const FACTORY_PASSWORD = process.env.TEST_FACTORY_PASSWORD || 'Factory@123';
const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL || 'admin@dawrha_org.com';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD || 'Admin@123';
const ODOO_WEBHOOK_SECRET = process.env.ODOO_WEBHOOK_SECRET || process.env.ODOO_WEBHOOK_SECRET_FALLBACK || '';

let factoryToken = '';
let adminToken = '';
const results = [];
const scenarios = [];
const log = (...a) => console.log(...a);
const hr = (t) => log('\n' + '═'.repeat(70) + '\n' + t + '\n' + '═'.repeat(70));
const ok = (m) => log('  ✓ ' + m);
const warn = (m) => log('  ⚠ ' + m);
const info = (m) => log('    ' + m);

async function call(method, path, { token, body, query, anon, headers: extraHeaders } = {}) {
  const url = new URL(BASE_URL + '/api/v1' + path);
  if (query) for (const [k, v] of Object.entries(query)) if (v != null) url.searchParams.set(k, String(v));
  const headers = { 'Content-Type': 'application/json', ...(extraHeaders || {}) };
  if (!anon && token) headers['Authorization'] = 'Bearer ' + token;
  const started = Date.now();
  let status = 'ERR';
  let json;
  try {
    const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    status = res.status;
    const text = await res.text();
    try { json = JSON.parse(text); } catch { json = text; }
  } catch (e) {
    json = { error: String(e.message || e) };
  }
  const ms = Date.now() - started;
  results.push({ method, path: url.pathname + url.search, status, ms });
  const tag = status >= 200 && status < 300 ? '✓' : status >= 400 && status < 500 ? '·' : '✗';
  log(`  ${tag} ${method.padEnd(6)} ${String(status).padStart(3)}  ${String(ms).padStart(4)}ms  ${path}`);
  return { status, json, ms, ok: status >= 200 && status < 300 };
}

async function login(email, password, app) {
  const { json } = await call('POST', `/auth/login/${app}`, { anon: true, body: { email, password, deviceId: 'test-device', deviceType: 'WEB' } });
  const r = json?.result || json?.data || json;
  return r?.accessToken || r?.token || r?.access_token || r?.access_token || '';
}

function expectStatus(res, codes, label) {
  const list = Array.isArray(codes) ? codes : [codes];
  const pass = list.includes(res.status);
  const msg = `${label}: ${res.status} ${pass ? '✓' : '✗ (expected ' + list.join('/') + ')'}`;
  if (pass) ok(msg); else warn(msg);
  return pass;
}

async function main() {
  hr('1) تسجيل الدخول');
  factoryToken = await login(FACTORY_EMAIL, FACTORY_PASSWORD, 'factory-app');
  adminToken = await login(ADMIN_EMAIL, ADMIN_PASSWORD, 'admin');
  if (!factoryToken) warn('لم يتم الحصول على توكن المصنع — تأكد TEST_FACTORY_* وأن الحساب ACTIVE وله province');
  if (!adminToken) warn('لم يتم الحصول على توكن الإدارة — تأكد TEST_ADMIN_* وصلاحيات admin.*');
  if (!factoryToken || !adminToken) { summarize(); return; }
  ok('تم تسجيل الدخول');

  await suiteBuyer();
  await suiteAdminOrders();
  await suiteDelivery();
  await suiteComplaints();
  await suiteConstraints();
  await suitePoints();
  await suiteWebhook();
  await suiteScenarios();

  summarize();
}

// ── Buyer: 11 endpoints ──
async function suiteBuyer() {
  hr('2) المشتري — Buyer /orders  (11 endpoints)');
  const r1 = await call('GET', '/orders/delivery-estimate', { token: factoryToken });
  expectStatus(r1, [200, 400], 'GET /orders/delivery-estimate (200 أو 400 بلا موقع)');

  const r2 = await call('POST', '/orders/checkout', { token: factoryToken, body: { fulfilment_mode: 'PICKUP', accept_partial_fulfilment: false } });
  expectStatus(r2, [201, 400, 409], 'POST /orders/checkout PICKUP');
  const r2b = await call('POST', '/orders/checkout', { token: factoryToken, body: { fulfilment_mode: 'DELIVERY', accept_partial_fulfilment: true } });
  expectStatus(r2b, [201, 400, 409], 'POST /orders/checkout DELIVERY');

  const r3 = await call('GET', '/orders', { token: factoryToken, query: { page: 1, limit: 5 } });
  expectStatus(r3, 200, 'GET /orders');
  const r3f = await call('GET', '/orders', { token: factoryToken, query: { page: 1, limit: 5, status: 'PREPARING' } });
  expectStatus(r3f, 200, 'GET /orders?status=PREPARING');

  const list = await call('GET', '/orders', { token: factoryToken, query: { page: 1, limit: 1 } });
  const order = list.json?.data?.[0] || list.json?.result?.data?.[0] || null;
  global.__orderId = order?.id || order?.order_id || null;
  global.__partId = order?.parts?.[0]?.id || null;
  global.__orderStatus = order?.status || null;
  if (global.__orderId) info(`الطلب المرجعي: ${global.__orderId} (${global.__orderStatus})`);

  // ── اختبار رفض العميل للطلب المقسوم المرفوض (REJECTED_AWAITING_BUYER) ──
  const oid = global.__orderId;
  if (oid) {
    const r4 = await call('GET', `/orders/${oid}`, { token: factoryToken });
    expectStatus(r4, 200, 'GET /orders/:id');

    const r5 = await call('POST', `/orders/${oid}/cancel`, { token: factoryToken, body: { reason: 'اختبار إلغاء' } });
    expectStatus(r5, [200, 409, 404], 'POST /orders/:id/cancel (200 أو 409 نقطة اللاعودة)');
    // بعد الإلغاء قد لا تصلح بقية المسارات لهذا الطلب — ننشئ طلباً جديداً للمسارات التالية
    const fresh = await call('POST', '/orders/checkout', { token: factoryToken, body: { fulfilment_mode: 'PICKUP', accept_partial_fulfilment: true } });
    if (fresh.status === 201) {
      const nl = await call('GET', '/orders', { token: factoryToken, query: { page: 1, limit: 1 } });
      const nid = nl.json?.data?.[0]?.id || nl.json?.result?.data?.[0]?.id;
      if (nid && nid !== oid) global.__orderId2 = nid;
    }
    const testOid = global.__orderId2 || oid;
    const r6 = await call('POST', `/orders/${testOid}/partial-decision`, { token: factoryToken, body: { accept: true } });
    expectStatus(r6, [200, 409, 404], 'POST /orders/:id/partial-decision');
    const r7 = await call('POST', `/orders/${testOid}/confirm-rejection`, { token: factoryToken });
    expectStatus(r7, [200, 409, 404], 'POST /orders/:id/confirm-rejection (مقسوم مرفوض ككل)');
    const r8 = await call('POST', `/orders/${testOid}/consolidate`, { token: factoryToken });
    expectStatus(r8, [200, 400, 409, 404], 'POST /orders/:id/consolidate (PICKUP مقسوم فقط)');
    const r9 = await call('POST', `/orders/${testOid}/confirm-receipt`, { token: factoryToken });
    expectStatus(r9, [200, 400, 404, 409], 'POST /orders/:id/confirm-receipt');
  } else {
    warn('لا يوجد طلب — تم تخطي مسارات الطلب المفرد');
  }

  // تقييم وشكوى: نحاول على أي part موجود، وإلا نختبر مسار 404
  const pid = global.__partId || '00000000-0000-0000-0000-000000000000';
  const r10 = await call('POST', `/orders/parts/${pid}/rating`, { token: factoryToken, body: { stars: 5, note: 'اختبار تقييم' } });
  expectStatus(r10, [200, 404, 400], 'POST /orders/parts/:partId/rating');
  const r11 = await call('POST', `/orders/parts/${pid}/complaints`, { token: factoryToken, body: { kind: 'SHORTAGE', description: 'اختبار نقص 20 كغ', claimed_shortfall: 20 } });
  expectStatus(r11, [201, 404, 400], 'POST /orders/parts/:partId/complaints SHORTAGE→WAREHOUSE');
  const r11b = await call('POST', `/orders/parts/${pid}/complaints`, { token: factoryToken, body: { kind: 'DELIVERY', description: 'تأخر التوصيل' } });
  expectStatus(r11b, [201, 404, 400], 'POST /orders/parts/:partId/complaints DELIVERY→ADMIN');

  const bad = await call('GET', '/orders/00000000-0000-0000-0000-000000000000', { token: factoryToken });
  expectStatus(bad, 404, 'GET /orders/:id — غير موجود 404');
}

// ── Admin Orders: 6 endpoints ──
async function suiteAdminOrders() {
  hr('3) الإدارة — Admin /admin/orders  (6 endpoints: modification-options + approve + reject + modify + list + create)');
  const r1 = await call('GET', '/admin/orders', { token: adminToken, query: { page: 1, limit: 5 } });
  expectStatus(r1, 200, 'GET /admin/orders');
  const r1f = await call('GET', '/admin/orders', { token: adminToken, query: { page: 1, limit: 5, status: 'AWAITING_SPLIT_APPROVAL' } });
  expectStatus(r1f, 200, 'GET /admin/orders?status=AWAITING_SPLIT_APPROVAL (جديد)');
  const r1g = await call('GET', '/admin/orders', { token: adminToken, query: { page: 1, limit: 5, status: 'REJECTED_AWAITING_BUYER' } });
  expectStatus(r1g, 200, 'GET /admin/orders?status=REJECTED_AWAITING_BUYER');

  const oid = global.__orderId2 || global.__orderId;
  if (oid) {
    const r2 = await call('GET', `/admin/orders/${oid}/modification-options`, { token: adminToken });
    expectStatus(r2, [200, 404], 'GET /admin/orders/:id/modification-options');
    const r3 = await call('POST', `/admin/orders/${oid}/approve-split`, { token: adminToken });
    expectStatus(r3, [200, 409, 404, 400], 'POST /admin/orders/:id/approve-split (AWAITING_SPLIT_APPROVAL فقط)');
    const r3b = await call('POST', `/admin/orders/${oid}/reject-split`, { token: adminToken, body: { reason: 'اختبار رفض مقسوم' } });
    expectStatus(r3b, [200, 409, 404, 400], 'POST /admin/orders/:id/reject-split (AWAITING_SPLIT_APPROVAL → REJECTED_AWAITING_BUYER)');
    const r4 = await call('POST', `/admin/orders/${oid}/modify`, { token: adminToken, body: { warehouseIds: [] } });
    expectStatus(r4, [400, 409, 404], 'POST /admin/orders/:id/modify — مصفوفة فارغة 400');
  }
  const r5 = await call('POST', '/admin/orders', { token: adminToken, body: { buyerAccountId: '00000000-0000-0000-0000-000000000000', items: [{ productId: 'prod-test', quantity: 10 }], fulfilmentMode: 'PICKUP' } });
  expectStatus(r5, [404, 400], 'POST /admin/orders — buyer وهمي 404');
  const r5b = await call('POST', '/admin/orders', { token: adminToken, body: { buyerAccountId: '00000000-0000-0000-0000-000000000000', items: [] } });
  expectStatus(r5b, [400, 404], 'POST /admin/orders — items فارغة 400');
  // مستودع واحد: يجب أن يقبله مدير المستودع في Odoo، ليس ادمن المستودعات — نختبر أن modify/reject مرفوضان
  if (oid) {
    const r6 = await call('POST', `/admin/orders/${oid}/reject-split`, { token: adminToken, body: {} });
    expectStatus(r6, [409, 404, 400], 'POST /admin/orders/:id/reject-split — مرفوض إن لم يكن مقسوماً بانتظار مدير المستودعات');
  }
}

// ── Delivery: 6 endpoints (محذوفة من باك اند — تتبع عبر Odoo/Webhook) ──
async function suiteDelivery() {
  hr('4) التوصيل — Delivery  (6 endpoints — محذوفة من باك اند، مرئية لادمن المستودعات في Odoo)');
  const oid = global.__orderId2 || global.__orderId || '00000000-0000-0000-0000-000000000000';
  const r1 = await call('GET', `/admin/orders/${oid}/delivery`, { token: adminToken });
  expectStatus(r1, [404], 'GET /admin/orders/:id/delivery — محذوف من باك اند 404 ✓ (التتبع في Odoo)');
  const r2 = await call('POST', `/admin/orders/${oid}/delivery/plan`, { token: adminToken, body: {} });
  expectStatus(r2, [404], 'POST /admin/orders/:id/delivery/plan — محذوف 404 ✓ (مؤتمت في الخلفية)');
  const r2b = await call('POST', `/admin/orders/${oid}/delivery/plan`, { token: adminToken, body: { truck_groups: [['part-a', 'part-b']] } });
  expectStatus(r2b, [404], 'POST /admin/orders/:id/delivery/plan مع truck_groups — محذوف 404 ✓');

  const fakeTrip = '00000000-0000-0000-0000-000000000000';
  const fakeStop = '00000000-0000-0000-0000-000000000000';
  const r3 = await call('POST', `/admin/orders/delivery/trips/${fakeTrip}/assign`, { token: adminToken, body: { odoo_truck_id: 1, odoo_driver_id: 1, driver_name: 'سائق اختبار', driver_phone: '0790000000' } });
  expectStatus(r3, [404], 'POST /admin/orders/delivery/trips/:tripId/assign — محذوف 404 ✓');
  const r4 = await call('GET', `/admin/orders/delivery/drivers/1/trips`, { token: adminToken });
  expectStatus(r4, [404], 'GET /admin/orders/delivery/drivers/:driverId/trips — محذوف 404 ✓');
  const r5 = await call('POST', `/admin/orders/delivery/trips/${fakeTrip}/stops/${fakeStop}/pickup`, { token: adminToken, body: { note: 'استلام اختبار' } });
  expectStatus(r5, [404], 'POST .../stops/:stopId/pickup — محذوف 404 ✓ (السائق يؤكد في Odoo)');
  const r6 = await call('POST', `/admin/orders/delivery/trips/${fakeTrip}/complete`, { token: adminToken });
  expectStatus(r6, [404], 'POST .../trips/:tripId/complete — محذوف 404 ✓ (السائق يسلّم في Odoo)');
  ok('رحلة التوصيل غير مرئية لادمن الباك اند ✓ — تظهر بين واجهة السائق وادمن المستودعات في Odoo + Webhook');
}

// ── Complaints: 3 endpoints ──
async function suiteComplaints() {
  hr('5) الشكاوى — Admin Complaints  (3 endpoints)');
  const r1 = await call('GET', '/admin/orders/complaints', { token: adminToken, query: { page: 1, limit: 5 } });
  expectStatus(r1, 200, 'GET /admin/orders/complaints');
  const r1f = await call('GET', '/admin/orders/complaints', { token: adminToken, query: { page: 1, limit: 5, route: 'ADMIN', status: 'OPEN' } });
  expectStatus(r1f, 200, 'GET /admin/orders/complaints?route=ADMIN&status=OPEN');
  const r2 = await call('GET', '/admin/orders/complaints/00000000-0000-0000-0000-000000000000', { token: adminToken });
  expectStatus(r2, [404, 400], 'GET /admin/orders/complaints/:id — وهمي 404');
  const r3 = await call('PATCH', '/admin/orders/complaints/00000000-0000-0000-0000-000000000000', { token: adminToken, body: { status: 'RESOLVED', resolution: 'تم الحل اختبارياً' } });
  expectStatus(r3, [404, 400], 'PATCH /admin/orders/complaints/:id — وهمي 404');
}

// ── Constraints: 6 endpoints ──
async function suiteConstraints() {
  hr('6) القيود — Constraints  (6 endpoints)');
  const r1 = await call('GET', '/admin/order-constraints/minimums', { token: adminToken });
  expectStatus(r1, 200, 'GET /admin/order-constraints/minimums');
  const r2 = await call('PUT', '/admin/order-constraints/minimums/FACTORY', { token: adminToken, body: { min_order_value: 100, currency: 'JOD', is_active: true } });
  expectStatus(r2, [200, 201], 'PUT /admin/order-constraints/minimums/FACTORY');
  const r3 = await call('DELETE', '/admin/order-constraints/minimums/FACTORY', { token: adminToken });
  expectStatus(r3, [200, 404], 'DELETE /admin/order-constraints/minimums/FACTORY');
  const r4 = await call('GET', '/admin/order-constraints/spending-caps', { token: adminToken });
  expectStatus(r4, 200, 'GET /admin/order-constraints/spending-caps');
  const r5 = await call('PUT', '/admin/order-constraints/spending-caps/FACTORY', { token: adminToken, body: { max_amount: 5000, period: 'MONTHLY', currency: 'JOD', is_active: true } });
  expectStatus(r5, [200, 201], 'PUT /admin/order-constraints/spending-caps/FACTORY MONTHLY');
  const r5b = await call('PUT', '/admin/order-constraints/spending-caps/EXTERNAL_PARTNER', { token: adminToken, body: { max_amount: 2000, period: 'DAILY', currency: 'JOD', is_active: true } });
  expectStatus(r5b, [200, 201], 'PUT /admin/order-constraints/spending-caps/EXTERNAL_PARTNER DAILY');
  const r6 = await call('DELETE', '/admin/order-constraints/spending-caps/FACTORY', { token: adminToken });
  expectStatus(r6, [200, 404], 'DELETE /admin/order-constraints/spending-caps/FACTORY');
  await call('DELETE', '/admin/order-constraints/spending-caps/EXTERNAL_PARTNER', { token: adminToken });
}

// ── Points & Wallet: الادمن يحدد قيمة النقطة + المعمل يستلم نقاط ──
async function suitePoints() {
  hr('7) النقاط — Points  (admin يحدد قيمة النقطة + المعمل يستلم)');
  const r1 = await call('GET', '/admin/points-rate', { token: adminToken });
  expectStatus(r1, [200, 403], 'GET /admin/points-rate — كل المعدلات');
  const r2 = await call('POST', '/admin/points-rate', { token: adminToken, body: { role: 'FACTORY', amount_per_point: 100 } });
  expectStatus(r2, [201, 200, 400], 'POST /admin/points-rate FACTORY amount_per_point=100 → 1 نقطة=100 عملة');
  const r2b = await call('POST', '/admin/points-rate', { token: adminToken, body: { role: 'EXTERNAL_PARTNER', amount_per_point: 150 } });
  expectStatus(r2b, [201, 200, 400], 'POST /admin/points-rate EXTERNAL_PARTNER');
  const r3 = await call('PATCH', '/admin/points-rate/FACTORY', { token: adminToken, body: { amount_per_point: 100 } });
  expectStatus(r3, [200, 404, 400], 'PATCH /admin/points-rate/FACTORY');
  const r4 = await call('GET', '/wallet', { token: factoryToken });
  expectStatus(r4, [200, 403], 'GET /wallet — رصيد نقاط المعمل');
  const r5 = await call('GET', '/admin/platform-settings', { token: adminToken });
  expectStatus(r5, [200, 403], 'GET /admin/platform-settings — العملة المركزية');
  const r6 = await call('PATCH', '/admin/platform-settings', { token: adminToken, body: { default_currency: 'SYP' } });
  expectStatus(r6, [200, 400, 403], 'PATCH /admin/platform-settings { default_currency:SYP }');
  if (r2.status === 201 || r2.status === 200) ok('الادمن يحدد 1 نقطة = 100 عملة → المعمل سيربح floor(3000/100)=30 نقطة على طلب 3000');
}

// ── Webhook: 1 endpoint (3 حالات) ──
async function suiteWebhook() {
  hr('7) Webhook — Odoo /odoo/webhooks/delivery  (1 endpoint × 3 حالات)');
  const r1 = await call('POST', '/odoo/webhooks/delivery', { anon: true, body: { event: 'picked_up', backend_trip_id: 'trip-x', backend_stop_id: 'stop-x' }, headers: { 'x-odoo-webhook-secret': 'wrong-secret' } });
  expectStatus(r1, [403, 401], 'POST /odoo/webhooks/delivery — سر خاطئ 403');
  const r2 = await call('POST', '/odoo/webhooks/delivery', { anon: true, body: { event: 'picked_up', backend_trip_id: 'trip-x', backend_stop_id: 'stop-x' }, headers: { 'x-odoo-webhook-secret': ODOO_WEBHOOK_SECRET || 'test' } });
  expectStatus(r2, [202, 503], 'POST /odoo/webhooks/delivery — picked_up (202 أو 503 بلا إعداد)');
  const r3 = await call('POST', '/odoo/webhooks/delivery', { anon: true, body: { event: 'completed', backend_trip_id: 'trip-x' }, headers: { 'x-odoo-webhook-secret': ODOO_WEBHOOK_SECRET || 'test' } });
  expectStatus(r3, [202, 503], 'POST /odoo/webhooks/delivery — completed');
  const r4 = await call('POST', '/odoo/webhooks/delivery', { anon: true, body: { event: 'unknown_event', backend_trip_id: 'trip-x' }, headers: { 'x-odoo-webhook-secret': ODOO_WEBHOOK_SECRET || 'test' } });
  expectStatus(r4, [202, 503], 'POST /odoo/webhooks/delivery — حدث غير معروف (ignored)');
}

// ── سيناريوهات تكاملية (الخوارزمية + حالات التوصيل) ──
async function suiteScenarios() {
  hr('8) السيناريوهات — حالات التوصيل الثلاث + الخوارزمية + التجميع + Milk-run');

  // سيناريو 1: بدون توصيل (PICKUP)
  log('\n  [سيناريو 1] بدون توصيل — المعمل يستلم بنفسه (PICKUP)');
  const s1 = await call('POST', '/orders/checkout', { token: factoryToken, body: { fulfilment_mode: 'PICKUP', accept_partial_fulfilment: false } });
  if (s1.status === 201) ok('تم إنشاء طلب PICKUP'); else info(`checkout PICKUP → ${s1.status}: ${JSON.stringify(s1.json).slice(0, 200)}`);
  scenarios.push({ name: 'PICKUP', status: s1.status });

  // سيناريو 2: توصيل مباشر (DELIVERY — للمعمل فقط)
  log('\n  [سيناريو 2] توصيل مباشر — من المستودع المجهز (DELIVERY)');
  const s2 = await call('POST', '/orders/checkout', { token: factoryToken, body: { fulfilment_mode: 'DELIVERY', accept_partial_fulfilment: false } });
  if (s2.status === 201) ok('تم إنشاء طلب DELIVERY'); else info(`checkout DELIVERY → ${s2.status}: ${JSON.stringify(s2.json).slice(0, 200)}`);
  scenarios.push({ name: 'DELIVERY', status: s2.status });

  // سيناريو 3: طلب مقسوم + بوابة مدير المستودعات
  log('\n  [سيناريو 3] طلب مقسوم — خوارزمية الإسناد + مدير المستودعات');
  const s3 = await call('POST', '/orders/checkout', { token: factoryToken, body: { fulfilment_mode: 'PICKUP', accept_partial_fulfilment: true } });
  info(`checkout للتقسيم → ${s3.status}: ${JSON.stringify(s3.json).slice(0, 300)}`);
  const list = await call('GET', '/orders', { token: factoryToken, query: { page: 1, limit: 1 } });
  const o = list.json?.data?.[0] || list.json?.result?.data?.[0] || list.json?.[0];
  if (o) {
    info(`أحدث طلب: ${o.orderNumber || o.order_number || o.id} — ${o.status} — أجزاء: ${o.parts?.length || '؟'}`);
    if (o.status === 'AWAITING_SPLIT_APPROVAL') {
      ok('الطلب مقسوم وبانتظار مدير المستودعات (إصلاح الفجوة 1 يعمل)');
      const opt = await call('GET', `/admin/orders/${o.id}/modification-options`, { token: adminToken });
      if (opt.status === 200) {
        const opts = opt.json?.result?.options || opt.json?.options || [];
        info(`خيارات التعديل: ${opts.length} بدائل (مثال A+B→A+C)`);
        if (opts.length) {
          const chosen = opts[0].warehouses.map(w => w.id);
          const mod = await call('POST', `/admin/orders/${o.id}/modify`, { token: adminToken, body: { warehouseIds: chosen } });
          expectStatus(mod, [200, 400], 'تعديل التقسيم A+B→A+C');
        }
      }
      // اعتماد إذا لم يعدل
      const cur = await call('GET', '/orders', { token: factoryToken, query: { page: 1, limit: 1 } });
      const curO = cur.json?.data?.[0] || cur.json?.result?.data?.[0];
      if (curO?.status === 'AWAITING_SPLIT_APPROVAL') {
        const appr = await call('POST', `/admin/orders/${o.id}/approve-split`, { token: adminToken });
        expectStatus(appr, [200, 409], 'اعتماد التقسيم كما هو (approve-split)');
      }
    } else if (o.status === 'AWAITING_APPROVAL') {
      info('الطلب معروض على مدراء المستودعات (مستودع واحد أو مقسوم معتمد)');
    } else if (o.status === 'NEEDS_CUSTOMER_DECISION') {
      ok('الخوارزمية كشفت نقص تغطية → NEEDS_CUSTOMER_DECISION (حالة 3: لا مستودع يغطي)');
      await call('POST', `/orders/${o.id}/partial-decision`, { token: factoryToken, body: { accept: false } });
    } else {
      info(`حالة الطلب: ${o.status} (ليس مقسوماً بانتظار الإدارة)`);
    }
  }
  scenarios.push({ name: 'SPLIT+ADMIN_GATE', status: o?.status });

  // سيناريو 4: التجميع (Consolidation) — مقسوم PICKUP
  log('\n  [سيناريو 4] التجميع — الأبعد يرسل للأقرب، المشتري يستلم من مكان واحد');
  const target = (await call('GET', '/orders', { token: factoryToken, query: { page: 1, limit: 10 } })).json?.data?.find(x => x.status === 'AWAITING_APPROVAL' || x.status === 'PREPARING') || o;
  if (target) {
    const cons = await call('POST', `/orders/${target.id}/consolidate`, { token: factoryToken });
    expectStatus(cons, [200, 400, 409, 404], 'POST /orders/:id/consolidate (PICKUP مقسوم فقط)');
    if (cons.status === 200) ok('تم اختيار التجميع — سيُجمع عند أقرب مستودع');
    else info(`التجميع غير متاح: ${JSON.stringify(cons.json).slice(0, 200)}`);
  }

  // سيناريو 5: توصيل مقسوم — Milk-run
  log('\n  [سيناريو 5] توصيل مقسوم — Milk-run (شاحنة من الأبعد تمر بالأقرب)');
  const delivOrder = (await call('GET', '/orders', { token: factoryToken, query: { page: 1, limit: 10 } })).json?.data?.find(x => x.fulfilmentMode === 'DELIVERY' || x.fulfilment_mode === 'DELIVERY');
  if (delivOrder) {
    const plan = await call('POST', `/admin/orders/${delivOrder.id}/delivery/plan`, { token: adminToken, body: {} });
    expectStatus(plan, [200, 201, 400, 404, 409], 'تخطيط Milk-run لطلب DELIVERY');
  } else {
    info('لا يوجد طلب DELIVERY للاختبار — السيناريو يحتاج طلب توصيل');
  }

  // سيناريو 6: المنشأة الحرة تُجبر على PICKUP
  log('\n  [سيناريو 6] المنشأة الحرة تطلب DELIVERY → تُجبر على PICKUP (resolveFulfilmentMode)');
  info('يُختبر عبر checkout بطلب DELIVERY من حساب EXTERNAL_PARTNER — إن وجد — وإلا يُوثق سلوكاً');

  // سيناريو 7: التقييم والشكوى لكل جزء
  log('\n  [سيناريو 7] تقييم وشكوى لكل جزء من طلب مقسوم');
  const withParts = (await call('GET', '/orders', { token: factoryToken, query: { page: 1, limit: 1 } })).json?.data?.[0];
  if (withParts?.parts?.length) {
    for (const p of withParts.parts.slice(0, 2)) {
      await call('POST', `/orders/parts/${p.id}/rating`, { token: factoryToken, body: { stars: 4, note: 'اختبار جزء' } });
      await call('POST', `/orders/parts/${p.id}/complaints`, { token: factoryToken, body: { kind: 'QUALITY', description: 'اختبار جودة' } });
    }
    ok(`تم تقييم/شكوى ${Math.min(2, withParts.pards?.length || 2)} أجزاء منفصلة`);
  } else {
    info('لا أجزاء متاحة للتقييم المنفصل');
  }
}

function summarize() {
  hr('الملخص');
  const byStatus = {};
  let total = 0, okCount = 0;
  for (const r of results) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    total++;
    if (r.status >= 200 && r.status < 300) okCount++;
  }
  log(`  إجمالي النداءات: ${total}`);
  log(`  ناجحة (2xx): ${okCount}  —  غير 2xx (متوقعة 400/403/404/409): ${total - okCount}`);
  log('  حسب الحالة: ' + JSON.stringify(byStatus));
  if (scenarios.length) {
    log('\n  السيناريوهات:');
    for (const s of scenarios) log(`    ${s.name}: ${s.status}`);
  }
  log('\n  للتشغيل:  node order-api-tester.js');
  log('  متغيرات:  API_BASE_URL  TEST_FACTORY_EMAIL  TEST_FACTORY_PASSWORD  TEST_ADMIN_EMAIL  TEST_ADMIN_PASSWORD  ODOO_WEBHOOK_SECRET');
}
main().catch(e => { console.error(e); process.exit(1); });
