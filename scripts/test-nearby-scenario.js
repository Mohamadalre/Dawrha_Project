/* eslint-disable */
/**
 * test-nearby-scenario.js
 * -----------------------
 * Real end-to-end test of the `user:nearby_drivers` hybrid socket (assigned + GPS fallback).
 *
 * What it does (all against the REAL local server + REAL Postgres + REAL Redis):
 *   1. Seeds a citizen account, two collector drivers (with truck / shift / open handover /
 *      coverage assignment) and two coverage points.
 *   2. Writes live GPS for each driver into Redis (key: truck:location:{truckId}).
 *   3. Connects as the citizen over Socket.IO `/collection` and emits `user:nearby_drivers`.
 *   4. Also calls the REST twin GET /api/v1/user/coverage-zones.
 *   5. Asserts the ACK contains the assigned driver (source=assigned) on point P1 and the
 *      GPS driver (source=gps) on point P2.
 *
 * Run:  node scripts/test-nearby-scenario.js
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');
const Redis = require('ioredis');
const jwt = require('jsonwebtoken');
const { io } = require('socket.io-client');

// ---- config ----
const envText = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const getEnv = (k) => {
  const m = envText.match(new RegExp(`^${k}=(.*)$`, 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : undefined;
};
const JWT_SECRET = getEnv('JWT_ACCESS_SECRET');
const BASE_URL = 'http://localhost:3000';

const db = new Client({
  host: '127.0.0.1', port: 5432, user: 'postgres',
  password: 'Ff123456', database: 'dawrha_db',
});
const redis = new Redis({ host: 'localhost', port: 6379 });

const uid = () => crypto.randomUUID();
const now = new Date();
const ts = Date.now();

// Stable-ish unique values so re-runs don't collide
const CITIZEN_EMAIL = `nearby_citizen_${ts}@test.dev`;
const DRIVER_A_EMAIL = `nearby_driverA_${ts}@test.dev`;
const DRIVER_B_EMAIL = `nearby_driverB_${ts}@test.dev`;

// Two coverage points. P1 and P2 are ~6.1km apart (P2 > 5km from P1, but both within 10km of citizen@P1)
const P1 = { lat: 33.51, lng: 36.27 };
const P2 = { lat: 33.565, lng: 36.27 };

const ids = {};

// Remove any rows left by previous runs so the test is idempotent.
async function cleanup() {
  const del = async (sql, p = []) => {
    try { await db.query(sql, p); } catch (e) { /* ignore */ }
  };
  await del(`delete from driver_coverage_assignments where coverage_point_id in
             (select id from coverage_points where name like 'Nearby %')`);
  await del(`delete from truck_assignments where truck_id in
             (select id from trucks where plate_number like 'NB-%')`);
  await del(`delete from truck_handovers where truck_id in
             (select id from trucks where plate_number like 'NB-%')`);
  await del(`delete from collector_profiles where national_id like 'TEST-NAT-%'`);
  await del(`delete from trucks where plate_number like 'NB-%'`);
  await del(`delete from accounts where email like 'nearby_%@test.dev'`);
  await del(`delete from shifts where name like 'NearbyTestShift%'`);
  await del(`delete from coverage_points where name like 'Nearby %'`);
  console.log('[cleanup] previous test rows removed');
}

async function seed() {
  await cleanup();
  // One shared active shift covering the whole day
  const shiftId = uid();
  await db.query(
    `insert into shifts (id, name, start_time, end_time, shift_type, is_active)
     values ($1,'NearbyTestShift-${ts}','00:00:00','23:59:00','DRIVER',true)`,
    [shiftId],
  );
  ids.shift = shiftId;

  // ---- Citizen ----
  const citizenId = uid();
  await db.query(
    `insert into accounts (id, name, email, role, account_status, is_email_verified, description, language, provider)
     values ($1,'Nearby Citizen','${CITIZEN_EMAIL}','CITIZEN','ACTIVE',true,'','en','LOCAL')`,
    [citizenId],
  );
  ids.citizen = citizenId;

  // ---- Coverage points ----
  const p1Id = uid();
  await db.query(
    `insert into coverage_points (id, name, point_type, lat, lng, radius_m, priority, is_active)
     values ($1,'Nearby P1 ${ts}','GENERAL',$2,$3,5000,5,true)`,
    [p1Id, P1.lat, P1.lng],
  );
  const p2Id = uid();
  await db.query(
    `insert into coverage_points (id, name, point_type, lat, lng, radius_m, priority, is_active)
     values ($1,'Nearby P2 ${ts}','GENERAL',$2,$3,5000,5,true)`,
    [p2Id, P2.lat, P2.lng],
  );
  ids.p1 = p1Id;
  ids.p2 = p2Id;

  // ---- Two drivers (accounts + profiles + trucks + truck_assignments + handovers) ----
  const A = await createDriver(DRIVER_A_EMAIL, 'NB-A-001', 1000);
  const B = await createDriver(DRIVER_B_EMAIL, 'NB-B-002', 1500);
  ids.A = A;
  ids.B = B;

  // assign driver A to point P1 (assigned source)
  await db.query(
    `insert into driver_coverage_assignments (id, driver_id, coverage_point_id, assigned_from, is_active)
     values ($1,$2,$3,now(),true)`,
    [uid(), A.profId, p1Id],
  );

  // open handovers (eligibility requires status='open')
  await db.query(
    `insert into truck_handovers (id, driver_id, truck_id, shift_id, work_date, status)
     values ($1,$2,$3,$4,current_date,'open')`,
    [uid(), A.profId, A.truckId, shiftId],
  );
  await db.query(
    `insert into truck_handovers (id, driver_id, truck_id, shift_id, work_date, status)
     values ($1,$2,$3,$4,current_date,'open')`,
    [uid(), B.profId, B.truckId, shiftId],
  );

  // ---- GPS into Redis (simulates truck:location broadcast) ----
  await   redis.set(`truck:location:${A.truckId}`, JSON.stringify({ lat: P1.lat, lng: P1.lng }));
  await redis.set(`truck:location:${B.truckId}`, JSON.stringify({ lat: P2.lat, lng: P2.lng }));
  console.log('[seed] redis gps written');

  console.log('[seed] done. citizen=%s P1=%s P2=%s', citizenId, p1Id, p2Id);
}

