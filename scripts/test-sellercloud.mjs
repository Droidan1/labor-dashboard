// The Sellercloud probe (E-Commerce, 2026-11-18): ?action=sellercloud-probe.
//
// WHAT THIS PROTECTS.
//   - Only a signed-in superuser reaches Sellercloud: not an admin who holds E-Commerce, not a
//     Bargain-Lane-only manager, and never the public X-Snapshot-Secret bypass. None of those
//     makes a single call out.
//   - With no login set, nothing is called and the answer says so.
//   - The probe pages correctly (50 a page, stops on a short page / TotalResults), sends the
//     company and date filters, and reports — rather than trusts — whether the company filter
//     held.
//   - A throttle BODY (Sellercloud's only throttle signal) and an expired token are retried.
//   - Nothing about a buyer, the password, or the bearer token is ever in the response.
// A stubbed Sellercloud stands in for jay.api.sellercloud.us; everything else is the real worker.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, ctx, blockNetwork, req } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const worker = await loadWorker(repo);
blockNetwork();
const blocked = globalThis.fetch;

const { db, env } = makeEnv(repo);
db.prepare("INSERT INTO businesses (id,name,unit_noun,source,active) VALUES ('ecom','E-Commerce','storefront','sellercloud',1)").run();
db.prepare("INSERT INTO user_grants (user_id,business_id,role,units) VALUES ('u-admin','ecom','admin',NULL)").run();

const PASSWORD = 'pw-not-real-Zq9';
const USERNAME = 'probe-user@example.com';

// ── The fake Sellercloud account ────────────────────────────────────────────
// 163: 120 orders → pages of 50, 50, 20. 110 Completed, 5 Canceled, 5 InProcess; 100 eBay, 20 Amazon.
// 164: none. 165: 3. 166 and 167: 1 each. Every order carries a buyer the Hub must not return.
const buyer = { FirstName: 'Secretfirst', LastName: 'Secretlast', CustomerEmail: 'buyer-secret@example.com',
  ShippingAddress: { Address1: '123 Secretstreet', City: 'Nowhere' }, BillingAddress: { Address1: '9 Billingsecret' } };
const ORDERS = [];
const add = (company, n, extra = {}) => ORDERS.push({ ID: 900000 + ORDERS.length, CompanyID: company,
  TimeOfOrder: `2026-11-17T${String(8 + (n % 12)).padStart(2, '0')}:15:00`, CreatedOn: '2026-11-17T09:00:00',
  StatusCode: 3, OrderSource: 1, GrandTotal: 12.34, TaxTotal: 0.8, ShippingTotal: 5,
  Items: [{ Qty: 2, QtyReturned: n % 40 === 0 ? 1 : 0, TotalRefunded: n % 40 === 0 ? 6 : 0,
    ProductID: 'SKU-' + n, DisplayName: 'Item ' + n, LineTotal: 10, SiteCost: n % 2 ? 2.5 : 0, AverageCost: 2.4, LastCost: 0, ImageURL: n % 3 ? 'https://img.example/x.jpg' : '' }],
  ...buyer, ...extra });
for (let n = 1; n <= 120; n++) add(163, n, { StatusCode: n <= 5 ? -1 : n <= 10 ? 2 : 3, OrderSource: n <= 100 ? 1 : 4 });
for (let n = 1; n <= 3; n++) add(165, n, { GrandTotal: 40 });
add(166, 1, { GrandTotal: 99.99, OrderSource: 42 });
add(167, 1, { GrandTotal: 7.5, OrderSource: 77 });
const COMPANIES = [163, 164, 165, 166, 167, 168, 169].map(id => ({ ID: id, CompanyName: 'Co ' + id, IsDisabled: id > 167 }));

let calls = [], tokenCalls = 0, issued = 0;
const fail401 = { n: 0 }, throttle = { n: 0 };
let ignoreCompanyFilter = false, plRefused = false, plBodies = [];
const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

