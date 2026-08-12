#!/usr/bin/env node
// Re-parent the `FG BL SOFTLINES - APPAREL` L3 rows that a bad KV override filed
// under `Softline - Accessories` in stored item snapshots.
//
// WHY THIS IS NOT A RE-SNAPSHOT
//   The obvious repair — re-pull those days from Clover — is the wrong one twice
//   over. CLAUDE.md rule 1: Clover's order retention is ~90 days and decays
//   continuously, so re-pulling a day that is otherwise healthy silently drops
//   refunds that have aged out. The earliest affected day is 2026-06-19, already
//   ~54 days back. And it is unnecessary: the stored snapshot ALREADY holds the
//   correct L3 row with correct amounts — only its parent L2 is wrong. So this is
//   a pure local re-parenting of stored JSON. Zero Clover calls, nothing to lose.
//
//   That is exact because the invariant holds: an L2's totals equal the sum of its
//   l3Rows. Measured across all 1,154 Softline buckets in range, on all six money
//   fields, to the cent. This script re-checks it per snapshot and refuses to touch
//   one where it does not hold.
//
// WHY IT IS SCOPED TO ONE NAMED L3
//   The tempting generalisation — "re-parent every row whose L2 disagrees with the
//   current map" — would also reclassify Hamilton Beach history, which was a
//   deliberate decision NOT to backfill (see memory: isr-category-mirror). Mapping
//   changes are not retroactive by default. This script fixes the one category it
//   was written for and REPORTS any other disagreement without touching it.
//
// The destination L2 is read from worker.js's own L3_TO_L2 rather than hardcoded,
// so this script cannot disagree with the engine about where the row belongs.
//
// Usage:
//   node scripts/repair-softline-apparel-parent.mjs            # dry run (default)
//   node scripts/repair-softline-apparel-parent.mjs --apply    # back up, write, verify
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const NAMESPACE_ID = '8f6062a726fd4fd2afcffc0512790884';   // production SALES_SNAPSHOTS
const TARGET_L3 = 'FG BL SOFTLINES - APPAREL';
const SKU_BOOK_CATEGORY = 'Sku Book Items';   // mirrors worker.js:299
const STORES = ['bl1', 'bl2', 'bl4', 'bl8', 'bl14', 'bl16'];
const FIRST_DAY = '2026-06-19';   // first stored occurrence; nothing earlier exists
const LAST_DAY  = '2026-08-10';   // 08-11 onward is written correctly by the nightly job
const MONEY = ['qty', 'gross', 'discounts', 'refunds', 'netSales', 'cost'];
const COV = ['item', 'category', 'none'];

const APPLY = process.argv.includes('--apply');
const roundCents = n => Math.round(n * 100) / 100;
const money = n => (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2);

let failures = 0;
const die = (msg) => { console.error('\n  ABORT: ' + msg); process.exit(1); };
const check = (cond, msg) => { if (!cond) { failures++; console.error('  FAIL: ' + msg); } };

// ── 1 · destination L2 comes from the engine's own table ──────────────────
// Parsed from source, then proven non-vacuous BEFORE it is trusted: an empty
// parse would otherwise "agree" with everything and report a clean run forever.
function loadL3ToL2() {
  const src = fs.readFileSync(path.join(REPO, 'worker.js'), 'utf8');
  const i = src.indexOf('const L3_TO_L2');
  if (i < 0) die('L3_TO_L2 not found in worker.js');
  const open = src.indexOf('{', i);
  let depth = 0, end = -1;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) { end = j; break; }
  }
  if (end < 0) die('could not find the end of the L3_TO_L2 literal');
  // A JS object literal, not JSON — it carries comments and trailing commas, so
  // it is evaluated as source rather than JSON.parsed.
  const map = new Function('return (' + src.slice(open, end + 1) + ')')();
  if (Object.keys(map).length < 50) die(`L3_TO_L2 parse looks vacuous (${Object.keys(map).length} keys)`);
  return map;
}

