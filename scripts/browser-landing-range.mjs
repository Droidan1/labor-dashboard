// The landing page's date picker (2026-11-18), in a real browser against the built dist/, with
// fake Bargain Lane history + live sales and a fake ?action=ecom-overview.
//
// WHAT THIS PROTECTS.
//   - The landing has the dashboard's date chip and its OWN range (Brian: landing only) — picking
//     a range there leaves the Bargain Lane dashboard's range where it was.
//   - For every preset, the landing's Bargain Lane figure EQUALS the dashboard hero's for the same
//     range. Both now come from blRangeTotals(); this is what stops a second copy of the dashboard's
//     range maths from drifting (lessons.md: two programs, same tiles, wrong all day).
//   - E-Commerce's card follows the range (asks for from/to, shows the range's sales), the hero adds
//     both businesses for the range, Live Sales names the range, and the Live pill is only shown for
//     a range that includes today.
//   - Landing text clears AA in light and dark.
//
// Run: bash scripts/build.sh && PLAYWRIGHT_CHROMIUM=<chrome> node scripts/browser-landing-range.mjs
let chromium;
try { ({ chromium } = await import('playwright-core')); } catch (e) {
  console.error('\nThis check needs playwright-core:  npm install --no-save playwright-core\n'); process.exit(2);
}
const CHROME = process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'dist');
if (!fs.existsSync(path.join(root, 'index.html'))) { console.error('\nRun `bash scripts/build.sh` first.\n'); process.exit(2); }
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, s) => {
  const f = path.join(root, q.url === '/' ? 'index.html' : q.url.split('?')[0]);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end('no'); }
  s.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(s);
});
await new Promise(r => srv.listen(8098, r));
const URL_ = 'http://127.0.0.1:8098/index.html';
const results = [];
const check = (c, m) => results.push([!!c, m]);
const money = (s) => Number(String(s || '').replace(/[^0-9.\-−]/g, '').replace('−', '-'));

const b = await chromium.launch({ executablePath: CHROME });
async function open(theme) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errs = [], asked = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR_/.test(m.text())) errs.push('console: ' + m.text()); });
  await page.exposeFunction('__asked', (u) => asked.push(u));
  await page.addInitScript((theme) => {
    try { localStorage.setItem('darkMode', String(theme !== 'light')); localStorage.setItem('darkFlavor', 'dark');
      sessionStorage.removeItem('retjg.activeBusiness'); localStorage.setItem('bioPromptDismissed', '1'); } catch (e) {}
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
    const h = (s) => { let x = 2166136261; for (const c of s) { x ^= c.charCodeAt(0); x = Math.imul(x, 16777619); } return (x >>> 0) / 4294967296; };
    window.fetch = async (u) => {
      const s = String(u);
      const J = (v) => new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });
      if (s.includes('auth-me')) return J({ authenticated: true, email: 'x@example.com', name: 'X', role: 'superuser', pages: {},
        businesses: [{ id: 'bl', name: 'Bargain Lane', connected: true, unitCount: 5, unitNoun: 'store' },
                     { id: 'ecom', name: 'E-Commerce', connected: false, unitCount: 0, unitNoun: 'storefront' },
                     { id: 'live', name: 'Live Sales', connected: true, unitCount: 4, unitNoun: 'store' }] });
      if (s.includes('action=ecom-overview')) {
        window.__asked(s);
        const to = (s.match(/[?&]to=(\d{4}-\d{2}-\d{2})/) || [])[1] || today, from = (s.match(/[?&]from=(\d{4}-\d{2}-\d{2})/) || [])[1] || to;
        const days = Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1, sales = 500 * days + 0.25;
        const agg = { sales, shipping: 50 * days, refunded: 0, orders: 5 * days, units: 6 * days, returns: 0, ebay: sales, poshmark: 0, other: 0 };
        return J({ ok: true, date: to, weekStart: to, monthStart: to.slice(0, 8) + '01', range: { from, to, days },
          budget: { monthly: 57000, today: 1900, week: 13300, month: 57000, period: 1900 * days },
          today: agg, week: agg, month: agg, period: agg, reporting: 3, reportingPeriod: 4,
          companies: [163, 164, 165, 166, 167].map(id => ({ id, name: 'Co ' + id, companyIds: [id], today: agg, week: agg, month: agg, period: agg, hours: new Array(24).fill(0) })),
          sync: { at: new Date().toISOString(), ok: true } });
      }
      const m = s.match(/history_d1=true&store=([A-Z0-9]+)/);
      if (m) {
        const out = {}; const d = new Date('2025-01-01T12:00:00Z'); const end = new Date(today + 'T12:00:00Z');
        for (; d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
          const k = d.toISOString().slice(0, 10), r = h(m[1] + k);
          if (r < 0.03) continue;
          const retail = Math.round(2000 + r * 3000), bin = Math.round(500 + r * 900), auction = r > 0.8 ? Math.round(r * 400) : 0;
          const wk = Math.floor((d - new Date('2025-02-02T12:00:00Z')) / (7 * 864e5)) + 1;
          out[k] = { week: wk, budget: 4200 + Math.round(h(k + m[1]) * 600), retail, bin, total: retail + bin, auction, laborPct: 12,
            orderCount: r < 0.06 ? null : Math.round(90 + r * 80), avgCart: 24 + r * 6, avgItems: 4 + r, avgTxnSec: 60, avgASP: 5 + r };
        }
        return J(out);
      }
      const lv = s.match(/[?&]store=([a-z0-9]+)&since=/);
      if (lv) { const r = h(lv[1] + 'live'); return J({ aggregate: { total: Math.round(800 + r * 900), retail: Math.round(600 + r * 600), bin: Math.round(200 + r * 300), avgCart: 21 + r, avgItems: 4, orderCount: Math.round(40 + r * 30), avgTxnSec: 55, avgASP: 5 }, channels: null }); }
      if (s.includes('action=live-sales')) return J({ ok: true, units: [], channels: [], coverage: [], bl: [], shows: [], sync: {} });
      return J({ ok: true });
    };
  }, theme);
  await page.goto(URL_, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.setDateRange === 'function' && !document.getElementById('app')?.classList.contains('hidden'), { timeout: 15000 });
  await page.waitForTimeout(2500);
  return { ctx, page, errs, asked };
}

