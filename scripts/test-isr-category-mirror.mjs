// ISR_L3_TO_L2 (index.html) must stay a faithful mirror of L3_TO_L2 (worker.js).
//
// The Item Sales Reconciliation tool exists to answer "does the dashboard agree
// with Clover's own Revenue Item Sales report?" — so it re-implements the L3→L2
// rollup client-side to bucket the pasted CSV. That copy had drifted 16 keys
// behind the worker (found 2026-08-10): FRONTE PASTA, FG T BULLSEYE, Refund,
// Gift Cards, Custom Sales, MI Bottle/Can Deposit and 10 more. Every one of them
// fell into the tool's "Unmapped" bucket, so the reconciliation reported a
// discrepancy against the worker's numbers that did not exist.
//
// That failure mode is loud (unmapped rows are listed in the UI) rather than a
// silent mis-booking, so it never corrupted stored data — but it makes the one
// tool whose entire job is checking our arithmetic untrustworthy, which is worse
// than useless. Drift is guaranteed to recur: the two tables sit ~11k lines
// apart in different files and nothing but discipline connects them.
//
// SCOPE NOTE: this parses two source-literal data tables, which is exactly the
// pattern scripts/lib/worker-harness.mjs was written to replace. It is the right
// tool here only because the artifact under test IS the literal, and because the
// client copy lives in a browser <script> block Node cannot import. It does NOT
// prove the ISR tool calls this map — see section 4 for the closest reachable
// check on that.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };

// Pull an object literal out of source and evaluate it. JSON.parse cannot be
// used: both tables carry trailing commas and worker.js's carries a // comment.
// Evaluating our own repo source is safe and is the most faithful read of what
// actually ships.
function extractObjectLiteral(src, declaration, label) {
  let at = -1, count = 0;
  for (let i = src.indexOf(declaration); i !== -1; i = src.indexOf(declaration, i + 1)) {
    if (count === 0) at = i;
    count++;
  }
  if (count === 0) throw new Error(`${label}: could not find "${declaration}"`);
  // A second declaration means someone forked the table; indexOf would silently
  // read only the first and the comparison below would pass while the shipped
  // code used the other one.
  if (count > 1) throw new Error(`${label}: found ${count} declarations of "${declaration}", expected 1`);

  const open = src.indexOf('{', at);
  if (open === -1) throw new Error(`${label}: no "{" after the declaration`);

  let depth = 0, i = open, quote = null;
  for (; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === quote && src[i - 1] !== '\\') quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i === -1) break; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) break;
  }
  if (depth !== 0) throw new Error(`${label}: unbalanced braces — literal never closed`);

  const value = new Function(`"use strict"; return (${src.slice(open, i + 1)});`)();
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label}: literal did not evaluate to a plain object`);
  }
  return value;
}

const workerSrc = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
const clientSrc = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');

const workerMap = extractObjectLiteral(workerSrc, 'const L3_TO_L2 = {', 'worker.js L3_TO_L2');
const clientMap = extractObjectLiteral(clientSrc, 'const ISR_L3_TO_L2 = {', 'index.html ISR_L3_TO_L2');

// ── 1 · the parse itself must not be vacuous ─────────────────────────────
// Without this, a future rename or a brace-matching miss yields {} for both
// maps and every assertion below passes while comparing nothing. This suite has
// no value if it can green-light an empty read.
{
  const FLOOR = 80; // both tables were 89 keys when this guard was written
  ok(Object.keys(workerMap).length >= FLOOR,
     `parsed worker L3_TO_L2 has ${Object.keys(workerMap).length} keys, expected >= ${FLOOR} (parse likely broke)`);
  ok(Object.keys(clientMap).length >= FLOOR,
     `parsed client ISR_L3_TO_L2 has ${Object.keys(clientMap).length} keys, expected >= ${FLOOR} (parse likely broke)`);

  // Anchors from opposite ends of each literal — proves we captured the whole
  // table and not a prefix, and that we grabbed the right one.
  for (const [label, map] of [['worker', workerMap], ['client', clientMap]]) {
    ok(map['BL CONSUMABLES - FOOD - PEPSI'] === 'Consumable Food', `${label} map contains its first entry`);
    ok(map['Sku Book Items'] === 'Sku Book Items', `${label} map contains its last entry`);
    ok(Object.values(map).every(v => typeof v === 'string' && v.length > 0),
       `${label} map values are all non-empty strings`);
  }
}

// ── 2 · zero value conflicts ─────────────────────────────────────────────
// A conflict is the dangerous case: both sides map the category, to different
// L2s, so the reconciliation shows a plausible-looking delta with no unmapped
// row to explain it.
{
  const conflicts = Object.keys(workerMap)
    .filter(k => k in clientMap && workerMap[k] !== clientMap[k])
    .map(k => `${JSON.stringify(k)} worker=${workerMap[k]} client=${clientMap[k]}`);
  ok(conflicts.length === 0, `${conflicts.length} value conflict(s):\n    ` + conflicts.join('\n    '));
}

// ── 3 · zero missing and zero extra keys ─────────────────────────────────
// Missing: the category lands in the ISR "Unmapped" bucket and the tool reports
// a false discrepancy. Extra: the tool buckets a category the worker leaves
// Uncategorized, which is the same false discrepancy with the sign flipped.
{
  const missing = Object.keys(workerMap).filter(k => !(k in clientMap));
  ok(missing.length === 0,
     `${missing.length} key(s) in worker L3_TO_L2 missing from client ISR_L3_TO_L2:\n    ` +
     missing.map(k => `${JSON.stringify(k)} -> ${workerMap[k]}`).join('\n    '));

  const extra = Object.keys(clientMap).filter(k => !(k in workerMap));
  ok(extra.length === 0,
     `${extra.length} key(s) in client ISR_L3_TO_L2 absent from worker L3_TO_L2:\n    ` +
     extra.map(k => `${JSON.stringify(k)} -> ${clientMap[k]}`).join('\n    '));
}

// ── 4 · the ISR tool still reads this map ────────────────────────────────
// Sections 1-3 compare a table to a table; they cannot see whether the paste
// tool actually consumes it. Driving that code needs a DOM, so this is the
// weaker reachable check: the reconciliation body must reference the map by
// name. It catches the "added a second lookup and quietly stopped using this
// one" case, which would otherwise leave this whole suite green and irrelevant.
{
  const uses = (clientSrc.match(/ISR_L3_TO_L2/g) || []).length;
  ok(uses >= 2, `ISR_L3_TO_L2 referenced ${uses}x in index.html — declared but never read`);
  ok(/ISR_L3_TO_L2\s*\[/.test(clientSrc), 'ISR_L3_TO_L2 is indexed by an L3 key somewhere in the ISR tool');
}

console.log(`\ntest-isr-category-mirror: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