globalThis.fetch = async (u, init = {}) => {
  const url = new URL(String(u));
  if (url.host !== 'jay.api.sellercloud.us') return blocked(u);
  calls.push(url);
  if (url.pathname === '/rest/api/token') {
    tokenCalls++;
    const b = JSON.parse(init.body || '{}');
    if ((init.method || 'GET') !== 'POST' || b.Username !== USERNAME || b.Password !== PASSWORD) return json({ Message: 'invalid credentials' }, 400);
    issued++;
    return json({ access_token: 'tok-secret-' + issued, token_type: 'bearer', expires_in: 1800, '.expires': 'Tue, 18 Nov 2026 15:00:00 GMT' });
  }
  const auth = (init.headers && init.headers.Authorization) || '';
  if (!/^Bearer tok-secret-\d+$/.test(auth)) return json({ Message: 'no token' }, 401);
  if (fail401.n > 0) { fail401.n--; return json({ Message: 'token expired' }, 401); }
  if (throttle.n > 0) { throttle.n--; return json({ Error: 'Too many requests.', RateLimitResetTime: new Date(Date.now() + 200).toISOString() }, 200); }
  if (url.pathname === '/rest/api/Companies') return json({ Items: COMPANIES, TotalResults: COMPANIES.length });
  if (url.pathname === '/rest/api/Orders/ProfitAndLoss') {
    plBodies.push({ method: init.method, body: JSON.parse(init.body || '{}') });
    if (plRefused) return json({ Message: 'Authorization has been denied for this request.' }, 403);
    return json(JSON.parse(init.body).Orders.map(id => ({ OrderID: id, CustomerID: 424242, ItemCost: '5.00', OrderCost: '5.00', Comission: '1.20', TransactionFee: '0.30',
      ShippingCost: '4.00', ProfitLoss: '2.84', ProfitLossPercentage: '23%', OrderItems: [{ ProductID: 'SKU-x', QtySold: 2, OrderUnitSiteCost: 2.5, ProductUnitSiteCost: 2.5,
      SellingPrice: 12.34, ChannelCommission: 1.2, TransactionFee: 0.3, FinalCostTotal: 9.5, Profit: 2.84, ProfitPercent: 23 }] })));
  }
  if (url.pathname === '/rest/api/Orders') {
    const ids = url.searchParams.getAll('companyID').map(Number);
    const size = Number(url.searchParams.get('pageSize') || 10), page = Number(url.searchParams.get('pageNumber') || 1);
    const rows = ORDERS.filter(o => ignoreCompanyFilter || ids.includes(o.CompanyID));
    return json({ Items: rows.slice((page - 1) * size, page * size), TotalResults: rows.length });
  }
  return json({ Message: 'not found' }, 404);
};

const probe = async (qs = '', opts = { user: 'u-su' }) => {
  const r = await worker.fetch(req('/?action=sellercloud-probe' + qs, opts), env, ctx);
  const text = await r.text();
  let body = null; try { body = JSON.parse(text); } catch {}
  return { status: r.status, body, text };
};

// ── 1. no login set: nothing is called ─────────────────────────────────────
{
  calls = [];
  const r = await probe();
  ok(r.status === 503 && r.body && r.body.connected === false, `no login → 503 connected:false, got ${r.status} ${r.text.slice(0, 120)}`);
  eq(calls.length, 0, 'no login → not one call to Sellercloud');
}

env.SELLERCLOUD_USERNAME = USERNAME;
env.SELLERCLOUD_PASSWORD = 'wrong-password';

// ── 2. who may NOT reach it — and none of them calls out ───────────────────
{
  calls = [];
  const mgr = await probe('', { user: 'u-mgr1' });
  ok(mgr.status === 403 && mgr.body.code === 'NO_BUSINESS_ACCESS', `a Bargain-Lane-only manager is refused by the business gate, got ${mgr.status} ${mgr.body && mgr.body.code}`);
  const adm = await probe('', { user: 'u-admin' });
  ok(adm.status === 403 && adm.body.code === 'SUPERUSER_ONLY', `an admin holding E-Commerce is still refused (superuser only), got ${adm.status} ${adm.body && adm.body.code}`);
  const sec = await probe('', { secret: env.SNAPSHOT_SECRET });
  ok(sec.status === 403, `the X-Snapshot-Secret bypass does not reach Sellercloud, got ${sec.status}`);
  const anon = await probe('', {});
  ok(anon.status === 401 || anon.status === 403, `signed out is refused, got ${anon.status}`);
  eq(calls.length, 0, 'none of the refused callers made a call to Sellercloud');
}

