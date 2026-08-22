#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
//  اختبارات خوارزمية التعيين (Allocation Planner)
// ═══════════════════════════════════════════════════════════════
//  Pure algorithm — no DB, no network, no clock
//  node test-allocation-planner.js
// ═══════════════════════════════════════════════════════════════

const QUANTITY_EPSILON = 0.0001;

function round3(v) { return Math.round(v * 1000) / 1000; }

function combinationCovers(required, combo) {
  return required.every((line) => {
    if (line.quantity <= QUANTITY_EPSILON) return true;
    const total = combo.reduce((s, w) => s + (w.available.get(line.key) || 0), 0);
    return total >= line.quantity - QUANTITY_EPSILON;
  });
}

function takeFrom(supply, remaining) {
  const lines = [];
  for (const [key, needed] of remaining) {
    if (needed <= QUANTITY_EPSILON) continue;
    const free = supply.available.get(key) || 0;
    const take = Math.min(needed, free);
    if (take <= QUANTITY_EPSILON) continue;
    lines.push({ key, quantity: round3(take) });
    remaining.set(key, round3(needed - take));
  }
  return lines;
}

function* combinations(items, k) {
  if (k <= 0 || k > items.length) return;
  const idx = Array.from({ length: k }, (_, i) => i);
  while (true) {
    yield idx.map((i) => items[i]);
    let pivot = k - 1;
    while (pivot >= 0 && idx[pivot] === items.length - k + pivot) pivot--;
    if (pivot < 0) return;
    idx[pivot]++;
    for (let i = pivot + 1; i < k; i++) idx[i] = idx[i - 1] + 1;
  }
}

function isSatisfied(remaining) {
  for (const qty of remaining.values()) if (qty > QUANTITY_EPSILON) return false;
  return true;
}

function buildShortfalls(required, remaining) {
  return required.map((line) => {
    const missing = remaining.get(line.key) || 0;
    return { key: line.key, requested: line.quantity, allocated: round3(line.quantity - missing), missing: round3(missing) };
  }).filter((s) => s.missing > QUANTITY_EPSILON);
}

function planSingleWarehouse(required, supplies) {
  const c = supplies.find((s) => combinationCovers(required, [s]));
  if (!c) return null;
  return {
    parts: [{ warehouseId: c.warehouseId, distanceKm: c.distanceKm,
      lines: required.filter((l) => l.quantity > QUANTITY_EPSILON).map((l) => ({ key: l.key, quantity: round3(l.quantity) })) }],
    shortfalls: [], score: round3(c.distanceKm), fullyCovered: true,
  };
}

function buildCoveringPlan(required, combo) {
  const rem = new Map(required.map((l) => [l.key, l.quantity]));
  const parts = [];
  for (const s of combo) {
    if (isSatisfied(rem)) break;
    const lines = takeFrom(s, rem);
    if (!lines.length) continue;
    parts.push({ warehouseId: s.warehouseId, distanceKm: s.distanceKm, lines });
  }
  return { parts, shortfalls: buildShortfalls(required, rem),
    score: round3(parts.reduce((a, p) => a + p.distanceKm, 0)), fullyCovered: true };
}

function planFewestParts(required, supplies, max) {
  for (let sz = 2; sz <= max; sz++) {
    let best = null;
    for (const c of combinations(supplies, sz)) {
      if (!combinationCovers(required, c)) continue;
      const km = c.reduce((a, w) => a + w.distanceKm, 0);
      if (!best || km < best.km) best = { c, km };
    }
    if (best) return buildCoveringPlan(required, best.c);
  }
  return null;
}

function planPartial(required, supplies, max) {
  const rem = new Map(required.map((l) => [l.key, l.quantity]));
  const parts = [];
  for (const s of supplies) {
    if (parts.length >= max) break;
    if (isSatisfied(rem)) break;
    const lines = takeFrom(s, rem);
    if (!lines.length) continue;
    parts.push({ warehouseId: s.warehouseId, distanceKm: s.distanceKm, lines });
  }
  const sh = buildShortfalls(required, rem);
  return { parts, shortfalls: sh, score: round3(parts.reduce((a, p) => a + p.distanceKm, 0)), fullyCovered: sh.length === 0 };
}

