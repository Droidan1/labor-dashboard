// Sign Studio: the page, driven in a REAL BROWSER with the real fonts.
//
// 🛑 NOT PART OF `scripts/test.sh`, deliberately: the runner globs `test-*` and this needs
// playwright-core and a Chromium, neither of which is a repo dependency. Run it by hand
// after a change to the page:
//
//   npm install --no-save playwright-core
//   bash scripts/build.sh && node scripts/browser-sign-studio.mjs
//
// scripts/test-sign-render.mjs proves the renderer in Node: the fit rules, the layouts and
// the two drawers, against the committed font files. This checks what a manager meets: who
// can open the page, the three steps, the preview the browser actually draws with those
// fonts, what is allowed to print, and that every word on the page is readable in all three
// themes.
//
// 🛑 THE APP'S THEME IS localStorage, NOT prefers-color-scheme (see browser-bin-dump):
// `darkMode` + `darkFlavor=oled` are written before boot, and the class is asserted.
let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch (e) {
  console.error(
    '\nThis check needs playwright-core, which is not a dependency of this repo.\n\n' +
    '  npm install --no-save playwright-core\n' +
    '  bash scripts/build.sh\n' +
    '  node scripts/browser-sign-studio.mjs\n\n' +
    'A Chromium is also needed: /opt/pw-browsers/chromium, or PLAYWRIGHT_CHROMIUM.\n');
  process.exit(2);
}
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium';
const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const root = path.join(repo, 'dist');
if (!fs.existsSync(path.join(root, 'index.html'))) { console.error('No dist/ — run bash scripts/build.sh first.'); process.exit(2); }
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.txt': 'text/plain' };
const PORT = 8094;
// A path in `fail` answers 503, the way a struggling CDN or a dead store connection does, so a
// check can take one file away. `served` counts what was asked for.
const fail = new Set(), served = {};
let swDeploy = 0;   // section 10 bumps this to ship a "new deploy" of sw.js
const srv = http.createServer((q, s) => {
  const u = q.url.split('?')[0];
  served[u] = (served[u] || 0) + 1;
  if (u === '/sw.js' && swDeploy) {
    s.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-cache' });
    return s.end(fs.readFileSync(path.join(root, 'sw.js'), 'utf8').replace(/const CACHE_NAME = '([^']+)'/, `const CACHE_NAME = '$1-next${swDeploy}'`));
  }
  const f = path.join(root, u === '/' ? 'index.html' : u);
  if (fail.has(u)) { s.writeHead(503); return s.end('down'); }
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end('no'); }
  s.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(s);
});
await new Promise(r => srv.listen(PORT, r));
const ORIGIN = `http://127.0.0.1:${PORT}`;

