// Weekly upload targets on Submit Photos, driven in a REAL BROWSER.
//
// 🛑 NOT PART OF `scripts/test.sh` — it needs playwright-core and a Chromium. Run by hand:
//
//   npm install --no-save playwright-core
//   bash scripts/build.sh && node scripts/browser-submit-photo-targets.mjs
//   (on a Mac: PLAYWRIGHT_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
//
// test-photo-targets.mjs proves the worker counts and scopes. It cannot see that the
// page draws the bars, refuses an untyped batch, opens on the user's own store,
// reads in both themes, or that an associate can reach the page at all. That is here.
//
// 🛑 THE APP'S THEME IS A `.dark` CLASS FROM localStorage, NOT prefers-color-scheme —
// set, then ASSERTED before any colour is measured (browser-associate-reveal.mjs).
let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch (e) {
  console.error('\nThis check needs playwright-core: npm install --no-save playwright-core\n');
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
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${srv.address().port}`;

const results = [];
const check = (c, m) => { results.push([!!c, m]); };

// Due two days from now, so the label reads "Due", whatever day this runs.
const due = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
const STORE = (store, label, retail, bins, people) => ({ store, label, retail, bins, people });
const TARGETS = {
  ok: true, week: { start: '2026-10-11', end: '2026-10-17', due }, targets: { retail: 20, bins: 20 },
  stores: [STORE('BL1', 'Coliseum', 0, 10, 1), STORE('BL4', 'Dupont', 0, 34, 1), STORE('BL2', 'South Bend', 6, 20, 3),
           STORE('BL14', 'Battle Creek', 0, 23, 1), STORE('BL16', 'Indy East', 4, 4, 2)],
};

function mocks({ who, TARGETS, dark }) {
  try {
    localStorage.setItem('darkMode', String(dark));
    localStorage.setItem('bioPromptDismissed', '1'); localStorage.setItem('coachTipsDisabled', '1');
  } catch (e) {}
  window.__calls = []; window.__uploads = []; window.__settings = [];
  window.__targets = JSON.parse(JSON.stringify(TARGETS));
  // The worker scopes photo-targets; the stub does the same so the page sees what it would.
  const scoped = () => {
    const t = JSON.parse(JSON.stringify(window.__targets));
    if (Array.isArray(who.stores)) t.stores = t.stores.filter(s => who.stores.includes(s.store));
    return t;
  };
  const J = (x, status = 200) => new Response(JSON.stringify(x), { status, headers: { 'content-type': 'application/json' } });
  window.fetch = async (u, o = {}) => {
    const action = new URL(String(u), location.href).searchParams.get('action');
    window.__calls.push(action);
    switch (action) {
      case 'auth-me': return J(who);
      case 'photo-targets': return J(scoped());
      case 'photo-upload': {
        const f = o.body;
        window.__uploads.push({ store: f.get('store'), type: f.get('photo_type'), note: f.get('note') });
        const s = window.__targets.stores.find(x => x.store === f.get('store'));
        if (s && f.get('photo_type') === 'retail') s.retail++;
        return J({ ok: true, id: window.__uploads.length });
      }
      case 'notify-photo-upload': return J({ ok: true, notified: true });
      case 'content-setting': {
        const b = JSON.parse(o.body); window.__settings.push(b);
        window.__targets.targets = { retail: Number(b.value.retail), bins: Number(b.value.bins) };
        return J({ ok: true });
      }
      default: return J({ error: 'Forbidden' }, 403);
    }
  };
}

const b = await chromium.launch({ executablePath: CHROME });
const live = new Set();
async function open(who, { dark, width = 1280, height = 900, mobile = false }) {
  const ctx = await b.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' });
  live.add(ctx);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.route(u => !u.href.startsWith(ORIGIN), r => r.abort());
  await page.addInitScript(mocks, { who, TARGETS, dark });
  await page.goto(ORIGIN + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__calls?.includes('auth-me'), null, { timeout: 10000 });
  await page.waitForTimeout(900);
  return { page, errs };
}
async function section(name, fn) {
  try { await fn(); }
  catch (e) { check(false, `${name}: stopped — ${String((e && e.message) || e).split('\n')[0]}`); }
  finally { for (const c of live) { try { await c.close(); } catch (e) {} } live.clear(); }
}
// SHOTS=<dir> also saves a screenshot of each surface, for a PR or a review.
const shot = (page, name) => process.env.SHOTS
  ? page.screenshot({ path: path.join(process.env.SHOTS, name + '.png'), fullPage: false }) : null;
const shown = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); return !!(e && e.offsetParent); }, sel);
const text = (page, sel) => page.evaluate(s => document.querySelector(s)?.textContent.replace(/\s+/g, ' ').trim() || '', sel);

// Contrast against the real composited ground (browser-associate-reveal.mjs's measure).
const CONTRAST = (sel) => {
  const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const parse = s => { const m = String(s).match(/[\d.]+/g); return m ? m.map(Number) : null; };
  const over = (f, b) => { const a = f.length > 3 ? f[3] : 1; return [0, 1, 2].map(i => f[i] * a + b[i] * (1 - a)); };
  const ground = el => { let g = [255, 255, 255], st = [];
    for (let n = el; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (!c) continue;
      const a = c.length > 3 ? c[3] : 1; if (a === 0) continue; st.push(c); if (a === 1) { g = c.slice(0, 3); break; } }
    for (let i = st.length - 1; i >= 0; i--) g = over(st[i], g); return g; };
  const out = [];
  for (const el of document.querySelectorAll(sel + ' *')) {
    if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || !el.getClientRects().length) continue;
    if (el.closest('button:disabled')) continue;   // disabled controls are exempt from 1.4.3
    const fg = parse(cs.color); if (!fg) continue;
    const g = ground(el); const [l1, l2] = [lum(over(fg, g)), lum(g)].sort((a, b) => b - a);
    const px = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700;
    out.push({ text: el.textContent.trim().slice(0, 30), need: (px >= 24 || (bold && px >= 18.66)) ? 3 : 4.5,
               ratio: Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100 });
  }
  return out;
};
async function readable(page, sel, t) {
  const rows = await page.evaluate(CONTRAST, sel);
  const bad = rows.filter(r => r.ratio < r.need);
  check(rows.length > 0 && bad.length === 0,
    `[${t}] ${sel} clears AA (${rows.length} nodes, worst ${Math.min(...rows.map(r => r.ratio))}:1)`
    + bad.map(x => `\n      ✗ ${x.ratio}:1 need ${x.need} "${x.text}"`).join(''));
}

const MANAGER = { authenticated: true, email: 'sb@bargainlane.com', name: 'Ashley', role: 'manager', stores: ['BL2'], pages: {}, businesses: ['bl'] };
const ADMIN = { authenticated: true, email: 'a@b.com', name: 'Admin', role: 'admin', stores: null, pages: {}, businesses: ['bl'] };
const ASSOC = { authenticated: true, email: 'assoc_7@associate.invalid', name: 'Dee Ramirez', role: 'staff', associate: true,
                pages: {}, stores: ['BL1'], businesses: ['bl'] };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP438AARAwQCgAt7gX9iz9uhAAAAABJRU5ErkJggg==', 'base64');

for (const dark of [true, false]) {
  const t = dark ? 'dark' : 'light';

  // ── 1. A one-store manager, on a phone ─────────────────────────────────────
  await section(`1 ${t}`, async () => {
    const { page, errs } = await open(MANAGER, { dark, width: 375, height: 812, mobile: true });
    check(await page.evaluate(() => document.documentElement.classList.contains('dark')) === dark, `[${t}] the .dark class matches the theme under test`);
    await page.evaluate(() => window.navigateToPage('submit-photos'));
    await page.waitForTimeout(500);
    check(await shown(page, '#sp-targets'), `[${t}] the weekly targets card shows`);
    const card = await text(page, '#sp-targets');
    check(/South Bend · this week/.test(card) && /Due /.test(card), `[${t}] titled for their store, with the due date (${card.slice(0, 60)})`);
    check(/Retail photos\s*6 \/ 20/.test(card), `[${t}] retail 6 / 20`);
    check(/Bin photos\s*20 \/ 20 ✓/.test(card), `[${t}] bins met, with a tick`);
    check(/3 people so far/.test(card), `[${t}] counts everyone who uploaded`);
    const opts = await page.evaluate(() => [...document.querySelectorAll('#sp-store option')].map(o => o.value));
    check(JSON.stringify(opts) === '["BL2"]', `🛑 [${t}] the store picker offers only their store (got ${JSON.stringify(opts)})`);
    check(!(await page.evaluate(() => document.querySelector('#sp-type-chips .bg-accent-green'))), `[${t}] no type is preselected`);
    check(await page.evaluate(() => document.getElementById('sp-submit').disabled), `[${t}] Submit is disabled until a type is chosen`);
    check(await text(page, '#sp-drop-text') === 'Choose what you are uploading first', `[${t}] and the drop zone says why`);
    await readable(page, '#page-submit-photos', t);
    await shot(page, `manager-${t}`);

    // Pick a type, add a photo, submit: the bar moves.
    await page.click('#sp-type-chips button:has-text("Retail floor")');
    check(!(await page.evaluate(() => document.getElementById('sp-submit').disabled)), `[${t}] choosing a type enables Submit`);
    await page.setInputFiles('#sp-files', { name: 'a.png', mimeType: 'image/png', buffer: PNG });
    await page.waitForTimeout(400);
    await page.fill('#sp-note', 'Halloween bedding $8');
    await page.click('#sp-submit');
    const moved = await page.waitForFunction(() => /7 \/ 20/.test(document.getElementById('sp-targets')?.textContent || ''), null, { timeout: 5000 })
      .then(() => true, () => false);
    check(moved, `[${t}] the retail bar moves to 7 / 20 after the upload`);
    const up = await page.evaluate(() => window.__uploads);
    check(JSON.stringify(up) === '[{"store":"BL2","type":"retail","note":"Halloween bedding $8"}]', `[${t}] uploaded as retail for South Bend, with the note (${JSON.stringify(up)})`);
    check(await text(page, '#sp-submit') === 'Submit photos', `[${t}] Submit is ready again for the same type`);
    check(errs.length === 0, `[${t}] no page errors (${errs.join(' | ').slice(0, 200)})`);
  });

  // ── 2. An admin: every store, and the targets editor ───────────────────────
  await section(`2 ${t}`, async () => {
    const { page, errs } = await open(ADMIN, { dark });
    await page.evaluate(() => window.navigateToPage('submit-photos'));
    await page.waitForTimeout(500);
    const rows = await page.evaluate(() => [...document.querySelectorAll('#sp-targets tbody tr')].map(r => [...r.cells].map(c => c.textContent.trim()).join(' ')));
    check(rows.length === 5 && rows[2] === 'South Bend 6/20 20/20 0/1', `[${t}] the admin sees all five stores, with the store-walk column (${JSON.stringify(rows)})`);
    await readable(page, '#sp-targets', t);
    await page.click('#sp-targets button:has-text("Edit weekly targets")');
    check(await shown(page, '#sp-target-edit'), `[${t}] Edit opens the targets form`);
    await readable(page, '#sp-target-edit', t);
    await shot(page, `admin-${t}`);
    await page.fill('#sp-tgt-retail', '24');
    // 🔑 Found in review: changing store (or an upload landing) re-drew the card and threw
    // away what an admin had typed. The picker no longer re-draws an admin's card, and a
    // re-draw keeps the form open with its values.
    await page.selectOption('#sp-store', 'BL4');
    await page.evaluate(() => window.spRenderTargets());
    check(await shown(page, '#sp-target-edit') && await page.inputValue('#sp-tgt-retail') === '24',
      `[${t}] a re-draw mid-edit keeps the form open and the typed value`);
    await page.fill('#sp-tgt-retail', '25');
    await page.click('#sp-tgt-save');
    const reread = await page.waitForFunction(() => /6\/25/.test(document.getElementById('sp-targets')?.textContent || ''), null, { timeout: 5000 })
      .then(() => true, () => false);
    check(reread, `[${t}] the table re-reads against the new target`);
    check(!(await shown(page, '#sp-target-edit')), `[${t}] and the form closes once saved`);
    const sent = await page.evaluate(() => window.__settings);
    check(JSON.stringify(sent) === '[{"key":"upload_targets","value":{"retail":"25","bins":"20","store_walk":"1"}}]', `[${t}] saved as the upload_targets setting, store walk included (${JSON.stringify(sent)})`);
    check(errs.length === 0, `[${t}] no page errors (${errs.join(' | ').slice(0, 200)})`);
  });
}

// ── 3. An associate with no grants, on a phone ───────────────────────────────
await section('3', async () => {
  const { page, errs } = await open(ASSOC, { dark: true, width: 375, height: 812, mobile: true });
  // `currentUser` is a top-level `let`, so it is reachable by name but is not on window.
  check(await page.evaluate(() => landingPageFor(currentUser)) === 'submit-photos',
    '🔑 an associate with no page grants lands on Submit Photos, not "no access"');
  check(await page.evaluate(() => landingPageFor({ associate: true, pages: { 'bin-dump': 'edit' } })) === 'bin-dump',
    'one with a grant still lands on the granted page');
  await page.evaluate(() => window.navigateToPage('submit-photos'));
  await page.waitForTimeout(500);
  check(await shown(page, '#page-submit-photos'), '🔑 an associate can open Submit Photos');
  check(await shown(page, '#bn-submit-photos'), 'with the Submit tab in their phone bar');
  check(await page.evaluate(() => !document.getElementById('nav-submit-photos').classList.contains('hidden')
    && !document.getElementById('nav-marketing-group').classList.contains('hidden')), 'and Submit Photos in their menu');
  check(await page.evaluate(() => ['nav-content', 'nav-flow-calendar', 'nav-comments', 'nav-marketing-ads']
    .every(id => { const e = document.getElementById(id); return !e || e.classList.contains('hidden'); })),
    '🛑 but nothing else from Marketing');
  await page.evaluate(() => window.navigateToPage('content'));
  await page.waitForTimeout(300);
  check(await shown(page, '#page-submit-photos') && !(await shown(page, '#page-content')), '🛑 and the Content page stays shut');
  const opts = await page.evaluate(() => [...document.querySelectorAll('#sp-store option')].map(o => o.value));
  check(JSON.stringify(opts) === '["BL1"]', `their store only (${JSON.stringify(opts)})`);
  check(/Coliseum · this week/.test(await text(page, '#sp-targets')), "and their store's bars");
  check(errs.length === 0, `no page errors (${errs.join(' | ').slice(0, 200)})`);
});

await b.close(); srv.close();
let pass = 0, fail = 0;
for (const [c, m] of results) { if (c) pass++; else { fail++; console.log('  FAIL ' + m); } }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