function planAllocation(params) {
  const { required } = params;
  const sup = [...params.supplies].sort((a, b) => a.distanceKm - b.distanceKm);
  const mx = sup.length;
  const s = planSingleWarehouse(required, sup);
  if (s) return s;
  const sp = planFewestParts(required, sup, mx);
  if (sp) return sp;
  return planPartial(required, sup, mx);
}

function planForWarehouses(params) {
  const w = new Set(params.warehouseIds);
  const ch = params.supplies.filter((s) => w.has(s.warehouseId));
  if (ch.length !== w.size) return null;
  if (!combinationCovers(params.required, ch)) return null;
  return buildCoveringPlan(params.required, [...ch].sort((a, b) => a.distanceKm - b.distanceKm));
}

function coveringCombinations(params) {
  const { required, size } = params;
  const contrib = params.supplies.filter((s) =>
    required.some((l) => l.quantity > QUANTITY_EPSILON && (s.available.get(l.key) || 0) > QUANTITY_EPSILON));
  const sup = contrib.sort((a, b) => a.distanceKm - b.distanceKm);
  if (size < 1 || size > sup.length) return [];
  const opts = [];
  for (const c of combinations(sup, size)) {
    if (!combinationCovers(required, c)) continue;
    opts.push({ warehouseIds: c.map((w) => w.warehouseId),
      totalDistanceKm: round3(c.reduce((a, w) => a + w.distanceKm, 0)) });
  }
  return opts.sort((a, b) => a.totalDistanceKm - b.totalDistanceKm);
}

function shortfallRatio(plan, required) {
  const total = required.reduce((a, l) => a + l.quantity, 0);
  if (total <= 0) return 0;
  const missing = plan.shortfalls.reduce((a, s) => a + s.missing, 0);
  return missing / total;
}


// ─── Test Helpers ───────────────────────────────────────────────
let passed = 0, failed = 0;
const failures = [];

function suite(name) { console.log("\n  " + "-".repeat(56) + "\n  " + name + "\n  " + "-".repeat(56)); }

function test(label, fn) {
  try { fn(); passed++; console.log("    OK  " + label); }
  catch (e) { failed++; failures.push(label); console.log("    FAIL " + label); console.log("       " + e.message); }
}

function eq(a, b) { const sa = JSON.stringify(a), sb = JSON.stringify(b); if (sa !== sb) throw new Error("expected " + sb + "\n       got " + sa); }
function ok(v, msg) { if (!v) throw new Error(msg || "expected truthy"); }
function deepEq(a, b) { const sa = JSON.stringify(a), sb = JSON.stringify(b); if (sa !== sb) throw new Error("expected " + sb + "\n       got " + sa); }

// ─── Convenience ────────────────────────────────────────────────
function wh(id, dist, stock) {
  const m = new Map();
  if (stock) Object.entries(stock).forEach(([k, v]) => m.set(k, v));
  return { warehouseId: id, distanceKm: dist, available: m };
}

function req(key, qty) { return { key, quantity: qty }; }

function lines(plan) {
  const r = {};
  for (const p of plan.parts) r[p.warehouseId] = {};
  for (const p of plan.parts) for (const l of p.lines) r[p.warehouseId][l.key] = l.quantity;
  return r;
}

// ═══════════════════════════════════════════════════════════════
//  السيناريوهات من التفريغ الصوتي
// ═══════════════════════════════════════════════════════════════

// ─── 1. مستودع واحد يغطي الطلب بالكامل ────────────────────────
suite("1. مستودع واحد يغطي الطلب بالكامل (100 كيلو عند مستودع واحد)");