const results = [], measured = [];
const check = (c, m) => { results.push([!!c, m]); };
const eq = (got, want, m) => { const same = JSON.stringify(got) === JSON.stringify(want);
  check(same, `${m}${same ? '' : `  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`); };

// ── the fake worker, run inside the page ─────────────────────────────────
// auth-me is answered here; nothing else this page does reaches the worker. Every request
// that is not this server is refused below, so nothing can reach production.
function pageMocks({ who, theme }) {
  try {
    localStorage.setItem('darkMode', String(theme !== 'light'));
    localStorage.setItem('darkFlavor', theme === 'oled' ? 'oled' : 'dark');
  } catch (e) {}
  const J = (x, st = 200) => new Response(JSON.stringify(x), { status: st, headers: { 'content-type': 'application/json' } });
  const real = window.fetch;
  window.fetch = async (u, o = {}) => {
    const s = String(u && u.url ? u.url : u);
    if (!s.startsWith('https://')) return real(u, o);
    if (new URL(s).searchParams.get('action') !== 'auth-me') return J({ ok: false, error: 'not in this harness' }, 404);
    window.__ssAuthed = true;
    return J(who);
  };
}
const USER = role => ({ authenticated: true, email: `${role}@example.com`, name: 'Alex M', role, stores: ['BL1', 'BL4'], pages: {}, businesses: ['bl'] });
const ROLES = {
  // A district manager is a `manager` with more stores: migration-029 retired the separate role.
  manager: USER('manager'), admin: USER('admin'), superuser: USER('superuser'),
  executive: USER('executive'), staff: USER('staff'),
  // An associate is gated by page grant. This one holds a grant for Sign Studio, which the
  // PRD says cannot be granted: the router must refuse it anyway.
  associate: Object.assign(USER('associate'), { associate: true, pages: { 'merch-signs': 'edit', 'bin-dump': 'edit' } }),
};

const b = await chromium.launch({ executablePath: CHROME });
// One section = one scenario. A wait that times out is a FAILED check, recorded, and the run
// goes on; a crash would hide every check after it.
// SECTIONS=2,4 runs only those.
const live = new Set(), ONLY = (process.env.SECTIONS || '').split(',').filter(Boolean);
async function section(name, fn) {
  if (ONLY.length && !ONLY.includes(name.split('.')[0])) return;
  try { await fn(); }
  catch (e) { check(false, `${name}: stopped after "${(results[results.length - 1] || [])[1]}" — ${String((e && e.message) || e).split('\n')[0]}`); }
  finally { for (const c of live) { try { await c.close(); } catch (e) {} } live.clear(); }
}
async function open({ role = 'manager', theme = 'light', phone = false, go = true, sw = false } = {}) {
  const ctx = await b.newContext(Object.assign({ timezoneId: 'America/New_York', locale: 'en-US', serviceWorkers: sw ? 'allow' : 'block' },
    phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
          : { viewport: { width: 1280, height: 900 } }));
  live.add(ctx);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  // A failed load of a refused off-host file (Google Fonts, the CDNs) is this harness, not a fault.
  page.on('console', m => { if (m.type() === 'error' && !(m.location().url && !m.location().url.startsWith(ORIGIN))) errs.push('console: ' + m.text()); });
  // A context route also covers the service worker's own requests (Chromium), which a page
  // route does not see.
  await (sw ? ctx : page).route(u => !u.href.startsWith(ORIGIN), r => r.abort());
  await page.addInitScript(pageMocks, { who: ROLES[role], theme });
  await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.navigateToPage === 'function' && window.__ssAuthed, null, { timeout: 10000 });
  await page.waitForTimeout(600);
  await page.addStyleTag({ content: '#error-banner,#swipe-label,#ptr-hint{display:none !important}' });
  const got = await page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light')
    + (document.documentElement.classList.contains('oled') ? '+oled' : ''));
  check(got === { light: 'light', dark: 'dark', oled: 'dark+oled' }[theme], `[${theme}] the app is ACTUALLY in ${theme} (${got})`);
  if (go) await enter(page);
  return { ctx, page, errs };
}
const shown = page => page.evaluate(() => [...document.querySelectorAll('[id^="page-"]')].filter(n => !n.classList.contains('hidden')).map(n => n.id));
async function enter(page) {
  await page.evaluate(() => window.navigateToPage('merch-signs'));
  await page.waitForFunction(() => document.querySelector('#ss-root [data-preview] svg, #ss-root .ss-fail'), null, { timeout: 8000 });
}
const settle = page => page.waitForTimeout(120);
// Types like a person: one key at a time, into whatever has focus.
async function type(page, sel, text) { await page.fill(sel, ''); await page.type(sel, text); await settle(page); }
async function makeSign(page, s) {
  // From step 1, the way a manager would: the type, the fields, the label.
  await page.click('[data-step="1"]'); await settle(page);
  await page.click(`[data-chips="template"] [data-v="${s.template || 'price'}"]`); await settle(page);
  const two = await page.evaluate(() => !!document.getElementById('ss-f-name-1'));
  if (!!s.two !== two) { await page.click('[data-two]'); await settle(page); }
  for (const [k, v] of Object.entries(s.fields || {})) await type(page, `#ss-f-${k}`, v);
  for (const [gi, u] of Object.entries(s.units || {})) { await page.click(`[data-chips="unit-${gi}"] [data-v="${u}"]`); await settle(page); }
  await page.click('[data-step="2"]'); await settle(page);
  await page.click(`.ss-tile[data-v="${s.sale || 'none'}"]`); await settle(page);
  if (s.custom != null) await type(page, '#ss-f-custom', s.custom);
  await page.click('[data-step="3"]'); await settle(page);
}
const pill = page => page.$eval('[data-status]', n => ({ cls: n.className.replace('ss-pill ', ''), text: n.textContent.trim() }));

// ── colour ─────────────────────────────────────────────────────────────
const rgba = s => { const m = String(s).match(/[\d.]+/g) || []; return [+m[0], +m[1], +m[2], m[3] == null ? 1 : +m[3]]; };
const over = (top, base) => [0, 1, 2].map(i => top[i] * top[3] + base[i] * (1 - top[3])).concat(1);
const lum = c => { const f = c.slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
// Every piece of text on the page (the sign itself excluded: it is paper, checked in Node),
// with its colour and the stack of backgrounds it is painted over, down to the page ground.
async function textSamples(page) {
  return page.evaluate(() => {
    const out = [], rootEl = document.getElementById('page-merch-signs');
    const layers = n => { const L = []; for (let e = n; e; e = e.parentElement) { const bg = getComputedStyle(e).backgroundColor; if (bg && bg !== 'rgba(0, 0, 0, 0)') L.push(bg); } return L; };
    const faded = n => { for (let e = n; e; e = e.parentElement) if (+getComputedStyle(e).opacity < 1) return true; return false; };
    const ground = getComputedStyle(document.body).backgroundColor;
    const visible = n => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(n).visibility !== 'hidden'; };
    for (const n of rootEl.querySelectorAll('*')) {
      if (n.closest('svg') || !visible(n) || faded(n) || n.closest(':disabled')) continue;
      const own = [...n.childNodes].filter(c => c.nodeType === 3 && c.textContent.trim()).map(c => c.textContent.trim()).join(' ');
      if (own) out.push({ what: `${n.tagName.toLowerCase()}.${String(n.className).split(' ')[0]} "${own.slice(0, 28)}"`, color: getComputedStyle(n).color, layers: layers(n), ground });
      for (const pseudo of ['::before', '::after', '::placeholder']) {
        if (pseudo === '::placeholder' && !(n.tagName === 'INPUT' && n.placeholder && !n.value)) continue;
        const cs = getComputedStyle(n, pseudo), content = pseudo === '::placeholder' ? n.placeholder : cs.content;
        if (!content || content === 'none' || content === 'normal' || !/[\p{L}\p{N}\p{S}]/u.test(content.replace(/^"|"$/g, ''))) continue;
        out.push({ what: `${n.tagName.toLowerCase()}.${String(n.className).split(' ')[0]}${pseudo} ${content.slice(0, 20)}`, color: cs.color, layers: layers(n), ground });
      }
    }
    return out;
  });
}
function contrastOf(samples) {
  return samples.map(s => {
    let bg = rgba(s.ground);
    for (const L of s.layers.slice().reverse()) bg = over(rgba(L), bg);   // outermost first
    const fg = over(rgba(s.color), bg);
    return { what: s.what, r: ratio(fg, bg) };
  });
}

// ── 1. Who can open it ───────────────────────────────────────────────────
// The sidebar item and the router carry the same list, because the phone's Menu is built
// from the sidebar: an item the router refuses is a dead row on a phone.
await section('1. roles', async () => {
  for (const role of ['manager', 'admin', 'superuser']) {
    const { page, errs } = await open({ role, go: false });
    const items = await page.evaluate(() => [...document.querySelectorAll('#nav-merch-sub .nav-item')]
      .filter(n => !n.classList.contains('hidden')).map(n => n.querySelector('.nav-label').textContent.trim()));
    const at = items.indexOf('Sign Studio');
    check(at >= 0, `${role}: Merchandising lists Sign Studio (${items.join(' / ')})`);
    if (items.includes('Price Scan')) check(items[at - 1] === 'Price Scan', `${role}: …right after Price Scan`);
    if (role === 'manager') eq(items, ['Price Scan', 'Sign Studio', 'Shelf Count'], 'manager: Price Scan → Sign Studio → Shelf Count');
    // The Merchandising sub-menu opens on a click, as it does for a person. Its collapsed
    // state is the .hidden class, which the sidebar's CSS does not turn into display:none,
    // so Playwright's isVisible cannot tell.
    if (await page.evaluate(() => document.getElementById('nav-merch-sub').classList.contains('hidden'))) await page.click('#nav-merch');
    await page.click('#nav-merch-signs');
    await page.waitForFunction(() => !document.getElementById('page-merch-signs').classList.contains('hidden'), null, { timeout: 5000 }).catch(() => {});
    eq(await shown(page), ['page-merch-signs'], `${role}: the item opens Sign Studio`);
    check(await page.evaluate(() => document.getElementById('nav-merch-signs').classList.contains('active')), `${role}: …and lights its own item`);
    check(!errs.length, `${role}: no page errors (${errs.slice(0, 2).join(' | ')})`);
  }
  for (const role of ['executive', 'staff', 'associate']) {
    const { page, errs } = await open({ role, go: false });
    const vis = await page.evaluate(() => ({ group: !document.getElementById('nav-merch-group').classList.contains('hidden'),
      item: !document.getElementById('nav-merch-signs').classList.contains('hidden') }));
    check(!vis.item, `${role}: no Sign Studio in the sidebar (${JSON.stringify(vis)})`);
    if (role === 'executive') check(vis.group, 'executive: still sees Merchandising, for Price Scan');
    const before = await shown(page);
    await page.evaluate(() => window.navigateToPage('merch-signs'));
    await page.waitForTimeout(200);
    eq(await shown(page), before, `🛑 ${role}: the router refuses Sign Studio${role === 'associate' ? ', grant or no grant' : ''}`);
    check(!errs.length, `${role}: no page errors (${errs.slice(0, 2).join(' | ')})`);
  }
});

// ── 2. Layout C: three steps that keep what you typed ────────────────────
await section('2. layout C', async () => {
  const { page, errs } = await open();
  eq(await page.$$eval('.ss-step', ns => ns.map(n => n.textContent.trim())), ['1What\'s on sale', '2Which sale', '3Print'], 'three steps, in order');
  eq(await page.$eval('.ss-step[aria-current="step"]', n => n.dataset.step), '1', 'it opens on step 1');
  // Focus stays in the box while typing, and the preview follows each key.
  await page.click('#ss-f-name-0');
  await page.keyboard.type('All cereal', { delay: 15 });
  const f = await page.evaluate(() => ({ active: document.activeElement.id, value: document.activeElement.value,
    drawn: [...document.querySelectorAll('[data-preview="current"] svg text[data-role="name"]')].map(t => t.textContent).join(' ') }));
  eq(f, { active: 'ss-f-name-0', value: 'All cereal', drawn: 'ALL CEREAL' }, 'typing keeps focus and every key, and the preview draws it in capitals');
  // …and the box being typed in is never rebuilt: an edit in the MIDDLE keeps its caret.
  await page.evaluate(() => { const n = document.getElementById('ss-f-name-0'); n.__mark = 1; n.setSelectionRange(3, 3); });
  await page.keyboard.type(' the', { delay: 15 });
  eq(await page.evaluate(() => { const n = document.getElementById('ss-f-name-0'); return [n.value, n.__mark === 1, n.selectionStart]; }), ['All the cereal', true, 7],
     'typing in the middle of a name keeps the caret there, in the same box');
  await type(page, '#ss-f-name-0', 'All cereal');
  await type(page, '#ss-f-price-0', '2');
  // Values survive every switch: step, sign type, orientation, a second price.
  await page.click('[data-orient="portrait"]'); await settle(page);
  await page.click('[data-step="2"]'); await settle(page);
  await page.click('.ss-tile[data-v="flash"]'); await settle(page);
  await page.click('[data-step="1"]'); await settle(page);
  await page.click('[data-chips="template"] [data-v="pct"]'); await settle(page);
  await type(page, '#ss-f-pct-0', '20');
  await page.click('[data-chips="template"] [data-v="uvt"]'); await settle(page);
  await type(page, '#ss-f-them', '100');
  await page.click('[data-chips="template"] [data-v="price"]'); await settle(page);
  const kept = await page.evaluate(() => ({ name: document.getElementById('ss-f-name-0').value, price: document.getElementById('ss-f-price-0').value,
    orient: document.querySelector('[data-orient][aria-pressed="true"]').dataset.orient }));
  eq(kept, { name: 'All cereal', price: '2', orient: 'portrait' }, 'the name, the price and the orientation survive every switch');
  await page.click('[data-chips="template"] [data-v="pct"]'); await settle(page);
  eq(await page.$eval('#ss-f-pct-0', n => n.value), '20', '…and so does the percentage');
  await page.click('[data-chips="template"] [data-v="uvt"]'); await settle(page);
  eq(await page.$eval('#ss-f-them', n => n.value), '100', '…and their price');
  eq(await page.$eval('[data-discount]', n => n.textContent.includes('Our discount: 98% off')), true, 'Us vs Them works the discount out: $100 → $2 is 98% off');
  await page.click('[data-chips="template"] [data-v="price"]'); await settle(page);
  await page.click('[data-two]'); await settle(page);
  eq(await page.evaluate(() => document.activeElement.id), 'ss-f-name-1', 'adding a second price puts you in its name');
  await page.click('[data-two]'); await settle(page);
  eq(await page.$eval('#ss-f-name-0', n => n.value), 'All cereal', '…and removing it keeps the first');
  // The step bar's labels: step 2 shows the labels as they print, on paper.
  await page.click('[data-step="2"]'); await settle(page);
  eq(await page.$eval('.ss-tile[aria-pressed="true"]', n => n.dataset.v), 'flash', 'step 2 remembers Flash Sale');
  eq(await page.$eval('.ss-tile[data-v="flash"] .lbl-t', n => [n.innerText.replace(/\s+/g, ' '), getComputedStyle(n).fontFamily]), ['FLASH SALE', '"SS Poppins Black Italic", sans-serif'],
     'a label tile is the printed label: its words, in the sign\'s italic');
  await page.click('.ss-tile[data-v="custom"]'); await settle(page);
  await type(page, '#ss-f-custom', 'Weekend deal');
  eq(await page.$eval('.ss-tile[data-v="custom"] .lbl-t', n => n.innerText), 'WEEKEND DEAL', 'the custom tile shows what was typed, as it prints');
  // Hostile text is text: in the sign, the tiles and the messages.
  await type(page, '#ss-f-custom', '<b>x</b>');
  await page.click('[data-step="1"]'); await settle(page);
  await type(page, '#ss-f-name-0', '<img src=x onerror=1>');
  const hostile = await page.evaluate(() => ({ imgs: document.querySelectorAll('#page-merch-signs img, #page-merch-signs b b').length,
    onattrs: [...document.querySelectorAll('#page-merch-signs *')].filter(n => [...n.attributes].some(a => /^on/i.test(a.name))).length,
    drawn: [...document.querySelectorAll('[data-preview] svg text[data-role="name"]')].map(t => t.textContent).join(' '),
    label: [...document.querySelectorAll('[data-preview] svg text[data-role="label"]')].map(t => t.textContent).join(' ') }));
  eq(hostile, { imgs: 0, onattrs: 0, drawn: '<IMG SRC=X ONERROR=1>', label: '<B>X</B>' }, 'hostile text is drawn literally and adds no element and no handler');
  // Start a new sign clears it, back on step 1.
  await page.click('[data-step="3"]'); await settle(page);
  await page.click('[data-new]'); await settle(page);
  eq(await page.evaluate(() => [document.querySelector('.ss-step[aria-current="step"]').dataset.step, document.getElementById('ss-f-name-0').value]), ['1', ''],
     'Start a new sign clears the sign and goes back to step 1');
  check(!errs.length, `no page errors (${errs.slice(0, 2).join(' | ')})`);
  // A phone: nothing scrolls sideways on any step, and the floating bar hides nothing at the end.
  const P = await open({ phone: true, theme: 'dark' });
  await makeSign(P.page, { template: 'uvt', fields: { 'name-0': 'Mens athletic sneakers', them: '59.99', 'price-0': '19.99' }, sale: 'manager' });
  for (const st of ['1', '2', '3']) {
    await P.page.click(`[data-step="${st}"]`); await settle(P.page);
    const w = await P.page.evaluate(() => ({ sw: document.scrollingElement.scrollWidth, cw: document.scrollingElement.clientWidth }));
    check(w.sw <= w.cw, `390 px, step ${st}: no sideways scroll (${w.sw} ≤ ${w.cw})`);
  }
  eq(await P.page.$$eval('.ss-step', ns => new Set(ns.map(n => Math.round(n.getBoundingClientRect().top))).size), 1, '390 px: the three steps sit on one row');
  await P.page.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight));
  await P.page.waitForTimeout(400);
  const last = await P.page.evaluate(() => { const r = document.querySelector('[data-new]').getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!hit && !!hit.closest('[data-new]'); });
  check(last, '390 px: scrolled to the end, Start a new sign is not under the floating bar');
  const small = await P.page.evaluate(() => [...document.querySelectorAll('#page-merch-signs button, #page-merch-signs input, #page-merch-signs summary')]
    .filter(n => n.getBoundingClientRect().height > 0 && n.getBoundingClientRect().height < 36).map(n => n.id || n.className || n.tagName));
  eq(small, [], '390 px: every control is at least 36 px tall');
  const fs16 = await P.page.$$eval('#page-merch-signs input[type=text]', ns => ns.every(n => parseFloat(getComputedStyle(n).fontSize) >= 16));
  check(fs16, '390 px: every text box is 16 px, so iOS does not zoom on focus');
  check(!P.errs.length, `phone: no page errors (${P.errs.slice(0, 2).join(' | ')})`);
});

