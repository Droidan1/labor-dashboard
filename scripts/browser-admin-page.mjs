// Admin Settings (#page-admin-settings), restructured into a rail + one tool at a time, driven in a
// REAL BROWSER in light, dark, pure black and Halloween.
//
// 🛑 NOT PART OF `scripts/test.sh` — needs playwright-core and a Chromium. Run by hand:
//
//   npm install --no-save playwright-core
//   bash scripts/build.sh && node scripts/browser-admin-page.mjs
//   (on a Mac: PLAYWRIGHT_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
//
// scripts/test-admin-page.mjs pins the markup. This proves the page works:
//   1. the rail has a group per business the account reaches, from auth-me — a business the page has
//      never heard of gets one too — and every rail row opens exactly its own tool;
//   2. every store picker is filled from the store list: the five open stores, then Holland under
//      "Closed", with "All Stores" only where it was before;
//   3. the old entry hooks still run (the health check's default range), and a health check renders
//      into the reordered results;
//   4. Manual entries' ONE save button posts exactly what each of the four old buttons posted;
//   5. the switches show one panel at a time, and the Categories switches count their table's rows
//      as the table refills (the SECOND render, DESIGN.md §4.8 trap 8);
//   6. Find a tool finds a tool by its old name, and says so when nothing matches;
//   7. Backfill Last 13 Weeks is gone, button and function;
//   8. a phone opens on the list, a tool opens over it and goes back, with no sideways page scroll;
//   9. contrast COMPUTED against the composited background of every text node, ≥ 4.5:1, in every
//      tool and every theme — never a screenshot.
let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch (e) {
  console.error('\nThis check needs playwright-core: npm install --no-save playwright-core\n');
  process.exit(2);
}
const CHROME = process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium';

import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'dist');
if (!fs.existsSync(path.join(root, 'index.html'))) {
  console.error('\ndist/ is not built. Run: bash scripts/build.sh\n'); process.exit(2);
}
const SHOTS = process.env.SHOT_DIR || '/tmp';
fs.mkdirSync(SHOTS, { recursive: true });
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, s) => {
  const f = path.join(root, q.url === '/' ? 'index.html' : q.url.split('?')[0]);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end('no'); }
  s.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(s);
});
await new Promise(r => srv.listen(8098, r));
const URL_ = 'http://127.0.0.1:8098/index.html';
const TZ = 'America/New_York';

const BUSINESSES = [
  { id: 'bl', name: 'Bargain Lane', unitNoun: 'store', unitCount: 6, connected: true },
  { id: 'ecom', name: 'E-Commerce', unitNoun: 'storefront', unitCount: 0, connected: false },
  { id: 'live', name: 'Live Sales', unitNoun: 'store', unitCount: 4, connected: true },
];
const HEALTH = {
  ok: true, threshold: '98%', truncated: null,
  summary: { checked: 150, ok: 146, short: 3, missing: 1, gap: 1284.17, pending: 1, noD1: 0 },
  byStore: {
    BL1: { checked: 30, ok: 28, short: 1, missing: 1, gap: 812.4, uncosted: 0 },
    BL2: { checked: 30, ok: 30, short: 0, missing: 0, gap: 0, uncosted: 12.5 },
    BL4: { checked: 30, ok: 29, short: 1, missing: 0, gap: 301.15, uncosted: 0 },
    BL14: { checked: 30, ok: 30, short: 0, missing: 0, gap: 0, uncosted: 0 },
    BL16: { checked: 30, ok: 29, short: 1, missing: 0, gap: 170.62, uncosted: 0 },
  },
  needsRepair: [
    { store: 'BL1', date: '2026-10-14', status: 'short', snapNet: 6912.33, d1Net: 7481.1, gap: 568.77 },
    { store: 'BL4', date: '2026-10-21', status: 'short', snapNet: 3420.85, d1Net: 3722, gap: 301.15 },
    { store: 'BL1', date: '2026-10-08', status: 'missing', snapNet: null, d1Net: 243.63, gap: 243.63 },
    { store: 'BL16', date: '2026-11-03', status: 'short', snapNet: 4110.4, d1Net: 4281.02, gap: 170.62 },
  ],
};