test("يُختار المستودع الوحيد الذي يملك 100 كيلو", () => {
  const plan = planAllocation({
    required: [req("mat-A", 100)],
    supplies: [
      wh("W-far",  50, { "mat-A": 50 }),   // بعيد، 50 فقط
      wh("W-near", 10, { "mat-A": 200 }),  // قريب، يكفي بالكامل
      wh("W-mid",  30, { "mat-A": 80 }),   // متوسط
    ],
  });
  eq(plan.parts.length, 1);
  eq(plan.parts[0].warehouseId, "W-near");
  eq(plan.parts[0].lines[0].quantity, 100);
  eq(plan.shortfalls.length, 0);
  ok(plan.fullyCovered, "fullyCovered");
  console.log("       allocation:", JSON.stringify(lines(plan)));
});

test("إذا أكثر من مستودع يكفي، يُختار الأقرب", () => {
  const plan = planAllocation({
    required: [req("mat-A", 100)],
    supplies: [
      wh("W-far",  40, { "mat-A": 150 }),
      wh("W-near",  5, { "mat-A": 100 }),
      wh("W-mid",  20, { "mat-A": 120 }),
    ],
  });
  eq(plan.parts.length, 1);
  eq(plan.parts[0].warehouseId, "W-near");
  ok(plan.fullyCovered);
});

// ─── 2. مستودعين يغطيان معًا ───────────────────────────────────
suite("2. مستودعين معًا يغطيان الطلب (تقسيم)");

test("لا مستودع يكفي وحده → تقسيم على 2", () => {
  const plan = planAllocation({
    required: [req("mat-A", 100)],
    supplies: [
      wh("W-1", 10, { "mat-A": 60 }),
      wh("W-2", 15, { "mat-A": 50 }),
      wh("W-3", 8,  { "mat-A": 30 }),  // أقرب لكن لا يكفي وحده
    ],
  });
  eq(plan.parts.length, 2);
  eq(plan.shortfalls.length, 0);
  ok(plan.fullyCovered);
  // الأقرب (W-3) يأخذ أول 30، ثم W-1 يأخذ 60، ثم W-2 يأخذ 10
  const total = plan.parts.reduce((s, p) => s + p.lines.reduce((a, l) => a + l.quantity, 0), 0);
  eq(total, 100);
  console.log("       allocation:", JSON.stringify(lines(plan)));
});

test("يختار أصغر عدد مستودعات", () => {
  const plan = planAllocation({
    required: [req("mat-A", 100)],
    supplies: [
      wh("W-1", 5,  { "mat-A": 40 }),
      wh("W-2", 10, { "mat-A": 35 }),
      wh("W-3", 15, { "mat-A": 30 }),
      wh("W-4", 20, { "mat-A": 80 }),
    ],
  });
  // لا مستودع يكفي وحده → يحتاج 2 على الأقل
  // W-4 وحده 80 لا يكفي. W-1+W-4 = 120 يكفي → 2 مستودعات
  eq(plan.parts.length, 2);
  ok(plan.fullyCovered);
  console.log("       allocation:", JSON.stringify(lines(plan)));
});

test("بين مجموعات بنفس الحجم، الأقرب تكلفة يُختار", () => {
  const plan = planAllocation({
    required: [req("mat-A", 100)],
    supplies: [
      wh("W-far1", 30, { "mat-A": 60 }),
      wh("W-far2", 35, { "mat-A": 60 }),
      wh("W-near1", 10, { "mat-A": 55 }),
      wh("W-near2", 12, { "mat-A": 55 }),
    ],
  });
  eq(plan.parts.length, 2);
  ok(plan.fullyCovered);
  // المجموعة الأقرب: near1 + near2 = 22 كم (10+12)
  // المجموعة البعد: far1 + far2 = 65 كم
  eq(plan.score, 22);
  console.log("       allocation:", JSON.stringify(lines(plan)), "score:", plan.score);
});