// ── 3. The preview the browser draws, measured ───────────────────────────
// Every text in every preview is as wide in the browser as the reader said (so the fit held
// on screen), and no ink lands between the border and the content box. The same sweep must
// catch a sign pushed 30 pt, or it proves nothing.
await section('3. geometry', async () => {
  const { page, errs } = await open();
  const SIGNS = [
    { fields: { 'name-0': 'All cereal', 'price-0': '2' }, sale: 'flash' },
    { fields: { 'name-0': 'Mens athletic sneakers', 'price-0': '24.99' }, sale: 'manager' },
    { two: true, fields: { 'name-0': 'Shoes', 'price-0': '10', 'name-1': 'Premium shoes', 'price-1': '15' }, sale: 'blowout' },
    { template: 'pct', two: true, fields: { 'name-0': 'Winter coats', 'pct-0': '20', 'name-1': 'Boots', 'pct-1': '40' }, sale: 'custom', custom: 'Weekend deal' },
    { template: 'uvt', fields: { 'name-0': 'Stand mixer', them: '59.99', 'price-0': '19.99' }, sale: 'sale' },
    { fields: { 'name-0': 'All candy', 'price-0': '0.99' } },
  ];
  // The reader's widths, from the very bytes the page loaded.
  await page.evaluate(async () => {
    const R = window.SignRender, fam = {};
    for (const [k, f] of Object.entries(R.FACES)) fam[f.fam] = R.readFont(new Uint8Array(await (await fetch(f.file)).arrayBuffer()));
    window.__ssReader = fam;
  });
  let worst = 0, n = 0;
  for (const s of SIGNS) {
    await makeSign(page, s);
    const r = await page.evaluate(() => {
      const out = [];
      for (const t of document.querySelectorAll('[data-preview] svg text')) {
        const f = window.__ssReader[t.getAttribute('font-family')], size = +t.getAttribute('font-size'), ls = +(t.getAttribute('letter-spacing') || 0);
        const want = f.w100(t.textContent) * size / 100, got = t.getComputedTextLength() - ls * [...t.textContent].length;   // Chrome counts the spacing after the last letter too
        out.push({ role: t.dataset.role, rel: Math.abs(got - want) / want });
      }
      return out;
    });
    n += r.length; worst = Math.max(worst, ...r.map(x => x.rel));
  }
  check(n > 60 && worst < 0.001, `every text the browser draws is within 0.1% of the reader's width (${n} texts, worst ${(worst * 100).toFixed(3)}%)`);
  // The ink sweep: the sign drawn at 2 px per point, then every pixel in the band between the
  // border's inner edge (31 pt) and the content box (51 pt, less 1 pt for a round letter's
  // overshoot) must be paper.
  const sweep = async (orient, shift) => {
    const dims = await page.evaluate(async ({ orient, shift }) => {
      const svg = document.querySelector(`[data-preview="${orient}"] svg`).cloneNode(true);
      if (shift) svg.querySelectorAll('text').forEach(t => t.setAttribute('x', +t.getAttribute('x') + shift));
      const [W, H] = svg.getAttribute('viewBox').split(' ').slice(2).map(Number);
      svg.setAttribute('width', W * 2); svg.setAttribute('height', H * 2);
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#fff';
      host.id = 'ss-sweep'; host.appendChild(svg); document.body.appendChild(host);
      await document.fonts.ready;
      return [W, H];
    }, { orient, shift });
    const buf = await page.locator('#ss-sweep svg').screenshot();
    await page.evaluate(() => document.getElementById('ss-sweep').remove());
    return { dims, buf };
  };
  const inkInBand = async (orient, shift) => {
    const { dims: [W, H], buf } = await sweep(orient, shift);
    // Decode the screenshot in the page itself (no PNG decoder in this repo).
    return page.evaluate(async ({ b64, W, H }) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data, k = c.width / W;
      let ink = 0;
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
        const px = (x + 0.5) / k, py = (y + 0.5) / k;   // the pixel's centre, so the border's own edge is not counted
        const inBorder = px > 31 && py > 31 && px < W - 31 && py < H - 31;
        const inContent = px > 50 && py > 50 && px < W - 50 && py < H - 50;   // round letters overshoot by up to 0.6 pt
        if (!inBorder || inContent) continue;
        const i = (y * c.width + x) * 4;
        if (d[i] < 200 || d[i + 1] < 200 || d[i + 2] < 200) ink++;
      }
      return ink;
    }, { b64: buf.toString('base64'), W, H });
  };
  const bands = [];
  for (const s of SIGNS.slice(0, 5)) {
    await makeSign(page, s);
    for (const o of ['landscape', 'portrait']) bands.push(await inkInBand(o, 0));
  }
  eq(bands.filter(x => x > 0).length, 0, `no ink between the border and the content box, on ${bands.length} signs (${bands.join(',')})`);
  check((await inkInBand('landscape', 30)) > 50, '…and the same sweep catches a sign pushed 30 pt');
  check(!errs.length, `no page errors (${errs.slice(0, 2).join(' | ')})`);
});