function installFetch(cfg) {
  const log = window.__adMock = { posts: [] };
  window.fetch = async (u, o = {}) => {
    const s = String(u);
    const J = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
    if (s.includes('auth-me')) return J({ authenticated: true, email: 'owner@example.com', name: 'Owner', role: cfg.role,
      stores: null, associate: false, pages: {}, businesses: cfg.businesses });
    const q = s.includes('?') ? Object.fromEntries(new URL(s).searchParams) : {};
    if (q.action === 'manual-override') {
      const body = JSON.parse(o.body);
      log.posts.push(body);
      return J({ ok: true, count: body.entries.length, total: body.entries.length, results: [], rebuilt: [] });
    }
    if (q.action === 'repair-health') return J(cfg.health);
    return J({ ok: true });
  };
}
const mockScript = (cfg) => `(${installFetch.toString()})(${JSON.stringify(cfg)});`;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS  ' + m); } else { fail++; console.log('  FAIL  ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}${JSON.stringify(a) === JSON.stringify(b) ? '' : `  (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`}`);

const b = await chromium.launch({ executablePath: CHROME });

async function open({ theme = 'light', width = 1400, height = 900, mobile = false, businesses = BUSINESSES, role = 'superuser' } = {}) {
  const ctx = await b.newContext({ timezoneId: TZ, viewport: { width, height }, ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  const page = await ctx.newPage();
  const errs = [], escaped = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('dialog', d => d.dismiss().catch(() => {}));
  await ctx.route(/retjghub\.com/, r => { escaped.push(r.request().url()); r.abort(); });
  await page.addInitScript(({ theme }) => {
    try {
      localStorage.setItem('darkMode', String(theme !== 'light'));
      localStorage.setItem('darkFlavor', theme === 'light' ? 'dark' : theme);
      sessionStorage.setItem('retjg.activeBusiness', 'bl');
      localStorage.setItem('bioPromptDismissed', '1');
    } catch (e) {}
  }, { theme });
  await page.addInitScript(mockScript({ role, businesses, health: HEALTH }));
  await page.goto(URL_, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.getElementById('app')?.classList.contains('hidden'), { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(400);
  await page.evaluate(() => navigateToPage('admin-settings'));
  await page.waitForTimeout(300);
  return { ctx, page, errs, escaped };
}
const visibleTools = (page) => page.$$eval('#page-admin-settings .ad-tool', ts => ts.filter(t => !t.hidden).map(t => t.dataset.tool));
const current = (page) => page.$$eval('#ad-rail .ad-item[aria-current="page"]', bs => bs.map(x => x.dataset.biz || x.dataset.tool));
const shown = (page, sel) => page.$eval(sel, n => !!n.getClientRects().length).catch(() => false);
const TOOLS = ['announcement', 'health', 'manual', 'compare', 'costs', 'categories', 'repull', 'stickers'];

// ── 1–7: desktop, light ─────────────────────────────────────────────────────
{
  console.log('\n[desktop, superuser]');
  const { ctx, page, errs, escaped } = await open();
  eq(await page.$$eval('#ad-rail .ad-ghead', hs => hs.map(h => h.textContent.trim())),
    ['Hub', 'Bargain Lane', 'E-Commerce', 'Live Sales'], 'the rail has Hub, Bargain Lane, and a group for each other business auth-me lists');
  eq(await visibleTools(page), ['health'], 'a first visit opens Data health, and only it');
  eq(await current(page), ['health'], '…and its rail row is the current one');

  for (const t of TOOLS) {
    await page.click(`#ad-rail .ad-item[data-tool="${t}"]`);
    eq(await visibleTools(page), [t], `the ${t} row opens exactly the ${t} tool`);
  }
  await page.click('#ad-rail .ad-item[data-biz="ecom"]');
  eq(await visibleTools(page), ['biz'], 'a business with no tools opens the empty-business view');
  eq(await page.$eval('#ad-biz-empty', n => n.textContent), 'No admin tools for E-Commerce yet', '…naming that business');
  eq(await current(page), ['ecom'], '…and only its row is current');
  await page.click('#ad-rail .ad-item[data-biz="live"]');
  ok((await page.$eval('#ad-biz-note', n => n.textContent)).includes('Manual entries'), "Live Sales' empty view says where Live Sales $ is entered today");

  // 2. Store pickers
  const pickers = await page.$$eval('#page-admin-settings select[data-ad-stores]', ss => ss.map(s => ({
    id: s.id, values: [...s.options].map(o => o.value),
    closed: [...s.querySelectorAll('optgroup')].map(g => [g.label, [...g.children].map(o => o.value)]) })));
  eq(pickers.map(p => p.id).sort(), ['isr-store', 'mlh-store', 'mso-store', 'overrides-store', 'resnapshot-store', 'rh-store', 'srr-store'],
    'all seven store pickers are filled from the list');
  for (const p of pickers) {
    const all = p.id === 'rh-store' || p.id === 'resnapshot-store';
    eq(p.values, [...(all ? ['all'] : []), 'BL1', 'BL2', 'BL4', 'BL14', 'BL16', 'BL8'], `${p.id}: ${all ? 'All Stores, ' : ''}the five open stores, then Holland`);
    eq(p.closed, [['Closed', ['BL8']]], `${p.id}: Holland sits under "Closed"`);
  }
  eq(await page.$eval('#mso-store', s => s.options[0].textContent), 'BL1 – Coliseum', 'an option reads "BL1 – Coliseum", as before');

  // 3. The entry hooks, and the reordered health results
  await page.click('#ad-rail .ad-item[data-tool="health"]');
  ok(/^\d{4}-\d{2}-\d{2}$/.test(await page.inputValue('#rh-start')) && /^\d{4}-\d{2}-\d{2}$/.test(await page.inputValue('#rh-end')),
    "entering the page still fills the health check's default range");
  await page.click('#rh-run');
  await page.waitForFunction(() => !document.getElementById('rh-results').classList.contains('hidden'));
  eq(await page.$$eval('#rh-needs tr', r => r.length), 4, 'a health check renders its four dates');
  eq(await page.$$eval('#rh-results .ad-ptitle', t => t.map(x => x.textContent)), ['Dates a repair would improve', 'By store'],
    'the dates to fix come before the per-store table');
  ok(await shown(page, '#rh-repair'), 'the Repair button shows when there are dates to repair');

  // 4. Manual entries: one save, four shapes
  await page.click('#ad-rail .ad-item[data-tool="manual"]');
  const seg = (name, v) => page.click(`[data-ad-seg="${name}"] button[data-v="${v}"]`);
  await page.selectOption('#mso-store', 'BL2');
  await page.fill('#mso-date', '2026-11-17'); await page.fill('#mso-total', '7761.5'); await page.fill('#mso-auction', '120');
  await page.click('#ad-manual-save'); await page.waitForTimeout(150);
  await seg('me-mode', 'csv'); await page.fill('#mso-bulk', 'store,date,total\nBL1,2026-11-16,6400');
  await page.click('#ad-manual-save'); await page.waitForTimeout(150);
  await seg('me-kind', 'labor'); await seg('me-mode', 'one');
  await page.selectOption('#mlh-store', 'BL16'); await page.fill('#mlh-date', '2026-11-17'); await page.fill('#mlh-hours', '42.5');
  await page.click('#ad-manual-save'); await page.waitForTimeout(150);
  await seg('me-mode', 'csv'); await page.fill('#mlh-bulk', 'BL4,2026-11-15,38');
  await page.click('#ad-manual-save'); await page.waitForTimeout(150);
  eq(await page.evaluate(() => window.__adMock.posts), [
    { entries: [{ store: 'BL2', date: '2026-11-17', total: 7761.5, auction: 120 }] },
    { entries: [{ store: 'BL1', date: '2026-11-16', total: 6400 }] },
    { entries: [{ store: 'BL16', date: '2026-11-17', labor_hours: 42.5 }] },
    { entries: [{ store: 'BL4', date: '2026-11-15', labor_hours: 38 }] },
  ], 'Save and lock posts sales one-day, sales CSV, labor one-day and labor CSV exactly as the four old buttons did');
  ok(await shown(page, '#mlh-status') && !(await shown(page, '#mso-status')), "labor's result shows while Labor is picked, and sales' is out of the way");

  // 5. Switches, and the Categories counts on a second render
  await page.click('#ad-rail .ad-item[data-tool="compare"]');
  ok(await shown(page, '#srr-csv') && !(await shown(page, '#isr-csv')), 'Compare opens on the Sales report');
  await page.click('[data-ad-seg="cmp"] button[data-v="items"]');
  ok(await shown(page, '#isr-csv') && !(await shown(page, '#srr-csv')), '…and the switch swaps in Item sales');
  await page.click('#ad-rail .ad-item[data-tool="costs"]');
  await page.click('[data-ad-seg="cost"] button[data-v="l3"]');
  ok(await shown(page, '#cc-list') && !(await shown(page, '#im-file')), 'Costs switches to category costs');
  await page.click('#ad-rail .ad-item[data-tool="categories"]');
  const fill = (id, n) => page.evaluate(([id, n]) => {
    document.getElementById('overrides-table-wrap').classList.remove('hidden');
    document.getElementById(id).innerHTML = '<tr><td>x</td></tr>'.repeat(n);
  }, [id, n]);
  await fill('overrides-tbody', 12); await fill('overrides-fallback-tbody', 3); await page.waitForTimeout(50);
  const counts = () => page.$$eval('[data-ad-count]', ns => ns.map(n => n.textContent));
  eq(await counts(), ['12', '3', '0', '0'], 'each Categories switch shows its table\'s row count');
  await fill('overrides-fallback-tbody', 7); await page.waitForTimeout(50);
  eq(await counts(), ['12', '7', '0', '0'], '…and keeps it current when the table refills');
  await page.click('[data-ad-seg="cat"] button[data-v="fallback"]');
  ok(await shown(page, '#overrides-fallback-tbody') && !(await shown(page, '#overrides-tbody')), 'the switch shows one table at a time');
  eq(await page.$$eval('#overrides-tbody, #overrides-fallback-tbody, #overrides-l3rules-tbody, #overrides-l3-tbody', t => t.length), 4,
    '…while all four stay in the page, so Save still saves every table');

  // 6. Find a tool
  const rows = () => page.$$eval('#ad-rail .ad-item', bs => bs.filter(x => !x.hidden).map(x => x.dataset.biz || x.dataset.tool));
  await page.fill('#ad-q', 'backfill');
  eq(await rows(), ['repull'], '"backfill" finds Re-pull & rebuild');
  await page.fill('#ad-q', 'manual sales override');
  eq(await rows(), ['manual'], 'a tool is found by its old name');
  await page.fill('#ad-q', 'e-commerce');
  eq(await rows(), ['ecom'], 'a business is found by its name');
  await page.fill('#ad-q', 'zzz');
  ok(await shown(page, '#ad-nomatch') && (await rows()).length === 0, 'nothing matching says so');
  await page.fill('#ad-q', '');
  eq((await rows()).length, 10, 'clearing the box brings all ten rows back');

  // 7. Retired
  eq(await page.evaluate(() => [typeof window.runBackfillSales13w, !!document.getElementById('backfill-sales-status'),
    /Backfill Last 13 Weeks/i.test(document.getElementById('page-admin-settings').textContent)]), ['undefined', false, false],
    'Backfill Last 13 Weeks is gone: no button, no status box, no function');

  eq(errs, [], 'no page errors');
  eq(escaped, [], 'nothing reached a real host');
  await page.screenshot({ path: path.join(SHOTS, 'admin-desktop-light.png'), fullPage: false });
  await ctx.close();
}

