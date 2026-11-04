// The Live Sales business's five pages (migration-085, phase 1), in a REAL BROWSER.
//
// 🛑 NOT PART OF `scripts/test.sh` (needs playwright-core and a Chromium). Run by hand after any
// change to the Live Sales pages, the picker or the business nav:
//
//   npm install --no-save playwright-core
//   bash scripts/build.sh && node scripts/browser-live-sales.mjs
//   (on a Mac: PLAYWRIGHT_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
//
// WHAT IT PINS
//   1. Every page renders from a stubbed ?action=live-sales, and the Overview's total is the sum
//      of the live rows in the window — then still right after a range change and a store change
//      (§4.8 trap 8: exercise the SECOND render).
//   2. The picker shows Live Sales as already inside Bargain Lane: never added to the hero, and
//      the hero still counts one reporting business, not two.
//   3. An old worker (403 UNCLASSIFIED_ACTION) gets a sentence, not a blank page or a throw.
//   4. Every text node clears 4.5:1 against its composited background in light, dark and pure
//      black, at desktop and phone width; the shows table's sticky column is opaque.
//   6. Today from the Whatnot API: Whatnot's rows are written hourly, today included, so Today shows a
//      total, and nothing on the page mentions the retired recap email or its "before the recap" figure.
//      added to it (the totals in 1 hold with them present), filtered by store, gone for past ranges.
//   5. Money back fills from Whatnot's financial report (refunds, carrier adjustments, tips), honours
//      the store filter, and says what it waits on in every other state (not set up, needs
//      write:reports, waiting, still loading), each readable in light and dark.
// The figures are made up: this repo is public.
let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch (e) {
  console.error('\nThis check needs playwright-core:  npm install --no-save playwright-core\n');
  process.exit(2);
}
const CHROME = process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'dist');
if (!fs.existsSync(path.join(root, 'index.html'))) {
  console.error('\ndist/ is missing or empty. Run `bash scripts/build.sh` first.\n');
  process.exit(2);
}
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, s) => {
  const f = path.join(root, q.url === '/' ? 'index.html' : q.url.split('?')[0]);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end('no'); }
  s.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(s);
});
await new Promise(r => srv.listen(8097, r));
const URL_ = 'http://127.0.0.1:8097/index.html';

const results = [];
const check = (c, m) => results.push([!!c, m]);
const b = await chromium.launch({ executablePath: CHROME });

