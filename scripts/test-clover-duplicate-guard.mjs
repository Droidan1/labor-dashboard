// The duplicate guard in create-clover-item, which for its whole life created duplicates.
//
// 🛑 WHAT WAS WRONG. It asked Clover to filter items by `code`. Clover answers every such
// request with 400 {"message":"'code' is not a supported field for this filter."} — verified
// against live Clover on 2026-09-02 — and the handler read the reply only inside
// `if (dupResp.ok)`. That block was therefore never entered, the 400 fell through, and the
// item was created regardless. The guard has never blocked anything, and it failed silently:
// no log, no error, nothing to suggest the check had not run.
//
// 🔑 The replacement pages the catalogue instead of asking Clover to filter, matches on
// `code` OR `sku` (create-clover-item writes the same string to both), and — the part that
// matters most — answers null rather than false when it could not look.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log(`  FAIL: ${msg}`); } };
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

console.log('Clover duplicate guard');

const src = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');

// 🔑 NAME THE REGRESSION, DO NOT DIE ON IT. Without this guard, a worker.js missing the
// helper throws while building it, killing the process and taking the other 52 suites with
// it — reporting the very thing under test as a stack trace instead of a named failure.
// That shape of mistake is what this whole feature spent an afternoon on.
const present = src.includes('async function cloverCodeInUse(');
ok(present, '🔑 worker.js defines cloverCodeInUse — without it there is no duplicate guard');

const fnSrc = present
  ? src.slice(src.indexOf('const CLOVER_CODE_SCAN_PAGES'),
              src.indexOf('// ─── Resolve or create a Clover category by name'))
  : null;
const build = (cloverFetch) => {
  if (!present) return async () => ({ inUse: 'ABSENT', why: 'cloverCodeInUse is not defined' });
  try {
    return new Function('cloverFetch', fnSrc + '\n; return cloverCodeInUse;')(cloverFetch);
  } catch (e) {
    return async () => ({ inUse: 'UNBUILDABLE', why: e.message });
  }
};

const env = { BL1_MERCHANT_ID: 'M1' };
const page = (elements, status = 200) => ({
  ok: status >= 200 && status < 300, status,
  json: async () => ({ elements }),
  text: async () => JSON.stringify({ elements }),
});
const item = (i, over = {}) => ({ id: `id${i}`, name: `Item ${i}`, code: `C${i}`, sku: `C${i}`, ...over });
const filler = (n) => Array.from({ length: n }, (_, i) => item(i));

// 🛑 THE ONE THAT WAS BROKEN IN PRODUCTION. Clover rejects the filter; the guard must not
// read that as "no duplicate".
{
  const g = build(async () => page([], 400));
  const r = await g(env, 'BL1', 'C1', {});
  eq(r.inUse, null, '🔑 a 400 is UNKNOWN, never "no duplicate" — this is the whole bug');
  ok(/400/.test(r.why), '…and the status is reported');
}

// Found, on either field.
{
  const byCode = await build(async () => page([item(1), item(2)]))(env, 'BL1', 'C2', {});
  eq(byCode.inUse, true, 'a matching code is found');
  eq(byCode.existingId, 'id2', '…and identifies which item');
  ok(/Item 2/.test(byCode.existingName), '…by name, so the message can say which');

  const bySku = await build(async () => page([item(9, { code: 'OTHER', sku: 'C9' })]))(env, 'BL1', 'C9', {});
  eq(bySku.inUse, true,
     '🔑 a match in `sku` counts too — create-clover-item writes the same string to both');
}

// Absent, and PROVEN absent: a short page is the end of the catalogue.
{
  const r = await build(async () => page([item(1), item(2)]))(env, 'BL1', 'NOPE', {});
  eq(r.inUse, false, 'a short page means the whole catalogue was read, so absent is a fact');
}

// Absent across a page boundary — the second page must actually be fetched.
{
  let calls = 0;
  const g = build(async () => { calls++; return page(calls === 1 ? filler(1000) : [item(1234)]); });
  const r = await g(env, 'BL1', 'C1234', {});
  eq(r.inUse, true, 'a full first page does not end the search');
  eq(calls, 2, '…the next page is actually read');
}

// 🛑 Full pages all the way to the cap: the catalogue was NEVER fully read, so this cannot
// answer false. Answering false here would recreate the original bug by another route.
{
  const g = build(async () => page(filler(1000)));
  const r = await g(env, 'BL1', 'MISSING', {});
  eq(r.inUse, null, '🛑 hitting the page cap is UNKNOWN, not absent');
  ok(/end of the catalogue/.test(r.why), '…and says why it could not be sure');
}

// A thrown fetch is the same event as a refusal. cloverFetch awaits fetch() directly.
{
  const r = await build(async () => { throw new TypeError('network error'); })(env, 'BL1', 'C1', {})
    .catch(e => ({ inUse: 'ESCAPED: ' + e.message }));
  eq(r.inUse, null, 'an unreachable Clover is unknown, and does not escape as a throw');
  ok(/network error/.test(r.why || ''), '…and says what threw');
}

// An unconfigured store cannot be checked, so it cannot be written to either.
{
  const r = await build(async () => page([]))({}, 'BL1', 'C1', {});
  eq(r.inUse, null, 'an unconfigured store is unknown');
  ok(/merchant id/i.test(r.why), '…and blames the config rather than Clover');
}

// ── The handler must act on all three answers ────────────────────────────────
{
  const at = src.indexOf('action") === "create-clover-item"');
  const h = src.slice(at, src.indexOf('action") === "inventory-items"', at));
  ok(h.length > 500, 'the handler slice found the handler');

  ok(!/filter=code%3D/.test(h),
     '🛑 the filter Clover rejects is gone from this handler');
  ok(/await cloverCodeInUse\(env, s, code, headers\)/.test(h),
     '…replaced by the check that pages the catalogue');

  // Ordering is the guard. Both refusals must return BEFORE the POST that creates.
  const nullAt = h.indexOf('dup.inUse === null');
  const dupAt = h.indexOf('if (dup.inUse)');
  const createAt = h.indexOf('method: "POST", headers, body: JSON.stringify(itemBody)');
  ok(nullAt > 0 && dupAt > nullAt, 'both answers are handled, unknown first');
  ok(createAt > dupAt,
     '🔑 …and BOTH refusals return before the create — the ordering IS the guard');
  ok(/Nothing was created/.test(h),
     '🛑 an unanswerable check refuses to create, and says so plainly');
  ok(/stage: "duplicate-check"/.test(h),
     '…under its own stage, so it is not mistaken for a category or item failure');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
