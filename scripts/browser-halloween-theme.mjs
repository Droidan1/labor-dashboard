// The Halloween theme, driven in a REAL BROWSER against the built dist/.
//
// 🛑 NOT PART OF `scripts/test.sh`: it needs playwright-core and a Chromium. Run by hand
// after any change to the theme tokens, the theme picker or a brand/semantic colour:
//
//   npm install --no-save playwright-core
//   bash scripts/build.sh && node scripts/browser-halloween-theme.mjs
//
// 🔑 WHAT IT PINS.
//   1. Picking Halloween in Settings → Accessibility sets `dark halloween`, remembers it,
//      tints the status bar, and the pre-paint boot script restores it on reload. The
//      two-way sidebar switch returns to Halloween after a trip through light.
//   2. The BRAND accent goes pumpkin (titles, active nav, #3BB54A buttons, the canvas
//      helper the charts read), while SEMANTIC colour does not: an ahead store's pace is
//      still green, a behind one red, the hero's 94% still amber. An orange "ahead" next
//      to an amber "close" is the failure this split exists to prevent.
//   3. Light, Dark and Pure black are untouched: the same accent they always had, and no
//      cobweb or bats.
//   4. Every visible text element clears 4.5:1 against its composited background in
//      Halloween, on the dashboard and on the Accessibility page.
//   5. The bats fly, and do not exist under prefers-reduced-motion.
let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch (e) {
  console.error('\nThis check needs playwright-core, which is not a dependency of this repo.\n\n'
    + '  npm install --no-save playwright-core\n  bash scripts/build.sh\n  node scripts/browser-halloween-theme.mjs\n');
  process.exit(2);
}
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const CHROME = process.env.PLAYWRIGHT_CHROMIUM
  || ['/opt/pw-browsers/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'dist');
if (!fs.existsSync(path.join(root, 'index.html'))) {
  console.error('\ndist/ is not built. Run: bash scripts/build.sh\n'); process.exit(2);
}
const types = { '.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json','.png':'image/png','.svg':'image/svg+xml' };
const srv = http.createServer((q, s) => {
  const f = path.join(root, q.url === '/' ? 'index.html' : q.url.split('?')[0]);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end('no'); }
  s.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(s);
});
const PORT = 8097;
await new Promise(r => srv.listen(PORT, r));

// ── The data ────────────────────────────────────────────────────────────────
// MIXED: two stores ahead of budget, one behind, the chain at 94% (amber), every past day
// at 90%. AHEAD: every store, every past day and the chain over budget, so each "ahead"
// site renders in its ahead state, which MIXED never reaches for the chain-level ones.
const TODAY = '2026-10-23';
const MIXED = { BL1: [7500, 8120], BL2: [5000, 3910], BL4: [2500, 2640], BL14: [3750, 3205], BL16: [1250, 905] };
const AHEAD = { BL1: [7500, 8120], BL2: [5000, 5400], BL4: [2500, 2640], BL14: [3750, 4010], BL16: [1250, 1390] };
const noon = (s) => new Date(s + 'T12:00:00Z');
const shift = (s, n) => new Date(noon(s).getTime() + n * 86400000).toISOString().slice(0, 10);
const DATA = { mixed: build(MIXED, 0.9), ahead: build(AHEAD, 2) };   // 2×: the week and month TARGETS are met by Friday
function build(STORES, pastRate) {
const HIST = {}, LIVE = {};
for (const [st, [bud, today]] of Object.entries(STORES)) {
  HIST[st] = {}; let week = 100;
  for (let i = -40; i <= 10; i++) {
    const d = shift(TODAY, i);
    if (noon(d).getUTCDay() === 0) week++;
    const total = i < 0 ? Math.round(bud * pastRate * 100) / 100 : 0;
    HIST[st][d] = { week, budget: bud, total, retail: Math.round(total * 0.7 * 100) / 100, bin: Math.round(total * 0.3 * 100) / 100,
      auction: 0, laborPct: 10, orderCount: Math.round(total / 18), avgCart: 18, avgItems: 4.2, avgTxnSec: 60, avgASP: 4.3 };
  }
  const retail = Math.round(today * 0.68 * 100) / 100, bin = Math.round(today * 0.32 * 100) / 100;
  const side = (net, units, orders) => ({ net, units, orders, avgCart: net / orders, avgItems: units / orders, asp: net / units });
  const ch = { retail: side(retail, Math.round(retail / 6), Math.round(retail / 22)), bin: side(bin, Math.round(bin / 3), Math.round(bin / 14)), mixed: 4 };
  LIVE[st] = { elements: [], refundCents: 0, binNet: bin, retailNet: retail, channels: ch,
    aggregate: { total: today, retail, bin, orderCount: ch.retail.orders + ch.bin.orders - 4, avgCart: 19, avgItems: 4.4, avgTxnSec: 60, avgASP: 4.4 } };
}
return { HIST, LIVE };
}