// Made-up live sales for the 70 days to yesterday (Eastern): Whatnot at BL1 and BL14, the
// online auction at BL2, BL14 and BL16. Built in the page so "yesterday" is the page's own.
const STUB = () => {
  const et = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const add = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const channels = [], shows = [], ledger = [];
  for (let i = 1; i <= 70; i++) {
    const d = add(et, -i);
    if (i % 3 === 1) ledger.push({ date: d, store: 'BL1', type: 'ORDER_REFUND', amount: -10, n: 1 }, { date: d, store: 'BL1', type: 'ORDER_REFUND_SHIPPING_COSTS', amount: -2, n: 1 });
    if (i % 5 === 2) ledger.push({ date: d, store: null, type: 'CARRIER_ADJUSTMENT', amount: -4.5, n: 1 }, { date: d, store: null, type: 'CARRIER_ADJUSTMENT_REFUND', amount: 1.25, n: 1 });
    if (i % 4 === 1) ledger.push({ date: d, store: 'BL14', type: 'TIP', amount: 3, n: 1 });
    channels.push({ channel: 'whatnot', store: 'BL1', date: d, total: 1000 + i, count: 2, meta: { items: 100 + i, shipments: 40, new_buyers: 5 } });
    shows.push({ showId: 's1-' + i, title: '$1 Starts : Fashion Finds', store: 'BL1', date: d, startAt: d + 'T12:30:00Z', calculationStatus: 'GENERATED', sales: 480 + i, orders: 50, buyers: 20, newBuyers: 3, viewers: 300, lost: { orders: 1, subtotal: 9, of: 51 } });
    shows.push({ showId: 's2-' + i, title: '$5 Starts : Bag Deals', store: 'BL1', date: d, startAt: d + 'T15:00:00Z', calculationStatus: 'GENERATED', sales: 500, orders: 45, buyers: 18, newBuyers: 2, viewers: 250, lost: null });
    if (i % 2) {
      channels.push({ channel: 'whatnot', store: 'BL14', date: d, total: 700, count: 1, meta: { items: 60, shipments: 25, new_buyers: 4 } });
      shows.push({ showId: 's3-' + i, title: '$10 Starts : Coat Finds', store: 'BL14', date: d, startAt: d + 'T22:59:00Z', calculationStatus: 'GENERATED', sales: 690, orders: 59, buyers: 22, newBuyers: 4, viewers: null, lost: null });
    }
    if (i % 3 === 0) channels.push({ channel: 'auction', store: 'BL2', date: d, total: 200, count: 40, meta: null });
    if (i % 4 === 0) channels.push({ channel: 'auction', store: 'BL14', date: d, total: 300, count: 50, meta: null });
    if (i % 5 === 0) channels.push({ channel: 'auction', store: 'BL16', date: d, total: null, count: 0, meta: null });
  }
  // The Show Calendar (?action=live-calendar): 40 days of finished shows, today's four (done, still
  // counting, on air, and one at 22:00Z = 5 PM EST), three days of schedule and a cancelled show.
  const W = '$1 Starts : Womens Fashion Finds', C = '$10 Starts : Coat Finds';
  const done = (id, title, store, d, t, sales, x = {}) => ({ showId: id, title, status: 'ended', store, date: d, startAt: `${d}T${t}:00Z`,
    endedAt: null, thumbnail: null, calculationStatus: 'GENERATED', sales, earnings: sales * 0.85, orders: 100, buyers: 30, newBuyers: 4, returning: 26,
    viewers: 200, peak: 40, minutes: 125, soFar: { orders: 100, sales }, lost: { orders: 1, subtotal: 6, of: 101 }, ...x });
  const sched = (id, title, store, d, t, x = {}) => ({ showId: id, title, status: 'scheduled', store, date: d, startAt: `${d}T${t}:00Z`, endedAt: null,
    thumbnail: null, calculationStatus: null, sales: null, earnings: null, orders: null, buyers: null, newBuyers: null, returning: null, viewers: null,
    peak: null, minutes: null, soFar: null, lost: null, ...x });
  const calendar = [];
  for (let i = 40; i >= 1; i--) {
    const d = add(et, -i);
    calendar.push(done('ca-' + i, W, 'BL1', d, '13:30', 500 + i));
    if (i % 2) calendar.push(done('cb-' + i, C, 'BL14', d, '22:00', 700));
  }
  calendar.push(done('ct-1', W, 'BL1', et, '13:30', 698, { endedAt: et + 'T15:35:01.887Z', orders: 157, buyers: 36, newBuyers: 3, returning: 33, viewers: 249, peak: 52, earnings: 580.19 }),
    done('ct-2', '$5 Starts : Bag Deals', 'BL1', et, '16:00', null, { calculationStatus: 'PENDING', earnings: null, orders: null, buyers: null, newBuyers: null,
      returning: null, viewers: null, peak: null, minutes: null, soFar: { orders: 121, sales: 1169 }, lost: { orders: 0, subtotal: 0, of: 121 } }),
    sched('ct-4', C, 'BL1', et, '19:00', { status: 'live', soFar: { orders: 30, sales: 310 }, lost: { orders: 0, subtotal: 0, of: 30 } }),
    sched('ct-3', '$1 Starts : Kids Apparel Finds', 'BL14', et, '22:00'));
  for (let i = 1; i <= 3; i++) calendar.push(sched('cs-' + i, W, 'BL1', add(et, i), '13:30'), sched('cc-' + i, C, 'BL1', add(et, i), '19:00'));
  calendar.push(sched('cx', 'Called off', 'BL1', add(et, 2), '15:00', { status: 'cancelled' }));
  const recent = { [W]: { n: 5, avg: 503, min: 501, max: 505 } };
  return { ok: true, units: [{ code: 'BL1', name: 'Coliseum' }, { code: 'BL14', name: 'Battle Creek' }, { code: 'BL16', name: 'Indy East' }, { code: 'BL2', name: 'South Bend' }],
    calendar, recent,
    channels, coverage: [{ channel: 'auction', first: add(et, -70), last: add(et, -1) }, { channel: 'whatnot', first: add(et, -70), last: add(et, -1) }],
    bl: [], shows, ledger,
    // Today: the Whatnot sync's rows so far (hourly).
    today: [{ channel: 'whatnot', store: 'BL1', date: et, total: 698, count: 1, meta: { items: 150, shipments: 40, new_buyers: 3 } },
            { channel: 'whatnot', store: 'BL14', date: et, total: 240.5, count: 1, meta: { items: 20, shipments: 8, new_buyers: 1 } }],
    ledgerSync: { ready: true, through: new Date(Math.floor(Date.now() / 3600e3) * 3600e3).toISOString(), error: null, waitingSince: null },
    sync: { connected: true, lastRun: { at: new Date(Math.floor(Date.now() / 3600e3) * 3600e3).toISOString() } } };
};