// ─── 3. ثلاثة مستودعات ─────────────────────────────────────────
suite("3. ثلاثة مستودعات مطلوبة لتغطية الطلب");

test("لا يكفي 2 مستودع → يحتج 3", () => {
  const plan = planAllocation({
    required: [req("mat-A", 100)],
    supplies: [
      wh("W-1", 5,  { "mat-A": 40 }),
      wh("W-2", 10, { "mat-A": 35 }),
      wh("W-3", 15, { "mat-A": 30 }),
    ],
  });
  // كل واحد يكفي مع صاحبه؟ W-1+W-2=75، W-1+W-3=70، W-2+W-3=65 — لا يكفي 2
  // الثلاثة معًا = 105 يكفي
  eq(plan.parts.length, 3);
  ok(plan.fullyCovered);
  console.log("       allocation:", JSON.stringify(lines(plan)));
});

// ─── 4. لا مستودع يغطي — ملء جزئي ─────────────────────────────
suite("4. لا مستودع يكفي — ملء جزئي (يعرض للعميل)");

test("يملأ من الأقرب حتى تنتهي الكمية", () => {
  const plan = planAllocation({
    required: [req("mat-A", 100)],
    supplies: [
      wh("W-1", 5,  { "mat-A": 30 }),
      wh("W-2", 10, { "mat-A": 25 }),
      wh("W-3", 15, { "mat-A": 20 }),
    ],
  });
  eq(plan.fullyCovered, false);
  eq(plan.shortfalls.length, 1);
  eq(plan.shortfalls[0].missing, 25); // 100 - 30 - 25 - 20 = 25
  eq(plan.shortfalls[0].allocated, 75);
  console.log("       shortfall:", JSON.stringify(plan.shortfalls[0]));
  console.log("       ratio:", shortfallRatio(plan, [req("mat-A", 100)]).toFixed(4));
});

test("لا مخزون إطلاقًا", () => {
  const plan = planAllocation({
    required: [req("mat-A", 100)],
    supplies: [
      wh("W-1", 5,  { "mat-B": 50 }),
      wh("W-2", 10, { "mat-C": 30 }),
    ],
  });
  eq(plan.fullyCovered, false);
  eq(plan.parts.length, 0);
  eq(plan.shortfalls[0].missing, 100);
});

// ─── 5. طلب بمواد متعددة (multi-line) ──────────────────────────
suite("5. طلب بمواد متعددة (multi-line order)");

test("material-A و material-B معًا", () => {
  const plan = planAllocation({
    required: [req("A", 50), req("B", 30)],
    supplies: [
      wh("W-1", 5,  { "A": 60, "B": 10 }),
      wh("W-2", 10, { "A": 20, "B": 40 }),
      wh("W-3", 20, { "A": 10, "B": 5 }),
    ],
  });
  eq(plan.fullyCovered, true);
  const totalA = plan.parts.reduce((s, p) => s + (p.lines.find((l) => l.key === "A")?.quantity || 0), 0);
  const totalB = plan.parts.reduce((s, p) => s + (p.lines.find((l) => l.key === "B")?.quantity || 0), 0);
  eq(totalA, 50);
  eq(totalB, 30);
  console.log("       allocation:", JSON.stringify(lines(plan)));
});

// ─── 6. المستودع الأقرب دائمًا أولًا ───────────────────────────
suite("6. المستودع الأقرب دائمًا يأخذ أولوية");

test("مستودع بعيد больше مخزون لا يُختار إذا قريب يكفي", () => {
  const plan = planAllocation({
    required: [req("mat-A", 100)],
    supplies: [
      wh("W-huge-far", 100, { "mat-A": 999 }),
      wh("W-small-near", 1, { "mat-A": 100 }),
    ],
  });
  eq(plan.parts.length, 1);
  eq(plan.parts[0].warehouseId, "W-small-near");
});

// ─── 7. تعديل يدوي من المدير (planForWarehouses) ───────────────
suite("7. تعديل يدوي — مدير المستودعات يختار المستودعات");