function stub({ HIST, LIVE, theme }) {
  // Seed the theme on the FIRST load only: an init script runs again on reload, and
  // re-seeding there would overwrite the choice the reload is meant to restore.
  try {
    if (!sessionStorage.getItem('seeded')) {
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('darkMode', String(theme !== 'light'));
      if (theme !== 'light') localStorage.setItem('darkFlavor', theme);
      localStorage.setItem('dashHeroExpanded', '1');
      localStorage.setItem('coachTipsDisabled', '1');
    }
  } catch (e) {}
  const J = (x) => new Response(JSON.stringify(x), { status: 200, headers: { 'content-type': 'application/json' } });
  window.fetch = async (u) => {
    const s = String(u); const q = new URL(s, location.href).searchParams;
    const st = (q.get('store') || '').toUpperCase();
    if (s.includes('auth-me')) return J({ authenticated: true, email: 'a@b.com', name: 'Admin', role: 'admin', stores: null, pages: {}, businesses: ['bl'] });
    if (q.get('history_d1') === 'true') return J(HIST[st] || {});
    if (!q.get('action') && q.get('since') && st) return J(LIVE[st] || {});
    return J({});
  };
}

const failed = []; let passed = 0;
const ok = (c, m) => { if (c) passed++; else { failed.push(m); console.log('  FAIL ' + m); } };
const PUMPKIN = 'rgb(255, 122, 26)', GREEN = 'rgb(34, 197, 94)';

const b = await chromium.launch({ executablePath: CHROME, headless: true });
async function open(theme, { reducedMotion = 'no-preference', width = 1400, data = 'mixed' } = {}) {
  const { HIST, LIVE } = DATA[data];
  const ctx = await b.newContext({ timezoneId: 'America/New_York', viewport: { width, height: 1000 }, reducedMotion });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.clock.setFixedTime(new Date(`${TODAY}T15:20:00-04:00`));
  await page.addInitScript(stub, { HIST, LIVE, theme });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelectorAll('#store-cards [data-store-code]').length >= 5, null, { timeout: 15000 });
  await page.waitForTimeout(800);                       // past every transition-colors (150 ms) and the 0.5 s toggle
  return { ctx, page, errs };
}
const color = (page, sel, prop = 'color') => page.evaluate(([s, p]) => {
  const e = document.querySelector(s); return e ? getComputedStyle(e)[p] : null;
}, [sel, prop]);
// The pace number on a store card, by store code.
const cardPace = (page, st) => page.evaluate((st) => {
  const c = document.querySelector(`#store-cards [data-store-code="${st}"]`);
  const e = c && [...c.querySelectorAll('*')].find(n => n.children.length === 0 && /^\d+%$/.test(n.textContent.trim()));
  return e ? { text: e.textContent.trim(), color: getComputedStyle(e).color } : null;
}, st);
// Every visible text element against its composited background (WCAG 2.1).
const lowContrast = (page) => page.evaluate(() => {
  const parse = c => (c.match(/[\d.]+/g) || []).map(Number);
  const lum = ([r, g, bl]) => [r, g, bl].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
    .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ground = el => {
    const layers = [];
    for (let e = el; e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c.length && (c[3] === undefined || c[3] > 0)) { layers.push(c); if (c[3] === undefined || c[3] === 1) break; }
    }
    let base = parse(getComputedStyle(document.body).backgroundColor).slice(0, 3);
    for (const l of layers.reverse()) { const a = l[3] ?? 1; base = base.map((v, i) => l[i] * a + v * (1 - a)); }
    return base;
  };
  const bad = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!el.getClientRects().length || ![...el.childNodes].some(t => t.nodeType === 3 && t.textContent.trim())) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility !== 'visible' || +cs.opacity < 0.9) continue;
    const fg = parse(cs.color); if ((fg[3] ?? 1) < 0.9) continue;
    const L1 = lum(fg), L2 = lum(ground(el)); const cr = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    if (cr < 4.5) bad.push(`${cr.toFixed(2)} "${el.textContent.trim().slice(0, 30)}"`);
  }
  return bad;
});