const L3_TO_L2 = loadL3ToL2();
const CORRECT_L2 = L3_TO_L2[TARGET_L3];
if (!CORRECT_L2) die(`${TARGET_L3} is not in L3_TO_L2 — nothing to re-parent it to`);
console.log(`L3_TO_L2 parsed: ${Object.keys(L3_TO_L2).length} keys`);
console.log(`destination for ${JSON.stringify(TARGET_L3)}: ${JSON.stringify(CORRECT_L2)} (from worker.js, not hardcoded)`);

const kv = (...args) =>
  execFileSync('npx', ['wrangler', ...args, '--namespace-id', NAMESPACE_ID, '--remote'],
    { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });

// ── 2 · refuse to repair history while the engine still mis-files ─────────
// Repairing stored days before Phase 1 landed would just be undone by the next
// nightly rollup. Assert the live override is gone first.
{
  const ov = JSON.parse(kv('kv', 'key', 'get', 'item-overrides:global'));
  const live = (ov.l3Map || {})[TARGET_L3];
  if (live !== undefined && live !== CORRECT_L2) {
    die(`prod l3Map still maps ${JSON.stringify(TARGET_L3)} -> ${JSON.stringify(live)}.\n`
      + `         Phase 1 must land first, or tonight's rollup re-breaks every day this fixes.`);
  }
  console.log(`prod l3Map check: no conflicting override for this L3 — safe to repair history`);
}

