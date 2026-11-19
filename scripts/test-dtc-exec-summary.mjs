// The DTC Executive Summary (James, 2026-11-19): an Ecommerce row under the stores in each table,
// "Total DTC", and two companion PDFs (BL-Ecommerce-<date>.pdf, BL-Retail-Bins-<date>.pdf) beside the
// Live PDF. Through the real entry points:
//   1. GET ?action=preview-daily-summary&ecom=1 — the DTC copy's figures, worked out by hand below;
//      without ecom=1 the copy has no Ecommerce at all;
//   2. GET ?action=ecom-daily-pdf / retail-bins-pdf — who may read them, and what they say;
//   3. the 5 AM cron — the DTC copy and the Ecommerce PDF go ONLY to a reader the Hub lets see
//      E-Commerce; the Retail & Bins PDF to every chain-wide copy; store managers get neither.
// The figures are made up: this repo is public.
//
// The dataset (report covers Wed 2026-11-18, sent Thu 2026-11-19 05:00 ET):
//   stores — five open stores at retail 70 + bins 30 = 100 a day, plan 100 a day, 10 tickets; Nov 11
//   is retail 80 + bins 20; on Nov 18 Coliseum is retail 80 + bins 40 + 20 Live (12 tickets) and
//   Dupont retail 60 + bins 50. Holland is closed (plan, no sales). Nothing reported after Nov 18.
//   ecommerce — Harrison $20 a day Nov 1-14 (eBay); Shoes and Fashions $40 on Nov 11; Bass River
//   $30 a day Nov 15-17 (Walmart = "other"); Nov 18: Shoes and Fashions $50 + $25.50 (eBay) + $10
//   on Poshmark (company 169 = S&F's card), Dymoda $100 (eBay, 1 unit returned, $30 refunded), and
//   two that are not sales: a cancelled $999 and a $0 order. Plan $57,000 / 30 = $1,900 a day.
process.env.TZ = 'UTC';
const PINNED = '2026-11-19T10:00:00Z';          // 05:00 EST, the send
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...a) { if (a.length === 0) super(PINNED); else super(...a); }
  static now() { return new RealDate(PINNED).getTime(); }
};
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, ctx, req, applyMigrationAlters } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS  ' + m); } else { fail++; console.log('  FAIL  ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
const has = (s, x, m) => ok(s.includes(x), `${m} (looking for ${JSON.stringify(x)})`);
const lacks = (s, x, m) => ok(!s.includes(x), `${m} (must not contain ${JSON.stringify(x)})`);

const sends = [];
globalThis.fetch = async (url, opts = {}) => {
  if (String(url) === 'https://api.resend.com/emails') { sends.push(JSON.parse(opts.body)); return new Response(JSON.stringify({ id: 'msg_' + sends.length }), { status: 200 }); }
  throw new Error(`unexpected network call: ${url}`);
};
const worker = await loadWorker(repo);
const migration = (m) => fs.readFileSync(path.join(repo, `migration-${m}.sql`), 'utf8');
const OPEN = ['BL1', 'BL4', 'BL2', 'BL14', 'BL16'];
const day = (n) => `2026-11-${String(n).padStart(2, '0')}`;