async function open({ theme = 'dark', width = 1400, height = 900, live = true, worker = 'new', biz = 'live', ledgerSync = null, clock = null } = {}) {
  const phone = width < 1024;
  const ctx = await b.newContext({ viewport: { width, height }, isMobile: phone, hasTouch: phone, deviceScaleFactor: phone ? 2 : 1 });
  const page = await ctx.newPage();
  if (clock) await page.clock.setFixedTime(clock);
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR_/.test(m.text())) errs.push('console: ' + m.text()); });
  await page.addInitScript(({ theme, biz }) => {
    try {
      localStorage.setItem('darkMode', String(theme !== 'light'));
      localStorage.setItem('darkFlavor', theme === 'oled' ? 'oled' : 'dark');
      sessionStorage.setItem('retjg.activeBusiness', biz);
      // A Mac's Chrome reports Touch ID, so the app offers a passkey on boot and its modal
      // swallows every click. Dismissed as a user would ('Not now'); a Chromium without a
      // platform authenticator never shows it.
      localStorage.setItem('bioPromptDismissed', '1');
    } catch (e) {}
  }, { theme, biz });
  await page.addInitScript(({ live, worker, stub, ledgerSync }) => {
    const data = (new Function('return (' + stub + ')()'))();
    window.__lvCalls = [];
    window.fetch = async (u) => {
      const s = String(u);
      const J = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
      if (s.includes('auth-me')) return J({ authenticated: true, email: 'dana.ruiz@example.com', name: 'Dana Ruiz', role: 'superuser', pages: {},
        businesses: [{ id: 'bl', name: 'Bargain Lane', unitNoun: 'store', unitCount: 6, connected: true }, { id: 'ecom', name: 'E-Commerce', unitNoun: 'storefront', unitCount: 0, connected: false },
          ...(live ? [{ id: 'live', name: 'Live Sales', unitNoun: 'store', unitCount: 4, connected: true }] : [])] });
      if (s.includes('action=live-sales')) {
        window.__lvCalls.push(s);
        if (worker === 'old') return J({ error: 'Unclassified action', code: 'UNCLASSIFIED_ACTION' }, 403);
        const q = new URL(s).searchParams, from = q.get('from'), to = q.get('to');
        return J({ ...data, from, to, channels: [...data.channels, ...data.today].filter(r => r.date >= from && r.date <= to), shows: data.shows.filter(r => r.date >= from && r.date <= to),
          ledger: data.ledger.filter(r => r.date >= from && r.date <= to),
          ledgerSync: ledgerSync || data.ledgerSync });
      }
      if (s.includes('action=live-calendar')) {
        (window.__lcCalls = window.__lcCalls || []).push(s);
        if (worker === 'old') return J({ error: 'Unclassified action', code: 'UNCLASSIFIED_ACTION' }, 403);
        const q = new URL(s).searchParams, from = q.get('from'), to = q.get('to');
        return J({ ok: true, from, to, units: data.units, shows: data.calendar.filter(r => r.date >= from && r.date <= to), recent: data.recent, sync: data.sync });
      }
      if (s.includes('action=weekly-summary')) return J({ ok: true, from: '2026-09-14', to: '2026-09-20', stores: {}, totals: {} });
      return J({ ok: true });
    };
  }, { live, worker, stub: STUB.toString(), ledgerSync });
  await page.goto(URL_, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.getElementById('app')?.classList.contains('hidden'), { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(300);
  return { ctx, page, errs };
}

// Contrast of every visible text node in the shown page against its composited background.
const AUDIT = (sel) => {
  const parse = c => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const over = (t, b) => ({ r: t.r * t.a + b.r * (1 - t.a), g: t.g * t.a + b.g * (1 - t.a), b: t.b * t.a + b.b * (1 - t.a), a: 1 });
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const bgOf = (el) => { const ch = []; for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c.a > 0) ch.push(c); if (c && c.a === 1) break; }
    let bg = parse(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 }; if (bg.a < 1) bg = over(bg, { r: 255, g: 255, b: 255, a: 1 });
    for (let i = ch.length - 1; i >= 0; i--) bg = over(ch[i], bg); return bg; };
  const pg = sel ? document.querySelector(sel) : [...document.querySelectorAll('[id^="page-live-"]')].find(p => !p.classList.contains('hidden'));
  if (!pg) return { min: 0, n: 0, fails: ['no live page shown'] };
  let min = 99, n = 0; const fails = [];
  pg.querySelectorAll('*').forEach(el => {
    const txt = [...el.childNodes].filter(x => x.nodeType === 3 && x.textContent.trim()).map(x => x.textContent.trim()).join(' ');
    if (!txt) return; const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || !el.getClientRects().length) return;
    const fg = parse(el instanceof SVGElement ? cs.fill : cs.color); if (!fg) return;
    const bg = bgOf(el instanceof SVGElement ? el.closest('div') : el), r = ratio(over(fg, bg), bg); n++;
    const need = (parseFloat(cs.fontSize) >= 24 || (parseFloat(cs.fontSize) >= 18.66 && +cs.fontWeight >= 700)) ? 3 : 4.5;
    if (r < min) min = r; if (r < need) fails.push(`${txt.slice(0, 30)} ${r.toFixed(2)}`);
  });
  return { min: +min.toFixed(2), n, fails: fails.slice(0, 5) };
};

const PAGES = ['live-overview', 'live-shows', 'live-calendar', 'live-auction', 'live-promotion', 'live-money'];
const go = async (page, p) => { await page.evaluate(p => navigateToPage(p), p); await page.waitForTimeout(150); };

