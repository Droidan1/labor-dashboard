// The payment archive, driven through the REAL worker with Clover stubbed.
//
// 🛑 WHAT THESE TESTS ARE PROTECTING. Once a date leaves Clover's ~90-day window
// there is no re-pull: whatever is banked is all that will ever exist for it. So
// a day banked INCOMPLETELY and recorded as complete is permanent and unfixable,
// while a complete day recorded as incomplete costs one re-bank. Every assertion
// below leans the second way, and the three that matter most are:
//
//   * a failed Clover page banks NOTHING (a short array would be permanent)
//   * a day that disagrees with daily_sales is banked at complete=0, not 1
//   * a day already banked complete is never replaced by a thinner fetch
//
// The platform is stubbed; worker.js runs unmodified.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, applyMigrationAlters, ctx, req } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };

const worker = await loadWorker(repo);
const { db, env } = makeEnv(repo);
// The archive tables are born in migration-063; the harness does not build them.
db.exec(fs.readFileSync(path.join(repo, 'migration-063.sql'), 'utf8'));
applyMigrationAlters(db, repo);   // re-run: the harness note says a migration that
                                  // creates tables must be followed by this.
for (const s of ['BL1', 'BL2']) { env[`${s}_MERCHANT_ID`] = 'M'; env[`${s}_API_TOKEN`] = 'T'; }

const etToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const TODAY = etToday();
const shift = (iso, d) => new Date(Date.parse(iso + 'T12:00:00Z') + d * 86400000).toISOString().slice(0, 10);
const at = (iso, h) => Date.parse(`${iso}T${String(h).padStart(2, '0')}:00:00Z`) + 4 * 3600e3;

const TENDERS = [{ id: 't-cash', label: 'Cash' }];
const EMPLOYEES = [{ id: 'e-1', name: 'Lorrenda Watkins' }];
let ordersOk = true;
function stub({ orders = [], refunds = [], credits = [] } = {}) {
  ordersOk = true;
  globalThis.fetch = async (url) => {
    const u = String(url);
    const json = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { 'Content-Type': 'application/json' } });
    if (u.includes('/orders')) return ordersOk ? json({ elements: orders }) : json({ message: 'boom' }, 500);
    if (u.includes('/refunds')) return json({ elements: refunds });
    if (u.includes('/credits')) return json({ elements: credits });
    if (u.includes('/tenders')) return json({ elements: TENDERS });
    if (u.includes('/employees')) return json({ elements: EMPLOYEES });
    throw new Error('unexpected fetch ' + u.slice(0, 90));
  };
}
const pay = (id, iso, h, cents) => ({
  id: 'o-' + id, createdTime: at(iso, h),
  payments: { elements: [{ id, amount: cents, taxAmount: 0, createdTime: at(iso, h), tender: { id: 't-cash' }, employee: { id: 'e-1' }, result: 'SUCCESS' }] },
});
const bank = (qs, user = 'u-su') =>
  worker.fetch(req(`https://api.retjghub.com/?action=bank-transactions&${qs}`, { user, method: 'POST' }), env, ctx);
const read = (qs, user = 'u-su') =>
  worker.fetch(req(`https://api.retjghub.com/?action=transactions&${qs}`, { user }), env, ctx);
const body = async r => { try { return await r.json(); } catch { return {}; } };
const setSales = (store, date, total) =>
  db.prepare('INSERT OR REPLACE INTO daily_sales (store,date,total) VALUES (?,?,?)').run(store, date, total);
const dayRow = (store, date) =>
  db.prepare('SELECT * FROM payment_archive_days WHERE store=? AND date=?').get(store, date);
const rowCount = (store, date) =>
  db.prepare('SELECT count(*) c FROM payment_archive WHERE store=? AND date=?').get(store, date).c;

const D1 = shift(TODAY, -10);

// ── 1. Guards ─────────────────────────────────────────────────────────────
stub({});
ok((await worker.fetch(req(`https://api.retjghub.com/?action=bank-transactions&store=BL1&start=${D1}&end=${D1}`, { user: 'u-su' }), env, ctx)).status !== 200,
   'GET is refused — banking is POST-only');
ok((await bank(`store=BL1&start=${D1}&end=${D1}`, 'u-mgr1')).status === 403, 'a manager cannot bank');
ok((await bank(`store=BL1&start=${D1}&end=${D1}`, 'u-admin')).status === 403, 'an admin cannot bank — superuser only');
ok((await bank('store=BL1&start=nope&end=nope')).status === 400, 'a malformed date is refused');
ok((await bank(`store=BL1&start=${D1}&end=${shift(D1, -2)}`)).status === 400, 'end before start is refused');
const wide = await bank(`store=ALL&start=2020-01-01&end=${TODAY}`);
ok(wide.status === 413 && (await body(wide)).code === 'BUDGET_EXCEEDED', 'an over-wide range is refused, not silently truncated');

// ── 2. Dry run is the default, and it writes nothing ──────────────────────
stub({ orders: [pay('p1', D1, 10, 1000), pay('p2', D1, 11, 2000)] });
setSales('BL1', D1, 30.00);
const dry = await body(await bank(`store=BL1&start=${D1}&end=${D1}`));
ok(dry.dry === true, 'banking is a DRY RUN unless the caller says otherwise');
ok(rowCount('BL1', D1) === 0 && !dayRow('BL1', D1), 'a dry run wrote nothing at all');