try {
  // ── 1. Picking it, remembering it, restoring it ────────────────────────────
  {
    const { ctx, page, errs } = await open('dark');
    await page.evaluate(() => navigateToPage('accessibility'));
    const opt = '#a11y-theme .a11y-theme-opt[data-theme="halloween"]';
    ok(await page.$(opt), 'the Accessibility theme picker offers Halloween');
    if (await page.$(opt)) {
      await page.click(opt);
      await page.waitForTimeout(400);
      const st = await page.evaluate(() => ({
        cls: document.documentElement.className, flavor: localStorage.getItem('darkFlavor'),
        dark: localStorage.getItem('darkMode'), meta: document.querySelector('meta[name="theme-color"]').content,
        checked: document.querySelector('#a11y-theme [aria-checked="true"]')?.dataset.theme,
      }));
      ok(st.cls.split(' ').includes('dark') && st.cls.split(' ').includes('halloween'), `picking Halloween sets "dark halloween" (got "${st.cls}")`);
      ok(st.flavor === 'halloween' && st.dark === 'true', 'Halloween is remembered as the dark flavour');
      ok(st.meta === '#ff7a1a', `the status bar turns pumpkin (got ${st.meta})`);
      ok(st.checked === 'halloween', 'the picker shows Halloween as selected');

      await page.reload({ waitUntil: 'domcontentloaded' });
      const boot = await page.evaluate(() => document.documentElement.className);
      ok(boot.includes('halloween'), `the boot script restores Halloween before the app runs (got "${boot}")`);

      await page.waitForTimeout(1500);
      await page.click('#dark-toggle');                 // off → light
      await page.waitForTimeout(300);
      ok(!(await page.evaluate(() => document.documentElement.className)).includes('halloween'), 'the sidebar switch turns Halloween off');
      await page.click('#dark-toggle');                 // on → back to the dark you picked
      await page.waitForTimeout(300);
      ok((await page.evaluate(() => document.documentElement.className)).includes('halloween'), 'the sidebar switch returns to Halloween, not plain dark');
    }
    ok(!errs.length, 'no page errors while switching themes: ' + errs.join(' | '));
    await ctx.close();
  }

  // ── 2–4. Halloween: brand pumpkin, semantics intact, readable ─────────────
  {
    const { ctx, page, errs } = await open('halloween');
    ok((await page.evaluate(() => document.documentElement.className)).includes('halloween'), 'Halloween boots from storage');
    ok(await color(page, '#page-dashboard h1.text-accent-green, h1.font-brand.text-accent-green') === PUMPKIN, 'the page title is pumpkin');
    ok(await color(page, '.sidebar .nav-item.active') === PUMPKIN, 'the active sidebar item is pumpkin');
    ok(await color(page, '#rh-run', 'backgroundColor') === PUMPKIN, 'a #3BB54A primary button is pumpkin');
    ok(await color(page, '#ptr-indicator', 'color') === 'rgb(12, 9, 7)', 'the pull-to-refresh bar puts black text on pumpkin');
    ok(await page.evaluate(() => typeof window.accentRgba === 'function' && window.accentRgba(0.5)) === 'rgba(255,122,26,0.5)', 'charts read the pumpkin accent');

    const ahead = await cardPace(page, 'BL1'), behind = await cardPace(page, 'BL2');
    ok(ahead && ahead.text === '108%' && ahead.color === GREEN, `an ahead store's pace stays green (got ${JSON.stringify(ahead)})`);
    ok(behind && behind.text === '78%' && behind.color !== PUMPKIN && behind.color !== GREEN, `a behind store's pace is neither green nor pumpkin (got ${JSON.stringify(behind)})`);
    ok(await color(page, '#h-pace') === 'rgb(245, 158, 11)', 'the hero pace at 94% stays amber');

    const after = await page.evaluate(() => { const c = getComputedStyle(document.body, '::after'); return { name: c.animationName, content: c.content }; });
    ok(after.name === 'hw-bats' && after.content !== 'none', 'the bats fly');
    const web = await page.evaluate(() => getComputedStyle(document.body, '::before').backgroundImage);
    ok(web.includes('data:image/svg+xml'), 'the cobweb is drawn');

    const badDash = await lowContrast(page);
    ok(!badDash.length, 'every dashboard text clears 4.5:1 in Halloween: ' + badDash.join(', '));
    await page.evaluate(() => navigateToPage('accessibility'));
    await page.waitForTimeout(600);
    const badA11y = await lowContrast(page);
    ok(!badA11y.length, 'every Accessibility page text clears 4.5:1 in Halloween: ' + badA11y.join(', '));
    ok(!errs.length, 'no page errors in Halloween: ' + errs.join(' | '));
    await ctx.close();
  }

  // ── 2b. Halloween with the chain AHEAD: every "ahead" site stays green ──────
  {
    const { ctx, page, errs } = await open('halloween', { data: 'ahead' });
    ok(await color(page, '#h-pace') === GREEN, `the hero pace, ahead, is green not pumpkin (got ${await color(page, '#h-pace')})`);
    ok(await color(page, '#c-today-diff span') === GREEN, 'the hero +$ delta is green');
    ok(await color(page, '#bgt-w-bar', 'backgroundColor') === GREEN, 'the weekly budget bar, ahead, is green');
    ok(await color(page, '#bgt-m-bar', 'backgroundColor') === GREEN, 'the monthly budget bar, ahead, is green');
    await page.evaluate(() => { showAllStoresDetail(); switchAllStoresTab('weekly'); });
    await page.waitForTimeout(1500);
    const pills = await page.evaluate(() => [...document.querySelectorAll('#as-content-weekly span, #as-content-weekly div')]
      .filter(e => e.children.length === 0 && /^\d+%$/.test(e.textContent.trim()) && parseInt(e.textContent, 10) >= 100)
      .map(e => getComputedStyle(e).color));
    ok(pills.length > 0 && pills.every(c => c === GREEN), `the All Stores weekly table's ≥100% pills are green (got ${JSON.stringify(pills.slice(0, 4))})`);
    // Status greens that live in <style> blocks, not markup: Sign Studio's ok pill sits
    // beside amber "part", and its brand variable is the one Halloween re-points.
    const ss = await page.evaluate(() => {
      const host = document.getElementById('page-merch-signs'); const e = document.createElement('span');
      e.className = 'ss-pill ok'; host.appendChild(e); const c = getComputedStyle(e).color; e.remove(); return c;
    });
    ok(ss === GREEN, `Sign Studio's ok pill stays green (got ${ss})`);
    ok(!errs.length, 'no page errors with the chain ahead: ' + errs.join(' | '));
    await ctx.close();
  }

  // ── 5. Reduced motion: no bats ─────────────────────────────────────────────
  {
    const { ctx, page } = await open('halloween', { reducedMotion: 'reduce' });
    ok(await page.evaluate(() => getComputedStyle(document.body, '::after').display) === 'none', 'no bats under prefers-reduced-motion');
    await ctx.close();
  }

  // ── 3. The other themes are untouched ──────────────────────────────────────
  for (const theme of ['dark', 'oled', 'light']) {
    const { ctx, page } = await open(theme);
    const want = theme === 'light' ? 'rgb(22, 101, 52)' : GREEN;   // light retints accent TEXT to green-800
    ok(await color(page, 'h1.font-brand.text-accent-green') === want, `[${theme}] the page title keeps its green`);
    ok(await color(page, '#rh-run', 'backgroundColor') === 'rgb(59, 181, 74)', `[${theme}] a primary button keeps #3BB54A`);
    ok(await page.evaluate(() => getComputedStyle(document.body, '::after').content) === 'none', `[${theme}] no bats`);
    ok(await page.evaluate(() => getComputedStyle(document.body, '::before').content) === 'none', `[${theme}] no cobweb`);
    ok(await page.evaluate(() => typeof window.accentRgba === 'function' && window.accentRgba(0.5)) === 'rgba(34,197,94,0.5)', `[${theme}] charts keep the green accent`);
    const ahead = await cardPace(page, 'BL1');
    ok(ahead && ahead.color === (theme === 'light' ? 'rgb(22, 101, 52)' : GREEN), `[${theme}] an ahead store's pace is green (got ${JSON.stringify(ahead)})`);
    // text-op-good takes the same light retint as text-accent-green (#22c55e is 2.28:1 on
    // white). Intentional: it also lifts the Labor page's existing op-good text in light.
    const good = await page.evaluate(() => { const e = document.createElement('span'); e.className = 'text-op-good';
      document.body.appendChild(e); const c = getComputedStyle(e).color; e.remove(); return c; });
    ok(good === (theme === 'light' ? 'rgb(22, 101, 52)' : GREEN), `[${theme}] text-op-good is ${theme === 'light' ? 'green-800' : '#22c55e'} (got ${good})`);
    await ctx.close();
  }
} finally {
  await b.close(); srv.close();
}

console.log(`\n${passed} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
