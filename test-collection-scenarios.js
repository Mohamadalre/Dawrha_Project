#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════
 *  سيناريوهات اختبار شاملة — نظام طلبات التجميع (Collection Requests)
 * ═══════════════════════════════════════════════════════════════════
 *
 *  السيناريوهات:
 *    1. إنشاء طلب تجميع + عرضه + إلغائه (المستخدم)
 *    2. قبول عرض السائق + الوصول + الجمع + التسليم للمستودع (السائق)
 *    3. التسليم الفوري عبر QR (Drop-Off)
 *    4. إدارة الطلبات و الإسناد اليدوي (الأدمن)
 *    5. إدارة الشحنات (إلغاء + تسليم) (السائق)
 *    6. خطط التجميع الدورية (المؤسسة)
 *    7. نقاط التغطية (الأدمن)
 *    8. التقارير (الأدمن)
 *
 *  التشغيل: node test-collection-scenarios.js
 * ═══════════════════════════════════════════════════════════════════
 */

const http = require('http');

// ─── Configuration ──────────────────────────────────────────────
const BASE = 'http://localhost:3000/api/v1';
const DEVICE_ID = '99999999-9999-9999-9999-999999999999';

const CREDS = {
  admin:    { email: 'admin@dawrha.com',       password: 'Admin@123' },
  driver:   { email: 'driver.flow@dawrha.com',  password: 'Driver@123' },
  user:     { email: 'producer.flow@dawrha.com', password: 'Producer@123' },
};