// ── 4. Each orientation prints on its own ────────────────────────────────
await section('4. per-orientation', async () => {
  const { page, errs } = await open();
  await makeSign(page, { two: true, fields: { 'name-0': 'Work boots', 'price-0': '20', 'name-1': 'Premium work boots', 'price-1': '35' }, sale: 'blowout' });
  eq(await pill(page), { cls: 'part', text: 'Portrait only' }, 'Premium work boots: the pill says portrait only, in amber');
  const sum = await page.$eval('[data-summary] .ss-note', n => ({ cls: n.className, head: n.querySelector('b').textContent, items: [...n.querySelectorAll('li')].map(l => l.textContent) }));
  eq(sum.cls, 'ss-note warn', '…the summary is a warning, not an error');
  eq(sum.head, 'Only the portrait sign can print. To print the landscape sign too:', '…and says which prints and why');
  eq(sum.items, ['Too long for the landscape sign: letters would be 0.46 in tall, and the minimum is 0.6 in. Cut about 3 characters.'], '…with the fix');
  eq(await page.$eval('[data-readout="landscape"] .bad', n => n.textContent), '0.46 in', 'the landscape readout flags the 0.46 in name');
  // A field error on top blocks both, and says so.
  await page.click('[data-step="1"]'); await settle(page);
  await type(page, '#ss-f-price-0', '');
  await page.click('[data-step="3"]'); await settle(page);
  eq(await pill(page), { cls: 'no', text: '2 things to fix' }, 'a missing price on top: nothing prints, two things to fix');
  eq(await page.$eval('[data-summary] .ss-note', n => [n.className, n.querySelector('b').textContent]), ['ss-note err', 'Fix these to print:'], '…as an error');
  await page.click('[data-step="1"]'); await settle(page);
  await type(page, '#ss-f-price-0', '20');
  await type(page, '#ss-f-name-1', 'Premium boots');
  await page.click('[data-step="3"]'); await settle(page);
  eq(await pill(page), { cls: 'ok', text: 'Ready to print' }, 'fixed: ready to print, both ways');
  eq(await page.$$eval('[data-summary] *', ns => ns.length), 0, '…with no summary left');
  check(!errs.length, `no page errors (${errs.slice(0, 2).join(' | ')})`);
});