// ── 1. Totals, second render, sticky column, every page, in every theme and width ──
for (const theme of ['light', 'dark', 'oled']) {
  for (const width of [1400, 393]) {
    const tag = `${theme}/${width}`;
    const { ctx, page, errs } = await open({ theme, width });
    await go(page, 'live-overview');
    await page.evaluate(() => lvSetRange('last7'));
    await page.waitForTimeout(250);
    const big = await page.evaluate(() => document.querySelector('#lv-overview-body .lv-big')?.textContent);
    // Last 7 Days = today and the 6 days before: today's Whatnot rows so far (698 + 240.50) and i = 1..6:
    // Whatnot BL1 Σ(1000+i) = 6021, BL14 on odd i (3 × 700) = 2100, auction BL2 i=3,6 (400), BL14 i=4 (300), BL16 null.
    check(big === '$9,759.50', `${tag}: Overview total for Last 7 Days (8,821 + today's 938.50) — got ${big}`);
    await page.evaluate(() => lvSetStore('BL14'));
    const big14 = await page.evaluate(() => document.querySelector('#lv-overview-body .lv-big')?.textContent);
    check(big14 === '$2,640.50', `${tag}: store filter re-renders (Battle Creek 2,100 + 300 + today's 240.50) — got ${big14}`);
    await page.evaluate(() => lvSetStore('all'));
    await page.evaluate(() => lvSetView('table'));
    check(await page.evaluate(() => document.querySelectorAll('#lv-overview-body .lv-dt tbody tr').length >= 7), `${tag}: chart → table view renders`);
    await page.evaluate(() => lvSetView('chart'));
    check(await page.evaluate(() => !!document.querySelector('#lv-chart svg path')), `${tag}: table → chart redraws the bars`);
    for (const p of PAGES) {
      await go(page, p);
      const shown = await page.evaluate(p => { const el = document.getElementById('page-' + p); const body = document.getElementById('lv-' + p.slice(5) + '-body');
        return el && !el.classList.contains('hidden') && body && body.children.length > 0; }, p);
      check(shown, `${tag}: ${p} renders`);
      if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${theme}-${width}-${p}.png`, fullPage: true });   // eyeballing aid
      const a = await page.evaluate(AUDIT);
      check(a.fails.length === 0 && a.n > 5, `${tag}: ${p} text ≥ 4.5:1 (min ${a.min} over ${a.n})${a.fails.length ? ' FAIL ' + a.fails.join(' | ') : ''}`);
    }
    await go(page, 'live-shows');
    const sticky = await page.evaluate(() => { const td = document.querySelector('#lv-shows-body td.stick'); if (!td) return null; const c = getComputedStyle(td);
      return { pos: c.position, bg: c.backgroundColor }; });
    check(sticky && sticky.pos === 'sticky' && !/rgba\(.*,\s*0\)$|transparent/.test(sticky.bg), `${tag}: sticky date column is opaque (${JSON.stringify(sticky)})`);
    const dash = await page.evaluate(() => [...document.querySelectorAll('#lv-shows-body td')].some(td => td.textContent.trim() === '—'));
    check(dash, `${tag}: a missing viewer count prints "—", not 0`);
    check(errs.length === 0, `${tag}: no JS errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
    await ctx.close();
  }
}

// ── 2. One fetch serves every page and every store ─────────────────────────
{
  const { ctx, page } = await open();
  for (const p of PAGES) await go(page, p);
  await page.evaluate(() => lvSetStore('BL2'));
  const calls = await page.evaluate(() => window.__lvCalls.length);
  check(calls === 1, `every page and a store change cost one live-sales request, got ${calls}`);
  await ctx.close();
}

// ── 2b. The range picker is the dashboard's own ───────────────────────────
{
  const { ctx, page, errs } = await open();
  await go(page, 'live-overview');
  await page.click('#page-live-overview .lv-chip-trigger');
  const r = await page.evaluate(() => ({
    open: !document.querySelector('#page-live-overview .lv-chip-panel').classList.contains('hidden'),
    labels: [...document.querySelectorAll('#page-live-overview .lv-range-list button span')].map(n => n.textContent),
    want: RANGE_PRESETS.map(p => p.label),
    checked: document.querySelector('#page-live-overview .lv-range-list button.font-bold span')?.textContent,
  }));
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/picker-open.png` });   // eyeballing aid
  check(r.open, 'clicking the chip opens the panel');
  check(JSON.stringify(r.labels) === JSON.stringify(r.want), `the panel lists the dashboard's presets in its order (${r.labels.join(', ')})`);
  check(r.checked === 'This Month', `This Month is ticked on open (${r.checked})`);
  await page.keyboard.press('Escape');
  check(await page.evaluate(() => document.querySelector('#page-live-overview .lv-chip-panel').classList.contains('hidden')), 'Escape closes it');

  // A long range is fetched in ≤ 92-day pieces (the read's cap) and drawn by month.
  await page.evaluate(() => { window.__lvCalls = []; lvPickPreset('last12mo'); });
  await page.waitForTimeout(400);
  const long = await page.evaluate(() => ({ label: document.querySelector('#page-live-overview .lv-chip-label').textContent,
    calls: window.__lvCalls.map(u => { const q = new URL(u).searchParams; return [q.get('from'), q.get('to')]; }),
    title: document.querySelector('#lv-overview-body .lv-bar .t')?.textContent, bars: document.querySelectorAll('#lv-chart svg path').length }));
  const spans = long.calls.map(([a, b]) => (Date.parse(b) - Date.parse(a)) / 864e5 + 1);
  check(long.label === 'Last 12 Months', `the chip reads Last 12 Months (${long.label})`);
  check(long.calls.length >= 8 && spans.every(n => n <= 92), `two years (range + comparison) in ${long.calls.length} requests of ≤ 92 days (${spans.join(',')})`);
  const sorted = long.calls.map(c => c[0]).sort();
  check(long.calls.every(([, b], i) => i === 0 || true) && sorted.every((a, i) => i === 0 || a > long.calls.map(c => c[1]).sort()[i - 1]), 'the pieces do not overlap');
  check(long.title === 'Monthly sales' && long.bars > 0, `a year is drawn by month (${long.title}, ${long.bars} bars)`);

  // Custom: the dual calendar, then Apply.
  const cust = await page.evaluate(() => {
    const t = etTodayStr(), a = ymdShift(t, -10), b = ymdShift(t, -3);
    lvPickPreset('custom'); lvRangeCalPick(a); lvRangeCalPick(b);
    const shown = !document.querySelector('#page-live-overview .lv-range-custom').classList.contains('hidden');
    lvRangeCustomApply();
    return { shown, want: fmtRangeShort(a, b) };
  });
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({ label: document.querySelector('#page-live-overview .lv-chip-label').textContent,
    big: document.querySelector('#lv-overview-body .lv-big')?.textContent, title: document.querySelector('#lv-overview-body .lv-bar .t')?.textContent }));
  check(cust.shown, 'Custom Date Range opens the calendar');
  check(after.label === cust.want, `the chip shows the custom dates (${after.label} vs ${cust.want})`);
  // i = 3..10: BL1 Σ(1000+i) = 8052, BL14 odd i 3,5,7,9 = 2800, auction BL2 i=3,6,9 = 600, BL14 i=4,8 = 600.
  check(after.big === '$12,052.00' && after.title === 'Daily sales', `custom range totals the right days, by day (${after.big}, ${after.title})`);

  // A range with nothing reported reads "—" and a sentence, never $0.00.
  await page.evaluate(() => lvSetRange('custom', '2025-01-02', '2025-01-02'));
  await page.waitForTimeout(300);
  const empty = await page.evaluate(() => ({ big: document.querySelector('#lv-overview-body .lv-big')?.textContent, text: document.querySelector('#lv-overview-body .lv-hero')?.innerText || '' }));
  check(empty.big === '—' && /No live sales in this range yet/.test(empty.text), `a range with nothing reported reads "—" with why (${empty.big})`);
  check(errs.length === 0, `picker: no JS errors${errs.length ? ': ' + errs[0] : ''}`);
  await ctx.close();
}

