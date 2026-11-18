// The E-Commerce Overview page and E-Commerce's landing card (phase 2, 2026-11-18), in a real
// browser against the built dist/, with ?action=ecom-overview stubbed.
//
// WHAT THIS PROTECTS.
//   - The landing card shows E-Commerce's own figures (Brian chose card "A"): today's sales, the
//     pace against E-Commerce's one budget, Product · Shipping · Refunded, Orders · Avg order ·
//     Units · Returns — and the "All businesses" hero adds E-Commerce in (sales AND budget), with
//     E-Commerce as one more slice of the mix.
//   - Entering E-Commerce opens the Overview: the hero against today's budget with shipping shown,
//     the mix, the Matrix, This week / month budget cards, and ONE CARD PER COMPANY with no budget
//     on it — a company with no orders is dimmed and says so.
//   - Picking an earlier day asks the worker for that day; a server not set up says so.
//   - Every visible text node clears AA in light and dark (a dimmed no-orders card is skipped,
//     as Bargain Lane's offline store card is).
//
// Run: bash scripts/build.sh && PLAYWRIGHT_CHROMIUM=<chrome> node scripts/browser-ecom-overview.mjs
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
await new Promise(r => srv.listen(8097, r));
const URL_ = 'http://127.0.0.1:8097/index.html';

const results = [];
const check = (c, m) => results.push([!!c, m]);

// The worker's answer for "today", whatever today is when this runs.
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const co = (id, name, sales, ship, orders, units, hours, ids) => ({ id, name, companyIds: ids || [id],
  today: { sales, shipping: ship, refunded: id === 163 ? 24.99 : 0, orders, units, returns: id === 163 ? 1 : 0, ebay: sales, poshmark: 0, other: 0 },
  week: { sales: sales * 3, orders: orders * 3 }, month: { sales: sales * 12, orders: orders * 12 }, hours });
const H = (pairs) => { const h = new Array(24).fill(0); for (const [i, v] of pairs) h[i] = v; return h; };
const FIXTURE = (date) => ({ ok: true, connected: true, date, weekStart: date, monthStart: date.slice(0, 8) + '01',
  budget: { monthly: 57000, today: 1900, week: 13300, month: 57000 },
  today: { sales: 2380.43, shipping: 258.54, refunded: 24.99, orders: 25, units: 27, returns: 1, ebay: 2126.53, poshmark: 253.90, other: 0 },
  week: { sales: 12303.12, orders: 129 }, month: { sales: 41208.77, orders: 431 },
  reporting: 4,
  companies: [
    co(163, 'Shoes and Fashions', 1642.30, 198.60, 19, 21, H([[9, 84.5], [10, 212.3], [11, 160.8], [12, 301.2], [13, 248.9], [14, 634.6]]), [163, 169]),
    co(164, 'Harrison Avenue', 76.98, 9.99, 1, 1, H([[13, 76.98]])),
    co(165, 'Bass River', 162.40, 19.98, 2, 2, H([[10, 84.45], [13, 77.95]])),
    co(166, 'Detail Pro', 0, 0, 0, 0, H([])),
    co(167, 'Dymoda', 498.75, 29.97, 3, 3, H([[8, 137.98], [11, 221.80], [13, 138.97]])),
  ],
  sync: { at: new Date().toISOString(), ok: true, from: date, to: date, deep: false, orders: 38 } });

const b = await chromium.launch({ executablePath: CHROME });