// ── 5. Print: the sign alone, at its own paper size ──────────────────────
// window.print() does nothing in headless Chromium, so the check prints what it leaves
// behind: page.pdf() renders print media, honouring @page, exactly as the dialog would.
const { execFileSync } = await import('node:child_process');
const os = await import('node:os');
const PDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-print-'));   // this run's own files
const poppler = (tool, file) => execFileSync(tool, [file], { encoding: 'utf8' });
function pdfFacts(buf, name) {
  const f = path.join(PDIR, name);
  fs.writeFileSync(f, buf);
  const info = poppler('pdfinfo', f), size = (info.match(/Page size:\s+([\d.]+) x ([\d.]+) pts/) || []).slice(1).map(Number);
  // pdffonts prints fixed-width columns, and a name may hold spaces ("SS Poppins Black").
  const rows = poppler('pdffonts', f).split('\n'), typeAt = rows[0].indexOf('type'), embAt = rows[0].indexOf('emb');
  const fonts = rows.slice(2).filter(Boolean).map(l => ({ name: l.slice(0, typeAt).trim().replace(/^[A-Z]{6}\+/, ''), emb: l.slice(embAt, embAt + 3) === 'yes' }));
  return { pages: +(info.match(/Pages:\s+(\d+)/) || [])[1], size, fonts, text: execFileSync('pdftotext', [f, '-'], { encoding: 'utf8' }) };
}
await section('5. print', async () => {
  const { page, errs } = await open();
  // A dashboard printed earlier in the session leaves its report in #print-report, which the
  // app's own print rule always shows. A sign print must not carry it along.
  await page.evaluate(() => { document.getElementById('print-report').textContent = 'EARLIER DASHBOARD REPORT'; });
  await makeSign(page, { fields: { 'name-0': 'All cereal', 'price-0': '2' }, sale: 'flash' });
  eq(await page.$$eval('[data-print]', bs => bs.map(b => b.disabled)), [false, false], 'a sign that fits both ways: both Print buttons are on');
  const state = () => page.evaluate(() => ({ on: document.documentElement.classList.contains('printing-sign'),
    paper: document.getElementById('sign-print-page').textContent, svg: document.querySelectorAll('#sign-print svg').length }));
  for (const [o, W, H, paper] of [['landscape', 792, 612, '11in 8.5in'], ['portrait', 612, 792, '8.5in 11in']]) {
    await page.click(`[data-print="${o}"]`);
    eq(await state(), { on: true, paper: `@page { size: ${paper}; margin: 0; }`, svg: 1 }, `${o} Print: the sign is readied for print, at ${paper}`);
    const facts = pdfFacts(await page.pdf({ preferCSSPageSize: true, printBackground: true }), `${o}.pdf`);
    eq([facts.pages, facts.size], [1, [W, H]], `${o}: it prints ONE page, ${W} × ${H} pt`);
    check(facts.fonts.length >= 2 && facts.fonts.every(x => x.emb && /Poppins|LuckiestGuy/.test(x.name)),
          `${o}: only the sign's fonts, all embedded (${facts.fonts.map(x => x.name + (x.emb ? '' : ' NOT EMBEDDED')).join(', ')})`);
    const text = facts.text.replace(/\s+/g, ' ');
    check(/ALL CEREAL/.test(text) && /FLASH SALE/.test(text), `${o}: the sign's words are on the page, as text (${text.trim().slice(0, 60)})`);
    check(!/Sign Studio|SIGN STUDIO|Merchandising|Three quick steps|Dashboard|DASHBOARD|Before you hang it/.test(text), `${o}: and nothing of the app is, not even an earlier dashboard report`);
  }
  // It stays readied through afterprint and a wait: iOS returns from print() at once and may
  // fire afterprint before its print sheet draws. It ends on the next change, and on leaving.
  await page.waitForTimeout(2000);
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  eq((await state()).on, true, 'still readied at 2 s and after afterprint: nothing clears it early');
  await page.click('[data-step="1"]'); await settle(page);
  eq(await state(), { on: false, paper: '', svg: 0 }, 'the next change clears it: the printed sign would be stale');
  await page.click('[data-step="3"]'); await settle(page);
  await page.click('[data-print="portrait"]');
  eq((await state()).on, true, 'readied again…');
  await page.evaluate(() => window.navigateToPage('dashboard'));
  await page.waitForTimeout(200);
  eq(await state(), { on: false, paper: '', svg: 0 }, '…and leaving the page clears it');
  // The dashboard's own print is untouched: Letter portrait, its report only.
  await page.evaluate(() => { document.getElementById('print-report').textContent = 'DASHBOARD PRINT MARKER'; });
  const dash = pdfFacts(await page.pdf({ preferCSSPageSize: true }), 'dashboard.pdf');
  eq(dash.size, [612, 792], 'a dashboard print afterwards is still Letter portrait');
  check(/DASHBOARD PRINT MARKER/.test(dash.text) && !/ALL CEREAL/.test(dash.text), '…with the report on it, and no sign');
  // A sign that fits only one way: the other Print is off, and printSign refuses it anyway.
  await enter(page);
  await makeSign(page, { two: true, fields: { 'name-0': 'Work boots', 'price-0': '20', 'name-1': 'Premium work boots', 'price-1': '35' }, sale: 'blowout' });
  const btns = await page.$$eval('[data-print]', bs => bs.map(b => [b.getAttribute('data-print'), b.disabled, b.title]));
  eq(btns, [['landscape', true, "The landscape sign doesn't fit. The portrait one prints."], ['portrait', false, '']], 'portrait only: landscape Print is off and says why');
  await page.evaluate(() => { const b = document.querySelector('[data-print="landscape"]'); b.disabled = false; b.click(); });
  eq((await state()).on, false, '🛑 a forced click on the disabled landscape Print readies nothing: the print path checks too');
  check(!errs.length, `no page errors (${errs.slice(0, 2).join(' | ')})`);
});