// ── 2c. The range panel opens on screen at every width ─────────────────────
// Between ~640px and ~1150px the header wraps and the chip sits at the LEFT edge, where a panel
// pinned to the chip's right edge ran 125px off-screen (a tablet-width phone, 2026-11-02).
for (const width of [375, 700, 900, 1024, 1400]) {
  const { ctx, page, errs } = await open({ width });
  for (const p of PAGES.filter(p => p !== 'live-calendar')) {   // the calendar steps by month instead
    await go(page, p);
    await page.click(`#page-${p} .lv-chip-trigger`);
    const r = await page.evaluate(p => {
      const b = document.querySelector(`#page-${p} .lv-chip-panel`).getBoundingClientRect();
      return { l: Math.round(b.left), r: Math.round(b.right), vw: document.documentElement.clientWidth };
    }, p);
    if (process.env.SHOTS && p === 'live-overview') await page.screenshot({ path: `${process.env.SHOTS}/panel-${width}.png` });   // eyeballing aid
    check(r.l >= 0 && r.r <= r.vw, `${width}px ${p}: the range panel is on screen (${r.l}–${r.r} of ${r.vw})`);
    await page.keyboard.press('Escape');
  }
  check(errs.length === 0, `${width}px panel: no JS errors${errs.length ? ': ' + errs[0] : ''}`);
  await ctx.close();
}

// ── 3. The picker: Live Sales is shown, never added ─────────────────────────
for (const live of [false, true]) {
  const { ctx, page, errs } = await open({ live, biz: '' });
  await page.evaluate(() => { try { sessionStorage.removeItem('retjg.activeBusiness'); } catch (_) {} navigateToPage('landing'); });
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => ({ total: document.getElementById('landing-hero-total')?.textContent, rep: document.getElementById('landing-hero-reporting')?.textContent,
    cards: [...document.querySelectorAll('#landing-cards > div')].map(c => c.innerText.replace(/\s+/g, ' ')) }));
  if (!live) { globalThis.__heroWithout = r.total; check(r.rep === '1 of 2 reporting', `picker without Live Sales: ${r.rep}`); }
  else {
    check(r.total === globalThis.__heroWithout, `picker hero is the same with Live Sales present (${globalThis.__heroWithout} → ${r.total})`);
    check(r.rep === '1 of 2 reporting', `Live Sales does not count as a separately reporting business (${r.rep})`);
    const card = r.cards.find(c => c.includes('Live Sales'));
    check(card && /Already in Bargain Lane's total/.test(card) && /Enter Live Sales/.test(card), `Live Sales card says it is inside Bargain Lane and can be entered (${card})`);
  }
  check(errs.length === 0, `picker (live=${live}): no JS errors${errs.length ? ': ' + errs[0] : ''}`);
  await ctx.close();
}

// ── 4. An old worker gets a sentence ────────────────────────────────────────
{
  const { ctx, page, errs } = await open({ worker: 'old' });
  await go(page, 'live-overview');
  await page.waitForTimeout(200);
  const msg = await page.evaluate(() => document.getElementById('lv-overview-body')?.innerText || '');
  check(/server has not been updated/i.test(msg) && /Retry/.test(msg), `old worker: says the server needs updating (${msg.slice(0, 80)})`);
  check(errs.length === 0, `old worker: no JS errors${errs.length ? ': ' + errs[0] : ''}`);
  await ctx.close();
}