async function open({ theme = 'dark', biz = '', width = 1280, height = 900, setup = true } = {}) {
  const ctx = await b.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  const errs = [], asked = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR_/.test(m.text())) errs.push('console: ' + m.text()); });
  await page.exposeFunction('__asked', (u) => asked.push(u));
  await page.addInitScript(({ theme, biz, today, base, setup }) => {
    try {
      localStorage.setItem('darkMode', String(theme !== 'light'));
      localStorage.setItem('darkFlavor', 'dark');
      if (biz) sessionStorage.setItem('retjg.activeBusiness', biz); else sessionStorage.removeItem('retjg.activeBusiness');
      localStorage.setItem('bioPromptDismissed', '1');
    } catch (e) {}
    const FIX = (d) => Object.assign(JSON.parse(JSON.stringify(base)), { date: d });
    window.fetch = async (u) => {
      const s = String(u);
      const J = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
      if (s.includes('auth-me')) return J({ authenticated: true, email: 'dana.ruiz@example.com', name: 'Dana Ruiz', role: 'superuser',
        pages: {}, businesses: [{ id: 'bl', name: 'Bargain Lane', connected: true, unitCount: 5, unitNoun: 'store' },
                                { id: 'ecom', name: 'E-Commerce', connected: false, unitCount: 0, unitNoun: 'storefront' }] });
      if (s.includes('action=ecom-overview')) {
        window.__asked(s);
        if (!setup) return J({ ok: false, setup: false, error: 'ecom_orders is missing (migration-090)' }, 503);
        const m = s.match(/[?&]date=(\d{4}-\d{2}-\d{2})/);
        return J(FIX(m ? m[1] : today));
      }
      if (s.includes('action=weekly-summary')) return J({ ok: true, from: today, to: today, stores: {}, totals: {} });
      if (s.includes('action=live-sales')) return J({ ok: true, units: [], channels: [], coverage: [], bl: [], shows: [], sync: {} });
      return J({ ok: true });
    };
  }, { theme, biz, today, base: FIXTURE(today), setup });
  await page.goto(URL_, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.getElementById('app')?.classList.contains('hidden'), { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(700);
  return { ctx, page, errs, asked };
}

// Text-node contrast inside `selector`, composited the way the menu check does it.
const aaFailures = (page, selector) => page.evaluate((selector) => {
  const lum = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; };
    return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); };
  const ratio = (a, b) => { const [h, l] = lum(a) > lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)]; return (h + .05) / (l + .05); };
  const parse = s => { const m = s && s.match(/rgba?\(([^)]+)\)/); if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return { rgb: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 }; };
  const over = (fg, a, bg) => fg.map((c, i) => c * a + bg[i] * (1 - a));
  const bgOf = node => {
    const stack = []; let e = node;
    while (e && e !== document.documentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c && c.a > 0) { stack.push(c); if (c.a === 1) break; }
      e = e.parentElement;
    }
    const rootBg = parse(getComputedStyle(document.body).backgroundColor) || { rgb: [255, 255, 255], a: 1 };
    let base = stack.length && stack[stack.length - 1].a === 1 ? stack.pop().rgb : rootBg.rgb;
    for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i].rgb, stack[i].a, base);
    return base;
  };
  const out = [], seen = new Set();
  for (const rootEl of document.querySelectorAll(selector)) {
    const w = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      if (!n.textContent.trim()) continue;
      const e = n.parentElement, cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || !e.getClientRects().length) continue;
      if (e.closest('.opacity-60, [disabled], .skel')) continue;   // dimmed / inactive states
      const fg = parse(cs.color); if (!fg) continue;
      const bg = bgOf(e), eff = fg.a < 1 ? over(fg.rgb, fg.a, bg) : fg.rgb;
      const px = parseFloat(cs.fontSize);
      // A lone ■ is a legend swatch, a graphic: WCAG 1.4.11 asks 3:1 of it, not text's 4.5:1.
      const swatch = n.textContent.trim() === '■';
      const min = (swatch || px >= 24 || (px >= 18.66 && parseInt(cs.fontWeight) >= 700)) ? 3 : 4.5;
      const key = cs.color + '|' + bg.map(Math.round).join() + '|' + min;
      if (seen.has(key)) continue; seen.add(key);
      const r = ratio(eff, bg);
      if (r < min) out.push(`${r.toFixed(2)}:1 (min ${min}) "${n.textContent.trim().slice(0, 30)}" ${cs.color} on rgb(${bg.map(Math.round).join(',')})`);
    }
  }
  return out;
}, selector);