test("مدير المستودعات يُعيد التعيين لمجموعة مختلفة", () => {
  const supplies = [
    wh("W-A", 5,  { "mat-A": 60 }),
    wh("W-B", 10, { "mat-A": 50 }),
    wh("W-C", 20, { "mat-A": 60 }),
  ];
  const required = [req("mat-A", 100)];

  // الخوارزمية تختار A+B (5+10=15 كم)
  const auto = planAllocation({ required, supplies });
  eq(auto.parts.length, 2);
  eq(auto.parts[0].warehouseId, "W-A");
  eq(auto.parts[1].warehouseId, "W-B");

  // المدير يُغيّر إلى A+C (B عليه ضغط)
  const manual = planForWarehouses({ required, supplies, warehouseIds: ["W-A", "W-C"] });
  ok(manual, "manual plan should exist");
  eq(manual.parts.length, 2);
  eq(manual.parts[0].warehouseId, "W-A");
  eq(manual.parts[1].warehouseId, "W-C");
  eq(manual.shortfalls.length, 0);
  console.log("       auto:", JSON.stringify(lines(auto)));
  console.log("       manual:", JSON.stringify(lines(manual)));
});

test("مدير المستودعات يختار مجموعة لا تكفي → يرفض", () => {
  const supplies = [
    wh("W-A", 5,  { "mat-A": 40 }),
    wh("W-B", 10, { "mat-A": 35 }),
  ];
  const result = planForWarehouses({
    required: [req("mat-A", 100)],
    supplies,
    warehouseIds: ["W-A", "W-B"],
  });
  eq(result, null); // 75 < 100 → null
});

test("مدير المستودعات يختار مستودع غير موجود", () => {
  const supplies = [wh("W-A", 5, { "mat-A": 100 })];
  const result = planForWarehouses({
    required: [req("mat-A", 100)],
    supplies,
    warehouseIds: ["W-A", "W-NONEXISTENT"],
  });
  eq(result, null);
});

// ─── 8. توليد البدائل (coveringCombinations) ────────────────────
suite("8. توليد بدائل التعيين (coveringCombinations)");

test("يعرض كل المجموعات الممكنة بحجم محدد", () => {
  const supplies = [
    wh("W-A", 5,  { "mat-A": 60 }),
    wh("W-B", 10, { "mat-A": 50 }),
    wh("W-C", 20, { "mat-A": 60 }),
  ];
  const opts = coveringCombinations({
    required: [req("mat-A", 100)],
    supplies,
    size: 2,
  });
  ok(opts.length > 0, "should have covering options");
  // كل خيار يغطي 100
  for (const o of opts) {
    const total = supplies.filter((s) => o.warehouseIds.includes(s.warehouseId))
      .reduce((a, s) => a + (s.available.get("mat-A") || 0), 0);
    ok(total >= 100, "each option must cover 100");
  }
  console.log("       options:", JSON.stringify(opts));
});

test("لا خيارات إذا الحجم أكبر من المتاح", () => {
  const opts = coveringCombinations({
    required: [req("mat-A", 100)],
    supplies: [wh("W-A", 5, { "mat-A": 100 })],
    size: 5,
  });
  eq(opts.length, 0);
});

// ─── 9. حساب النقص (shortfallRatio) ────────────────────────────
suite("9. حساب نسبة النقص (shortfallRatio)");

test("نسبة النقص = 0 عند التغطية الكاملة", () => {
  const plan = planAllocation({
    required: [req("A", 100)],
    supplies: [wh("W-1", 5, { "A": 100 })],
  });
  eq(shortfallRatio(plan, [req("A", 100)]), 0);
});

test("نسبة النقص = 0.25 عند نقص 25 من 100", () => {
  const plan = planAllocation({
    required: [req("A", 100)],
    supplies: [wh("W-1", 5, { "A": 75 })],
  });
  const ratio = shortfallRatio(plan, [req("A", 100)]);
  eq(ratio, 0.25);
  console.log("       ratio:", ratio);
});