// A business the page has never heard of still gets its own group.
{
  const { ctx, page } = await open({ businesses: [...BUSINESSES, { id: 'thrift', name: 'Thrift Co', unitNoun: 'store', unitCount: 2, connected: true }] });
  eq(await page.$$eval('#ad-rail .ad-ghead', hs => hs.map(h => h.textContent.trim())).then(h => h.slice(-1)), ['Thrift Co'],
    'a new business in auth-me gets a group with no edit to the page');
  await ctx.close();
}

// ── 8: phone ─────────────────────────────────────────────────────────────────
{
  console.log('\n[phone 375]');
  const { ctx, page, errs } = await open({ width: 375, height: 812, mobile: true, theme: 'dark' });
  ok(await shown(page, '#ad-rail') && !(await shown(page, '#ad-pane')), 'a phone opens on the list of tools');
  for (const t of TOOLS) {
    await page.click(`#ad-rail .ad-item[data-tool="${t}"]`);
    await page.waitForTimeout(60);
    const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    ok(await shown(page, `.ad-tool[data-tool="${t}"]`) && !(await shown(page, '#ad-rail')) && w[0] <= w[1],
      `${t} opens over the list, with no sideways page scroll (${w[0]} ≤ ${w[1]})`);
    if (t === 'manual') await page.screenshot({ path: path.join(SHOTS, 'admin-phone-dark-tool.png') });
    await page.click(`.ad-tool[data-tool="${t}"] .ad-back`);
    ok(await shown(page, '#ad-rail'), `…and ‹ Admin tools goes back to the list`);
  }
  await page.screenshot({ path: path.join(SHOTS, 'admin-phone-dark-list.png') });
  eq(errs, [], 'no page errors on the phone');
  await ctx.close();
}

