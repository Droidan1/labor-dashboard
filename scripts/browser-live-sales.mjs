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
  const channels = [], shows = [];
  for (let i = 1; i <= 70; i++) {
    const d = add(et, -i);
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
    bl: [], shows, sync: { connected: true, lastRun: null } };
};

async function open({ theme = 'dark', width = 1400, height = 900, live = true, worker = 'new', biz = 'live' } = {}) {
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
  await page.addInitScript(({ live, worker, stub }) => {
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
        return J({ ...data, from, to, channels: data.channels.filter(r => r.date >= from && r.date <= to), shows: data.shows.filter(r => r.date >= from && r.date <= to) });
      }
      if (s.includes('action=weekly-summary')) return J({ ok: true, from: '2026-09-14', to: '2026-09-20', stores: {}, totals: {} });
      return J({ ok: true });
    };
  }, { live, worker, stub: STUB.toString() });
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
    await page.evaluate(() => lvSetRange('l7'));
    await page.waitForTimeout(250);
    const expect7 = await page.evaluate(() => {
      const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
      const add = (s, n) => { const x = new Date(s + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
      const from = add(d, -7), to = add(d, -1);
      return { from, to };
    });
    const big = await page.evaluate(() => document.querySelector('#lv-overview-body .lv-big')?.textContent);
    // Last 7 days = i = 1..7: Whatnot BL1 Σ(1000+i)=7028, BL14 on odd i (4 × 700)=2800, auction BL2 i=3,6 (400), BL14 i=4 (300), BL16 null.
    check(big === '$10,528.00', `${tag}: Overview total for the last 7 days (${expect7.from}…${expect7.to}) — got ${big}`);
    await page.evaluate(() => lvSetStore('BL14'));
    const big14 = await page.evaluate(() => document.querySelector('#lv-overview-body .lv-big')?.textContent);
    check(big14 === '$3,100.00', `${tag}: store filter re-renders (Battle Creek 2,800 + 300) — got ${big14}`);
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

await b.close();
srv.close();
const failed = results.filter(r => !r[0]);
results.forEach(([okk, m]) => { if (!okk || process.env.VERBOSE) console.log((okk ? '  ok    ' : '  FAIL  ') + m); });
console.log(`\nbrowser-live-sales: ${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