test("نسبة النقص = 1.0 عندما لا يوجد مخزون", () => {
  const plan = planAllocation({
    required: [req("A", 100)],
    supplies: [wh("W-1", 5, { "B": 50 })],
  });
  eq(shortfallRatio(plan, [req("A", 100)]), 1);
});

// ─── 10. حالات حدودية ──────────────────────────────────────────
suite("10. حالات حدودية (Edge Cases)");

test("لا يوجد مستودعات متاحة", () => {
  const plan = planAllocation({ required: [req("A", 100)], supplies: [] });
  eq(plan.fullyCovered, false);
  eq(plan.parts.length, 0);
  eq(plan.shortfalls[0].missing, 100);
});

test("الطلب = 0 — يُعامل كتغطية كاملة (لا أسطر)", () => {
  const plan = planAllocation({ required: [req("A", 0)], supplies: [wh("W-1", 5, { "A": 100 })] });
  eq(plan.fullyCovered, true);
  eq(plan.shortfalls.length, 0);
});

test("كمية أصغر من epsilon", () => {
  const plan = planAllocation({ required: [req("A", 0.00005)], supplies: [wh("W-1", 5, { "A": 100 })] });
  eq(plan.fullyCovered, true);
});

test("المخزون بالضبط يساوي الطلب", () => {
  const plan = planAllocation({ required: [req("A", 100)], supplies: [wh("W-1", 5, { "A": 100 })] });
  eq(plan.fullyCovered, true);
  eq(plan.parts.length, 1);
  eq(plan.parts[0].lines[0].quantity, 100);
});

test("مستودعات بالمسافة المتساوية", () => {
  const plan = planAllocation({
    required: [req("A", 100)],
    supplies: [
      wh("W-1", 10, { "A": 60 }),
      wh("W-2", 10, { "A": 50 }),
    ],
  });
  eq(plan.parts.length, 2);
  ok(plan.fullyCovered);
  // الأول يأخذ 60، الثاني 40 (أو العكس حسب الترتيب الأصلي)
  console.log("       allocation:", JSON.stringify(lines(plan)));
});

test("multi-line جزئي — مادة واحدة متوفرة والأخرى لا", () => {
  const plan = planAllocation({
    required: [req("A", 50), req("B", 50)],
    supplies: [wh("W-1", 5, { "A": 50 })],
  });
  eq(plan.fullyCovered, false);
  const shortfallB = plan.shortfalls.find((s) => s.key === "B");
  ok(shortfallB, "should have shortfall for B");
  eq(shortfallB.missing, 50);
  console.log("       shortfalls:", JSON.stringify(plan.shortfalls));
});

test("خوارزمية تختار أقرب مستودع أولاً حتى مع وجود مستودع أبعد但他 يكفي", () => {
  // السيناريو من التفريغ: "إذا كانت متوفرة عند مستودعين، بتأسند للمستودع الأقرب"
  const plan = planAllocation({
    required: [req("mat-A", 100)],
    supplies: [
      wh("W-closest",  2, { "mat-A": 100 }),
      wh("W-middle",  15, { "mat-A": 100 }),
      wh("W-farthest", 50, { "mat-A": 100 }),
    ],
  });
  eq(plan.parts.length, 1);
  eq(plan.parts[0].warehouseId, "W-closest");
  eq(plan.score, 2);
});

// ═══════════════════════════════════════════════════════════════
//  ملخص النتائج
// ═══════════════════════════════════════════════════════════════
console.log("\n" + "=".repeat(56));
console.log("  النتيجة: " + passed + " OK  |  " + failed + " FAIL");
console.log("=".repeat(56));

if (failures.length > 0) {
  console.log("\n  الفشل:");
  failures.forEach((f, i) => console.log("    " + (i + 1) + ". " + f));
}
console.log("");
process.exit(failed > 0 ? 1 : 0);