// ── 6. PDF: the same sign, as real text with its fonts inside ────────────
// Made under ×4 CPU throttling, a mid-range phone's speed, and read back: size and timing,
// fonts, the one image, and every text object's position against the layout it came from.
const zlib = await import('node:zlib');
function pdfStreams(buf) {   // every stream, inflated where it is Flate-compressed
  const src = buf.toString('latin1'), out = [];
  for (const m of src.matchAll(/<<([^]*?)>>\s*stream\r?\n/g)) {
    const start = m.index + m[0].length, len = +((m[1].match(/\/Length (\d+)/) || [])[1]);
    const raw = buf.subarray(start, start + len);
    try { out.push({ dict: m[1], data: /FlateDecode/.test(m[1]) ? zlib.inflateSync(raw).toString('latin1') : raw.toString('latin1') }); } catch (e) {}
  }
  return out;
}
async function makePdf(page, orient) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click(`[data-pdf="${orient}"]`)]);
  return { name: dl.suggestedFilename(), buf: fs.readFileSync(await dl.path()) };
}
await section('6. pdf', async () => {
  const { page, errs } = await open();
  const cdp = await page.context().newCDPSession(page);
  await makeSign(page, { template: 'uvt', fields: { 'name-0': 'Stand mixer', them: '59.99', 'price-0': '19.99' }, units: { 0: 'each' }, sale: 'flash' });
  // The layout this sign should have, worked out independently of the page's own state: the
  // same sign given to SignRender with an engine built here from the served fonts.
  await page.evaluate(async () => {
    const R = window.SignRender, fonts = {};
    for (const [k, f] of Object.entries(R.FACES)) fonts[k] = R.readFont(new Uint8Array(await (await fetch(f.file)).arrayBuffer()));
    window.__ssCheckEngine = R.engine(fonts);
  });
  eq(await page.$$eval('[data-pdf]', bs => bs.map(b => b.disabled)), [false, false], 'a sign that fits both ways: both PDF buttons are on');
  await page.waitForFunction(() => window.jspdf && window.jspdf.jsPDF, null, { timeout: 8000 }).catch(() => {});
  check(await page.evaluate(() => !!(window.jspdf && window.jspdf.jsPDF)), 'step 3 warms jsPDF up in idle time, before any tap');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  for (const orient of ['landscape', 'portrait']) {
    const t0 = Date.now();
    const { name, buf } = await makePdf(page, orient);
    const ms = Date.now() - t0;
    check(ms < 3000, `${orient}: the PDF arrives in ${ms} ms under ×4 CPU throttling (target 3 s)`);
    eq(name, `sign-stand-mixer-${orient}.pdf`, `${orient}: named after the product and the orientation`);
    check(buf.length < 150 * 1024, `${orient}: ${Math.round(buf.length / 1024)} KB, under 150 KB`);
    const facts = pdfFacts(buf, `sign-${orient}.pdf`);
    eq([facts.pages, facts.size], [1, orient === 'landscape' ? [792, 612] : [612, 792]], `${orient}: one page, US Letter`);
    eq(facts.fonts.map(f => f.name + (f.emb ? '' : ' (not embedded)')).sort(), ['SS Luckiest Guy', 'SS Poppins Black', 'SS Poppins Black Italic', 'SS Poppins Bold'],
       `${orient}: the sign's four fonts, every one embedded, and no other`);
    const text = facts.text.replace(/\s+/g, ' ');
    check(/STAND MIXER/.test(text) && /YOU PAY/.test(text) && /66% OFF/.test(text), `${orient}: its words are real text (${text.trim().slice(0, 50)})`);
    const imgs = execFileSync('pdfimages', ['-list', path.join(PDIR, `sign-${orient}.pdf`)], { encoding: 'utf8' }).split('\n').slice(2).filter(Boolean);
    check(imgs.length === 1 && / rgb /.test(imgs[0]) && !/smask/.test(imgs[0]), `${orient}: one image, the RGB logo, with no mask (${imgs.map(l => l.replace(/\s+/g, ' ')).join(' / ')})`);
    // Every text object at the layout's left edge, baseline and size, to 0.01 pt.
    const layout = await page.evaluate(o => {
      const R = window.SignRender;
      const model = R.signModel(R.normalizeSign({ template: 'uvt', sale: 'flash', them: '59.99', groups: [{ name: 'Stand mixer', price: '19.99', unit: 'each' }] }));
      return window.__ssCheckEngine.layoutSign(model, o).items;
    }, orient).catch(() => null);
    const content = pdfStreams(buf).filter(x => /\bBT\b/.test(x.data)).map(x => x.data).join('\n');
    const bts = [...content.matchAll(/BT\n([^]*?)ET/g)].map(m => {
      const tf = m[1].match(/\/F\d+ (\S+) Tf/), td = m[1].match(/(\S+) (\S+) Td/);
      return tf && td ? [+(+tf[1]).toFixed(2), +(+td[1]).toFixed(2), +(+td[2]).toFixed(2)] : null;
    });
    if (layout) {
      const want = layout.filter(i => i.t === 'text').map(i => [+i.size.toFixed(2), +i.x.toFixed(2), +((orient === 'landscape' ? 612 : 792) - i.y).toFixed(2)]);
      const off = want.filter((w, k) => !bts[k] || Math.abs(bts[k][0] - w[0]) > 0.011 || Math.abs(bts[k][1] - w[1]) > 0.011 || Math.abs(bts[k][2] - w[2]) > 0.011);
      eq([bts.length, off.length], [want.length, 0], `${orient}: every text is at the layout's size, left edge and baseline (${want.length} texts)`);
    } else check(false, `${orient}: the page's layout could not be read for comparison`);
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  check(!errs.length, `no page errors (${errs.slice(0, 2).join(' | ')})`);
  // The jsPDF file fails once, then comes back: the next tap tries again and works.
  fail.add('/jspdf-2.5.1.umd.min.js');   // down before step 3, so the idle warm-up meets it too
  const P = await open();
  await makeSign(P.page, { fields: { 'name-0': 'All cereal', 'price-0': '2' } });
  await P.page.waitForTimeout(800);
  await P.page.click('[data-pdf="landscape"]');
  await P.page.waitForFunction(() => /didn't finish/.test(document.querySelector('[data-pdfnote="landscape"]').textContent), null, { timeout: 8000 });
  eq(await P.page.$eval('[data-pdfnote="landscape"]', n => [n.className, n.textContent]),
     ['ss-pdfnote bad', "The PDF didn't finish: The PDF maker didn't load. Tap PDF to try again."], 'jsPDF down: the PDF says so, in the error colour');
  fail.delete('/jspdf-2.5.1.umd.min.js');
  const again = await makePdf(P.page, 'landscape');
  check(again.buf.length > 10000 && again.name === 'sign-all-cereal-landscape.pdf', 'back up: the next tap makes the PDF');
  eq(await P.page.$eval('[data-pdfnote="landscape"]', n => n.textContent), 'Saved sign-all-cereal-landscape.pdf', '…and says where it went');
  check(await P.page.evaluate(() => document.querySelectorAll('script[src="jspdf-2.5.1.umd.min.js"]').length === 1), '…with one script tag left, not one per attempt');
  // A blocked orientation: its PDF button is off, and a forced click makes nothing.
  await makeSign(P.page, { two: true, fields: { 'name-0': 'Work boots', 'price-0': '20', 'name-1': 'Premium work boots', 'price-1': '35' }, sale: 'blowout' });
  eq(await P.page.$$eval('[data-pdf]', bs => bs.map(b => b.disabled)), [true, false], 'portrait only: the landscape PDF button is off');
  const forced = P.page.waitForEvent('download', { timeout: 1500 }).then(() => true, () => false);
  await P.page.evaluate(() => { const b = document.querySelector('[data-pdf="landscape"]'); b.disabled = false; b.click(); });
  eq(await forced, false, '🛑 a forced click on it makes no PDF: the PDF path checks too');
});

// ── 7. The sign in progress survives a reload ────────────────────────────
await section('7. draft', async () => {
  const { page, errs } = await open();
  const draft = () => page.evaluate(() => JSON.parse(localStorage.getItem('sign-studio-draft') || 'null'));
  eq(await draft(), null, 'an untouched page saves nothing');
  await makeSign(page, { template: 'pct', two: true, fields: { 'name-0': 'Winter coats', 'pct-0': '20', 'name-1': 'Boots', 'pct-1': '40' }, sale: 'custom', custom: 'Weekend deal' });
  await page.click('[data-step="2"]'); await settle(page);
  await page.click('[data-orient="portrait"]'); await settle(page);
  const d = await draft();
  check(d && d.v === 1 && d.user === 'manager@example.com' && d.step === 2 && d.orient === 'portrait' && d.sign.groups[1].name === 'Boots',
        `every change is saved, with its owner, step and orientation (${JSON.stringify(d).slice(0, 120)})`);
  const before = d.savedAt;
  // A reload (an app update does the same) comes back to it.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.navigateToPage === 'function' && window.__ssAuthed, null, { timeout: 10000 });
  await page.waitForTimeout(500);
  await enter(page);
  const back = await page.evaluate(() => ({ step: document.querySelector('.ss-step[aria-current="step"]').dataset.step,
    orient: document.querySelector('[data-orient][aria-pressed="true"]').dataset.orient,
    tile: document.querySelector('.ss-tile[aria-pressed="true"]').dataset.v, custom: document.getElementById('ss-f-custom').value }));
  eq(back, { step: '2', orient: 'portrait', tile: 'custom', custom: 'Weekend deal' }, 'after a reload: the same step, orientation and label');
  eq((await draft()).savedAt, before, 'coming back to it is not a change: the draft keeps its age');
  await page.click('[data-step="1"]'); await settle(page);
  eq(await page.evaluate(() => [document.getElementById('ss-f-name-0').value, document.getElementById('ss-f-pct-1').value]), ['Winter coats', '40'], '…and the same fields');
  const seed = async (patch) => {
    await page.evaluate(p => { const x = JSON.parse(localStorage.getItem('sign-studio-draft')); Object.assign(x, p); localStorage.setItem('sign-studio-draft', typeof p.raw === 'string' ? p.raw : JSON.stringify(x)); }, patch);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.navigateToPage === 'function' && window.__ssAuthed, null, { timeout: 10000 });
    await page.waitForTimeout(500);
    await enter(page);
    return page.evaluate(() => ({ step: document.querySelector('.ss-step[aria-current="step"]').dataset.step,
      name: (document.getElementById('ss-f-name-0') || {}).value, kept: !!localStorage.getItem('sign-studio-draft') }));
  };
  eq(await seed({ savedAt: Date.now() - 13 * 3600 * 1000 }), { step: '1', name: '', kept: false }, 'a 13-hour-old draft: a fresh sign, and the old draft gone');
  await makeSign(page, { fields: { 'name-0': 'All cereal', 'price-0': '2' } });
  eq(await seed({ user: 'someone.else@example.com' }), { step: '1', name: '', kept: false }, "another person's draft on this device: a fresh sign");
  await makeSign(page, { fields: { 'name-0': 'All cereal', 'price-0': '2' } });
  eq(await seed({ savedAt: Date.now() + 30 * 24 * 3600 * 1000 }), { step: '1', name: '', kept: false }, 'a draft stamped in the future (so it would never expire): a fresh sign');
  await makeSign(page, { fields: { 'name-0': 'All cereal', 'price-0': '2' } });
  eq(await seed({ raw: '{not json' }), { step: '1', name: '', kept: false }, 'an unreadable draft: a fresh sign, no error');
  // A stored name longer than the box allows is kept, flagged and blocked, not cut quietly.
  await makeSign(page, { fields: { 'name-0': 'All cereal', 'price-0': '2' } });
  const long = 'A thirty character product nm';
  await page.evaluate(n => { const x = JSON.parse(localStorage.getItem('sign-studio-draft')); x.sign.groups[0].name = n; x.step = 3; localStorage.setItem('sign-studio-draft', JSON.stringify(x)); }, long);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.navigateToPage === 'function' && window.__ssAuthed, null, { timeout: 10000 });
  await page.waitForTimeout(500);
  await enter(page);
  eq(await pill(page), { cls: 'no', text: '1 thing to fix' }, 'a stored 30-character name: nothing prints');
  eq(await page.$$eval('[data-print]', bs => bs.map(b => b.disabled)), [true, true], '…both Print buttons are off');
  check(/22 characters at most/.test(await page.$eval('[data-summary]', n => n.textContent)), '…and the summary says why');
  await page.click('[data-step="1"]'); await settle(page);
  eq(await page.$eval('#ss-f-name-0', n => n.value), long, '…with the whole name in the box to shorten');
  // Start a new sign clears it for good.
  await page.click('[data-step="3"]'); await settle(page);
  await page.click('[data-new]'); await settle(page);
  eq(await draft(), null, 'Start a new sign clears the draft');
  check(!errs.length, `no page errors (${errs.slice(0, 2).join(' | ')})`);
});