// ── 3 · read every candidate snapshot ─────────────────────────────────────
const dates = [];
for (let d = new Date(FIRST_DAY + 'T00:00:00Z'); d <= new Date(LAST_DAY + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
  dates.push(d.toISOString().slice(0, 10));
}
const keys = dates.flatMap(d => STORES.map(s => `items:${s}:${d}`));
console.log(`\nreading ${keys.length} snapshot keys (${FIRST_DAY} .. ${LAST_DAY}, ${STORES.length} stores)…`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apparel-repair-'));
const snapshots = {};
for (let i = 0; i * 100 < keys.length; i++) {
  const batch = keys.slice(i * 100, (i + 1) * 100);          // API caps bulk get at 100
  const f = path.join(tmp, `k${i}.json`);
  fs.writeFileSync(f, JSON.stringify(batch));
  Object.assign(snapshots, JSON.parse(kv('kv', 'bulk', 'get', f)));
  process.stdout.write(`  batch ${i + 1}/${Math.ceil(keys.length / 100)}\r`);
}
const present = Object.entries(snapshots).filter(([, v]) => v != null);
console.log(`  ${present.length} snapshots present, ${keys.length - present.length} absent (store closed / no trade)\n`);

// ── 4 · plan the transform ────────────────────────────────────────────────
const plan = [];
const otherDisagreements = new Map();   // reported, never touched

for (const [key, raw] of present) {
  const [, store, date] = key.split(':');
  let snap;
  try { snap = JSON.parse(raw); } catch { die(`${key} does not parse`); }
  if (!Array.isArray(snap.categories)) continue;

  // Surface — without acting on — every OTHER row whose parent disagrees with
  // the engine. Silence here would read as "nothing else is wrong".
  for (const c of snap.categories) {
    for (const l of c.l3Rows || []) {
      if (l.l3 === TARGET_L3) continue;
      // "Sku Book Items" is a POS convenience page, not a product category: its
      // items route through SKU_BOOK_TO_L2 to a REAL L2 (Hardlines, Home, …)
      // while keeping that L3 label (worker.js:2700). So a "Sku Book Items" row
      // under Hardlines is correct by design, not drift. Without this the report
      // cried wolf over 338 perfectly good rows.
      if (l.l3 === SKU_BOOK_CATEGORY) continue;
      const want = L3_TO_L2[l.l3];
      if (want && want !== c.category) {
        const k = `${l.l3} :: ${c.category} -> ${want}`;
        const e = otherDisagreements.get(k) || { days: 0, net: 0 };
        e.days++; e.net += Number(l.netSales) || 0;
        otherDisagreements.set(k, e);
      }
    }
  }

  const from = snap.categories.find(c => c.category !== CORRECT_L2 && (c.l3Rows || []).some(l => l.l3 === TARGET_L3));
  if (!from) continue;                                        // already correct, or absent → idempotent no-op
  const row = from.l3Rows.find(l => l.l3 === TARGET_L3);

  // Refuse to touch a snapshot whose own arithmetic does not hold — the
  // transform's exactness depends on it.
  for (const f of MONEY) {
    const sum = from.l3Rows.reduce((a, l) => a + (Number(l[f]) || 0), 0);
    if (Math.abs(sum - (Number(from[f]) || 0)) > 0.011) {
      die(`${key}: "${from.category}".${f} (${from[f]}) != sum of its l3Rows (${sum.toFixed(2)}) — not safe to re-parent`);
    }
  }

  plan.push({ key, store, date, snap, fromName: from.category, row });
}

if (!plan.length) {
  console.log('Nothing to repair — every stored day already files this L3 correctly.');
  process.exit(0);
}

// ── 5 · apply the transform in memory ─────────────────────────────────────
function recalc(c) {
  c.qty = Math.round(c.qty);
  for (const f of ['gross', 'discounts', 'refunds', 'netSales', 'cost']) c[f] = roundCents(c[f]);
  c.extCost = c.cost;
  c.grossProfit = roundCents(c.netSales - c.cost);
  c.gpmPct = c.netSales > 0 ? Math.round((c.grossProfit / c.netSales) * 1000) / 10 : 0;
  c.asp = c.qty > 0 ? roundCents(c.netSales / c.qty) : 0;
  for (const k of COV) c.coverage[k] = roundCents(c.coverage[k]);
  return c;
}

for (const p of plan) {
  const { snap, row } = p;
  const from = snap.categories.find(c => c.category === p.fromName);

  const toBefore = snap.categories.find(c => c.category === CORRECT_L2);
  // Shallow COPIES — `to` is about to be mutated in place, and holding the live
  // reference here would make the "before" column of the diff print after-values.
  p.before = { from: { ...from }, to: toBefore ? { ...toBefore } : null };
  p.beforeTotals = { ...snap.totals };

  // out of the wrong parent
  from.l3Rows = from.l3Rows.filter(l => l !== row);
  for (const f of MONEY) from[f] = (Number(from[f]) || 0) - (Number(row[f]) || 0);
  for (const k of COV) from.coverage[k] = (Number(from.coverage[k]) || 0) - (Number(row.coverage?.[k]) || 0);

  // into the right one, created if this day had no apparel at all
  let to = snap.categories.find(c => c.category === CORRECT_L2);
  if (!to) {
    to = { category: CORRECT_L2, qty: 0, gross: 0, discounts: 0, refunds: 0, netSales: 0,
           asp: 0, cost: 0, extCost: 0, grossProfit: 0, gpmPct: 0,
           coverage: { item: 0, category: 0, none: 0 }, l3Rows: [], pctQty: 0 };
    snap.categories.push(to);
    p.createdTo = true;
  }
  to.l3Rows.push(row);                                        // the row itself is moved untouched
  for (const f of MONEY) to[f] = (Number(to[f]) || 0) + (Number(row[f]) || 0);
  for (const k of COV) to.coverage[k] = (Number(to.coverage[k]) || 0) + (Number(row.coverage?.[k]) || 0);

  recalc(from); recalc(to);

  // an L2 emptied by the move should not linger as a zero row
  if (!from.l3Rows.length && MONEY.every(f => Math.abs(from[f]) < 0.005)) {
    snap.categories = snap.categories.filter(c => c !== from);
    p.removedFrom = true;
  }

  // Only the two touched buckets are recomputed. Every other category is left
  // strictly alone — the grand qty is unchanged, so their pctQty is still right,
  // and not rewriting them is what lets the invariant below prove they are
  // untouched rather than merely re-derived to the same value.
  for (const c of [from, to]) {
    c.l3Rows.sort((a, b) => b.netSales - a.netSales);
    c.pctQty = snap.totals.qty > 0 ? Math.round((c.qty / snap.totals.qty) * 1000) / 10 : 0;
    for (const l of c.l3Rows) l.pctQty = snap.totals.qty > 0 ? Math.round((l.qty / snap.totals.qty) * 1000) / 10 : 0;
  }
  snap.categories.sort((a, b) => b.netSales - a.netSales);   // as a fresh snapshot would be

  p.after = { from: snap.categories.find(c => c.category === p.fromName) || null,
              to: snap.categories.find(c => c.category === CORRECT_L2) };
}

// ── 6 · invariants — money may move between two buckets, and nowhere else ──
//
// NOTE ON THE SUM INVARIANT: it is asserted only on the two buckets this script
// touches, because it is NOT universal. "Other / Non-Item" is a residual bucket
// carrying custom-amount sales, service charges and line-item modifications; it
// holds a total with ZERO l3Rows by design (worker.js:3193-3199) and already
// violated the invariant in 368 snapshots before this script existed. Asserting
// it chain-wide would have flagged 368 pre-existing, correct rows as damage this
// script caused — a false alarm from the checking tool, not a finding.
// Untouched categories are held to something stricter instead: byte-identity.
console.log('── invariants ' + '─'.repeat(66));
for (const p of plan) {
  const orig = JSON.parse(snapshots[p.key]);
  const touched = new Set([p.fromName, CORRECT_L2]);

  for (const f of MONEY) {
    const sum = p.snap.categories.reduce((a, c) => a + (Number(c[f]) || 0), 0);
    check(Math.abs(sum - (Number(p.beforeTotals[f]) || 0)) < 0.011,
      `${p.key}: grand ${f} moved (${p.beforeTotals[f]} -> ${sum.toFixed(2)})`);
  }

  // the two touched buckets must still add up
  for (const c of p.snap.categories.filter(c => touched.has(c.category))) {
    for (const f of MONEY) {
      const sum = c.l3Rows.reduce((a, l) => a + (Number(l[f]) || 0), 0);
      check(Math.abs(sum - (Number(c[f]) || 0)) < 0.011,
        `${p.key}: "${c.category}".${f} != sum of l3Rows after move`);
    }
  }

  // everything else must be byte-identical to what was stored
  for (const c of p.snap.categories.filter(c => !touched.has(c.category))) {
    const was = orig.categories.find(o => o.category === c.category);
    check(was && JSON.stringify(was) === JSON.stringify(c),
      `${p.key}: untouched category "${c.category}" was modified`);
  }
  const gone = orig.categories.map(c => c.category)
    .filter(n => !touched.has(n) && !p.snap.categories.some(c => c.category === n));
  check(!gone.length, `${p.key}: categories vanished: ${gone.join(', ')}`);
  check(JSON.stringify(p.snap.totals) === JSON.stringify(orig.totals),
    `${p.key}: the totals block was modified`);
  const landed = (p.after.to?.l3Rows || []).filter(l => l.l3 === TARGET_L3);
  check(landed.length === 1, `${p.key}: expected exactly 1 ${TARGET_L3} row in ${CORRECT_L2}, got ${landed.length}`);
  check(landed[0] === p.row, `${p.key}: the moved row is not the original object — it was rewritten, not moved`);
  // This is also the idempotency proof: the condition below is character-for-
  // character the one the planner uses to decide a snapshot needs repair, so a
  // snapshot that passes here cannot be picked up by a second run.
  const strays = p.snap.categories.filter(c => c.category !== CORRECT_L2 && (c.l3Rows || []).some(l => l.l3 === TARGET_L3));
  check(!strays.length, `${p.key}: ${TARGET_L3} still present under ${strays.map(c => c.category).join(', ')}`);
}
console.log(failures ? `  ${failures} invariant failure(s)` : `  all invariants hold across ${plan.length} snapshots`);
if (failures) die('invariants failed — nothing written');

// ── 7 · the diff ──────────────────────────────────────────────────────────
console.log('\n── per-day diff ' + '─'.repeat(64));
console.log('store date        moved net    qty   ' + 'Softline - Accessories'.padEnd(24) + 'Softline - Apparel');
console.log('                                     before -> after         before -> after');
let movedNet = 0, movedQty = 0;
const perStore = {};
for (const p of plan.sort((a, b) => (a.date + a.store).localeCompare(b.date + b.store))) {
  movedNet += p.row.netSales; movedQty += p.row.qty;
  const s = perStore[p.store] || (perStore[p.store] = { days: 0, net: 0, qty: 0 });
  s.days++; s.net += p.row.netSales; s.qty += p.row.qty;
  const fb = money(p.before.from.netSales);
  const fa = p.removedFrom ? '(removed)' : money(p.after.from.netSales);
  const tb = p.before.to ? money(p.before.to.netSales) : '(none)';
  const ta = money(p.after.to.netSales) + (p.createdTo ? ' *new' : '');
  console.log(`${p.store.toUpperCase().padEnd(5)} ${p.date}  ${money(p.row.netSales).padStart(9)} ${String(p.row.qty).padStart(5)}   ${(fb + ' -> ' + fa).padEnd(24)}${tb} -> ${ta}`);
}

console.log('\n── totals ' + '─'.repeat(70));
for (const [s, v] of Object.entries(perStore).sort((a, b) => b[1].net - a[1].net)) {
  console.log(`  ${s.toUpperCase().padEnd(5)} ${String(v.days).padStart(3)} days  ${String(v.qty).padStart(5)} qty  ${money(v.net).padStart(11)}`);
}
console.log(`  ${'ALL'.padEnd(5)} ${String(plan.length).padStart(3)} days  ${String(movedQty).padStart(5)} qty  ${money(movedNet).padStart(11)}`);
console.log(`\n  ${plan.length} snapshots change. Grand totals unchanged on every one —`);
console.log(`  money moves from "${plan[0].fromName}" to "${CORRECT_L2}" and nowhere else.`);

if (otherDisagreements.size) {
  console.log('\n── NOT touched: other rows whose parent disagrees with L3_TO_L2 ' + '─'.repeat(15));
  console.log('  (mapping changes are not retroactive by default — listed so the choice is visible)');
  for (const [k, v] of [...otherDisagreements].sort((a, b) => b[1].net - a[1].net)) {
    console.log(`  ${String(v.days).padStart(4)} days  ${money(v.net).padStart(11)}  ${k}`);
  }
}

if (!APPLY) {
  console.log('\nDRY RUN — nothing written. Re-run with --apply to back up and write.');
  process.exit(0);
}

// ── 8 · back up, write, read back, re-verify ──────────────────────────────
const ts = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
const backupDir = path.join(os.homedir(), 'Desktop', 'labor-dashboard-backups', `apparel-reparent-${ts}`);
fs.mkdirSync(backupDir, { recursive: true });
for (const p of plan) fs.writeFileSync(path.join(backupDir, p.key.replace(/:/g, '_') + '.json'), snapshots[p.key]);
const backedUp = fs.readdirSync(backupDir).length;
if (backedUp !== plan.length) die(`backed up ${backedUp} of ${plan.length} snapshots — a failed backup is a failed write`);
for (const p of plan) {                                        // prove each backup is readable, not just present
  const b = JSON.parse(fs.readFileSync(path.join(backupDir, p.key.replace(/:/g, '_') + '.json'), 'utf8'));
  if (!Array.isArray(b.categories)) die(`backup for ${p.key} is unusable as an undo`);
}
console.log(`\nbacked up ${backedUp} snapshots to ${backupDir} (validated)`);

const pairs = plan.map(p => ({ key: p.key, value: JSON.stringify(p.snap) }));
const putFile = path.join(tmp, 'put.json');
for (let i = 0; i * 100 < pairs.length; i++) {
  fs.writeFileSync(putFile, JSON.stringify(pairs.slice(i * 100, (i + 1) * 100)));
  kv('kv', 'bulk', 'put', putFile);
  process.stdout.write(`  wrote batch ${i + 1}/${Math.ceil(pairs.length / 100)}\r`);
}
console.log(`wrote ${pairs.length} snapshots`.padEnd(40));

// ── 9 · verify against prod, POLLING for consistency ──────────────────────
// KV is eventually consistent: a read issued straight after a write can return
// the OLD value for up to ~60s. The first version of this step read back
// immediately and reported 44 failures on a write that had in fact fully
// landed — then told the operator to restore from backup, which would have
// REVERTED a correct repair. A stale read is not a failed write.
//
// So: poll on the full condition, and require two consecutive clean passes
// before declaring success (one clean pass could itself be a lucky cache).
function verifyOnce() {
  const back = {};
  for (let i = 0; i * 100 < plan.length; i++) {
    const f = path.join(tmp, `v${i}.json`);
    fs.writeFileSync(f, JSON.stringify(plan.slice(i * 100, (i + 1) * 100).map(p => p.key)));
    Object.assign(back, JSON.parse(kv('kv', 'bulk', 'get', f)));
  }
  const bad = [];
  for (const p of plan) {
    const got = back[p.key] == null ? null : JSON.parse(back[p.key]);
    if (!got) { bad.push(`${p.key}: read back null`); continue; }
    const to = (got.categories || []).find(c => c.category === CORRECT_L2);
    const stray = (got.categories || []).filter(c => c.category !== CORRECT_L2 && (c.l3Rows || []).some(l => l.l3 === TARGET_L3));
    if (!to || !to.l3Rows.some(l => l.l3 === TARGET_L3)) bad.push(`${p.key}: ${TARGET_L3} not under ${CORRECT_L2}`);
    if (stray.length) bad.push(`${p.key}: still under ${stray.map(c => c.category).join(', ')}`);
    for (const f of MONEY) {
      const sum = (got.categories || []).reduce((a, c) => a + (Number(c[f]) || 0), 0);
      if (Math.abs(sum - (Number(p.beforeTotals[f]) || 0)) > 0.011) bad.push(`${p.key}: prod grand ${f} moved`);
    }
    // untouched categories must be byte-identical in prod too
    for (const c of (got.categories || []).filter(c => ![p.fromName, CORRECT_L2].includes(c.category))) {
      const was = JSON.parse(snapshots[p.key]).categories.find(o => o.category === c.category);
      if (!was || JSON.stringify(was) !== JSON.stringify(c)) bad.push(`${p.key}: untouched "${c.category}" differs in prod`);
    }
  }
  return bad;
}

console.log('\n── verifying against prod ' + '─'.repeat(54));
console.log('  (polling — KV is eventually consistent; a stale read is not a failed write)');
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
let cleanRuns = 0, lastBad = [];
for (let attempt = 1; attempt <= 8 && cleanRuns < 2; attempt++) {
  lastBad = verifyOnce();
  if (lastBad.length === 0) {
    cleanRuns++;
    console.log(`  pass ${attempt}: clean (${cleanRuns}/2 consecutive)`);
  } else {
    cleanRuns = 0;
    console.log(`  pass ${attempt}: ${lastBad.length} not yet consistent — waiting 20s`);
  }
  if (cleanRuns < 2) sleep(20000);
}

if (cleanRuns >= 2) {
  console.log(`\n  VERIFIED: ${plan.length}/${plan.length} snapshots correct in prod, two consecutive clean passes.`);
  console.log(`  Backups retained at ${backupDir}`);
  process.exit(0);
}
console.log(`\n  ${lastBad.length} check(s) still failing after 8 passes — this is NOT stale-read noise.`);
lastBad.slice(0, 20).forEach(m => console.log('    ' + m));
console.log(`\n  Undo with the backups in ${backupDir} (one file per key, original contents).`);
process.exit(1);