// ── 9: contrast, every tool, every theme ─────────────────────────────────────
const audit = (page) => page.evaluate(() => {
  const parse = (s) => { const m = String(s).match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const over = (t, u) => ({ r: t.r * t.a + u.r * (1 - t.a), g: t.g * t.a + u.g * (1 - t.a), b: t.b * t.a + u.b * (1 - t.a), a: 1 });
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const bgOf = (n) => {
    const layers = [];
    for (let e = n; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; } }
    let base = layers.length && layers[layers.length - 1].a >= 1 ? layers.pop() : { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base);
    return base;
  };
  const root = document.getElementById('page-admin-settings');
  let min = 99, n = 0; const low = [];
  for (const e of root.querySelectorAll('*')) {
    if (['STYLE', 'SCRIPT', 'OPTION', 'OPTGROUP'].includes(e.tagName) || e.closest('svg')) continue;
    const own = ['SELECT', 'INPUT', 'TEXTAREA'].includes(e.tagName) || [...e.childNodes].some(c => c.nodeType === 3 && c.textContent.trim());
    if (!own) continue;
    const r = e.getBoundingClientRect(); if (!r.width || !r.height) continue;
    if (e.closest('[disabled]') || (e.tagName === 'INPUT' && e.type === 'file')) continue;
    const cs = getComputedStyle(e);
    const fg0 = parse(cs.color), bg = bgOf(e);
    const v = ratio(fg0.a < 1 ? over(fg0, bg) : fg0, bg);
    n++; if (v < min) min = v;
    if (v < 4.5) low.push(`${e.tagName.toLowerCase()}.${[...e.classList].slice(0, 3).join('.')} "${(e.innerText || e.value || '').trim().slice(0, 30)}" ${v.toFixed(2)}`);
  }
  return { min, n, low };
});
for (const theme of ['light', 'dark', 'oled', 'halloween']) {
  console.log(`\n[contrast, ${theme}]`);
  const { ctx, page } = await open({ theme });
  await page.click('#rh-run');
  await page.waitForFunction(() => !document.getElementById('rh-results').classList.contains('hidden'));
  await page.evaluate(() => { document.getElementById('overrides-table-wrap').classList.remove('hidden'); });
  let worst = 99, n = 0; const low = [];
  for (const t of TOOLS.concat(['ecom'])) {
    await page.click(t === 'ecom' ? '#ad-rail .ad-item[data-biz="ecom"]' : `#ad-rail .ad-item[data-tool="${t}"]`);
    for (const segBtn of await page.$$(`.ad-tool:not([hidden]) [data-ad-seg] button`)) {
      await segBtn.click();
      const a = await audit(page); worst = Math.min(worst, a.min); n += a.n; low.push(...a.low);
    }
    const a = await audit(page); worst = Math.min(worst, a.min); n += a.n; low.push(...a.low);
  }
  ok(worst >= 4.5, `every text node in every tool ≥ 4.5:1 in ${theme} (min ${worst.toFixed(2)} over ${n} checks)${low.length ? '\n        ' + [...new Set(low)].slice(0, 12).join('\n        ') : ''}`);
  if (theme === 'dark') await page.screenshot({ path: path.join(SHOTS, 'admin-desktop-dark.png') });
  await ctx.close();
}

await b.close(); srv.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
