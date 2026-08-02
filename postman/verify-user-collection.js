/**
 * Every request in the user collection must point at a route that exists.
 *
 * This is the check the collection is for. A documented route that was renamed
 * or deleted does not fail loudly — it 404s, and the person reading the
 * collection concludes the backend is broken. Comparing the file against the
 * controllers turns that into a build-time error instead.
 *
 *   node postman/verify-user-collection.js
 *
 * Reports both directions:
 *   MISSING  — the collection documents a path with no route behind it.
 *   EXTRA    — a citizen-reachable route the collection never mentions.
 *
 * EXTRA is a warning, not a failure: some routes belong to other roles, and the
 * list of deliberate omissions is kept below with a reason for each.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const COLLECTION = path.join(__dirname, 'Dawrha.user.postman_collection.json');

// ---------------------------------------------------------------------------
// Routes that exist in the code
// ---------------------------------------------------------------------------
function controllerFiles(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) controllerFiles(p, acc);
    else if (e.name.endsWith('.controller.ts')) acc.push(p);
  }
  return acc;
}

const METHOD_DECORATOR =
  /@(Get|Post|Put|Patch|Delete)\s*\(\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)?\s*\)/;

const CONTROLLER_DECORATOR =
  /@Controller\(\s*(?:\{[^}]*path:\s*'([^']*)'[^}]*\}|'([^']*)')/g;

function routesInCode() {
  const routes = new Set();
  for (const file of controllerFiles(SRC)) {
    const text = fs.readFileSync(file, 'utf8');

    // ONE FILE CAN HOLD SEVERAL CONTROLLERS, and two of them do: the guest app
    // mounts the user and factory audiences side by side, and the category
    // requests file holds the buyer's controller and the admin's. Taking only
    // the first @Controller attributed every route in those files to the wrong
    // base path — which is exactly the kind of quiet wrongness this script is
    // supposed to catch, not commit.
    const blocks = [];
    CONTROLLER_DECORATOR.lastIndex = 0;
    let m;
    while ((m = CONTROLLER_DECORATOR.exec(text))) {
      blocks.push({ base: m[1] ?? m[2], start: m.index });
    }
    if (!blocks.length) continue;

    // ROUTES CAN LIVE IN AN ABSTRACT BASE CLASS, and the guest app's do: one
    // base declares the six visitor routes and two thin controllers inherit
    // them, differing only in which audience they are bound to. Those
    // decorators sit BEFORE the first @Controller in the file, so slicing from
    // it would attribute them to nobody and report every visitor route as
    // missing.
    const inherited = text.slice(0, blocks[0].start);

    // Everything between one @Controller and the next belongs to that one.
    for (let i = 0; i < blocks.length; i++) {
      const start = blocks[i].start;
      const end = i + 1 < blocks.length ? blocks[i + 1].start : text.length;
      const own = text.slice(start, end);
      const body = /extends\s+\w+/.test(own) ? own + '\n' + inherited : own;
      const base = blocks[i].base;

      // A controller may be mounted on several versions (media and
      // notifications are VERSION_NEUTRAL and '1'), so both spellings are
      // legal for it.
      const versions = /VERSION_NEUTRAL/.test(body) ? ['', 'v1/'] : ['v1/'];

      for (const line of body.split(/\r?\n/)) {
        const hit = line.match(METHOD_DECORATOR);
        if (!hit) continue;
        const verb = hit[1].toUpperCase();
        const sub = hit[2] || hit[3] || hit[4] || '';
        for (const v of versions) {
          const full = `api/${v}${base}${sub ? '/' + sub : ''}`.replace(/\/+/g, '/');
          routes.add(`${verb} ${normalise(full)}`);
        }
      }
    }
  }
  return routes;
}

/** `:param` and `{{var}}` both stand for "any single segment". */
function normalise(p) {
  return p
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .map((seg) => (seg.startsWith(':') || /^\{\{.*\}\}$/.test(seg) ? '*' : seg))
    .join('/');
}

// ---------------------------------------------------------------------------
// Routes the collection documents
// ---------------------------------------------------------------------------
function routesInCollection(file = COLLECTION) {
  const collection = JSON.parse(fs.readFileSync(file, 'utf8'));
  const out = [];
  const walk = (items, folder) => {
    for (const it of items) {
      if (it.item) walk(it.item, it.name);
      else {
        const raw = it.request.url.raw
          .replace('{{server}}:{{port}}/', '')
          .split('?')[0];
        out.push({
          key: `${it.request.method} ${normalise(raw)}`,
          name: it.name,
          folder,
          raw,
        });
      }
    }
  };
  walk(collection.item, '');
  return out;
}