for (const theme of ['dark', 'light']) {
  // ── The landing page ──────────────────────────────────────────────────────
  const L = await open({ theme });
  const lp = L.page;
  await lp.waitForTimeout(400);
  const visible = await lp.$$eval('[id^="page-"]', ps => ps.filter(p => !p.classList.contains('hidden')).map(p => p.id));
  check(visible.includes('page-landing'), `${theme}: a two-business superuser lands on the picker (${visible})`);
  const card = await lp.evaluate(() => {
    const c = [...document.querySelectorAll('#landing-cards > div')].find(d => d.textContent.includes('E-Commerce'));
    return c ? c.innerText : '';
  });
  check(card.includes('$2,380.43'), `${theme}: the E-Commerce card shows today's sales`);
  check(/\+\$?480\.43/.test(card.replace(/,/g, '')) && card.includes('$1,900.00'), `${theme}: …against E-Commerce's daily budget ($1,900)`);
  check(card.includes('Pace · 4 of 5 selling') && card.includes('125%'), `${theme}: …with pace and companies selling`);
  check(['Product', '$2,121.89', 'Shipping', '$258.54', 'Refunded', '$24.99'].every(s => card.includes(s)), `${theme}: …Product · Shipping · Refunded`);
  check(['Orders', '25', 'Avg order', '$95.22', 'Units', '27', 'Returns'].every(s => card.includes(s)), `${theme}: …Orders · Avg order · Units · Returns`);
  check(!card.includes('No sales data yet') && !card.includes('Setup'), `${theme}: …and no "no data / Setup" placeholder`);
  const hero = await lp.evaluate(() => ({ total: document.getElementById('landing-hero-total').textContent,
    budget: document.getElementById('landing-hero-budget').textContent, reporting: document.getElementById('landing-hero-reporting').textContent,
    legend: document.getElementById('landing-mix-legend').innerText, count: document.getElementById('landing-mix-count').textContent }));
  const money = s => Number(String(s).replace(/[^0-9.]/g, ''));
  check(money(hero.total) >= 2380.43 && money(hero.budget) >= 1900, `${theme}: the hero adds E-Commerce's sales and budget in (${hero.total} vs ${hero.budget})`);
  check(hero.reporting.startsWith('2 of 2'), `${theme}: both businesses report (${hero.reporting})`);
  check(hero.legend.includes('E-Commerce') && /of 4 channels/.test(hero.count), `${theme}: E-Commerce is a fourth slice of the mix (${hero.count})`);
  const lpAA = await aaFailures(lp, '#landing-cards, #page-landing .rounded-card');
  check(lpAA.length === 0, `${theme}: landing text clears AA` + (lpAA.length ? '\n     ' + lpAA.join('\n     ') : ''));

  // ── Into E-Commerce ───────────────────────────────────────────────────────
  await lp.evaluate(() => [...document.querySelectorAll('#landing-cards .lp-enter')].find(x => x.textContent.includes('E-Commerce')).click());
  await lp.waitForTimeout(500);
  const vis2 = await lp.$$eval('[id^="page-"]', ps => ps.filter(p => !p.classList.contains('hidden')).map(p => p.id));
  check(JSON.stringify(vis2) === '["page-ecom-overview"]', `${theme}: Enter E-Commerce opens the Overview (${vis2})`);
  const ov = await lp.evaluate(() => ({
    hero: document.getElementById('eo-hero').innerText, mix: document.getElementById('eo-mix').innerText,
    matrix: document.getElementById('eo-matrix').innerText, budgets: document.getElementById('eo-budgets').innerText,
    cards: [...document.querySelectorAll('#eo-cards [data-eo-company]')].map(c => ({ id: c.dataset.eoCompany, text: c.innerText,
      dim: c.classList.contains('opacity-60'), spark: !!c.querySelector('svg') })),
    updated: document.getElementById('eo-updated').textContent, status: document.getElementById('eo-status').className }));
  check(ov.hero.includes('$2,380.43') && ov.hero.includes('Includes $258.54 shipping') && ov.hero.includes('125%') && ov.hero.includes('4 of 5 selling'),
    `${theme}: Overview hero — today, shipping, pace, selling`);
  check(['eBay', '$2,126.53', 'Poshmark', '$253.90', '$258.54'].every(s => ov.mix.includes(s)), `${theme}: sales mix splits eBay / Poshmark and shows shipping`);
  check(['25', '$95.22', '27'].every(s => ov.matrix.includes(s)), `${theme}: Matrix tiles`);
  check(ov.budgets.includes('This week') && ov.budgets.includes('$13,300.00') && ov.budgets.includes('$57,000.00'), `${theme}: week and month budget cards`);
  check(ov.cards.map(c => c.id).join() === '163,164,165,166,167', `${theme}: one card per company (${ov.cards.map(c => c.id)})`);
  check(ov.cards.every(c => !/vs \$|Pace\b/.test(c.text)), `${theme}: no budget or pace on any company card`);
  const sf = ov.cards[0];
  check(sf.text.includes('163 + 169 · eBay + Poshmark') && sf.text.includes('$1,642.30') && sf.text.includes('19 orders · 21 units') && sf.text.includes('69%'),
    `${theme}: Shoes and Fashions card — includes Poshmark, sales, orders, share of today`);
  check(['$1,443.70', '$198.60', '$24.99'].every(s => sf.text.includes(s)), `${theme}: …Product · Shipping · Refunded`);
  check(sf.spark && ov.cards[4].spark && !ov.cards[3].spark, `${theme}: sparklines where there were sales, none for a company with none`);
  const dp = ov.cards[3];
  check(dp.dim && dp.text.includes('No orders yet today'), `${theme}: a company with no orders is dimmed and says so`);
  check(ov.updated.startsWith('Synced'), `${theme}: shows when Sellercloud last synced`);
  // Nothing on a company card may be cut off at a 1280 px desktop (three a row clipped the name,
  // the Product figure and "Avg order").
  const clipped = await lp.evaluate(() => [...document.querySelectorAll('#eo-cards [data-eo-company] .truncate')]
    .filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent.trim().slice(0, 24)));
  check(clipped.length === 0, `${theme}: no company-card text is cut off at 1280 px (${clipped.join(' | ')})`);
  const ovAA = await aaFailures(lp, '#page-ecom-overview');
  check(ovAA.length === 0, `${theme}: Overview text clears AA` + (ovAA.length ? '\n     ' + ovAA.join('\n     ') : ''));

  // An earlier day of this week, when there is one.
  const past = await lp.evaluate(() => { const bs = [...document.querySelectorAll('#eo-days button:not([disabled])')]; return bs.length > 1 ? bs.length : 0; });
  if (past) {
    L.asked.length = 0;
    await lp.evaluate(() => document.querySelector('#eo-days button:not([disabled])').click());
    await lp.waitForTimeout(400);
    check(L.asked.some(u => /[?&]date=\d{4}-\d{2}-\d{2}/.test(u)), `${theme}: picking an earlier day asks the worker for that day`);
    const heroPast = await lp.evaluate(() => document.getElementById('eo-hero').innerText);
    check(!heroPast.includes("Today's sales") && !heroPast.includes('Live'), `${theme}: …and the hero names that day, not "Today", with no Live pill`);
  }
  check(L.errs.length === 0, `${theme}: no JS errors` + (L.errs.length ? ' — ' + L.errs.join(' | ') : ''));
  if (theme === 'dark') await lp.screenshot({ path: path.join(process.env.SHOT_DIR || '/tmp', 'ecom-overview-dark.png'), fullPage: true }).catch(() => {});
  if (theme === 'light') await lp.screenshot({ path: path.join(process.env.SHOT_DIR || '/tmp', 'ecom-overview-light.png'), fullPage: true }).catch(() => {});
  await L.ctx.close();
}