// ── 3. A clean day banks, and reconciles ──────────────────────────────────
const wet = await body(await bank(`store=BL1&start=${D1}&end=${D1}&dry=0`));
ok(wet.wrote === 1, 'the day was banked');
ok(rowCount('BL1', D1) === 2, `both payments stored (${rowCount('BL1', D1)})`);
const row = dayRow('BL1', D1);
ok(row.complete === 1, 'it reconciles against daily_sales, so it is marked complete');
ok(row.payments === 2 && Math.abs(row.gross - 30) < 0.01, 'the ledger records the count and gross');

// Idempotent: Clover ids are the primary key.
await bank(`store=BL1&start=${D1}&end=${D1}&dry=0`);
ok(rowCount('BL1', D1) === 2, 're-banking the same day does not duplicate rows');

// ── 4. 🛑 A failed page banks NOTHING ─────────────────────────────────────
const D2 = shift(TODAY, -11);
stub({ orders: [pay('q1', D2, 10, 5000)] });
setSales('BL1', D2, 50.00);
ordersOk = false;
const broke = await body(await bank(`store=BL1&start=${D2}&end=${D2}&dry=0`));
ok(broke.wrote === 0, 'an incomplete Clover fetch banks nothing');
ok(rowCount('BL1', D2) === 0 && !dayRow('BL1', D2), 'and leaves no partial record behind');
ok(broke.report[0].skipped === 'INCOMPLETE_FETCH', 'and says why');
ok(broke.needsAttention.length === 1, 'and names the day as needing attention');

// ── 5. 🛑 Disagreeing with daily_sales means complete = 0 ─────────────────
// Clover degrades at its retention edge by returning FEWER rows, not an error.
const D3 = shift(TODAY, -12);
stub({ orders: [pay('r1', D3, 10, 1000)] });   // $10 banked...
setSales('BL1', D3, 500.00);                    // ...against a $500 day
const under = await body(await bank(`store=BL1&start=${D3}&end=${D3}&dry=0`));
const r3 = dayRow('BL1', D3);
ok(under.wrote === 1 && r3.complete === 0, 'a day that under-reports against daily_sales is banked at complete=0');
ok(/drift/.test(r3.note || ''), `and records why (${r3.note})`);
ok(under.needsAttention.length === 1, 'and is listed as needing attention');

// A day daily_sales says traded, where Clover returns nothing at all.
const D4 = shift(TODAY, -13);
stub({ orders: [] });
setSales('BL1', D4, 800.00);
await bank(`store=BL1&start=${D4}&end=${D4}&dry=0`);
const r4 = dayRow('BL1', D4);
ok(r4.complete === 0 && /no payments/.test(r4.note || ''), 'an empty fetch against a trading day is never complete');

// A genuinely dead day with no stored total agrees with itself.
const D5 = shift(TODAY, -14);
stub({ orders: [] });
await bank(`store=BL2&start=${D5}&end=${D5}&dry=0`);
ok(dayRow('BL2', D5).complete === 1, 'a day with no sales and no daily_sales row is complete, not suspect');

// ── 6. 🛑 A complete day is never replaced by a thinner fetch ─────────────
stub({ orders: [pay('p1', D1, 10, 1000)] });   // one payment where two were banked
const thin = await body(await bank(`store=BL1&start=${D1}&end=${D1}&dry=0`));
ok(thin.report[0].skipped === 'WOULD_LOSE_ROWS', 'a fetch returning fewer rows than a complete day is refused');
ok(rowCount('BL1', D1) === 2, 'and the banked day still has both rows');
const forced = await body(await bank(`store=BL1&start=${D1}&end=${D1}&dry=0&force=1`));
ok(forced.wrote === 1, 'force=1 is the deliberate override, and it is not the default');

// ── 7. The archive serves what Clover no longer can ───────────────────────
const OLD = shift(TODAY, -200);
stub({ orders: [pay('z1', OLD, 12, 4200)] });
setSales('BL1', OLD, 42.00);
// Banking an out-of-window day is allowed — the point is to capture whatever is
// still there — but reading it live is not.
await bank(`store=BL1&start=${OLD}&end=${OLD}&dry=0`);
const served = await read(`store=BL1&date=${OLD}`);
const sBody = await body(served);
ok(served.status === 200, 'a date past retention is SERVED once it is archived');
ok(sBody.archived === true && sBody.live === false, 'and is labelled as coming from the archive');
ok(sBody.rows.length === 1 && sBody.rows[0].id === 'z1', 'with the banked transaction');
ok(sBody.rows[0].tender === 'Cash' && sBody.rows[0].employee === 'Lorrenda Watkins',
   'and the names resolved at BANK time, not re-resolved now');
ok(sBody.archiveComplete === true, 'and its completeness travels with it');

// An out-of-window day that was never banked still refuses by name.
const GONE = shift(TODAY, -201);
const miss = await read(`store=BL1&date=${GONE}`);
const mBody = await body(miss);
ok(miss.status === 422 && mBody.code === 'BEYOND_RETENTION', 'an unbanked out-of-window date is still refused');
ok(mBody.archiveStart === OLD, `and says where the archive begins (${mBody.archiveStart})`);
ok(!Array.isArray(mBody.rows), 'with no rows array — nothing can render it as a quiet day');

// Inside the window Clover stays the source of truth even when a copy exists.
stub({ orders: [pay('live1', D1, 9, 7777)] });
const fresh = await body(await read(`store=BL1&date=${D1}`));
ok(fresh.archived !== true, 'a date inside the window is read LIVE, not from the archive');
ok(fresh.rows.some(r => r.id === 'live1'), 'and reflects what Clover says now');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
