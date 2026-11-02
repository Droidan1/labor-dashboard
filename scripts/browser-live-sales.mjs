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
  return { ok: true, units: [{ code: 'BL1', name: 'Coliseum' }, { code: 'BL14', name: 'Battle Creek' }, { code: 'BL16', name: 'Indy East' }, { code: 'BL2', name: 'South Bend' }],
    channels, coverage: [{ channel: 'auction', first: add(et, -70), last: add(et, -1) }, { channel: 'whatnot', first: add(et, -70), last: add(et, -1) }],
    bl: [], shows, ledger, ledgerSync: { ready: true, through: new Date(Math.floor(Date.now() / 3600e3) * 3600e3).toISOString(), error: null, waitingSince: null },
    sync: { connected: true, lastRun: null } };
};

async function open({ theme = 'dark', width = 1400, height = 900, live = true, worker = 'new', biz = 'live', ledgerSync = null } = {}) {
  const phone = width < 1024;
  const ctx = await b.newContext({ viewport: { width, height }, isMobile: phone, hasTouch: phone, deviceScaleFactor: phone ? 2 : 1 });
  const page = await ctx.newPage();
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
        return J({ ...data, from, to, channels: data.channels.filter(r => r.date >= from && r.date <= to), shows: data.shows.filter(r => r.date >= from && r.date <= to),
          ledger: data.ledger.filter(r => r.date >= from && r.date <= to), ledgerSync: ledgerSync || data.ledgerSync });
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
const AUDIT = () => {
  const parse = c => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const over = (t, b) => ({ r: t.r * t.a + b.r * (1 - t.a), g: t.g * t.a + b.g * (1 - t.a), b: t.b * t.a + b.b * (1 - t.a), a: 1 });
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const bgOf = (el) => { const ch = []; for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c.a > 0) ch.push(c); if (c && c.a === 1) break; }
    let bg = parse(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 }; if (bg.a < 1) bg = over(bg, { r: 255, g: 255, b: 255, a: 1 });
    for (let i = ch.length - 1; i >= 0; i--) bg = over(ch[i], bg); return bg; };
  const pg = [...document.querySelectorAll('[id^="page-live-"]')].find(p => !p.classList.contains('hidden'));
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

const PAGES = ['live-overview', 'live-shows', 'live-auction', 'live-promotion', 'live-money'];
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
    // Last 7 Days = today and the 6 days before; the stub has i = 1..6 of them (today is not reported yet):
    // Whatnot BL1 Σ(1000+i) = 6021, BL14 on odd i (3 × 700) = 2100, auction BL2 i=3,6 (400), BL14 i=4 (300), BL16 null.
    check(big === '$8,821.00', `${tag}: Overview total for Last 7 Days — got ${big}`);
    await page.evaluate(() => lvSetStore('BL14'));
    const big14 = await page.evaluate(() => document.querySelector('#lv-overview-body .lv-big')?.textContent);
    check(big14 === '$2,400.00', `${tag}: store filter re-renders (Battle Creek 2,100 + 300) — got ${big14}`);
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
  check(calls === 1, `five pages and a store change cost one request, got ${calls}`);
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

  // Today: nothing is reported until the next morning, so "—" and a sentence, never $0.00.
  await page.evaluate(() => lvSetRange('today'));
  await page.waitForTimeout(300);
  const today = await page.evaluate(() => ({ big: document.querySelector('#lv-overview-body .lv-big')?.textContent, text: document.querySelector('#lv-overview-body .lv-hero')?.innerText || '' }));
  check(today.big === '—' && /Nothing reported for this range yet/.test(today.text), `Today reads "—" with why (${today.big})`);
  check(errs.length === 0, `picker: no JS errors${errs.length ? ': ' + errs[0] : ''}`);
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