// ── 3. a wrong password: one token call, no orders, said plainly ──────────
{
  calls = [];
  const r = await probe();
  ok(r.status === 502 && r.body.ok === false, `bad login → 502 ok:false, got ${r.status}`);
  eq(r.body.errors.map(e => e.step), ['token'], 'the failure is named as the token step');
  eq(calls.filter(u => u.pathname !== '/rest/api/token').length, 0, 'no orders are asked for without a token');
  ok(!r.text.includes('wrong-password'), 'the password is not echoed in the error');
}

env.SELLERCLOUD_PASSWORD = PASSWORD;

// ── 4. the real thing ─────────────────────────────────────────────────────
let main;
{
  calls = [];
  main = await probe('&date=2026-11-17');
  const b = main.body;
  ok(main.status === 200 && b.ok === true, `superuser + login → 200 ok, got ${main.status} ${main.text.slice(0, 200)}`);
  eq(b.date, '2026-11-17', 'date echoed');
  eq(b.window, { from: '2026-11-17', to: '2026-11-18', by: 'order' }, 'window is the day to the next, by order date');
  eq(b.token, { expiresIn: 1800, expires: 'Tue, 18 Nov 2026 15:00:00 GMT' }, 'token lifetime reported from the live response');
  eq(b.companiesVisible.length, 7, 'every company the account can see is listed, not just the five');
  eq(b.companies.map(c => c.id), [163, 164, 165, 166, 167], 'the five companies, in order');
  const c = b.companies[0];
  eq([c.totalResults, c.fetched, c.pages, c.complete], [120, 120, 3, true], '163: 120 orders in 3 pages, complete');
  eq(c.byStatus.Completed && c.byStatus.Completed.orders, 110, '163: 110 Completed');
  eq(c.byStatus.Canceled && c.byStatus.Canceled.orders, 5, '163: 5 Canceled (StatusCode -1)');
  eq(c.byStatus.InProcess && c.byStatus.InProcess.orders, 5, '163: 5 InProcess');
  eq([c.bySource.eBay.orders, c.bySource.Amazon.orders], [100, 20], '163: 100 eBay, 20 Amazon');
  eq(c.grandTotal, 1480.8, '163: GrandTotal summed (120 × 12.34)');
  eq([c.taxTotal, c.shippingTotal], [96, 600], '163: tax and shipping summed');
  eq([c.units, c.unitsReturned, c.refunded], [240, 3, 18], '163: units, returned units, refunded');
  eq(c.otherCompanyIds, [], '163: the company filter held');
  eq(c.timeOfOrder.samples.length, 3, 'raw TimeOfOrder samples kept so the time zone can be read');
  eq([b.companies[1].fetched, b.companies[1].complete], [0, true], '164: an empty day is complete, not an error');
  eq(b.companies[3].bySource.Walmart.orders, 1, '166: OrderSource 42 named Walmart');
  ok(b.companies[4].bySource['source 77'], '167: an unnamed OrderSource is reported by number, not folded into a name');
  const o = calls.filter(u => u.pathname === '/rest/api/Orders');
  eq(o.length, 3 + 1 + 1 + 1 + 1, 'one Orders call per page: 3 + 1 + 1 + 1 + 1');
  const first = o[0].searchParams;
  eq([first.getAll('companyID'), first.get('orderFromDate'), first.get('orderToDate'), first.get('pageSize'), first.get('pageNumber')],
     [['163'], '2026-11-17', '2026-11-18', '50', '1'], 'the first Orders call carries company, dates and a full page');
  eq(o.slice(0, 3).map(u => u.searchParams.get('pageNumber')), ['1', '2', '3'], 'pages walked in order');
  eq(b.calls, 1 + 7, 'calls counted: Companies + 7 Orders pages (the token is not a data call)');
}

// ── 5. nothing private leaves ──────────────────────────────────────────────
{
  for (const s of ['Secretfirst', 'Secretlast', 'buyer-secret@example.com', 'Secretstreet', 'Billingsecret', PASSWORD, USERNAME, 'tok-secret'])
    ok(!main.text.includes(s), `the response does not contain "${s}"`);
}

// ── 6. by=created switches the filter ──────────────────────────────────────
{
  calls = [];
  const r = await probe('&date=2026-11-17&company=165&by=created');
  const p = calls.find(u => u.pathname === '/rest/api/Orders').searchParams;
  eq([p.get('createdOnFrom'), p.get('createdOnTo'), p.get('orderFromDate')], ['2026-11-17', '2026-11-18', null], 'by=created sends createdOn filters instead');
  eq(r.body.companies.map(c => [c.id, c.fetched, c.grandTotal]), [[165, 3, 120]], 'company=165 probes only 165');
}