const landing = (page) => page.evaluate(() => {
  const card = (name) => { const c = [...document.querySelectorAll('#landing-cards > div')].find(d => d.innerText.startsWith(name)); return c ? c.innerText : ''; };
  const bl = card('Bargain Lane');
  const blTotal = (bl.match(/net\s*\n\s*(\$[\d,]+\.\d{2})/) || [])[1];
  return { chip: document.querySelector('#lp-range .rp-label')?.textContent, label: document.getElementById('landing-hero-label').textContent,
    hero: document.getElementById('landing-hero-total').textContent, livePill: !document.getElementById('landing-hero-live').classList.contains('hidden'),
    mtd: document.getElementById('landing-hero-mtd').textContent, bl, blTotal, ecom: card('E-Commerce'), live: card('Live Sales') };
});
const pickLanding = async (page, label) => {
  await page.click('#lp-range .rp-trigger');
  await page.evaluate((label) => [...document.querySelectorAll('#lp-range .rp-list button')].find(x => x.textContent.trim() === label).click(), label);
  await page.waitForTimeout(400);
};

for (const theme of ['dark', 'light']) {
  const { ctx, page, errs, asked } = await open(theme);
  const vis = await page.$$eval('[id^="page-"]', ps => ps.filter(p => !p.classList.contains('hidden')).map(p => p.id));
  check(vis.includes('page-landing'), `${theme}: lands on the picker (${vis})`);
  const L0 = await landing(page);
  check(L0.chip === 'Today' && L0.label === 'Today · All businesses' && L0.livePill && L0.mtd.startsWith('Month to date'), `${theme}: the landing has the date chip, on Today (${L0.chip} / ${L0.label})`);

  // Every preset: the landing's Bargain Lane figure = the dashboard hero's for the same range.
  const PRESETS = [['today', 'Today'], ['yesterday', 'Yesterday'], ['thisWeek', 'This Week'], ['lastWeek', 'Last Week'], ['last7', 'Last 7 Days'],
    ['thisMonth', 'This Month'], ['lastMonth', 'Last Month'], ['last30', 'Last 30 Days'], ['last3mo', 'Last 3 Months'], ['last6mo', 'Last 6 Months'],
    ['thisYear', 'This Year'], ['lastYear', 'Last Year'], ['last12mo', 'Last 12 Months']];
  const dash = {};
  for (const [id] of PRESETS) {
    await page.evaluate((id) => window.setDateRange(id), id);
    await page.waitForTimeout(120);
    dash[id] = await page.evaluate(() => document.getElementById('c-today-total').textContent.trim());
  }
  await page.evaluate(() => window.setDateRange('today'));
  const mismatched = [];
  for (const [id, label] of PRESETS) {
    await pickLanding(page, label);
    const L = await landing(page);
    if (money(L.blTotal) !== money(dash[id])) mismatched.push(`${label}: landing ${L.blTotal} vs dashboard ${dash[id]}`);
  }
  check(mismatched.length === 0, `${theme}: for all 13 presets the landing's Bargain Lane total equals the dashboard's` + (mismatched.length ? '\n     ' + mismatched.join('\n     ') : ''));
  const dashChip = await page.evaluate(() => document.getElementById('day-chip-label').textContent.trim());
  check(dashChip === 'Today', `${theme}: picking ranges on the landing left the dashboard's range on Today (${dashChip})`);

  // A past range: E-Commerce follows it, the hero adds both, Live Sales names it, no Live pill.
  asked.length = 0;
  await pickLanding(page, 'Last Week');
  await page.waitForTimeout(400);
  const LW = await landing(page);
  const lwAsk = asked.find(u => /from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}/.test(u));
  check(!!lwAsk, `${theme}: E-Commerce is asked for the landing's range (${lwAsk ? lwAsk.split('?')[1] : 'none'})`);
  check(LW.ecom.includes('Last Week sales') && LW.ecom.includes('$3,500.25') && LW.ecom.includes('vs $13,300.00') && LW.ecom.includes('Pace · 4 of 5 selling'),
    `${theme}: the E-Commerce card shows Last Week's sales against Last Week's budget`);
  check(Math.abs(money(LW.hero) - (money(LW.blTotal) + 3500.25)) < 0.01, `${theme}: the hero is Bargain Lane + E-Commerce for the range (${LW.hero} = ${LW.blTotal} + $3,500.25)`);
  check(LW.label === 'Last Week · All businesses' && !LW.livePill && LW.mtd === '', `${theme}: the hero names the range, with no Live pill and no month-to-date line`);
  check(LW.bl.includes('Last Week net') && LW.live.includes('Last Week'), `${theme}: Bargain Lane and Live Sales cards name the range`);

  // Text contrast on the landing, with the chip's panel open.
  await page.click('#lp-range .rp-trigger');
  await page.waitForTimeout(150);
  const bad = await page.evaluate(() => {
    const lum = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); };
    const ratio = (a, b) => { const [h, l] = lum(a) > lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)]; return (h + .05) / (l + .05); };
    const parse = s => { const m = s && s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return { rgb: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 }; };
    const over = (fg, a, bg) => fg.map((c, i) => c * a + bg[i] * (1 - a));
    const bgOf = node => { const st = []; let e = node; while (e && e !== document.documentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { st.push(c); if (c.a === 1) break; } e = e.parentElement; }
      const rb = parse(getComputedStyle(document.body).backgroundColor) || { rgb: [255, 255, 255], a: 1 }; let base = st.length && st[st.length - 1].a === 1 ? st.pop().rgb : rb.rgb; for (let i = st.length - 1; i >= 0; i--) base = over(st[i].rgb, st[i].a, base); return base; };
    const out = [], seen = new Set();
    for (const rootEl of document.querySelectorAll('#page-landing')) {
      const w = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT); let n;
      while ((n = w.nextNode())) {
        if (!n.textContent.trim()) continue;
        const e = n.parentElement, cs = getComputedStyle(e);
        if (cs.display === 'none' || cs.visibility === 'hidden' || !e.getClientRects().length || e.closest('.opacity-60, [disabled], .skel')) continue;
        const fg = parse(cs.color); if (!fg) continue;
        const bg = bgOf(e), eff = fg.a < 1 ? over(fg.rgb, fg.a, bg) : fg.rgb, px = parseFloat(cs.fontSize);
        const min = (n.textContent.trim() === '■' || px >= 24 || (px >= 18.66 && parseInt(cs.fontWeight) >= 700)) ? 3 : 4.5;
        const key = cs.color + '|' + bg.map(Math.round).join() + '|' + min; if (seen.has(key)) continue; seen.add(key);
        const r = ratio(eff, bg); if (r < min) out.push(`${r.toFixed(2)}:1 (min ${min}) "${n.textContent.trim().slice(0, 30)}"`);
      }
    }
    return out;
  });
  check(bad.length === 0, `${theme}: landing text clears AA, picker open` + (bad.length ? '\n     ' + bad.join('\n     ') : ''));
  check(errs.length === 0, `${theme}: no JS errors` + (errs.length ? ' — ' + errs.slice(0, 3).join(' | ') : ''));
  await ctx.close();
}

await b.close(); srv.close();
let fails = 0;
for (const [ok, m] of results) { console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${m}`); if (!ok) fails++; }
console.log(`\n${results.length - fails} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