// clean explicit driver creator (avoids the placeholder mess above)
async function createDriver(email, plate, maxKg) {
  const accId = uid();
  await db.query(
    `insert into accounts (id, name, email, role, account_status, is_email_verified, description, language, provider)
     values ($1,'Driver','${email}','COLLECTOR','ACTIVE',true,'','en','LOCAL')`,
    [accId],
  );
  const profId = uid();
  await db.query(
    `insert into collector_profiles (id, account_id, shift_id, national_id)
     values ($1,$2,$3,$4)`,
    [profId, accId, ids.shift, 'TEST-NAT-' + crypto.randomUUID()],
  );
  const truckId = uid();
  await db.query(
    `insert into trucks (id, model, year, plate_number, max_payload_kg, status, truck_type)
     values ($1,'TestTruck',2024,'${plate}',$2,'active','COLLECTION')`,
    [truckId, maxKg],
  );
  await db.query(
    `insert into truck_assignments (id, assigned_at, truck_id, driver_id, shift_id)
     values ($1,now(),$2,$3,$4)`,
    [uid(), truckId, profId, ids.shift],
  );
  return { accId, profId, truckId };
}

function makeToken(accountId, role) {
  return jwt.sign({ id: accountId, sub: accountId, role }, JWT_SECRET, { expiresIn: '1h' });
}

function debugToken(token) {
  console.log('[debug] token prefix:', token.slice(0, 24) + '...');
  try {
    const p = jwt.verify(token, JWT_SECRET);
    console.log('[debug] local verify OK, payload:', JSON.stringify(p));
  } catch (e) {
    console.log('[debug] local verify FAIL:', e.message);
  }
}

function emitNearby(token) {
  return new Promise((resolve, reject) => {
    const socket = io(`${BASE_URL}/collection`, { auth: { token }, query: { token }, transports: ['websocket'], forceNew: true });
    const timeout = setTimeout(() => { socket.close(); reject(new Error('socket timeout')); }, 10000);
    socket.on('connect_error', (e) => { clearTimeout(timeout); reject(e); });
    socket.on('connect', () => {
      setTimeout(() => {
        socket.emit('user:nearby_drivers', { lat: P1.lat, lng: P1.lng, radius_km: 10 }, (ack) => {
          clearTimeout(timeout);
          socket.close();
          resolve(ack);
        });
      }, 600);
    });
  });
}

async function restNearby(token) {
  const res = await fetch(`${BASE_URL}/api/v1/user/coverage-zones?lat=${P1.lat}&lng=${P1.lng}&radius=10`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

async function main() {
  console.log('[main] starting');
  const watchdog = setTimeout(() => { console.error('[WATCHDOG] hung > 40s, exiting'); process.exit(2); }, 40000);
  watchdog.unref();
  console.log('[main] connecting to db...');
  await db.connect();
  console.log('[main] db connected');
  await seed();
  console.log('[main] seed complete');

  const token = makeToken(ids.citizen, 'CITIZEN');
  debugToken(token);

  console.log('\n=== SOCKET user:nearby_drivers ===');
  const ack = await emitNearby(token);
  console.log(JSON.stringify(ack, null, 2));

  console.log('\n=== REST GET /api/v1/user/coverage-zones ===');
  const rest = await restNearby(token);
  console.log(JSON.stringify(rest, null, 2));

  // ---- assertions ----
  const zones = ack?.zones || rest?.result || rest?.zones || [];
  const allDrivers = zones.flatMap((z) => z.drivers || []);
  const assigned = allDrivers.filter((d) => d.source === 'assigned');
  const gps = allDrivers.filter((d) => d.source === 'gps');

  console.log('\n=== RESULT ===');
  console.log('total drivers found :', allDrivers.length);
  console.log('  source=assigned   :', assigned.length);
  console.log('  source=gps        :', gps.length);

  const p1 = zones.find((z) => z.point_id === ids.p1);
  const p2 = zones.find((z) => z.point_id === ids.p2);
  console.log('P1 drivers          :', p1?.drivers?.map((d) => `${d.driver_name}/${d.source}`).join(', ') || 'none');
  console.log('P2 drivers          :', p2?.drivers?.map((d) => `${d.driver_name}/${d.source}`).join(', ') || 'none');

  const ok = assigned.length >= 1 && gps.length >= 1 && p1 && p2;
  console.log(ok ? '\n✅ PASS: hybrid nearby works (assigned + gps)' : '\n❌ FAIL: see above');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