function setup({ ecom = true, sync = 'fresh' } = {}) {
  const h = makeEnv(repo);
  h.db.exec(migration('015'));
  h.db.exec(migration('078'));
  if (ecom) h.db.exec(migration('090'));
  applyMigrationAlters(h.db, repo);
  h.db.exec('DELETE FROM daily_sales');
  const ins = h.db.prepare('INSERT INTO daily_sales (store, date, total, retail, bin, auction, budget, order_count, snapshot_time) VALUES (?,?,?,?,?,?,?,?,?)');
  for (let n = 1; n <= 30; n++) {
    const d = day(n), reported = n <= 18;
    for (const s of [...OPEN, 'BL8']) {
      let retail = 70, bin = 30, live = null, tx = 10;
      if (n === 11) { retail = 80; bin = 20; }
      if (n === 18 && s === 'BL1') { retail = 80; bin = 40; live = 20; tx = 12; }
      if (n === 18 && s === 'BL4') { retail = 60; bin = 50; }
      if (s === 'BL8' || !reported) { retail = 0; bin = 0; live = null; tx = 0; }
      ins.run(s, d, !reported && s === 'BL16' ? null : retail + bin, retail, bin, live, 100, tx, reported ? d + 'T23:55:00Z' : null);
    }
  }
  if (ecom) {
    const o = h.db.prepare(`INSERT INTO ecom_orders (order_id, company_id, unit, order_date, order_time, status_code, source, grand_total, shipping, units, units_returned, refunded, synced_at)
                            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'t')`);
    let id = 1;
    for (let n = 1; n <= 14; n++) o.run(id++, 164, 164, day(n), day(n) + 'T12:00:00', 3, 1, 20, 2, 1, 0, 0);
    o.run(id++, 163, 163, day(11), day(11) + 'T12:00:00', 3, 1, 40, 4, 1, 0, 0);
    for (const n of [15, 16, 17]) o.run(id++, 165, 165, day(n), day(n) + 'T12:00:00', 3, 42, 30, 3, 1, 0, 0);
    o.run(id++, 163, 163, day(18), day(18) + 'T09:00:00', 3, 1, 50, 5, 1, 0, 0);
    o.run(id++, 163, 163, day(18), day(18) + 'T10:00:00', 2, 2, 25.5, 5, 1, 0, 0);
    o.run(id++, 169, 163, day(18), day(18) + 'T11:00:00', 3, 0, 10, 0, 1, 0, 0);
    o.run(id++, 167, 167, day(18), day(18) + 'T20:00:00', 3, 2, 100, 10, 1, 1, 30);
    o.run(id++, 163, 163, day(18), day(18) + 'T21:00:00', -1, 1, 999, 0, 1, 0, 0);   // cancelled: not a sale
    o.run(id++, 165, 165, day(18), day(18) + 'T22:00:00', 3, 21, 0, 0, 500, 0, 0);    // $0 wholesale lot: not a sale
    if (sync) h.env.SALES_SNAPSHOTS._map.set('ecom:sync', JSON.stringify({
      at: new Date(Date.now() - (sync === 'stale' ? 3 * 3600e3 : 15 * 60e3)).toISOString(), ok: sync !== 'failed' }));
  }
  // Item snapshots (categories), the same at every store: Nov 18 and the Wednesday before.
  const snap = (bins, apparel, kids, gm, trees, home) => JSON.stringify({ orderCount: 10, categories: [
    { category: 'Bin Products', qty: 10, netSales: bins, l3Rows: [{ l3: 'Bin Products', qty: 10, netSales: bins }] },
    { category: 'Softline - Apparel', qty: 5, netSales: apparel + kids, l3Rows: [{ l3: 'Apparel', qty: 3, netSales: apparel }, { l3: 'FG BL APPAREL - KIDS', qty: 2, netSales: kids }] },
    { category: 'Seasonal', qty: 4, netSales: gm + trees, l3Rows: [{ l3: 'FG BL SEASONAL - CHRISTMAS - GM', qty: 3, netSales: gm }, { l3: 'FG BALSAM CHRISTMAS TREES B', qty: 1, netSales: trees }] },
    { category: 'Home', qty: 2, netSales: home, l3Rows: [{ l3: 'FG BL HOME - RUGS', qty: 2, netSales: home }] },
  ] });
  for (const s of OPEN) {
    h.env.SALES_SNAPSHOTS._map.set(`items:${s.toLowerCase()}:${day(18)}`, snap(30, 30, 10, 15, 5, 10));
    h.env.SALES_SNAPSHOTS._map.set(`items:${s.toLowerCase()}:${day(11)}`, snap(20, 45, 15, 28, 2, 10));
  }
  // The day's item lines, for the Christmas bin keys: $20 + $16 on 6 items; a $3 regular bin and a
  // "$1 XMAS" register button are not Christmas bin keys.
  const lines = (items) => JSON.stringify(items);
  const il = h.db.prepare("INSERT INTO item_day_lines (store, date, snapshot_time, item_count, net, items_json, other_json) VALUES (?,?,?,?,?,?,'[]')");
  il.run('BL1', day(18), 't', 3, 37, lines([{ name: '$5 Christmas Bin', code: 'BL-12CBIN', l2: 'Bin Products', qty: 4, net: 20 },
    { name: '$3 Bin', code: 'BL-50001-3', l2: 'Bin Products', qty: 5, net: 15 }, { name: '$1 XMAS', code: '', l2: 'Seasonal', qty: 2, net: 2 }]));
  il.run('BL14', day(18), 't', 1, 16, lines([{ name: 'Christmas Bin $8', code: '', l2: 'Bin Products', qty: 2, net: 16 }]));
  // An admin who may see E-Commerce as well as every store.
  h.db.prepare("INSERT INTO users (id,email,role,stores,status,created_at) VALUES ('u-ecadm','ecadm@x.com','admin',NULL,'active','2026-01-01')").run();
  h.db.prepare("INSERT INTO user_grants (user_id,business_id,role,units) VALUES ('u-ecadm','bl','admin',NULL), ('u-ecadm','ecom','admin',NULL)").run();
  return h;
}
const get = async (h, qs, opts = { user: 'u-su' }) => {
  const r = await worker.fetch(req('/?action=' + qs, opts), h.env, ctx);
  return { status: r.status, type: r.headers.get('content-type') || '', bytes: new Uint8Array(await r.arrayBuffer()) };
};
const html = (r) => Buffer.from(r.bytes).toString('utf8');
const pdfText = (bytes) => [...Buffer.from(bytes).toString('latin1').matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map(m => m[1].replace(/\\([()\\])/g, '$1'));
const tdRow = (s, label) => (s.match(new RegExp(`${label}(?:<sup[^>]*>[^<]*</sup>)?</td>((?:\\s*<td[^>]*>[^<]*</td>){3})`, 'g')) || [])
  .map(m => [...m.matchAll(/<td[^>]*>([^<]*)<\/td>/g)].slice(-3).map(x => x[1]));

// ── 1. The DTC copy, by hand ─────────────────────────────────────────────────────────────────────
console.log('the DTC copy (preview, ecom=1)');
{
  const h = setup();
  const s = html(await get(h, 'preview-daily-summary&date=2026-11-18&ecom=1'));
  has(s, '>DTC Executive Summary</h2>', 'renamed');
  has(s, 'All Stores, Live Sales, and Static Listings &nbsp;·&nbsp; Thursday, November 19, 2026', 'the tagline replaces "All Stores"');
  // WTD: stores 4 x 500 + 40 (Coliseum, incl. 20 Live) + 10 (Dupont) = 2,050; Ecommerce 90 + 185.50 = 275.50 -> $276.
  // Plan: stores 2,000 + Ecommerce 4 x 1,900 = 9,600. 2,326 / 9,600 = 24.2%.
  has(s, '>Total DTC WTD Sales</div>', 'headline is DTC');
  has(s, '>$2,326</div>', 'headline sales = stores + Ecommerce');
  has(s, '>$9,600</div>', 'headline plan = stores + Ecommerce plan to date');
  has(s, '>24.2%</div>', 'headline % to plan');
  // Pace: stores 2,050 + last Thu-Sat 1,500 = 3,550; Ecommerce 276 + 60 = 336 -> 3,886 vs 3,500 + 13,300 = 16,800.
  has(s, 'Projected <strong>$3,886</strong> vs full-week plan <strong>$16,800</strong>', 'pace counts Ecommerce on both sides');
  has(s, 'OFF TRACK', 'and it is off track');
  // Ecommerce rows: WTD, Yesterday, MTD — in that order, as the tables are.
  eq(tdRow(s, 'Ecommerce'), [['$276', '$7,600', '−96.4%'], ['$186', '$1,900', '−90.2%'], ['$596', '$57,000', '1.0%']],
     'Ecommerce rows: sales (cancelled and $0 orders left out, refunds NOT taken out), plan $1,900 a day, $57,000 a month');
  eq(tdRow(s, 'Total DTC'), [['$2,326', '$9,600', '−75.8%'], ['$736', '$2,400', '−69.3%'], ['$9,646', '$72,000', '13.4%']],
     'Total DTC = the store rows + Ecommerce, plan likewise');
  lacks(s, '>All Stores</td>', 'the footer row is Total DTC, not All Stores');
  has(s, 'Coliseum $20 (14.3% of Coliseum yesterday sales)', 'Live is still counted once, inside its store');
  has(s, 'Shoes and Fashions (with Poshmark), Harrison Avenue, Bass River, Detail Pro and Dymoda', 'the footer names the five companies');
  has(s, 'including shipping and sales tax,\n        by order date; later refunds are not taken out', 'and says what Ecommerce sales are');
  has(s, '$57,000 a month spread evenly over its days for Ecommerce', 'and what its plan is');
  lacks(s, 'Ecommerce figures', 'no Ecommerce warning when the sync ran 15 minutes ago');
}
{
  const h = setup();
  const s = html(await get(h, 'preview-daily-summary&date=2026-11-18'));
  lacks(s, 'Ecommerce', 'without ecom=1 the copy has no Ecommerce');
  has(s, '>Executive Summary</h2>', '...keeps its name');
  has(s, '>All Stores</td>', '...and its All Stores row');
  const scoped = html(await get(h, 'preview-daily-summary&date=2026-11-18&stores=BL1&ecom=1'));
  lacks(scoped, 'Ecommerce', 'a store-scoped copy never has Ecommerce, even asked');
  const secret = html(await get(h, 'preview-daily-summary&date=2026-11-18&ecom=1', { secret: h.env.SNAPSHOT_SECRET }));
  lacks(secret, 'Ecommerce', 'the admin secret never reads E-Commerce');
}
for (const [sync, words] of [['stale', 'Ecommerce figures were last read at'], ['failed', 'Ecommerce figures were last read with an error'],
                             [null, 'Ecommerce figures have not been read from Sellercloud yet']]) {
  const h = setup({ sync });
  has(html(await get(h, 'preview-daily-summary&date=2026-11-18&ecom=1')), words, `a ${sync || 'missing'} sync is said, so it cannot read as a slow day`);
}
{
  const h = setup({ ecom: false });
  const s = html(await get(h, 'preview-daily-summary&date=2026-11-18&ecom=1'));
  has(s, 'Ecommerce figures could not be read this morning, so this copy leaves Ecommerce out.', 'no ecom_orders: said, never silently left out');
  has(s, '>Executive Summary</h2>', '...and the copy is the plain one');
}

// ── 2. The PDFs on their own ─────────────────────────────────────────────────────────────────────
console.log('\nthe Ecommerce PDF');
{
  const h = setup();
  for (const [who, opts, want] of [['superuser', { user: 'u-su' }, 200], ['admin', { user: 'u-admin' }, 403], ['manager', { user: 'u-mgr1' }, 403],
                                   ['admin secret', { secret: h.env.SNAPSHOT_SECRET }, 403]]) {
    eq((await get(h, 'ecom-daily-pdf&date=2026-11-18', opts)).status, want, `${who}: ${want}`);
  }
  const r = await get(h, 'ecom-daily-pdf&date=2026-11-18');
  ok(r.type === 'application/pdf' && Buffer.from(r.bytes.slice(0, 5)).toString() === '%PDF-', 'a PDF');
  const t = pdfText(r.bytes), all = t.join(' | ');
  if (process.env.DEBUG_PDF) console.log(all);
  has(all, 'Wednesday, November 18, 2026', 'the day');
  has(all, '4 orders  ·  from RETJG HUB (Sellercloud)  ·  sales include shipping and tax', 'subtitle: orders, and that tax is in');
  for (const [x, m] of [['$185.50', 'sales: cancelled and $0 orders left out'], ['+$125.50 vs last Wed', 'vs the same weekday last week (Nov 11: $40 + Harrison $20)'],
                        ['$46.38 per item', 'per item'], ['1.0 item per order', 'items per order'], ['$30.00 last Wed', 'last week\'s order value ($60 / 2)'],
                        ['$30.00 refunded', 'refunds shown, not taken out of sales']]) has(all, x, m);
  has(all, 'Nov 18 sales: eBay $175.50 · Other $0.00 · Poshmark $10.00.', 'not all eBay: the split is given');
  has(all, 'Dymoda drove the gain vs last Wednesday; orders rose from 2 to 4.', 'what moved the day');
  const dayRows = t.slice(t.indexOf('Companies'), t.indexOf('Day total'));
  eq(['Dymoda', 'Shoes and Fashions', 'Harrison Avenue', 'Bass River', 'Detail Pro'].map(n => dayRows.indexOf(n) >= 0), [true, true, true, true, true],
     'every company is listed, sold or not');
  ok(dayRows.indexOf('Dymoda') < dayRows.indexOf('Shoes and Fashions') && dayRows.indexOf('Shoes and Fashions') < dayRows.indexOf('Harrison Avenue'), '...highest sales first');
  has(all, 'Day total | 4 | 4 | $20.00 | $185.50 | $46.38', 'day total row');
  has(all, 'Total | 22 | 22 | 1 | $595.50 | $27.07', 'month total: orders, items, returns, sales, $/order');
  has(all, 'Week to date (Nov 15-18): $275.50 vs $7,600 plan to date; $13,300 full-week plan.', 'week line');
  has(all, 'November to date: $595.50 vs $34,200 plan to date; 1.0% of the $57,000 full-month plan.', 'month line');
  has(all, 'November marketplace sales: eBay $495.50 · Other $90.00 · Poshmark $10.00.', 'marketplace line');
  has(all, 'Nov 1-11', 'the month-to-last-week bar');
  has(all, 'Plan to date uses $1,900 per calendar day. WTD is Sunday through Wednesday; MTD is November 1-18.', 'footer: the plan and the windows');
  lacks(all, 'Eastern', 'no claim that Sellercloud\'s times are Eastern (not confirmed)');
  eq((await get(setup({ ecom: false }), 'ecom-daily-pdf&date=2026-11-18')).status, 404, 'no ecom_orders: 404, no PDF');
}

console.log('\nthe Retail & Bins PDF');
{
  const h = setup();
  for (const [who, opts, want] of [['superuser', { user: 'u-su' }, 200], ['admin secret', { secret: h.env.SNAPSHOT_SECRET }, 200],
                                   ['admin', { user: 'u-admin' }, 403], ['manager', { user: 'u-mgr1' }, 403]]) {
    eq((await get(h, 'retail-bins-pdf&date=2026-11-18', opts)).status, want, `${who}: ${want}`);
  }
  const t = pdfText((await get(h, 'retail-bins-pdf&date=2026-11-18')).bytes), all = t.join(' | ');
  has(all, '5 stores  ·  from RETJG HUB  ·  net sales, excluding Live, auctions and e-commerce', 'subtitle');
  // Nov 18: retail 80+60+70x3 = 350, bins 40+50+30x3 = 180, net 530 (Coliseum's 20 Live left out). Nov 11: 400 + 100.
  for (const [x, m] of [['$530', 'net sales without Live'], ['+$30 vs last Wed', 'vs last Wednesday'], ['$350', 'retail'], ['-12.5% vs last Wed', 'retail change'],
                        ['$180', 'bins'], ['+80.0% vs last Wed', 'bins change'], ['52', 'transactions'], ['+4.0% vs last Wed', 'transaction change'],
                        ['$10.19', 'sales per transaction'], ['+1.9% vs last Wed', 'its change']]) has(all, x, m);
  has(all, 'Coliseum | $80 | $40 | $120 | +20.0% | +20.0% | $420 | $1,820', 'Coliseum row: Live left out, plan includes it (James\'s benchmark)');
  has(all, 'Total | $350 | $180 | $530 | +6.0% | +6.0% | $2,030 | $9,030', 'total row adds the store rows');
  has(all, 'Bins added $80 vs last Wednesday, but retail fell $50. 2 of 5 stores were up in combined sales.', 'what the day did');
  // Categories: the same snapshot at five stores. Live ("Auction") is not a category here.
  has(all, 'Apparel | $200 | $300 | -$100 | -33.3%', 'top category, vs the same weekday last week');
  has(all, 'Bins | $150 | $100 | +$50 | +50.0%', 'bins as a category');
  lacks(all, 'Auction', 'Live is not a category in this report');
  has(all, 'Apparel fell $100, mostly the core Apparel line (-$75). Seasonal fell $50, mostly Christmas GM (-$65).', 'what moved: the biggest falls and their subcategory');
  has(all, 'Christmas bin keys sold $36 on 6 items, about 20% of all bins.', 'Christmas bin keys by the bin split\'s rule');
  has(all, 'Nov 15-18: $2,030  |  +1.5% vs store plan  |  +1.5% vs same days last week.', 'week to date');
  has(all, 'Bins gained $80 week over week; retail fell $50. Coliseum supplied $20 of the $30 WTD plan lead.', 'week movers');
  has(all, 'Nov 1-18: $9,030  |  +0.3% vs store plan to date  |  $2,680 from bins.', 'month to date');
  has(all, 'which include Live sales', 'footer says the store plan includes Live');
  // Ties to the email: Retail & Bins WTD $2,030 + Coliseum's $20 Live = the email's $2,050.
  const s = html(await get(h, 'preview-daily-summary&date=2026-11-18'));
  ok(/>\$2,050<\/td>/.test(s), 'the email\'s store WTD is the PDF\'s $2,030 plus $20 of Live');
}

// ── 3. The 5 AM send: who gets what ──────────────────────────────────────────────────────────────
console.log('\nthe 5 AM send');
{
  const h = setup();
  h.env.RESEND_API_KEY = 'test-key';
  sends.length = 0;
  const waits = [];                              // the send runs in waitUntil: wait for it
  await worker.scheduled({ cron: '0 * * * *', scheduledTime: Date.now() }, h.env, { waitUntil: (p) => waits.push(p), passThroughOnException() {} });
  await Promise.allSettled(waits);
  const to = (email) => sends.find(m => m.to === email) || {};
  const files = (m) => (m.attachments || []).map(a => a.filename);
  for (const [email, who] of [['bhoward@bargainlane.com', 'superuser'], ['ecadm@x.com', 'admin with E-Commerce']]) {
    const m = to(email);
    eq(m.subject, 'DTC Executive Summary — Thu, Nov 19', `${who}: the DTC copy`);
    has(m.html || '', '>Total DTC</td>', `${who}: with Total DTC`);
    eq(files(m), ['BL-Retail-Bins-2026-11-18.pdf', 'BL-Ecommerce-2026-11-18.pdf'], `${who}: both new PDFs (no Whatnot show, so no Live PDF)`);
  }
  const a = to('bgeorges@retjg.com');
  eq(a.subject, 'Executive Summary — Thu, Nov 19', 'admin without E-Commerce: today\'s copy');
  lacks(a.html || '', 'Ecommerce', '...with no Ecommerce in it');
  eq(files(a), ['BL-Retail-Bins-2026-11-18.pdf'], '...and no Ecommerce PDF');
  for (const email of ['howardbrian260@gmail.com', 'alyson@bargainlane.com']) {
    const m = to(email);
    ok(!!m.subject && !/DTC/.test(m.subject) && !/Ecommerce/.test(m.html || ''), `store manager ${email}: their stores only, no Ecommerce`);
    eq(files(m), [], `store manager ${email}: no PDF (the Retail & Bins PDF shows all five stores)`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
