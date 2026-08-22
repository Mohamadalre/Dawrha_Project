const fs = require('fs');
const path = require('path');
const { DataSource } = require('typeorm');
const glob = require('glob'); // may not exist; fallback below

// Collect all compiled entity .js files
function walk(dir, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith('.entity.js') || e.name.endsWith('.js')) {
      // only entities have @Entity decorator compiled; we import all and filter by Entity
      acc.push(p);
    }
  }
}
const files = [];
walk(path.join(__dirname, 'dist', 'src'), files);
const entities = [];
for (const f of files) {
  try {
    const m = require(f);
    for (const k in m) {
      const v = m[k];
      if (v && typeof v === 'function' && v.prototype && v.prototype.constructor && Reflect && (v.prototype.constructor.name)) {
        // check for @Entity metadata presence loosely
        entities.push(v);
      }
    }
  } catch (e) {}
}
console.log('collected candidate classes', entities.length);
