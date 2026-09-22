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

// ── 8. The receipt ────────────────────────────────────────────────────────
// 🔑 LINE ITEMS BELONG TO THE ORDER, NOT THE PAYMENT. Clover has no notion of
// which items a given payment covers, so the only two honest answers are "the
// order's basket, labelled as the whole order" and "nothing at all". A guess at
// one payment's share would be invented data, and 0.94% of production orders
// are split-tender, so the case is real rather than theoretical.
const li = (name, priceCents, extra = {}) => ({ name, price: priceCents, ...extra });
stub({
  tenders: TENDERS, employees: EMPLOYEES,
  orders: [
    // Three of one thing. Clover writes one line PER UNIT with no quantity field.
    { id: 'o-a', createdTime: at('09:00'),
      lineItems: { elements: [li('Denim jacket', 999), li('Denim jacket', 999), li('Denim jacket', 999), li('Mug', 250)] },
      payments: { elements: [{ id: 'p-a', amount: 3247, createdTime: at('09:00'), tender: { id: 't-cash' }, result: 'SUCCESS' }] } },
    // Both discount spellings. Reading only `amount` once missed ~70% of them.
    { id: 'o-b', createdTime: at('09:30'),
      lineItems: { elements: [
        li('Lamp', 2000, { discounts: { elements: [{ amount: -500 }] } }),
        li('Rug', 4000, { discounts: { elements: [{ percentage: 25 }] } }),
      ] },
      payments: { elements: [{ id: 'p-b', amount: 4500, createdTime: at('09:30'), tender: { id: 't-cash' }, result: 'SUCCESS' }] } },
    // Weighed goods: unitQty in thousandths is the one quantity Clover models.
    { id: 'o-c', createdTime: at('09:45'),
      lineItems: { elements: [li('Loose beads', 400, { unitQty: 1500 })] },
      payments: { elements: [{ id: 'p-c', amount: 600, createdTime: at('09:45'), tender: { id: 't-cash' }, result: 'SUCCESS' }] } },
    // One basket, two payments.
    { id: 'o-d', createdTime: at('10:15'),
      lineItems: { elements: [li('Armchair', 12000)] },
      payments: { elements: [
        { id: 'p-d1', amount: 6000, createdTime: at('10:15'), tender: { id: 't-cash' }, result: 'SUCCESS' },
        { id: 'p-d2', amount: 6000, createdTime: at('10:16'), tender: { id: 't-visa' }, result: 'SUCCESS' },
      ] } },
    { id: 'o-e', createdTime: at('10:30'),
      lineItems: { elements: [li('Bike', 8000)] },
      payments: { elements: [{ id: 'p-e', amount: 8000, createdTime: at('10:30'), tender: { id: 't-cash' }, voided: true, result: 'SUCCESS' }] } },
    // Same item, same price, one of them returned.
    { id: 'o-f', createdTime: at('10:45'),
      lineItems: { elements: [li('Kettle', 1500, { refunded: true }), li('Kettle', 1500)] },
      payments: { elements: [{ id: 'p-f', amount: 3000, createdTime: at('10:45'), tender: { id: 't-cash' }, result: 'SUCCESS' }] } },
    // A custom-amount sale: an order Clover holds no line items for at all.
    { id: 'o-g', createdTime: at('11:00'),
      payments: { elements: [{ id: 'p-g', amount: 500, createdTime: at('11:00'), tender: { id: 't-cash' }, result: 'SUCCESS' }] } },
  ],
  refunds: [
    { id: 'r-f', amount: 1500, createdTime: at('11:30'), payment: { id: 'p-f', tender: { id: 't-cash' } }, orderRef: { id: 'o-f' } },
    // The original sale was rung on an earlier day, so its order is not in hand.
    { id: 'r-old', amount: 999, createdTime: at('11:45'), payment: { id: 'p-old', tender: { id: 't-cash' } }, orderRef: { id: 'o-from-march' } },
  ],
});
const dr = await body(await call('store=BL1'));
const R = Object.fromEntries((dr.rows || []).map(r => [r.id, r]));

const itemsA = R['p-a'].items;
ok(itemsA.length === 2, `identical lines merge into one row (got ${itemsA.length})`);
ok(itemsA[0].name === 'Denim jacket' && itemsA[0].qty === 3 && itemsA[0].price === 29.97,
   `three units merge to qty 3 at the LINE total (got ${JSON.stringify(itemsA[0])})`);
ok(itemsA[1].qty === 1 && itemsA[1].price === 2.50, 'a single unit reads qty 1');

const itemsB = R['p-b'].items;
ok(itemsB[0].price === 15.00, `an amount discount comes off the price shown (got ${itemsB[0].price})`);
ok(itemsB[1].price === 30.00, `a percentage discount comes off too (got ${itemsB[1].price})`);

ok(R['p-c'].items[0].qty === 1.5 && R['p-c'].items[0].price === 6.00,
   `unitQty gives a fractional quantity (got ${JSON.stringify(R['p-c'].items[0])})`);

// 🛑 The split-tender case. Both payments carry the WHOLE basket, and both say so.
ok(JSON.stringify(R['p-d1'].items) === JSON.stringify(R['p-d2'].items),
   'both payments on one order carry the same basket');
ok(/settled with 2 payments/.test(R['p-d1'].itemsNote || ''),
   `and each names the split rather than implying a share (got ${R['p-d1'].itemsNote})`);
ok(R['p-a'].itemsNote === null, 'a single-payment order carries no caveat — there is nothing to caveat');

ok(/voided/.test(R['p-e'].itemsNote || ''), "a void's basket is labelled as never having completed");

const itemsF = R['p-f'].items;
ok(itemsF.length === 2, 'a returned line does not merge into the identical one that stood');
ok(itemsF.some(i => i.refunded === true) && itemsF.some(i => i.refunded === false),
   'and the returned line is marked');

ok(Array.isArray(R['r-f'].items) && /original order/.test(R['r-f'].itemsNote || ''),
   'a refund shows the original basket, labelled as the order and not as what came back');

// 🛑 The two silences. Neither may be filled with a guess or an empty basket.
ok(R['r-old'].items === undefined,
   'a refund whose original order is not in this day carries NO items key');
ok(R['p-g'].items === undefined,
   'a custom-amount sale with no line items carries no items key either');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
