// Transactions endpoint, driven through the REAL worker with Clover stubbed.
//
// This endpoint is READ-ONLY and LIVE — there is no stored copy of a payment
// anywhere, so every guard here protects the only thing standing between a
// manager and a wrong answer. Two of them exist because this repo has already
// paid for the lesson:
//
//   * Clover degrades at its retention edge by returning FEWER rows, not an
//     error. An empty list rendered for an out-of-window date reads as "the
//     store took nothing that day" — so the date is refused by name instead.
//   * A failed page is not the end of the list. Serving the short array would
//     under-report a trading day with no visible symptom.
//
// The platform is stubbed; worker.js runs unmodified.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, ctx, req } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };

const worker = await loadWorker(repo);
const { db, env } = makeEnv(repo);
// Deliberately does NOT apply migration-063. The archive tables are created by a
// hand-run migration, so a worker can legitimately reach production before them —
// and every out-of-window request goes through the archive lookup. This suite
// therefore doubles as the proof that the endpoint still refuses cleanly, with a
// 422 and no rows, when those tables do not exist. scripts/test-payment-archive.mjs
// covers the migrated case.
// ⚠️ Must match what the handler reads. A wrong name fails identically to a
// broken stub, and the suite would "pass" on the error branch.
for (const s of ['BL1', 'BL4', 'BL16']) {
  env[`${s}_MERCHANT_ID`] = 'TESTMERCHANT';
  env[`${s}_API_TOKEN`] = 'test-token';
}

const etToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const TODAY = etToday();
const shift = (iso, days) => new Date(Date.parse(iso + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10);

// Clover money is cents; these fixtures speak cents so they look like Clover's.
let ordersOk = true, tendersOk = true;
function stub({ orders = [], refunds = [], credits = [], tenders = [], employees = [] } = {}) {
  ordersOk = true; tendersOk = true;
  globalThis.fetch = async (url) => {
    const u = String(url);
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
    if (u.includes('/orders')) return ordersOk ? json({ elements: orders }) : json({ message: 'boom' }, 500);
    if (u.includes('/refunds')) return json({ elements: refunds });
    if (u.includes('/credits')) return json({ elements: credits });
    if (u.includes('/tenders')) return tendersOk ? json({ elements: tenders }) : json({ message: 'boom' }, 500);
    if (u.includes('/employees')) return json({ elements: employees });
    throw new Error('unexpected outbound fetch: ' + u.slice(0, 120));
  };
}
const call = async (qs, user = 'u-su') =>
  worker.fetch(req(`https://api.retjghub.com/?action=transactions&${qs}`, { user }), env, ctx);
const body = async (r) => { try { return await r.json(); } catch { return {}; } };

const TENDERS = [{ id: 't-cash', label: 'Cash' }, { id: 't-visa', label: 'Credit Card' }, { id: 't-gift', label: 'Gift Card' }];
const EMPLOYEES = [{ id: 'e-1', name: 'Lorrenda Watkins' }, { id: 'e-2', name: 'Reshma Saeed' }];
const at = (hhmm) => Date.parse(`${TODAY}T${hhmm}:00Z`) + 4 * 3600000; // inside the ET day

// ── 1. Guards ─────────────────────────────────────────────────────────────
stub({ tenders: TENDERS, employees: EMPLOYEES });
ok((await call('')).status === 400, 'missing store → 400');
ok((await call('store=BL1&date=nonsense')).status === 400, 'malformed date → 400');
ok((await call(`store=BL1&date=${shift(TODAY, 1)}`)).status === 400, 'future date → 400');

const mgrOwn = await call('store=BL1', 'u-mgr1');
const mgrOther = await call('store=BL4', 'u-mgr1');
ok(mgrOwn.status === 200, 'a manager reaches their own store');
ok(mgrOther.status === 403, 'a manager is refused a store they do not hold');

// The business gate is fail-closed: an action missing from ACTION_BUSINESS
// 403s with UNCLASSIFIED_ACTION for every session call. This is the assertion
// that catches forgetting the map entry.
const gate = await body(mgrOther);
ok(gate.code !== 'UNCLASSIFIED_ACTION', 'the action is classified in ACTION_BUSINESS');

// ── 2. The retention wall ─────────────────────────────────────────────────
const old = await call(`store=BL1&date=${shift(TODAY, -120)}`);
const oldBody = await body(old);
ok(old.status === 422 && oldBody.code === 'BEYOND_RETENTION', 'a date past ~90 days is refused by name, not served empty');
ok(oldBody.ageDays > 90 && oldBody.retentionDays === 90, 'the refusal reports the age and the limit');
ok(!Array.isArray(oldBody.rows), 'the refusal carries NO rows array — nothing can render it as a quiet day');
const justInside = await call(`store=BL1&date=${shift(TODAY, -80)}`);
ok(justInside.status === 200, 'a date inside the window is served');

// BL16 and closed BL12 share one Clover merchant account.
const bl16 = await call('store=BL16&date=2026-06-01');
ok(bl16.status === 422 && (await body(bl16)).code === 'BEFORE_STORE_CUTOVER',
   'BL16 refuses a pre-handover date rather than returning Wyoming payments');

// ── 3. Classification, naming and sign ────────────────────────────────────
stub({
  tenders: TENDERS, employees: EMPLOYEES,
  orders: [
    { id: 'o-1', createdTime: at('14:00'),
      customers: { elements: [{ firstName: 'Penny', lastName: 'Egolof' }] },
      payments: { elements: [{ id: 'p-1', amount: 1578, taxAmount: 110, createdTime: at('14:00'),
        tender: { id: 't-visa' }, employee: { id: 'e-1' }, result: 'SUCCESS' }] } },
    { id: 'o-2', createdTime: at('15:00'),
      payments: { elements: [{ id: 'p-2', amount: 321, taxAmount: 21, cashTendered: 325, createdTime: at('15:00'),
        tender: { id: 't-cash' }, employee: { id: 'e-2' }, result: 'SUCCESS' }] } },
    // Two spellings of a void; both must classify as one.
    { id: 'o-3', createdTime: at('16:00'),
      payments: { elements: [{ id: 'p-3', amount: 999, createdTime: at('16:00'), tender: { id: 't-cash' }, result: 'FAIL' }] } },
    { id: 'o-4', createdTime: at('16:30'),
      payments: { elements: [{ id: 'p-4', amount: 500, createdTime: at('16:30'), tender: { id: 't-cash' }, voided: true, result: 'SUCCESS' }] } },
  ],
  refunds: [{ id: 'r-1', amount: 400, taxAmount: 28, createdTime: at('17:00'),
    payment: { id: 'p-1', tender: { id: 't-visa' } }, orderRef: { id: 'o-1' }, employee: { id: 'e-1' } }],
  credits: [{ id: 'c-1', amount: 250, taxAmount: 0, createdTime: at('18:00'), tender: { id: 't-cash' }, result: 'SUCCESS' }],
});
const d = await body(await call('store=BL1'));
const byId = Object.fromEntries((d.rows || []).map(r => [r.id, r]));

ok(d.counts.payment === 2, `two payments (got ${d.counts.payment})`);
ok(d.counts.void === 2, `both void spellings classify as void (got ${d.counts.void})`);
ok(d.counts.refund === 1 && d.counts.manual === 1, 'refund and manual refund are distinct kinds');

ok(byId['p-1'].tender === 'Credit Card' && byId['p-1'].tenderKind === 'card', 'tender id resolves to its label and glyph');
ok(byId['p-2'].tender === 'Cash' && byId['p-2'].tenderKind === 'cash', 'cash tender resolves');
ok(byId['p-1'].employee === 'Lorrenda Watkins', 'employee id resolves to a name');
ok(byId['p-1'].customer === 'Penny Egolof', 'customer comes off the order');
ok(byId['p-2'].customer === null, 'an order with no customer reports null, not a blank string');
ok(byId['p-2'].cashTendered === 3.25, 'cash tendered is carried in dollars');
ok(byId['p-1'].amount === 15.78 && byId['p-1'].tax === 1.10, 'cents convert to dollars');
ok(byId['r-1'].amount === -4.00, 'a refund is negative');
ok(byId['c-1'].amount === -2.50, 'a manual refund is negative');
ok(byId['r-1'].refundOf === 'p-1', 'a refund names the payment it reverses');

// Totals: a void never counted toward the day, so it never counts here.
ok(d.totals.payments === 18.99, `payments total excludes voids and refunds (got ${d.totals.payments})`);
ok(d.totals.count === 2, 'the payment count matches the payments tab');
ok(d.totals.refunded === 6.50, `refunded sums refunds + manual refunds (got ${d.totals.refunded})`);

// Newest first.
const ts = (d.rows || []).map(r => r.ts);
ok(ts.every((v, i) => i === 0 || ts[i - 1] >= v), 'rows are newest first');

// ── 4. payment.amount, never order.total ──────────────────────────────────
// 🛑 Clover REDUCES order.total for a same-day refund but leaves payment.amount
// at the original. Reading order.total here would show the sale at its
// post-refund value AND list the refund beside it — the same double-deduction
// this repo shipped once already.
stub({
  tenders: TENDERS, employees: EMPLOYEES,
  orders: [{ id: 'o-9', createdTime: at('12:00'), total: 100,
    payments: { elements: [{ id: 'p-9', amount: 2000, createdTime: at('12:00'), tender: { id: 't-cash' }, result: 'SUCCESS' }] } }],
  refunds: [{ id: 'r-9', amount: 1900, createdTime: at('12:30'), payment: { id: 'p-9' }, orderRef: { id: 'o-9' } }],
});
const dd = await body(await call('store=BL1'));
const p9 = dd.rows.find(r => r.id === 'p-9');
ok(p9.amount === 20.00, `the payment reads its own amount, not the refund-reduced order total (got ${p9.amount})`);

// ── 5. A failed page is not a quiet day ───────────────────────────────────
stub({ tenders: TENDERS, employees: EMPLOYEES, orders: [] });
ordersOk = false;
const broke = await call('store=BL1');
const brokeBody = await body(broke);
ok(broke.status === 502 && brokeBody.code === 'INCOMPLETE_FETCH',
   `an incomplete Clover fetch is an error, never an empty list (got ${broke.status})`);
ok(!Array.isArray(brokeBody.rows), 'the incomplete-fetch error carries no rows');

// ── 6. Read-only ──────────────────────────────────────────────────────────
// Nothing about a day's stored numbers may move because someone opened a tab.
const salesBefore = db.prepare('SELECT count(*) c, coalesce(sum(total),0) t FROM daily_sales').get();
stub({ tenders: TENDERS, employees: EMPLOYEES, orders: [] });
await call('store=BL1');
const salesAfter = db.prepare('SELECT count(*) c, coalesce(sum(total),0) t FROM daily_sales').get();
ok(salesBefore.c === salesAfter.c && salesBefore.t === salesAfter.t, 'daily_sales is untouched');
const kvKeys = [...env.SALES_SNAPSHOTS._map.keys()];
ok(kvKeys.every(k => /^clover-(tenders|employees):/.test(k)),
   `KV holds only the two label caches (found ${JSON.stringify(kvKeys)})`);
ok(!kvKeys.some(k => k.startsWith('items:') || k.startsWith('sales:')), 'no snapshot key was written or overwritten');

// ── 7. The label maps cache, but never a partial one ──────────────────────
// A truncated map cached for 24h is how a bad category map once mis-costed a
// store's bins. Serve what we have; do not freeze the gap in place.
env.SALES_SNAPSHOTS._map.clear();
stub({ tenders: TENDERS, employees: EMPLOYEES, orders: [] });
tendersOk = false;
await call('store=BL1');
ok(![...env.SALES_SNAPSHOTS._map.keys()].some(k => k.startsWith('clover-tenders:')),
   'a failed tender page is not cached');
ok([...env.SALES_SNAPSHOTS._map.keys()].some(k => k.startsWith('clover-employees:')),
   'the employee map that DID complete is still cached');

// An unresolved tender degrades to null rather than breaking the row.
env.SALES_SNAPSHOTS._map.clear();
stub({ tenders: [], employees: [],
  orders: [{ id: 'o-x', createdTime: at('10:00'),
    payments: { elements: [{ id: 'p-x', amount: 100, createdTime: at('10:00'), tender: { id: 't-unknown' }, employee: { id: 'e-gone' }, result: 'SUCCESS' }] } }] });
const dx = await body(await call('store=BL1'));
const px = dx.rows.find(r => r.id === 'p-x');
ok(px && px.tender === null && px.employee === null, 'an unresolvable id degrades to null, not a crash');
ok(px && px.tenderKind === 'other', 'an unknown tender takes the neutral glyph');
ok(px && px.amount === 1.00, 'the row still carries its money');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