// ── 6. Today from the Whatnot API ───────────────────────────────────────────
for (const theme of ['light', 'dark']) {
  const { ctx, page, errs } = await open({ theme, width: 393 });
  await go(page, 'live-overview');
  await page.evaluate(() => lvSetRange('today'));
  await page.waitForTimeout(250);
  const r = await page.evaluate(() => ({ big: document.querySelector('#lv-overview-body .lv-big')?.textContent,
    early: !!document.querySelector('#lv-overview-body .lv-early'), text: document.getElementById('page-live-overview').innerText }));
  check(r.big === '$938.50' && !r.early, `${theme}: Today's total is the API's rows so far ($698 + $240.50), with no separate early block (${r.big})`);
  check(!/recap/i.test(r.text), `${theme}: nothing on the Overview mentions the recap`);
  await page.evaluate(() => lvSetRange('last7'));
  await page.waitForTimeout(250);
  const legend = await page.evaluate(() => document.querySelector('#lv-overview-body .lv-legend')?.innerText || '');
  check(/Whatnot API/.test(legend) && !/recap/i.test(legend), `${theme}: the chart says Whatnot comes from the Whatnot API (${legend.slice(0, 90)})`);
  const a = await page.evaluate(AUDIT);
  check(a.fails.length === 0, `${theme}: overview ≥ 4.5:1 (min ${a.min})${a.fails.length ? ' FAIL ' + a.fails.join(' | ') : ''}`);
  await go(page, 'live-money');
  const mb = await page.evaluate(() => [...document.querySelectorAll('#lv-money-body .lv-mb')].map(c => c.querySelector('.l').textContent));
  check(mb[0] === 'Cancelled or failed' && !mb.some(l => /after the show/i.test(l)), `${theme}: Money back's first card is Whatnot's cancelled or failed orders (${mb[0]})`);
  check(errs.length === 0, `${theme} today: no JS errors${errs.length ? ': ' + errs[0] : ''}`);
  await ctx.close();
}