// ─── Helpers ────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (token) options.headers['Authorization'] = `Bearer ${token}`;

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.success === false && res.statusCode >= 400) {
            reject({ status: res.statusCode, body: parsed });
          } else {
            resolve({ status: res.statusCode, body: parsed });
          }
        } catch {
          reject({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function login(role) {
  const c = CREDS[role];
  const endpoint = role === 'admin' ? 'admin'
    : role === 'driver' ? 'collector-app'
    : 'user-app';
  const res = await request('POST', `/auth/login/${endpoint}`, {
    email: c.email,
    password: c.password,
    deviceId: DEVICE_ID,
  });
  return res.body?.data?.details?.token?.accessToken
    || res.body?.result?.details?.token?.accessToken;
}

function step(n, msg) { console.log(`\n  [STEP ${n}] ${msg}`); }
function info(msg)     { console.log(`    → ${msg}`); }
function ok(msg)       { passed++; console.log(`    ✅ PASS: ${msg}`); }
function fail(msg, detail) {
  failed++;
  failures.push({ msg, detail });
  console.log(`    ❌ FAIL: ${msg}`);
  if (detail) console.log(`           ${JSON.stringify(detail).slice(0, 200)}`);
}

async function assert(label, fn) {
  try {
    const result = await fn();
    if (result) ok(label);
    else fail(label, 'assertion returned falsy');
  } catch (e) {
    fail(label, e?.body?.message || e?.message || JSON.stringify(e));
  }
}

// ─── State ──────────────────────────────────────────────────────
let adminToken, driverToken, userToken;
let createdRequestId;
let driverProfileId;
let shipmentId;

// ═══════════════════════════════════════════════════════════════════
//  SCENARIO 1: User creates + lists + views + cancels a request
// ═══════════════════════════════════════════════════════════════════
async function scenario1_UserRequestLifecycle() {
  console.log('\n' + '═'.repeat(60));
  console.log('  السيناريو 1: إنشاء طلب تجميع + استعراض + تفاصيل + إلغاء');
  console.log('═'.repeat(60));

  let reqId;

  await assert('إنشاء طلب IMMEDIATE', async () => {
    const res = await request('POST', '/collection-requests', {
      lines: [{ product_id: '00000000-0000-0000-0000-000000000001', quantity: 100 }],
      contact_name: 'أحمد محمد',
      contact_phone: '963931234567',
      address_text: 'شارع الثورة، دمشق',
      lat: 33.5138,
      lng: 36.2765,
    }, userToken);
    reqId = res.body?.data?.id || res.body?.result?.id;
    return res.status === 201 && reqId;
  });

  await assert('عرض طلبات المستخدم', async () => {
    const res = await request('GET', '/collection-requests', null, userToken);
    const items = res.body?.data?.items || [];
    return res.status === 200 && items.length > 0;
  });

  await assert('تفاصيل الطلب', async () => {
    if (!reqId) throw new Error('No request ID');
    const res = await request('GET', `/collection-requests/${reqId}`, null, userToken);
    const data = res.body?.data;
    return res.status === 200 && data?.id === reqId;
  });

  await assert('إلغاء الطلب (قبل الاستلام)', async () => {
    if (!reqId) throw new Error('No request ID');
    const res = await request('PATCH', `/collection-requests/${reqId}/cancel`, {
      reason: 'غيّرت الخطط',
    }, userToken);
    const data = res.body?.data;
    return (res.status === 200 || res.status === 201)
      && (data?.status === 'CANCELLED' || res.body?.message?.includes('cancel'));
  });

  createdRequestId = reqId;
}

// ═══════════════════════════════════════════════════════════════════
//  SCENARIO 2: Full Driver Flow — accept → arrive → collect → deliver shipment
// ═══════════════════════════════════════════════════════════════════
async function scenario2_DriverFullFlow() {
  console.log('\n' + '═'.repeat(60));
  console.log('  السيناريو 2: تدفق السائق الكامل (قبول → وصول → جمع → تسليم)');
  console.log('═'.repeat(60));

  let newReqId;

  await assert('إنشاء طلب جديد للسائق', async () => {
    const res = await request('POST', '/collection-requests', {
      lines: [{ product_id: '00000000-0000-0000-0000-000000000001', quantity: 200 }],
      contact_name: 'محمد علي',
      address_text: 'شارع الحمراء',
    }, userToken);
    newReqId = res.body?.data?.id || res.body?.result?.id;
    return res.status === 201 && newReqId;
  });

  await assert('عرض جولة السائق', async () => {
    const res = await request('GET', '/driver/collection-requests', null, driverToken);
    return res.status === 200;
  });

  await assert('قبول عرض التجميع (يُرجع المواد + السعة)', async () => {
    if (!newReqId) throw new Error('No request ID');
    const res = await request('PATCH', `/driver/collection-requests/${newReqId}/accept`, null, driverToken);
    const data = res.body?.data || res.body?.result;
    return res.status === 200 && data?.request_id;
  });

  await assert('تسجيل الوصول', async () => {
    if (!newReqId) throw new Error('No request ID');
    const res = await request('PATCH', `/driver/collection-requests/${newReqId}/arrived`, null, driverToken);
    return res.status === 200;
  });

  await assert('تسجيل الوزن (الجمع) + استلام الكمية', async () => {
    if (!newReqId) throw new Error('No request ID');
    const res = await request('PATCH', `/driver/collection-requests/${newReqId}/collected`, {
      actualWeightKg: 185.5,
      received_lines: [{ product_id: '00000000-0000-0000-0000-000000000001', quantity: 185.5 }],
      truck_full: false,
      driver_note: 'بلاستيك نظيف',
    }, driverToken);
    const data = res.body?.data || res.body?.result;
    return res.status === 200 && data?.truck_capacity;
  });

  await assert('عرض شحنات السائق', async () => {
    const res = await request('GET', '/shipments', null, driverToken);
    const shipments = res.body?.result || [];
    if (Array.isArray(shipments) && shipments.length > 0) {
      shipmentId = shipments[0].id;
    }
    return res.status === 200;
  });

  await assert('تفاصيل الشحنة', async () => {
    if (!shipmentId) throw new Error('No shipment ID — skip');
    const res = await request('GET', `/shipments/${shipmentId}`, null, driverToken);
    const data = res.body?.result;
    return res.status === 200 && data?.id === shipmentId;
  });

  await assert('تسليم الشحنة للمستودع', async () => {
    if (!shipmentId) throw new Error('No shipment ID — skip');
    const res = await request('PATCH', `/shipments/${shipmentId}/deliver`, {
      warehouseId: undefined,
    }, driverToken);
    const data = res.body?.result;
    return res.status === 200 && data?.status === 'DELIVERED';
  });
}

// ═══════════════════════════════════════════════════════════════════
//  SCENARIO 3: Admin — list + assign + cancel
// ═══════════════════════════════════════════════════════════════════
async function scenario3_AdminManagement() {
  console.log('\n' + '═'.repeat(60));
  console.log('  السيناريو 3: إدارة الطلبات (الأدمن)');
  console.log('═'.repeat(60));

  let adminReqId;

  await assert('إنشاء طلب جديد (لإسناد يدوي)', async () => {
    const res = await request('POST', '/collection-requests', {
      lines: [{ product_id: '00000000-0000-0000-0000-000000000001', quantity: 50 }],
      address_text: 'شارع الم dstan',
    }, userToken);
    adminReqId = res.body?.data?.id || res.body?.result?.id;
    return res.status === 201 && adminReqId;
  });

  await assert('عرض كل الطلبات (أدمن)', async () => {
    const res = await request('GET', '/admin/collection-requests', null, adminToken);
    const data = res.body?.data;
    return res.status === 200 && data?.items;
  });

  await assert('إسناد طلب لسائق (يدوي)', async () => {
    if (!adminReqId) throw new Error('No request ID');
    const res = await request('POST', `/admin/collection-requests/${adminReqId}/assign`, {
      driver_id: driverProfileId,
    }, adminToken);
    return res.status === 200;
  });

  await assert('إلغاء طلب (أدمن)', async () => {
    if (!adminReqId) throw new Error('No request ID');
    const res = await request('PATCH', `/admin/collection-requests/${adminReqId}/cancel`, {
      reason: 'أمر إداري',
    }, adminToken);
    return res.status === 200;
  });
}

// ═══════════════════════════════════════════════════════════════════
//  SCENARIO 4: Shipment — cancel flow
// ═══════════════════════════════════════════════════════════════════
async function scenario4_ShipmentCancel() {
  console.log('\n' + '═'.repeat(60));
  console.log('  السيناريو 4: إلغاء شحنة');
  console.log('═'.repeat(60));

  let cancelReqId, cancelShipmentId;

  await assert('إنشاء طلب + قبول السائق (لإنشاء شحنة)', async () => {
    const res = await request('POST', '/collection-requests', {
      lines: [{ product_id: '00000000-0000-0000-0000-000000000001', quantity: 30 }],
    }, userToken);
    cancelReqId = res.body?.data?.id;
    if (!cancelReqId) throw new Error('No request');
    await request('PATCH', `/driver/collection-requests/${cancelReqId}/accept`, null, driverToken);
    return true;
  });

  await assert('جلب الشحنة الجديدة', async () => {
    const res = await request('GET', '/shipments', null, driverToken);
    const shipments = res.body?.result || [];
    cancelShipmentId = shipments[0]?.id;
    return cancelShipmentId;
  });

  await assert('إلغاء الشحنة', async () => {
    if (!cancelShipmentId) throw new Error('No shipment');
    const res = await request('PATCH', `/shipments/${cancelShipmentId}/cancel`, null, driverToken);
    const data = res.body?.result;
    return res.status === 200 && data?.status === 'CANCELLED';
  });

  await assert('الطلب عاد لـ PICKING بعد الإلغاء', async () => {
    if (!cancelReqId) throw new Error('No request');
    const res = await request('GET', `/collection-requests/${cancelReqId}`, null, userToken);
    const data = res.body?.data;
    return data?.status === 'PICKING' || data?.status === 'QUEUED';
  });
}

// ═══════════════════════════════════════════════════════════════════
//  SCENARIO 5: Coverage + Drop-Off (Walk-In)
// ═══════════════════════════════════════════════════════════════════
async function scenario5_DropOff() {
  console.log('\n' + '═'.repeat(60));
  console.log('  السيناريو 5: التسليم الفوري (Drop-Off) عبر QR');
  console.log('═'.repeat(60));

  let driverQR, coveragePointId;

  await assert('مناطق التغطية القريبة', async () => {
    const res = await request('GET', '/user/coverage-zones?lat=33.5138&lng=36.2765&radius=50', null, userToken);
    const data = res.body?.data;
    if (Array.isArray(data) && data.length > 0) {
      const zone = data[0];
      coveragePointId = zone.point_id;
      if (zone.drivers?.length > 0) driverQR = zone.drivers[0];
    }
    return res.status === 200;
  });

  await assert('بيانات QR للسائق', async () => {
    if (!driverQR) throw new Error('No driver found nearby');
    const res = await request('GET', `/user/drivers/${driverQR.driver_id}/qr`, null, userToken);
    const data = res.body?.data;
    return res.status === 200 && data?.qr_data;
  });

  if (!coveragePointId || !driverQR) {
    info('⚠️  لا توجد نقاط تغطية أو سائقين — تخطي Drop-Off');
    return;
  }

  await assert('إنشاء تسليم فوري (Drop-Off)', async () => {
    const res = await request('POST', '/user/drop-off', {
      driver_id: driverQR.driver_id,
      coverage_point_id: coveragePointId,
      lines: [{ product_id: '00000000-0000-0000-0000-000000000001', quantity: 25 }],
    }, userToken);
    const data = res.body?.data;
    return res.status === 201 && data?.status === 'PICKING' && data?.type === 'WALK_IN';
  });
}

// ═══════════════════════════════════════════════════════════════════
//  SCENARIO 6: Collection Plans (Institution)
// ═══════════════════════════════════════════════════════════════════
async function scenario6_CollectionPlans() {
  console.log('\n' + '═'.repeat(60));
  console.log('  السيناريو 6: خطط التجميع الدورية');
  console.log('═'.repeat(60));

  let planId;

  await assert('عرض خططي', async () => {
    const res = await request('GET', '/collection-plans', null, userToken);
    return res.status === 200;
  });

  await assert('إنشاء خطة أسبوعية', async () => {
    const res = await request('POST', '/collection-plans', {
      name: 'خطة اختبار — أسبوعية',
      frequency: 'WEEKLY',
      weekdays: [1, 3, 5],
      collection_time: '09:00',
      lat: 33.5138,
      lng: 36.2765,
      address_text: 'شارع الثورة',
      contact_name: 'محمد',
      contact_phone: '963931234567',
      lines: [{ product_id: '00000000-0000-0000-0000-000000000001', quantity: 100 }],
    }, userToken);
    planId = res.body?.result?.id || res.body?.data?.id;
    return res.status === 201 && planId;
  });

  await assert('تفاصيل الخطة', async () => {
    if (!planId) throw new Error('No plan ID');
    const res = await request('GET', `/collection-plans/${planId}`, null, userToken);
    return res.status === 200;
  });

  await assert('تحديث الخطة', async () => {
    if (!planId) throw new Error('No plan ID');
    const res = await request('PATCH', `/collection-plans/${planId}`, {
      collection_time: '10:00',
      is_active: false,
    }, userToken);
    return res.status === 200;
  });
}

// ═══════════════════════════════════════════════════════════════════
//  SCENARIO 7: Coverage Points (Admin)
// ═══════════════════════════════════════════════════════════════════
async function scenario7_CoveragePoints() {
  console.log('\n' + '═'.repeat(60));
  console.log('  السيناريو 7: إدارة نقاط التغطية');
  console.log('═'.repeat(60));

  let pointId;

  await assert('عرض نقاط التغطية', async () => {
    const res = await request('GET', '/admin/coverage-points', null, adminToken);
    return res.status === 200;
  });

  await assert('إضافة نقطة تغطية', async () => {
    const res = await request('POST', '/admin/coverage-points', {
      name: 'نقطة اختبار',
      point_type: 'MARKET',
      lat: 33.5200,
      lng: 36.2800,
      radius_m: 1000,
      priority: 5,
    }, adminToken);
    pointId = res.body?.data?.id;
    return res.status === 201 && pointId;
  });

  await assert('تحديث نقطة التغطية', async () => {
    if (!pointId) throw new Error('No point ID');
    const res = await request('PATCH', `/admin/coverage-points/${pointId}`, {
      name: 'نقطة اختبار (محدثة)',
      priority: 10,
    }, adminToken);
    return res.status === 200;
  });

  await assert('حذف نقطة التغطية', async () => {
    if (!pointId) throw new Error('No point ID');
    const res = await request('DELETE', `/admin/coverage-points/${pointId}`, null, adminToken);
    return res.status === 200;
  });
}

// ═══════════════════════════════════════════════════════════════════
//  SCENARIO 8: Reports (Admin)
// ═══════════════════════════════════════════════════════════════════
async function scenario8_Reports() {
  console.log('\n' + '═'.repeat(60));
  console.log('  السيناريو 8: التقارير');
  console.log('═'.repeat(60));

  await assert('تقرير التجميع اليومي', async () => {
    const res = await request('GET', '/admin/reports/collection/daily', null, adminToken);
    return res.status === 200;
  });

  await assert('تقرير طلبات التجميع', async () => {
    const res = await request('GET', '/admin/reports/collection/requests', null, adminToken);
    return res.status === 200;
  });

  await assert('تقرير مسارات التجميع', async () => {
    const res = await request('GET', '/admin/reports/collection/routes', null, adminToken);
    return res.status === 200;
  });
}

// ═══════════════════════════════════════════════════════════════════
//  SCENARIO 9: Dispatch Config (Admin)
// ═══════════════════════════════════════════════════════════════════
async function scenario9_DispatchConfig() {
  console.log('\n' + '═'.repeat(60));
  console.log('  السيناريو 9: إعدادات DISPATCH');
  console.log('═'.repeat(60));

  let originalConfig;

  await assert('عرض إعدادات DISPATCH', async () => {
    const res = await request('GET', '/admin/dispatch-config', null, adminToken);
    const data = res.body?.data;
    originalConfig = data;
    return res.status === 200 && data?.weights;
  });

  await assert('تحديث إعدادات DISPATCH', async () => {
    const res = await request('PATCH', '/admin/dispatch-config', {
      accept_window_sec: 150,
    }, adminToken);
    return res.status === 200;
  });

  await assert('إعادة الإعدادات الأصلية', async () => {
    if (!originalConfig) throw new Error('No original config');
    const res = await request('PATCH', '/admin/dispatch-config', {
      accept_window_sec: originalConfig.accept_window_sec,
    }, adminToken);
    return res.status === 200;
  });
}

// ═══════════════════════════════════════════════════════════════════
//  MAIN
// ═══════════════════════════════════════════════════════════════════
async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('  🧪  اختبارات سيناريوهات طلبات التجميع');
  console.log('═'.repeat(60));

  // ─── Login ───
  step(0, 'تسجيل الدخول...');
  try {
    adminToken = await login('admin');
    info(`Admin: ${adminToken ? '✅' : '❌'}`);
  } catch (e) { fail('Admin login', e?.body?.message); }

  try {
    driverToken = await login('driver');
    info(`Driver: ${driverToken ? '✅' : '❌'}`);
  } catch (e) { fail('Driver login', e?.body?.message); }

  try {
    userToken = await login('user');
    info(`User: ${userToken ? '✅' : '❌'}`);
  } catch (e) { fail('User login', e?.body?.message); }

  if (!adminToken || !driverToken || !userToken) {
    console.log('\n  ⛔  فشل تسجيل الدخول — توقف الاختبار');
    process.exit(1);
  }

  // ─── Get driver profile ID for admin assign ───
  try {
    const res = await request('GET', '/driver/collection-requests', null, driverToken);
    info('Driver profile loaded');
  } catch {}

  // ─── Run Scenarios ───
  await scenario1_UserRequestLifecycle();
  await scenario2_DriverFullFlow();
  await scenario3_AdminManagement();
  await scenario4_ShipmentCancel();
  await scenario5_DropOff();
  await scenario6_CollectionPlans();
  await scenario7_CoveragePoints();
  await scenario8_Reports();
  await scenario9_DispatchConfig();

  // ─── Summary ───
  console.log('\n' + '═'.repeat(60));
  console.log(`  📊  النتيجة النهائية: ${passed} ✅  |  ${failed} ❌`);
  console.log('═'.repeat(60));

  if (failures.length > 0) {
    console.log('\n  الفشل:');
    failures.forEach((f, i) => {
      console.log(`    ${i + 1}. ${f.msg}`);
      if (f.detail) console.log(`       ${f.detail}`);
    });
  }

  console.log('');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('\n  💥 خطأ غير متوقع:', e);
  process.exit(1);
});