// ── 10. The service worker: precache, offline, and an update mid-sign ─────
// The real sw.js runs here. Everything a sign needs must be in its precache, the page must
// make, print and PDF a sign with no network, and a new deploy must not reload the page out
// from under someone making a sign, while still reloading everyone else.
await section('10. service worker', async () => {
  const want = [...fs.readFileSync(path.join(root, 'sw.js'), 'utf8').match(/const PRECACHE_ASSETS = \[([\s\S]*?)\];/)[1]
    .replace(/\/\/.*$/gm, '').matchAll(/'([^']+)'/g)].map(m => m[1]);
  const { ctx, page, errs } = await open({ sw: true, go: false });
  await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 20000 });
  const cached = await page.evaluate(async () => {
    const name = (await caches.keys()).find(k => k.startsWith('dashboard-cache-'));
    return (await (await caches.open(name)).keys()).map(r => new URL(r.url).pathname);
  });
  const missing = want.filter(p => !cached.includes(p.replace(/^\.\//, '/')));
  eq(missing, [], `the precache holds every listed path (${want.length}), fonts, logo and jsPDF included`);
  // Offline: the page, the sign, Print and PDF all come from the cache.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.navigateToPage === 'function' && window.__ssAuthed, null, { timeout: 10000 });
  await ctx.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.navigateToPage === 'function' && window.__ssAuthed, null, { timeout: 15000 });
  await page.waitForTimeout(500);
  await enter(page);
  await makeSign(page, { fields: { 'name-0': 'All cereal', 'price-0': '2' }, sale: 'flash' });
  eq(await page.$$eval('#ss-root [data-preview] svg', ns => ns.length), 2, 'offline: both signs draw, in the sign fonts from the cache');
  await page.click('[data-print="landscape"]');
  const offPrint = pdfFacts(await page.pdf({ preferCSSPageSize: true, printBackground: true }), 'offline-print.pdf');
  check(offPrint.pages === 1 && /ALL CEREAL/.test(offPrint.text), 'offline: Print makes the sign');
  const offPdf = await makePdf(page, 'portrait');
  check(offPdf.buf.length > 10000, 'offline: so does PDF, with jsPDF from the cache');
  await ctx.setOffline(false);
  // A new deploy while the sign is on screen: no reload.
  const reloaded = async () => { await page.waitForTimeout(3000); return page.evaluate(() => window.__stay !== 1); };
  const deploy = async () => { swDeploy++; await page.evaluate(async () => {
    window.__stay = 1;
    navigator.serviceWorker.addEventListener('controllerchange', () => { window.__changes = (window.__changes || 0) + 1; });
    await (await navigator.serviceWorker.getRegistration()).update();
  }); };
  await page.click('[data-step="1"]'); await settle(page);
  await deploy();
  eq(await reloaded(), false, '🛑 a new deploy while a sign is being made on screen does not reload the page');
  eq(await page.evaluate(() => window.__changes), 1, '…though the new worker did take over: the page saw it and stayed');
  eq(await page.$eval('#ss-f-name-0', n => n.value), 'All cereal', '…and what was typed is still there');
  // Anywhere else, the update still reloads, as it always has.
  await page.evaluate(() => window.navigateToPage('dashboard'));
  await page.waitForTimeout(300);
  await deploy();
  eq(await reloaded(), true, 'a new deploy on another page still reloads it');
  check(!errs.filter(e => !/ERR_INTERNET_DISCONNECTED|Failed to fetch/.test(e)).length, `no page errors (${errs.slice(0, 2).join(' | ')})`);
});

// ── 8. Contrast: every word readable, in all three themes ────────────────
// Computed against the composited background it is painted on, never eyeballed (DESIGN.md
// §4.8 trap 6), across the states a manager can reach: each step, % Off and Us vs Them,
// field errors, the amber one-orientation summary, a counter near its limit.
await section('8. contrast', async () => {
  for (const theme of ['light', 'dark', 'oled']) {
    const { page, errs } = await open({ theme });
    const all = [];
    const take = async (what) => { for (const x of contrastOf(await textSamples(page))) all.push(Object.assign(x, { state: what })); };
    await take('step 1, empty');
    await page.click('[data-chips="template"] [data-v="price"]'); await settle(page);
    await type(page, '#ss-f-name-0', 'Mens athletic sneaker');   // 21 of 22: the counter turns amber
    await type(page, '#ss-f-price-0', '2.505');                  // an error on the field
    await page.click('.ss-disclose summary'); await settle(page);
    await take('step 1, errors, note open');
    await page.click('[data-chips="template"] [data-v="uvt"]'); await settle(page);
    await type(page, '#ss-f-them', '59.99'); await type(page, '#ss-f-price-0', '19.99');
    await take('step 1, Us vs Them');
    await page.click('[data-chips="template"] [data-v="pct"]'); await settle(page);
    await take('step 1, % Off');
    await page.click('[data-step="2"]'); await settle(page);
    await page.click('.ss-tile[data-v="custom"]'); await settle(page);
    await take('step 2, custom');
    await makeSign(page, { two: true, fields: { 'name-0': 'Work boots', 'price-0': '20', 'name-1': 'Premium work boots', 'price-1': '35' }, sale: 'blowout' });
    await take('step 3, one orientation');
    await page.click('[data-step="1"]'); await settle(page);
    await type(page, '#ss-f-price-0', '');
    await page.click('[data-step="3"]'); await settle(page);
    await take('step 3, errors');
    await type(page, '#ss-f-price-0', '20').catch(() => {});
    const low = all.filter(x => x.r < 4.5);
    const min = all.reduce((m, x) => x.r < m.r ? x : m, { r: 99 });
    measured.push(`[${theme}] ${all.length} texts, lowest ${min.r.toFixed(2)}:1 (${min.what}, ${min.state})`);
    eq(low.map(x => `${x.state}: ${x.what} ${x.r.toFixed(2)}`), [], `[${theme}] every text on the page is at least 4.5:1 on what it is painted over (${all.length} measured)`);
    check(all.length > 150, `[${theme}] …and the sweep found the page's text (${all.length})`);
    check(!errs.length, `[${theme}] no page errors (${errs.slice(0, 2).join(' | ')})`);
  }
});