// ── Phone width ─────────────────────────────────────────────────────────────
{
  const P = await open({ theme: 'dark', biz: 'ecom', width: 390, height: 844 });
  const vis = await P.page.$$eval('[id^="page-"]', ps => ps.filter(p => !p.classList.contains('hidden')).map(p => p.id));
  check(JSON.stringify(vis) === '["page-ecom-overview"]', `phone: E-Commerce opens on its Overview (${vis})`);
  const wide = await P.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check(!wide, 'phone: the page does not scroll sideways');
  if (process.env.SHOT_DIR) await P.page.screenshot({ path: path.join(process.env.SHOT_DIR, 'ecom-overview-phone.png'), fullPage: true });
  await P.ctx.close();
}

// ── Not set up on the server ────────────────────────────────────────────────
{
  const N = await open({ theme: 'dark', biz: 'ecom', setup: false });
  const status = await N.page.evaluate(() => { const s = document.getElementById('eo-status'); return s.classList.contains('hidden') ? '' : s.innerText; });
  check(/not set up/i.test(status), `no table yet: the page says E-Commerce sales are not set up (${status.slice(0, 60)})`);
  await N.ctx.close();
}

await b.close(); srv.close();
let fails = 0;
for (const [ok, m] of results) { console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${m}`); if (!ok) fails++; }
console.log(`\n${results.length - fails} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