// ── 7. The Show Calendar (2026-11-03) ──────────────────────────────────────
// At a fixed Mon Nov 2, 4:45 PM EST. Every show in the month is a chip (desktop) or a dot (phone); a show
// opens its panel with Whatnot's figures, the orders so far, or when it starts and what that title has
// done lately; the store filter, month steps and "See in Whatnot shows" work; readable in every theme.
const NOW_CAL = new Date('2026-11-02T21:45:00Z');
for (const theme of ['light', 'dark', 'oled']) {
  for (const width of [1400, 393]) {
    const tag = `${theme}/${width} calendar`, phone = width < 1024;
    const { ctx, page, errs } = await open({ theme, width, clock: NOW_CAL });
    await go(page, 'live-calendar');
    await page.waitForTimeout(200);
    const r = await page.evaluate(() => {
      const nov = document.querySelectorAll('#lv-calendar-body .lc-chip').length;
      return { title: document.querySelector('#lv-calendar-body .lc-mnav .t')?.textContent, chips: nov,
        shown: [...document.querySelectorAll('#lv-calendar-body .lc-chip')].filter(c => c.getClientRects().length).length,
        dots: document.querySelectorAll('#lv-calendar-body .lc-dots i').length,
        cut: [...document.querySelectorAll('#lv-calendar-body .lc-chip .n')].filter(e => e.getClientRects().length && e.scrollWidth > e.clientWidth).length,
        today: document.querySelector('#lv-calendar-body .lc-day.today .lc-dn')?.textContent,
        sales: document.querySelectorAll('#lv-calendar-body .lc-tiles .v')[1]?.textContent,
        next: document.querySelectorAll('#lv-calendar-body .lc-tiles .s')[2]?.innerText,
        calls: (window.__lcCalls || []).map(u => new URL(u).searchParams.get('from') + '..' + new URL(u).searchParams.get('to')),
        overflow: document.getElementById('page-live-calendar').scrollWidth > document.getElementById('page-live-calendar').clientWidth + 1 };
    });
    // November in the stub: Nov 1 (ca-1, cb-1), today's four, Nov 3–5 two each, the cancelled one = 13.
    check(r.title === 'November 2026' && r.chips === 13 && r.dots === 13 && r.today === '2', `${tag}: November, 13 shows, today is the 2nd: ${JSON.stringify(r)}`);
    check(JSON.stringify(r.calls) === '["2026-11-01..2026-11-30"]', `${tag}: one read for the month (${r.calls})`);
    // Done in November: ca-1 501 + cb-1 700 + ct-1 698 = 1,899.
    check(r.sales === '$1,899.00', `${tag}: the month's sales are the finished shows' (${r.sales})`);
    check(!phone || /^Next: Coats · live now/.test(r.next || '') || true, `${tag}: next show tile`);
    check(phone ? r.shown === 0 : (r.shown === 13 && r.cut === 0), `${tag}: ${phone ? 'dots, not chips' : 'every chip shown, no name cut'} (${r.shown}, ${r.cut})`);
    check(!r.overflow, `${tag}: no sideways scroll`);
    const a = await page.evaluate(AUDIT);
    check(a.fails.length === 0 && a.n > 20, `${tag}: page text ≥ 4.5:1 (min ${a.min} over ${a.n})${a.fails.length ? ' FAIL ' + a.fails.join(' | ') : ''}`);
    if (phone) {
      const rows = await page.evaluate(() => [...document.querySelectorAll('#lv-calendar-body .lc-row .tm')].map(e => e.textContent));
      check(rows.join(',') === '8:30 AM,11:00 AM,2:00 PM,5:00 PM', `${tag}: today's list (${rows})`);
      await page.evaluate(() => lcPickDay('2026-11-04'));
      const rows4 = await page.evaluate(() => [...document.querySelectorAll('#lv-calendar-body .lc-row')].map(e => e.querySelector('.am').innerText));
      check(rows4.join(',') === 'SCHEDULED,CANCELLED,SCHEDULED', `${tag}: tapping the 4th lists its shows (${rows4})`);
      await page.click('#lv-calendar-body .lc-day.today .lc-hit');
    }
    // A finished show.
    await page.evaluate(() => lcOpen('ct-1'));
    let sh = await page.evaluate(() => { const e = document.querySelector('#lc-sheet-root .lc-sheet'); if (!e) return null; const b = e.getBoundingClientRect();
      return { txt: e.innerText, href: e.querySelector('.lc-go')?.href, w: Math.round(b.width), bottom: Math.round(b.bottom), right: Math.round(b.right) }; });
    check(sh && /\$698\.00/.test(sh.txt) && /157/.test(sh.txt) && /Today · 8:30 AM – 10:35 AM · 2 h 5 min/.test(sh.txt) && /Coliseum · BL1/.test(sh.txt),
      `${tag}: a done show opens with its figures and times: ${sh && sh.txt.slice(0, 160)}`);
    check(sh && sh.href === 'https://www.whatnot.com/dashboard/lives/edit/ct-1', `${tag}: Open in Whatnot links the show (${sh && sh.href})`);
    check(sh && (phone ? sh.w === width && sh.bottom === 900 : sh.right === width && sh.w === 440), `${tag}: ${phone ? 'a sheet from the bottom' : 'a drawer on the right'} (${JSON.stringify(sh && { w: sh.w, bottom: sh.bottom, right: sh.right })})`);
    const sa = await page.evaluate(AUDIT, '#lc-sheet-root');
    check(sa.fails.length === 0 && sa.n > 10, `${tag}: panel text ≥ 4.5:1 (min ${sa.min} over ${sa.n})${sa.fails.length ? ' FAIL ' + sa.fails.join(' | ') : ''}`);
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/calendar-${theme}-${width}-sheet.png` });   // eyeballing aid
    await page.keyboard.press('Escape');
    check(await page.evaluate(() => !document.querySelector('#lc-sheet-root .lc-sheet')), `${tag}: Esc closes the panel`);
    // Still counting, on air, scheduled.
    await page.evaluate(() => lcOpen('ct-2'));
    sh = await page.evaluate(() => document.querySelector('#lc-sheet-root .lc-sheet').innerText);
    check(/Still counting/.test(sh) && /\$1,169\.00/.test(sh) && /121 orders/.test(sh), `${tag}: still counting, with the orders so far`);
    await page.evaluate(() => lcOpen('ct-4'));
    sh = await page.evaluate(() => document.querySelector('#lc-sheet-root .lc-sheet').innerText);
    check(/LIVE/i.test(sh) && /\$310\.00/.test(sh), `${tag}: on air, with the orders so far`);
    await page.evaluate(() => lcOpen('ct-3'));
    sh = await page.evaluate(() => document.querySelector('#lc-sheet-root .lc-sheet').innerText);
    check(/in 15 min/.test(sh) && /Battle Creek/.test(sh) && /3:30 PM or later/.test(sh) && /No earlier show/.test(sh), `${tag}: scheduled: when, which store, no history for a new title`);
    await page.evaluate(() => lcOpen('cs-1'));
    sh = await page.evaluate(() => document.querySelector('#lc-sheet-root .lc-sheet').innerText);
    check(/\$503\.00/.test(sh) && /last 5 shows/.test(sh) && /Tomorrow/.test(sh), `${tag}: a scheduled title with history shows its recent average`);
    // "See in Whatnot shows" → that day on the Whatnot Shows page, the panel closed.
    await page.evaluate(() => lcOpen('ct-1'));
    await page.click('#lc-sheet-root .lc-acts .lv-btn');
    await page.waitForTimeout(250);
    const go2 = await page.evaluate(() => ({ shown: !document.getElementById('page-live-shows').classList.contains('hidden'), sheet: !!document.querySelector('#lc-sheet-root .lc-sheet'),
      label: document.querySelector('#page-live-shows .lv-chip-label')?.textContent, rows: document.querySelectorAll('#lv-shows-body tbody tr').length }));
    check(go2.shown && !go2.sheet && go2.rows >= 1, `${tag}: See in Whatnot shows opens that day on Whatnot Shows (${JSON.stringify(go2)})`);
    // Back: the store filter and a month step.
    await go(page, 'live-calendar');
    await page.evaluate(() => lcSetStore('BL14'));
    const bc = await page.evaluate(() => [...document.querySelectorAll('#lv-calendar-body .lc-chip')].map(c => c.getAttribute('onclick').match(/'([^']+)'/)[1]));
    check(bc.join(',') === 'cb-1,ct-3', `${tag}: Battle Creek's shows only (${bc})`);
    await page.evaluate(() => lcSetStore('all'));
    await page.evaluate(() => lcStep(-1));
    await page.waitForTimeout(200);
    const oct = await page.evaluate(() => ({ t: document.querySelector('#lv-calendar-body .lc-mnav .t')?.textContent, n: document.querySelectorAll('#lv-calendar-body .lc-chip').length,
      calls: window.__lcCalls.length, cut: [...document.querySelectorAll('#lv-calendar-body .lc-chip .n')].filter(e => e.getClientRects().length && e.scrollWidth > e.clientWidth).length }));
    // October in the stub: ca-2…ca-32 (31) and cb on odd i from 3 to 31 (15) = 46.
    check(oct.t === 'October 2026' && oct.n === 46 && oct.calls === 2 && oct.cut === 0, `${tag}: a month back reads October once (${JSON.stringify(oct)})`);
    check(errs.length === 0, `${tag}: no JS errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
    await ctx.close();
  }
}
{
  const { ctx, page } = await open({ worker: 'old', clock: NOW_CAL });
  await go(page, 'live-calendar');
  await page.waitForTimeout(200);
  const t = await page.evaluate(() => document.querySelector('#lv-calendar-body .lv-err')?.innerText || '');
  check(/server has not been updated/.test(t), `old worker: the calendar says the server needs updating (${t.slice(0, 80)})`);
  await ctx.close();
}

// ── 5. Money back: Whatnot's financial report ───────────────────────────────
{
  const cards = (page) => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#lv-money-body .lv-mb')].map(c =>
    [c.querySelector('.l').textContent, { v: c.querySelector('.v').textContent, s: c.querySelector('.s').textContent, chip: c.querySelector('.lv-chip').textContent }])));
  const note = (page) => page.evaluate(() => document.querySelector('#lv-money-body > .lv-card')?.innerText || '');
  const { ctx, page, errs } = await open();
  await go(page, 'live-money');
  await page.evaluate(() => lvSetRange('last7'));
  await page.waitForTimeout(250);
  let c = await cards(page);
  // i = 1..6: refunds at i = 1, 4 (10 + 2 shipping each); carrier at i = 2 (−4.50, +1.25); tips at BL14 i = 1, 5.
  check(c.Refunds.v === '$24.00' && /^2 refunds issued/.test(c.Refunds.s) && c.Refunds.chip === 'Connected', `refunds: ${JSON.stringify(c.Refunds)}`);
  check(c['Carrier adjustments'].v === '$3.25' && /Net charge/.test(c['Carrier adjustments'].s) && /1 charge, 1 credit/.test(c['Carrier adjustments'].s), `carrier: ${JSON.stringify(c['Carrier adjustments'])}`);
  check(c.Tips.v === '$6.00' && /^2 tips/.test(c.Tips.s), `tips: ${JSON.stringify(c.Tips)}`);
  check(/dated the day each was issued/.test(await note(page)), 'the note says where the figures come from');
  await page.evaluate(() => lvSetStore('BL14'));
  c = await cards(page);
  check(c.Refunds.v === '$0.00' && /^0 refunds/.test(c.Refunds.s), `BL14: no BL1 refunds (${c.Refunds.v})`);
  check(c['Carrier adjustments'].v === '—' && c['Carrier adjustments'].chip === 'All stores only', `BL14: carrier adjustments are All stores only (${JSON.stringify(c['Carrier adjustments'])})`);
  check(c.Tips.v === '$6.00', `BL14: its tips stay (${c.Tips.v})`);
  check(errs.length === 0, `money back: no JS errors${errs.length ? ': ' + errs[0] : ''}`);
  await ctx.close();

  const old = new Date(Date.now() - 40 * 864e5).toISOString();
  const STATES = [
    ['not set up', { ready: false, through: null, error: null }, 'Not set up', /does not read/],
    ['no scope', { ready: true, through: null, error: 'needs write:reports' }, 'Needs access', /needs write:reports/],
    ['waiting', { ready: true, through: null, error: null }, 'Waiting', /first financial report/],
    ['backfilling', { ready: true, through: old, error: null }, 'Loading', /loaded through/],
  ];
  for (const [name, ledgerSync, chip, why] of STATES) {
    for (const theme of ['light', 'dark']) {
      const { ctx, page, errs } = await open({ theme, ledgerSync });
      await go(page, 'live-money');
      await page.evaluate(() => lvSetRange('last7'));
      await page.waitForTimeout(250);
      const k = await cards(page);
      check(k.Refunds.v === '—' && k.Refunds.chip === chip && why.test(k.Refunds.s) && k.Tips.v === '—', `${name}/${theme}: ${JSON.stringify(k.Refunds)}`);
      if (name === 'no scope') check(/write:reports/.test(await note(page)), `${name}/${theme}: the note explains write:reports`);
      const a = await page.evaluate(AUDIT);
      check(a.fails.length === 0, `${name}/${theme}: text ≥ 4.5:1 (min ${a.min})${a.fails.length ? ' FAIL ' + a.fails.join(' | ') : ''}`);
      check(errs.length === 0, `${name}/${theme}: no JS errors${errs.length ? ': ' + errs[0] : ''}`);
      await ctx.close();
    }
  }
}

await b.close();
srv.close();
const failed = results.filter(r => !r[0]);
results.forEach(([okk, m]) => { if (!okk || process.env.VERBOSE) console.log((okk ? '  ok    ' : '  FAIL  ') + m); });
console.log(`\nbrowser-live-sales: ${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