// ---------------------------------------------------------------------------
// Deliberate omissions — each with the reason it is not a citizen route
// ---------------------------------------------------------------------------
const NOT_A_CITIZEN_ROUTE = [
  [/^api\/v1\/admin\//, 'admin'],
  [/^api\/v1\/account-management\//, 'admin.accounts.* — account moderation'],
  [/^api\/v1\/auth\/login\/admin$/, 'admin'],
  [/^api\/v1\/odoo\/webhooks\//, 'server-to-server'],
  [/^api\/v1\/onboarding\/(collector|factory|institution|external-partner)\//, 'other roles onboarding'],
  [/^api\/v1\/onboarding\/location$/, 'onboarding of other roles'],
  [/^api\/v1\/auth\/(register|login)\/(institution|collector|factory|external-partner)/, 'other roles'],
  [/^api\/v1\/auth\/login\/(collector|factory)-app/, 'other apps'],
  [/^api\/v1\/driver\//, 'driver'],
  [/^api\/v1\/trucks?/, 'driver / admin'],
  [/^api\/v1\/truck-problems/, 'driver'],
  [/^api\/v1\/shift-change-requests/, 'driver'],
  [/^api\/v1\/shifts\//, 'driver onboarding'],
  [/^api\/v1\/institution\//, 'institution registration'],
  [/^api\/v1\/waste\/my-(categories|materials)$/, 'waste.materials.view — institutions/factories'],
  [/^api\/v1\/waste\/products\/\*\/availability$/, 'waste.products.availability — factories/free facilities'],
  [/^api\/v1\/waste\/category-requests$/, 'waste.categories.request — institutions'],
  [/^api\/v1\/waste\/public\//, 'app-agnostic guest routes; the user app uses user-app/guest'],
  [/^api\/v1\/factory-app\/guest\//, 'factory app'],
  [/^api\/v1\/waste-management\//, 'legacy'],
  [/^api\/?$/, 'health'],
];

const excused = (p) => NOT_A_CITIZEN_ROUTE.find(([re]) => re.test(p));

// ---------------------------------------------------------------------------
const code = routesInCode();
const documented = routesInCollection();

const missing = documented.filter((d) => !code.has(d.key));

const documentedKeys = new Set(documented.map((d) => d.key));
const extra = [...code]
  .filter((k) => !documentedKeys.has(k))
  .filter((k) => !excused(k.split(' ')[1]))
  // The unversioned twins of documented routes are the same route.
  .filter((k) => !documentedKeys.has(k.replace('api/', 'api/v1/')));

if (missing.length) {
  console.log(`\n❌ ${missing.length} documented route(s) do NOT exist in the code:`);
  for (const m of missing) console.log(`   ${m.key}\n      ← "${m.name}" in ${m.folder}`);
}
if (extra.length) {
  console.log(`\n⚠️  ${extra.length} citizen-reachable route(s) not in the collection:`);
  for (const e of extra) console.log(`   ${e}`);
}
if (!missing.length && !extra.length) {
  console.log(
    `✅ user: ${documented.length}/${documented.length} documented routes exist, and no citizen route is undocumented.`,
  );
}

// ---------------------------------------------------------------------------
// The ADMIN collection, MISSING-only
// ---------------------------------------------------------------------------
//
// Only one direction is checked there. A documented admin route that no longer
// exists is the failure that matters — the reader tries it, gets a 404 and
// concludes the backend is broken. The reverse (an admin route nobody wrote up)
// is a gap, not a lie, and the admin surface is large enough that listing every
// gap would drown the real failures.
const ADMIN_COLLECTION = path.join(__dirname, 'Dawrha.admin.postman_collection.json');
let adminMissing = [];
if (fs.existsSync(ADMIN_COLLECTION)) {
  const adminDocumented = routesInCollection(ADMIN_COLLECTION);
  adminMissing = adminDocumented.filter((d) => !code.has(d.key));
  if (adminMissing.length) {
    console.log(`\n❌ ${adminMissing.length} route(s) in the ADMIN collection do NOT exist:`);
    for (const m of adminMissing) console.log(`   ${m.key}\n      ← "${m.name}" in ${m.folder}`);
  } else {
    console.log(
      `✅ admin: ${adminDocumented.length}/${adminDocumented.length} documented routes exist.`,
    );
  }
}

process.exit(missing.length || adminMissing.length ? 1 : 0);
