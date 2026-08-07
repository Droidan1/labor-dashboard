// The display fields Raj's own dashboard showed, which our ingest was dropping.
//
// Handler has sent all of these since Slice 1; nothing bound them, so a case
// could only be described as an id, a title and an amount — not by what the
// buyer complained about or what eBay is waiting on.
//
// 🔑 The one worth the most scrutiny is `ebay_url`. Handler's link scheme is NOT
// uniform — RETURN goes to /rt/ReturnDetails?returnId=…, while CASE and INQUIRY
// go to /itm/<itemId>. Measured on his real dashboard: 54 RETURN rows use the
// first form, 14 CASE/INQUIRY rows use the second. Inferring a pattern from the
// RETURN rows would have sent 14 of 37 links to the wrong page — and a wrong
// link is worse than none, because it looks like it worked.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, ctx, req, blockNetwork } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };

blockNetwork();
const worker = await loadWorker(repo);
const { db, env } = makeEnv(repo);
for (const f of ['migration-031.sql', 'migration-033.sql', 'migration-034.sql']) {
  db.exec(fs.readFileSync(path.join(repo, f), 'utf8'));
}
// The harness applies ADD COLUMNs before these CREATEs and swallows failures,
// so ebay_cases' new columns must be replayed from the real files.
for (const f of ['migration-035.sql', 'migration-036.sql']) {
  const body = fs.readFileSync(path.join(repo, f), 'utf8')
    .split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  for (const stmt of (body.match(/ALTER TABLE[^;]+;/gi) || [])) {
    try { db.exec(stmt); } catch (e) { if (!/duplicate column/i.test(e.message)) throw e; }
  }
}
{
  const cols = db.prepare("PRAGMA table_info(ebay_cases)").all().map(c => c.name);
  for (const c of ['buyer_reason', 'activity_due', 'ebay_url', 'item_id', 'available_actions']) {
    ok(cols.includes(c), `migration-036 gave ebay_cases.${c}`);
  }
}
env.EBAY_HANDLER_TOKEN = 'tok';

const hoursFromNow = (h) => new Date(Date.now() + h * 3600e3).toISOString();
const ingest = async (cases) => {
  const r = await worker.fetch(new Request('https://api.retjghub.com/?action=ebay-handler-ingest', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Handler-Token': 'tok' },
    body: JSON.stringify({ state: {
      lastSuccessfulRunAt: hoursFromNow(-1),
      accountStatus: { shoes: { ok: true, queueErrors: 0 } }, cases }, audit: [] }),
  }), env, ctx);
  return JSON.parse(await r.text());
};

// Shaped from Handler's real payload — the three link cases side by side.
await ingest({
  'shoes::RETURN::1': {
    account: 'shoes', caseType: 'RETURN', caseId: '1', ebayState: 'OPEN', isClosed: false,
    buyerCanEscalate: true, respondByDate: hoursFromNow(30), amount: 54.99,
    buyerReason: 'ARRIVED_DAMAGED', activityDue: 'SELLER_APPROVE_REQUEST',
    itemId: '297648514592', ebayUrl: 'https://www.ebay.com/rt/ReturnDetails?returnId=1',
    availableActions: ['SELLER_APPROVE_REQUEST', 'SELLER_ISSUE_REFUND'],
  },
  'shoes::INQUIRY::2': {
    account: 'shoes', caseType: 'INQUIRY', caseId: '2', ebayState: 'OPEN', isClosed: false,
    buyerCanEscalate: true, respondByDate: hoursFromNow(40), amount: 21.03,
    buyerReason: 'ITEM_NOT_RECEIVED', activityDue: null,
    itemId: '297648514592', ebayUrl: 'https://www.ebay.com/itm/297648514592',
    availableActions: [],
  },
  // The real gap: 3 of 37 live cases carry no ebayUrl and no activityDue.
  'shoes::CASE::3': {
    account: 'shoes', caseType: 'CASE', caseId: '3', ebayState: 'OPEN', isClosed: false,
    buyerCanEscalate: true, respondByDate: hoursFromNow(50), amount: 10,
    buyerReason: 'WRONG_SIZE', itemId: '406216780716',
  },
  // No ebayUrl AND no itemId — must render unlinked, not as a broken link.
  'shoes::CASE::4': {
    account: 'shoes', caseType: 'CASE', caseId: '4', ebayState: 'OPEN', isClosed: false,
    buyerCanEscalate: true, respondByDate: hoursFromNow(60), amount: 5,
  },
});