// ── 7. the default day is yesterday, Eastern ───────────────────────────────
{
  const r = await probe('&company=164');
  const y = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() - 864e5));
  eq(r.body.date, y, 'no date → yesterday in Eastern time');
}

// ── 8. a throttle body and an expired token are retried ────────────────────
{
  throttle.n = 1;
  const r = await probe('&date=2026-11-17&company=165');
  ok(r.status === 200 && r.body.throttled === 1 && r.body.companies[0].fetched === 3, `a "Too many requests." body is waited out and retried, got ${r.status} throttled=${r.body && r.body.throttled}`);
  const before = issued;
  fail401.n = 1;
  const r2 = await probe('&date=2026-11-17&company=165');
  ok(r2.status === 200 && r2.body.companies[0].fetched === 3, `a 401 mid-run gets one fresh token and carries on, got ${r2.status}`);
  eq(issued, before + 1, 'exactly one new token was issued for the 401');
  fail401.n = 5;
  const r3 = await probe('&date=2026-11-17&company=165');
  ok(r3.status === 502 && r3.body.errors.some(e => e.status === 401), `a second 401 is reported, not retried forever, got ${r3.status}`);
  fail401.n = 0;
}

// ── 9. a company filter Sellercloud ignored is REPORTED ────────────────────
{
  ignoreCompanyFilter = true;
  const r = await probe('&date=2026-11-17&company=166');
  const c = r.body.companies[0];
  ok(c.otherCompanyIds.length > 0 && c.otherCompanyIds.includes(163), `orders from other companies are flagged, got ${JSON.stringify(c.otherCompanyIds)}`);
  ignoreCompanyFilter = false;
}

// ── 9b. order-line cost, and Sellercloud's own profit and loss (2026-11-18) ──
{
  calls = []; plBodies = [];
  const plain = await probe('&date=2026-11-17&company=163');
  ok(!plain.body.companies[0].lineCost && !plain.body.profitAndLoss && plBodies.length === 0, 'without items=1 the probe reports no line cost and asks for no profit and loss');
  const r = await probe('&date=2026-11-17&company=163&items=1');
  const lc = r.body.companies[0].lineCost;
  eq([lc.lines, lc.withSiteCost, lc.withAverageCost, lc.withLastCost, lc.withImage], [120, 60, 120, 0, 80], 'counts lines with each cost field and a photo');
  eq([lc.lineTotal, lc.siteCostTotal, lc.averageCostTotal], [1200, 300, 576], 'sums line totals and qty × each cost');
  eq([lc.samples.length, lc.samples[0].sku, lc.orderIds.length], [5, 'SKU-1', 5], 'five sample lines and five order ids');
  eq([plBodies.length, plBodies[0].method, plBodies[0].body.Orders.length], [1, 'POST', 5], "asks Sellercloud's profit and loss for those five orders");
  const pl = r.body.profitAndLoss;
  eq([pl.length, pl[0].itemCost, pl[0].profitLoss, pl[0].lines[0].orderUnitSiteCost, pl[0].lines[0].profit], [5, '5.00', '2.84', 2.5, 2.84], 'reports its item cost, profit and per-line unit cost');
  ok(!r.text.includes('424242') && !r.text.includes('CustomerID'), 'and never the customer');
  plRefused = true;
  const refused = await probe('&date=2026-11-17&company=163&items=1');
  ok(refused.status === 200 && refused.body.profitAndLoss.error && refused.body.profitAndLoss.status === 403, `a refused profit and loss is reported, the probe still answers, got ${refused.status} ${JSON.stringify(refused.body.profitAndLoss).slice(0, 80)}`);
  plRefused = false;
}

// ── 10. bad input dies at validation, before any call ──────────────────────
{
  calls = [];
  const d = await probe('&date=11/17/2026');
  ok(d.status === 400, `a non-ISO date → 400, got ${d.status}`);
  const c = await probe('&company=999');
  ok(c.status === 400, `an unknown company → 400, got ${c.status}`);
  eq(calls.length, 0, 'validation failures made no call to Sellercloud');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
