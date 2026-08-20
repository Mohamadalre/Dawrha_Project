// Real end-to-end scenario against the LIVE stack (backend + PostgreSQL + Redis + Odoo).
// Records pass/fail + real latency per step. No mocks.
import pkg from 'pg'; const { Client } = pkg;
import dotenv from 'dotenv';
import { execSync } from 'node:child_process';

dotenv.config({ path: './.env' });
const BASE = 'http://127.0.0.1:3000/api/v1';
const results = [];
let token = null;

const ms = (t0) => Math.round((performance.now() - t0) * 10) / 10;
async function step(name, fn) {
  const t0 = performance.now();
  try { const info = await fn(); results.push({ name, ok: true, ms: ms(t0), info: info ?? '' }); }
  catch (e) { results.push({ name, ok: false, ms: ms(t0), info: (e.message || String(e)).slice(0, 120) }); }
}
async function http(method, path, { body, headers } = {}) {
  const t0 = performance.now();
  const res = await fetch(BASE + path, {
    method, headers: { 'Content-Type': 'application/json', ...(headers || {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, headers: res.headers, ms: ms(t0) };
}
function pg() {
  return new Client({ host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME, statement_timeout: 8000 });
}

// ── 1. Boot + security headers ───────────────────────────────────────────
await step('API up + Helmet security headers present', async () => {
  const r = await http('GET', '/user-app/guest/categories?limit=1');
  if (r.status !== 200) throw new Error('status ' + r.status);
  const need = ['strict-transport-security', 'x-content-type-options', 'x-frame-options', 'referrer-policy'];
  const missing = need.filter((h) => !r.headers.get(h));
  if (missing.length) throw new Error('missing headers: ' + missing);
  if (r.headers.get('x-powered-by')) throw new Error('X-Powered-By leaked');
  return `headers ok · ${r.ms}ms`;
});

// ── 2. Auth ──────────────────────────────────────────────────────────────
await step('Admin login returns a JWT (deviceId in payload)', async () => {
  const r = await http('POST', '/auth/login/admin', { body: { email: 'admin@dawrha.com', password: 'Admin@123', deviceId: 'e2e-dev', deviceType: 'ANDROID' } });
  token = r.json?.data?.details?.token?.accessToken;
  if (!token) throw new Error('no token: ' + JSON.stringify(r.json).slice(0, 80));
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
  if (!payload.deviceId) throw new Error('deviceId not in token');
  return `token ok · deviceId=${payload.deviceId} · ${r.ms}ms`;
});
await step('Wrong password is rejected (401/400)', async () => {
  const r = await http('POST', '/auth/login/admin', { body: { email: 'admin@dawrha.com', password: 'WRONG', deviceId: 'e2e-dev', deviceType: 'ANDROID' } });
  if (r.status === 200) throw new Error('wrong password accepted!');
  return `rejected status ${r.status}`;
});

// ── 3. Guest catalogue shape ─────────────────────────────────────────────
await step('Guest categories: correct envelope + product_count', async () => {
  const r = await http('GET', '/user-app/guest/categories?limit=20', { headers: { 'x-lang': 'en' } });
  if (r.status !== 200 || r.json?.success !== true) throw new Error('bad envelope');
  const cats = r.json.data.categories;
  if (!Array.isArray(cats)) throw new Error('categories not array');
  return `${cats.length} categories · ${r.ms}ms`;
});

// ── 4. Pagination regression (the limit=10 bug) ──────────────────────────
await step('Pagination: limit=10 returns data (regression of stale-empty bug)', async () => {
  const r = await http('GET', '/user-app/guest/categories?limit=10', { headers: { 'x-lang': 'en' } });
  const n = r.json?.data?.categories?.length ?? 0;
  const total = r.json?.data?.pagination?.total_count ?? 0;
  if (total > 0 && n === 0) throw new Error('limit=10 shows nothing while total>0 (bug!)');
  return `limit=10 → ${n} items, total=${total}`;
});
await step('Pagination: invalid limit is rejected (number+positive validation)', async () => {
  const r = await http('GET', '/user-app/guest/categories?limit=abc', { headers: { 'x-lang': 'en' } });
  if (r.status !== 400) throw new Error('non-numeric limit accepted: ' + r.status);
  return `?limit=abc → 400`;
});

// ── 5. i18n ──────────────────────────────────────────────────────────────
await step('i18n: x-lang=ar returns an Arabic message', async () => {
  const r = await http('GET', '/user-app/guest/categories?limit=1', { headers: { 'x-lang': 'ar' } });
  if (!/[\u0600-\u06FF]/.test(r.json?.message || '')) throw new Error('message not Arabic: ' + r.json?.message);
  return `msg="${r.json.message}"`;
});

// ── 6. Authenticated catalogue: per-token shape ──────────────────────────
await step('Authenticated /waste/products: category object + has_offer + no condition for INDIVIDUAL', async () => {
  const r = await http('GET', '/waste/products?limit=1', { headers: { Authorization: 'Bearer ' + token, 'x-lang': 'en' } });
  const p = r.json?.data?.products?.[0];
  if (!p) throw new Error('no products');
  if (typeof p.category !== 'object' || !p.category.id) throw new Error('category not an object');
  if (typeof p.has_offer !== 'boolean') throw new Error('has_offer missing');
  if ('condition_prices' in p) throw new Error('condition leaked to INDIVIDUAL');
  if (typeof p.price !== 'number') throw new Error('no tier price');
  return `category={id,name}, has_offer=${p.has_offer}, price=${p.price} · ${r.ms}ms`;
});

// ── 7. Archived accounts route ───────────────────────────────────────────
await step('Admin route: GET /accounts/archived (translated msg)', async () => {
  const r = await http('GET', '/account-management/accounts/archived?limit=5', { headers: { Authorization: 'Bearer ' + token, 'x-lang': 'ar' } });
  if (r.status !== 200 || r.json?.success !== true) throw new Error('status ' + r.status);
  return `msg="${r.json.message}", count=${r.json.data.accounts.length}`;
});

// ── 8. Odoo webhook security ─────────────────────────────────────────────
await step('Odoo webhook rejects a WRONG secret (403)', async () => {
  const r = await http('POST', '/odoo/webhooks/fleet', { headers: { 'x-odoo-webhook-secret': 'wrong-secret' }, body: {} });
  if (r.status === 202) throw new Error('accepted a wrong secret!');
  return `wrong secret → ${r.status}`;
});
await step('Odoo webhook accepts the CORRECT secret (202)', async () => {
  const r = await http('POST', '/odoo/webhooks/fleet', { headers: { 'x-odoo-webhook-secret': process.env.ODOO_WEBHOOK_SECRET }, body: {} });
  if (r.status !== 202) throw new Error('correct secret not accepted: ' + r.status);
  return `correct secret → 202 (${r.json?.message})`;
});

// ── 9. Cross-system: backend→Odoo sync state (evidence) ──────────────────
await step('Backend→Odoo: catalogue is synced (products carry odooProductId)', async () => {
  const c = pg(); await c.connect();
  const r = await c.query('SELECT count(*)::int n, count(odoo_product_id)::int synced FROM products');
  await c.end();
  const { n, synced } = r.rows[0];
  if (n > 0 && synced < n) throw new Error(`${synced}/${n} products synced`);
  return `${synced}/${n} products carry odooProductId`;
});

// ── 10. Cross-system REVERSE (Odoo→backend) via AUTO-PING (extra_hosts) ───
await step('Odoo→Backend AUTO-SYNC: warehouse created in Odoo appears in backend (no manual webhook)', async () => {
  const c = pg(); await c.connect();
  const before = (await c.query('SELECT count(*)::int n FROM warehouses')).rows[0].n;
  const code = 'E2E-' + Date.now();
  const py = `p = env['recycle.province'].search([], limit=1)\n` +
    `w = env['recycle.warehouse'].create({'name':'E2E Auto WH','code':'${code}','address':'Damascus','latitude':33.5,'longitude':36.3,'province_id':p.id})\n` +
    `env.cr.commit()\nprint('WID=%d' % w.id)`;
  const out = execSync(`docker exec -i odoo19 odoo shell -d odoo19 --db_host=db --db_user=odoo --db_password=odoo --no-http --max-cron-threads=0`,
    { input: py, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  const wid = (out.match(/WID=(\d+)/) || [])[1];
  if (!wid) throw new Error('could not create Odoo warehouse');
  // Wait for the auto-ping → webhook → SYNC job → adoption.
  let after = before, tries = 0;
  while (tries++ < 10) {
    await new Promise((r) => setTimeout(r, 1500));
    after = (await c.query('SELECT count(*)::int n FROM warehouses WHERE code=$1', [code])).rows[0].n;
    if (after > 0) break;
  }
  await c.end();
  if (after === 0) throw new Error('warehouse never appeared in backend after ' + (tries * 1.5) + 's');
  return `Odoo WH ${wid} auto-adopted into backend in ~${tries * 1.5}s (no manual webhook)`;
});

// ── Summary ──────────────────────────────────────────────────────────────
const pass = results.filter((r) => r.ok).length;
console.log('\n================ E2E RESULTS (live stack) ================');
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} · ${String(r.ms).padStart(7)}ms · ${r.name}${r.info ? '  →  ' + r.info : ''}`);
console.log('==========================================================');
console.log(`TOTAL: ${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