const read = async () => {
  const r = await worker.fetch(req('/?action=ebay-cases', { user: 'u-su' }), env, ctx);
  return JSON.parse(await r.text());
};
const body = await read();
const byId = Object.fromEntries([...body.actionable, ...body.appeals].map(c => [c.case_id, c]));

// ── The fields survive the round trip ─────────────────────────────────────
{
  ok(byId['1'].buyer_reason === 'ARRIVED_DAMAGED', `buyer_reason stored, got ${byId['1'].buyer_reason}`);
  ok(byId['1'].activity_due === 'SELLER_APPROVE_REQUEST', `activity_due stored, got ${byId['1'].activity_due}`);
  ok(byId['1'].item_id === '297648514592', `item_id stored, got ${byId['1'].item_id}`);
  ok(JSON.parse(byId['1'].available_actions).length === 2,
     `available_actions round-trips as JSON, got ${byId['1'].available_actions}`);
}

// ── 🔑 The link scheme is preserved per queue type, not inferred ──────────
{
  ok(byId['1'].ebay_url === 'https://www.ebay.com/rt/ReturnDetails?returnId=1',
     `RETURN keeps its ReturnDetails link, got ${byId['1'].ebay_url}`);
  ok(byId['2'].ebay_url === 'https://www.ebay.com/itm/297648514592',
     `INQUIRY keeps its /itm/ link, got ${byId['2'].ebay_url}`);
  // The two forms genuinely differ — if this ever passes trivially the test has
  // stopped covering the thing it exists for.
  ok(!byId['1'].ebay_url.includes('/itm/') && !byId['2'].ebay_url.includes('ReturnDetails'),
     'the two link forms are genuinely different, so a single inferred pattern could not serve both');
}

// ── Gaps stay null rather than becoming "undefined" ──────────────────────
{
  ok(byId['3'].ebay_url === null, `a case with no ebayUrl stores NULL, got ${byId['3'].ebay_url}`);
  ok(byId['3'].activity_due === null, `no activityDue stores NULL, got ${byId['3'].activity_due}`);
  ok(byId['3'].item_id === '406216780716', 'but its itemId is kept — the client can fall back to /itm/');
  ok(byId['4'].ebay_url === null && byId['4'].item_id === null,
     'a case with neither renders unlinked rather than as a broken link');
  ok(byId['2'].available_actions === '[]',
     `an empty options array is stored as [], not null, got ${byId['2'].available_actions}`);
}

// ── 🛑 The string "undefined" must never reach the client ────────────────
// str() coerces with String(v), so a missing field passed carelessly becomes the
// literal text "undefined" in the UI — the classic version of this bug.
{
  const raw = JSON.stringify(body);
  ok(!raw.includes('"undefined"'), 'no field serialises as the string "undefined"');
  ok(!/undefined/.test(String(byId['4'].buyer_reason)), 'a wholly absent field is null, not "undefined"');
}

// ── A second run updates them (the ON CONFLICT list covers the new columns) ──
// Easy to add columns to the INSERT and forget the upsert clause; the symptom is
// values that are correct on first sight and then frozen forever.
{
  await ingest({
    'shoes::RETURN::1': {
      account: 'shoes', caseType: 'RETURN', caseId: '1', ebayState: 'OPEN', isClosed: false,
      buyerCanEscalate: true, respondByDate: hoursFromNow(30), amount: 54.99,
      buyerReason: 'NOT_AS_DESCRIBED',            // changed
      activityDue: 'SELLER_PROVIDE_LABEL',        // changed
      itemId: '297648514592', ebayUrl: 'https://www.ebay.com/rt/ReturnDetails?returnId=1',
      availableActions: ['SELLER_VOID_LABEL'],    // changed
    },
  });
  const b2 = await read();
  const c1 = [...b2.actionable, ...b2.appeals].find(c => c.case_id === '1');
  ok(c1.buyer_reason === 'NOT_AS_DESCRIBED', `buyer_reason updates on re-ingest, got ${c1.buyer_reason}`);
  ok(c1.activity_due === 'SELLER_PROVIDE_LABEL', `activity_due updates, got ${c1.activity_due}`);
  ok(c1.available_actions === '["SELLER_VOID_LABEL"]', `available_actions updates, got ${c1.available_actions}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