// ── 9. A font that does not arrive ───────────────────────────────────────
await section('9. font failure', async () => {
  fail.add('/fonts/luckiest-guy-400.ttf');
  const { page, errs } = await open({ go: false });
  await page.evaluate(() => window.navigateToPage('merch-signs'));
  await page.waitForSelector('#ss-root .ss-fail', { timeout: 8000 });
  await page.fill('#ss-f-name-0', 'All cereal'); await page.fill('#ss-f-price-0', '2');
  await page.click('[data-step="3"]'); await settle(page);
  eq(await page.$$eval('#ss-root .ss-fail', ns => ns.length), 2, 'with a font missing, both previews say so instead of drawing');
  eq(await page.$$eval('#ss-root [data-preview] svg', ns => ns.length), 0, '…and nothing is drawn in a fallback face');
  eq(await pill(page), { cls: 'wait', text: 'Sign font missing' }, '…and the pill says why');
  fail.delete('/fonts/luckiest-guy-400.ttf');
  await page.click('#ss-root [data-retry]');
  await page.waitForFunction(() => document.querySelectorAll('#ss-root [data-preview] svg').length === 2, null, { timeout: 8000 });
  eq(await pill(page), { cls: 'ok', text: 'Ready to print' }, 'Retry, once the font is there: both signs draw and it is ready');
  check(errs.filter(e => !/luckiest-guy|503/.test(e)).length === 0, `no other page errors (${errs.slice(0, 2).join(' | ')})`);
});

// ── 11. Speed, and the WRS export beside it ──────────────────────────────
// The preview must follow the keys within 300 ms on a mid-range phone (×4 CPU throttling),
// on the costliest sign there is: one that fails to fit, which runs the "cut about N" search.
// And a Sign Studio PDF loads jsPDF without autotable; the WRS export must still load it.
// autotable comes from cdnjs, which this harness refuses, so a stand-in answers that URL:
// enough plugin for the export to run, and a count of how often it was fetched.
const AUTOTABLE = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js';
const AUTOTABLE_STANDIN = `(function () {
  var J = window.jspdf && window.jspdf.jsPDF;
  J.API.autoTable = function (o) {
    window.__autoTables = (window.__autoTables || 0) + 1;
    this.lastAutoTable = { finalY: ((o && o.startY) || 40) + 20 };
    return this;
  };
})();`;
await section('11. timing and WRS', async () => {
  const { page, errs } = await open();
  let autotableFetches = 0;
  // Registered after open()'s refuse-everything route, so it is matched first.
  await page.route(AUTOTABLE, r => { autotableFetches++; r.fulfill({ contentType: 'text/javascript', body: AUTOTABLE_STANDIN }); });
  const cdp = await page.context().newCDPSession(page);
  await makeSign(page, { two: true, fields: { 'name-0': 'Work boots', 'price-0': '20', 'name-1': 'Premium work boots', 'price-1': '35' }, sale: 'blowout' });
  await page.click('[data-step="1"]'); await settle(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const keys = await page.evaluate(async () => {
    const n = document.getElementById('ss-f-name-1'), out = [];
    for (const ch of ' xyz') {
      const t0 = performance.now();
      n.value += ch;
      n.dispatchEvent(new Event('input', { bubbles: true }));
      const handled = performance.now() - t0;
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));   // …and painted
      out.push([handled, performance.now() - t0]);
    }
    return out;
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const worst = Math.max(...keys.map(k => k[1]));
  check(worst < 300, `a keystroke is drawn within 300 ms under ×4 throttling, on a sign that does not fit (worst ${Math.round(worst)} ms; handler ${Math.round(Math.max(...keys.map(k => k[0])))} ms)`);
  eq(await page.$eval('#ss-m-name-1', n => /Too long for the landscape sign/.test(n.textContent)), true, '…and the fit message kept up with it');
  // WRS after a Sign Studio PDF.
  await type(page, '#ss-f-name-1', 'Premium boots');
  await page.click('[data-step="3"]'); await settle(page);
  await makePdf(page, 'portrait');
  eq(await page.evaluate(() => [!!window.jspdf.jsPDF, !!window.jspdf.jsPDF.API.autoTable]), [true, false], 'after a Sign Studio PDF: jsPDF is loaded, autotable is not');
  await page.evaluate(() => window.navigateToPage('weekly-summary'));
  await page.waitForTimeout(400);
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.evaluate(() => {
    const pane = document.getElementById('wrs-pane-summary'), h = document.createElement('h3'), t = document.createElement('table');
    h.textContent = 'By store';
    const row = (tag, cells) => { const tr = document.createElement('tr'); cells.forEach(c => { const x = document.createElement(tag); x.textContent = c; tr.appendChild(x); }); return tr; };
    t.createTHead().appendChild(row('th', ['Store', 'Sales'])); t.createTBody().appendChild(row('td', ['Coliseum', '$1,000']));   // the export reads tHead/tBodies
    pane.append(h, t);
    return window.downloadWrsAsPdf();
  })]);
  eq(autotableFetches, 1, '🛑 the WRS export fetches autotable although jsPDF was already loaded');
  check(await page.evaluate(() => window.__autoTables > 0), '…and draws its table with it');
  const wrs = pdfFacts(fs.readFileSync(await dl.path()), 'wrs.pdf');
  check(wrs.pages >= 1 && wrs.fonts.some(f => /Helvetica/.test(f.name)) && !wrs.fonts.some(f => /SS |Poppins|Luckiest/.test(f.name)),
        `the WRS PDF is its own: its Helvetica, none of the sign's fonts (${wrs.fonts.map(f => f.name).slice(0, 4).join(', ')}…)`);
  check(!errs.length, `no page or console errors (${errs.slice(0, 2).join(' | ')})`);
});

await b.close();
srv.close();
fs.rmSync(PDIR, { recursive: true, force: true });
if (measured.length) console.log('Painted contrast:\n  ' + measured.join('\n  '));
const bad = results.filter(r => !r[0]);
if (process.env.VERBOSE) for (const [okk, m] of results) if (okk) console.log('  ok   ' + m);   // VERBOSE=1 shows the figures
for (const [okk, m] of results) if (!okk) console.log('  FAIL ' + m);
console.log(`\n${results.length - bad.length} passed, ${bad.length} failed`);
process.exit(bad.length ? 1 : 0);
