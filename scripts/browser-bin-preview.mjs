// Hub › Marketing › Bin Preview, driven in a REAL BROWSER against a stubbed API (plan E8).
//
// 🛑 NOT PART OF `scripts/test.sh` — it needs playwright-core and a Chromium. Run by hand:
//
//   npm install --no-save playwright-core
//   bash scripts/build.sh < /dev/null && node scripts/browser-bin-preview.mjs
//   (on a Mac: PLAYWRIGHT_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
//
// test-bin-preview.mjs proves the worker: who may do what, the windows, the revisions. It cannot
// see that the page sends the revision it showed, refuses a send-back with no reason, keeps the
// photo order, says times in the store's clock, hides itself from managers (Brian, 2026-11-25:
// admins and superusers only until the website exists), or reads in both themes. That is here.
//
// 🛑 THE APP'S THEME IS A `.dark` CLASS FROM localStorage — set, then ASSERTED before measuring.
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
  console.error('\ndist/ is missing or empty. Run `bash scripts/build.sh < /dev/null` first.\n');
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

// ── Fixtures: what the worker would answer (shapes from binPreviewView / siteSettings) ──
const P = (id, saleDate, status, phase, extra = {}) => ({
  id, store: 'BL4', saleDate, photoIds: [501, 502], caption: null, status, phase, startsAt: null, endsAt: null,
  revision: 2, createdBy: 'dupont@bargainlane.com', createdAt: '2026-11-20T15:00:00.000Z', updatedAt: '2026-11-20T15:00:00.000Z',
  submittedBy: null, submittedAt: null, reviewedBy: null, reviewedAt: null, reviewNote: null,
  pulledBy: null, pulledAt: null, pullReason: null, ...extra });
const PREVIEWS = [
  P(41, '2026-12-04', 'submitted', 'submitted', { photoIds: [501, 502, 503], caption: 'Fresh bins Friday', submittedBy: 'dupont@bargainlane.com', submittedAt: '2026-11-24T14:00:00.000Z' }),
  // Sale Fri Nov 27. 17:00Z = 12:00 PM Eastern (EST, UTC-5) on Thu Nov 26; 02:00Z on the 28th = 9:00 PM on the 27th.
  P(40, '2026-11-27', 'approved', 'live', { revision: 4, startsAt: '2026-11-26T17:00:00.000Z', endsAt: '2026-11-28T02:00:00.000Z', reviewedBy: 'brian@bargainlane.com' }),
  P(39, '2026-12-11', 'approved', 'scheduled', { revision: 3, startsAt: '2026-12-10T17:00:00.000Z', endsAt: '2026-12-12T02:00:00.000Z' }),
  P(38, '2026-12-18', 'rejected', 'rejected', { reviewNote: 'Too dark, retake the left bin', reviewedBy: 'brian@bargainlane.com' }),
  P(37, '2026-11-20', 'pulled', 'pulled', { pullReason: 'Wrong store photos', pulledBy: 'brian@bargainlane.com' }),
  P(36, '2026-12-25', 'draft', 'draft', { revision: 1 }),
];
const SETTINGS = {
  store: 'BL4', tz: 'America/New_York',
  profile: { displayName: 'Bargain Lane Dupont', address: { street: '1 Dupont Rd', city: 'Fort Wayne', state: 'IN', zip: '46825' }, phone: '(260) 555-0100', mapsUrl: 'https://maps.example/dupont' },
  hours: { fri: { open: '09:00', close: '21:00' }, sat: { open: '09:00', close: '21:00' }, sun: { open: '11:00', close: '18:00' } },
  binPrices: { fri: [{ from: '00:00', price: 12 }, { from: '14:00', price: 9 }], sat: [{ from: '00:00', price: 6 }] },
  previewDefaults: { startDaysBefore: 1, startTime: '12:00' }, public: false, revision: 3, updatedBy: 'brian@bargainlane.com', updatedAt: '2026-11-24T17:33:51.334Z',
};
const OVERRIDES = [{ date: '2026-12-25', closed: true, open: null, close: null, binPrices: null, note: 'Closed for Christmas', createdBy: 'brian@bargainlane.com', createdAt: '2026-11-24T18:00:00.000Z' }];
const PHOTOS = [501, 502, 503, 504, 505, 506, 507, 508].map(id => ({ id, store: 'BL4', photo_type: 'bins', status: 'new', created_at: '2026-11-2' + (id % 9) + 'T12:00:00Z', url: `?action=photo&id=${id}` }))
  .concat([{ id: 509, store: 'BL4', photo_type: 'bins', status: 'rejected', created_at: '2026-11-22T12:00:00Z', url: '?action=photo&id=509' }]);

function mocks({ who, dark, PREVIEWS, SETTINGS, OVERRIDES, PHOTOS }) {
  try {
    localStorage.setItem('darkMode', String(dark));
    localStorage.setItem('bioPromptDismissed', '1'); localStorage.setItem('coachTipsDisabled', '1');
  } catch (e) {}
  window.__calls = []; window.__posts = []; window.__stale = new Set();
  // __fail[action] = { status, code, error } answers that action once with a refusal;
  // __gates[action] = a promise the stub waits on, so a test can act while a request is in flight.
  window.__fail = {}; window.__gates = {};
  const st = { previews: JSON.parse(JSON.stringify(PREVIEWS)), settings: JSON.parse(JSON.stringify(SETTINGS)),
               overrides: JSON.parse(JSON.stringify(OVERRIDES)), photos: JSON.parse(JSON.stringify(PHOTOS)), next: 90 };
  window.__st = st;
  const J = (x, status = 200) => new Response(JSON.stringify(x), { status, headers: { 'content-type': 'application/json' } });
  const find = id => st.previews.find(p => p.id === id);
  window.fetch = async (u, o = {}) => {
    const url = new URL(String(u), location.href);
    const action = url.searchParams.get('action');
    window.__calls.push(action);
    const body = o.body && typeof o.body === 'string' ? JSON.parse(o.body) : null;
    if (body) window.__posts.push({ action, body });
    // A test marks an action stale to see the page's 409 path.
    if (window.__stale.has(action)) { window.__stale.delete(action); return J({ error: 'Someone changed this preview first. Reload and try again.', code: 'STALE' }, 409); }
    if (window.__gates[action]) await window.__gates[action];
    if (window.__fail[action]) { const f = window.__fail[action]; delete window.__fail[action]; return J({ error: f.error, code: f.code }, f.status); }
    switch (action) {
      case 'auth-me': return J(who);
      case 'bin-previews': return J({ ok: true, previews: st.previews.filter(p => p.store === url.searchParams.get('store')) });
      case 'store-settings': return J({ ok: true, settings: url.searchParams.get('store') === 'BL4' ? st.settings : null, overrides: url.searchParams.get('store') === 'BL4' ? st.overrides : [] });
      case 'marketing-photos': return J({ ok: true, photos: st.photos.filter(p => p.store === url.searchParams.get('store') && p.photo_type === url.searchParams.get('type')) });
      // The worker's store-scoped list: bins only, rejected left out, id and time only.
      case 'bin-preview-photos': return J({ ok: true, photos: st.photos.filter(p => p.store === url.searchParams.get('store') && p.photo_type === 'bins' && p.status !== 'rejected').map(p => ({ id: p.id, createdAt: p.created_at || null })) });
      case 'bin-preview-save': {
        let p;
        if (body.id) { p = find(body.id); Object.assign(p, { saleDate: body.saleDate, photoIds: body.photoIds, caption: body.caption || null, status: 'draft', phase: 'draft' }); p.revision++; }
        else { p = { id: st.next++, store: body.store, saleDate: body.saleDate, photoIds: body.photoIds, caption: body.caption || null, status: 'draft', phase: 'draft', revision: 1, createdBy: who.email }; st.previews.unshift(p); }
        return J({ ok: true, preview: p });
      }
      case 'bin-preview-submit': { const p = find(body.id); Object.assign(p, { status: 'submitted', phase: 'submitted', submittedBy: who.email }); p.revision++; return J({ ok: true, preview: p }); }
      case 'bin-preview-review': {
        const p = find(body.id);
        if (body.decision === 'reject') Object.assign(p, { status: 'rejected', phase: 'rejected', reviewNote: body.note });
        else Object.assign(p, { status: 'approved', phase: 'live', startsAt: new Date(Date.now() - 36e5).toISOString(), endsAt: new Date(Date.now() + 864e5).toISOString(), reviewedBy: who.email });
        p.revision++;
        return J({ ok: true, preview: p, ...(body.decision === 'approve' && { socialDrafts: [] }) });
      }
      case 'bin-preview-pull': { const p = find(body.id); Object.assign(p, { status: 'pulled', phase: 'pulled', pullReason: body.reason, pulledBy: who.email }); p.revision++; return J({ ok: true, preview: p, socialDrafts: [] }); }
      case 'store-settings-save': {
        const s = st.settings; for (const k of ['tz', 'profile', 'hours', 'binPrices', 'previewDefaults', 'public']) if (k in body) s[k] = body[k];
        s.revision++; return J({ ok: true, settings: s });
      }
      case 'store-override-save': {
        st.overrides = st.overrides.filter(x => x.date !== body.date);
        if (!body.remove) st.overrides.push({ date: body.date, closed: !!body.closed, open: body.open || null, close: body.close || null, binPrices: body.binPrices || null, note: body.note || null });
        st.overrides.sort((a, b) => a.date < b.date ? -1 : 1);
        return J({ ok: true, ...(body.remove && { removed: true }) });
      }
      case 'photo-upload': { const id = st.next++; st.photos.unshift({ id, store: o.body.get('store'), photo_type: o.body.get('photo_type'), status: 'new' }); window.__posts.push({ action, body: { store: o.body.get('store'), type: o.body.get('photo_type') } }); return J({ ok: true, id }); }
      default: return J({ error: 'Forbidden' }, 403);
    }
  };
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP438AARAwQCgAt7gX9iz9uhAAAAABJRU5ErkJggg==', 'base64');
const b = await chromium.launch({ executablePath: CHROME });
const live = new Set();
async function open(who, { dark, width = 1440, height = 900, mobile = false }) {
  const ctx = await b.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' });
  live.add(ctx);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  // <img> requests skip the fetch stub: answer photo thumbnails here, refuse everything else off-origin.
  await page.route(u => !u.href.startsWith(ORIGIN), r => /[?&]action=photo&/.test(r.request().url())
    ? r.fulfill({ status: 200, contentType: 'image/png', body: PNG, headers: { 'access-control-allow-origin': '*' } }) : r.abort());
  await page.addInitScript(mocks, { who, dark, PREVIEWS, SETTINGS, OVERRIDES, PHOTOS });
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
const shot = (page, name) => process.env.SHOTS
  ? page.screenshot({ path: path.join(process.env.SHOTS, name + '.png'), fullPage: true }) : null;
const shown = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); return !!(e && e.offsetParent); }, sel);
const text = (page, sel) => page.evaluate(s => document.querySelector(s)?.textContent.replace(/\s+/g, ' ').trim() || '', sel);
const posts = (page, action) => page.evaluate(a => window.__posts.filter(p => p.action === a).map(p => p.body), action);
const settle = page => page.waitForTimeout(350);
// The app's own dialog (uiConfirm / uiAlert): answer it by its button's text.
// 🔑 The app has other, hidden role=dialog sheets: _uiDialog's overlay is the one it just
// appended to <body>, so take the LAST match, never the first.
async function answer(page, button) {
  const dlg = page.locator('body > [role="dialog"][aria-modal="true"]').last();
  await dlg.waitFor({ state: 'visible', timeout: 3000 });
  const msg = await dlg.textContent();
  await dlg.locator('button', { hasText: button }).first().click();
  await settle(page);
  return msg;
}
async function openBP(page) {
  await page.evaluate(() => window.navigateToPage('bin-preview'));
  await page.waitForTimeout(600);
}
const row = (page, id) => text(page, `#bp-list tr[data-id="${id}"]`);

// Contrast against the real composited ground (browser-submit-photo-targets.mjs's measure).
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
    const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    const field = /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && el.type !== 'checkbox' && el.type !== 'file' && (el.value || el.tagName === 'SELECT');
    if (!own && !field) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || !el.getClientRects().length) continue;
    if (el.closest('button:disabled') || el.disabled) continue;   // disabled controls are exempt from 1.4.3
    const fg = parse(cs.color); if (!fg) continue;
    const g = ground(el); const [l1, l2] = [lum(over(fg, g)), lum(g)].sort((a, b) => b - a);
    const px = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700;
    out.push({ text: (el.value || el.textContent).trim().slice(0, 30), need: (px >= 24 || (bold && px >= 18.66)) ? 3 : 4.5,
               ratio: Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100 });
  }
  return out;
};
async function readable(page, sel, t) {
  const rows = await page.evaluate(CONTRAST, sel);
  const bad = rows.filter(r => r.ratio < r.need);
  check(rows.length > 0 && bad.length === 0,
    `[${t}] ${sel} clears AA (${rows.length} nodes, worst ${rows.length ? Math.min(...rows.map(r => r.ratio)) : '—'}:1)`
    + bad.slice(0, 6).map(x => `\n      ✗ ${x.ratio}:1 need ${x.need} "${x.text}"`).join(''));
}

const SUPER = { authenticated: true, email: 'brian@bargainlane.com', name: 'Brian', role: 'superuser', stores: null, pages: {}, businesses: [{ id: 'bl', name: 'Bargain Lane' }] };
const ADMIN = { authenticated: true, email: 'a@bargainlane.com', name: 'Admin', role: 'admin', stores: null, pages: {}, businesses: [{ id: 'bl', name: 'Bargain Lane' }] };
const MANAGER = { authenticated: true, email: 'dupont@bargainlane.com', name: 'Dee', role: 'manager', stores: ['BL4'], pages: {}, businesses: [{ id: 'bl', name: 'Bargain Lane' }] };
const ASSOC = { authenticated: true, email: 'assoc_7@associate.invalid', name: 'Dee Ramirez', role: 'staff', associate: true, pages: {}, stores: ['BL4'], businesses: [{ id: 'bl', name: 'Bargain Lane' }] };

for (const dark of [true, false]) {
  const t = dark ? 'dark' : 'light';

  // ── 1. Desktop: the list, the legend, store-local times, both themes ─────────
  await section(`1 ${t}`, async () => {
    const { page, errs } = await open(ADMIN, { dark });
    check(await page.evaluate(() => document.documentElement.classList.contains('dark')) === dark, `[${t}] the .dark class matches the theme under test`);
    check(await page.evaluate(() => { const e = document.getElementById('nav-bin-preview'); return !!e && !e.classList.contains('hidden'); }), `[${t}] an admin has Marketing › Bin Preview in the sidebar`);
    await openBP(page);
    check(await shown(page, '#page-bin-preview'), `[${t}] the page opens`);
    check(await page.evaluate(() => document.getElementById('bp-store').value) === 'BL4', `[${t}] it opens on Dupont (BL4), the pilot store`);
    const ids = await page.evaluate(() => [...document.querySelectorAll('#bp-list tr[data-id]')].map(r => +r.dataset.id));
    check(JSON.stringify(ids) === '[36,38,39,41,40]', `[${t}] "Open" lists every preview still in play, latest sale first, not the pulled one (${JSON.stringify(ids)})`);
    check(/Waiting for review/.test(await row(page, 41)), `[${t}] a submitted preview reads "Waiting for review"`);
    check(/On the site/.test(await row(page, 40)), `[${t}] a live one reads "On the site"`);
    check(/Scheduled/.test(await row(page, 39)), `[${t}] an approved one not started yet reads "Scheduled"`);
    check(/Sent back/.test(await row(page, 38)), `[${t}] a rejected one reads "Sent back"`);
    check(/Draft/.test(await row(page, 36)), `[${t}] a draft reads "Draft"`);
    const r40 = await row(page, 40);
    check(/Thu, Nov 26, 12:00 PM/.test(r40) && /Fri, Nov 27, 9:00 PM/.test(r40), `[${t}] the window is in the store's clock, not UTC (${r40.slice(0, 90)})`);
    check(/Fri, Nov 27/.test(r40), `[${t}] the sale day is named with its weekday`);
    const legend = await text(page, '#bp-list .bp-legend');
    for (const w of ['Draft', 'Waiting for review', 'Scheduled', 'On the site', 'Sent back', 'Pulled', 'Ended'])
      check(legend.includes(w), `[${t}] the legend explains "${w}"`);
    check(/1 waiting for review/.test(await text(page, '#bp-list .bp-status')), `[${t}] the status line counts what needs a reviewer`);
    await readable(page, '#bp-list', t);
    await readable(page, '#bp-settings', t);
    // Second render: switch filter, switch store and back.
    await page.click('#bp-list [data-filter="all"]'); await settle(page);
    check((await page.evaluate(() => document.querySelectorAll('#bp-list tr[data-id]').length)) === 6, `[${t}] "All" adds the pulled preview`);
    check(/Pulled/.test(await row(page, 37)), `[${t}] which reads "Pulled"`);
    await page.selectOption('#bp-store', 'BL2'); await settle(page);
    check(/No previews/.test(await text(page, '#bp-list')), `[${t}] another store with none says so`);
    await page.selectOption('#bp-store', 'BL4'); await settle(page);
    check((await page.evaluate(() => document.querySelectorAll('#bp-list tr[data-id]').length)) >= 5, `[${t}] and switching back renders the list again`);
    await page.click('#bp-list tr[data-id="41"] .bp-open'); await settle(page);
    check(await shown(page, '#bp-detail'), `[${t}] opening a preview shows it`);
    check((await page.evaluate(() => document.querySelectorAll('#bp-detail .bp-phone img').length)) === 3, `[${t}] the phone card shows its 3 photos`);
    check(/Fresh bins Friday/.test(await text(page, '#bp-detail .bp-phone')), `[${t}] and its caption`);
    await readable(page, '#bp-detail', t);
    await shot(page, `bp-desktop-${t}`);
    check(errs.length === 0, `[${t}] no page errors ${JSON.stringify(errs.slice(0, 2))}`);
  });

  // ── 2. Phone: no sideways scroll, detail stacks, still readable ──────────────
  await section(`2 ${t}`, async () => {
    const { page, errs } = await open(SUPER, { dark, width: 390, height: 844, mobile: true });
    await openBP(page);
    check(await shown(page, '#bp-list'), `[${t}] phone: the list shows`);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth);
    check(wide <= 390, `[${t}] phone: the page does not scroll sideways (${wide}px)`);
    await page.click('#bp-list tr[data-id="40"] .bp-open'); await settle(page);
    check(await shown(page, '#bp-detail .bp-phone'), `[${t}] phone: the preview card shows`);
    const wide2 = await page.evaluate(() => document.documentElement.scrollWidth);
    check(wide2 <= 390, `[${t}] phone: still no sideways scroll with a preview open (${wide2}px)`);
    // The panels clip (overflow:hidden), so a control too wide for a phone is cut off, not scrolled to.
    const clipped = await page.evaluate(() => ['bp-detail', 'bp-settings'].flatMap(id => {
      const box = document.getElementById(id).getBoundingClientRect();
      return [...document.querySelectorAll(`#${id} button, #${id} input, #${id} select, #${id} textarea`)]
        .filter(e => e.getClientRects().length && (e.getBoundingClientRect().right > box.right + 1 || e.getBoundingClientRect().left < box.left - 1))
        .map(e => `${id}: ${(e.textContent || e.dataset.path || e.id).trim().slice(0, 24)}`);
    }));
    check(!clipped.length, `[${t}] phone: no control is cut off at the panel edge ${JSON.stringify(clipped.slice(0, 4))}`);
    await readable(page, '#bp-list', t);
    await readable(page, '#bp-detail', t);
    await readable(page, '#bp-settings', t);
    await shot(page, `bp-phone-${t}`);
    check(errs.length === 0, `[${t}] phone: no page errors ${JSON.stringify(errs.slice(0, 2))}`);
  });
}

// ── 3. Review: approve sends the revision it showed; send-back needs a reason ──
await section('3 review', async () => {
  const { page } = await open(ADMIN, { dark: true });
  await openBP(page);
  await page.click('#bp-list tr[data-id="41"] .bp-open'); await settle(page);
  check(/12:00 PM.*1 day before/.test(await text(page, '#bp-detail .bp-review')), 'the default window is spelled out from the store setting');
  // A page rule once outranked .hidden, and the times showed while "Choose the times" was unticked.
  check(!(await shown(page, '#bp-start')), '🛑 the chosen-times fields are hidden until "Choose the times instead" is ticked');
  await page.click('#bp-detail [data-act="reject"]'); await settle(page);
  check((await posts(page, 'bin-preview-review')).length === 0, '🛑 a send-back with no reason sends nothing');
  check(/Say why/.test(await text(page, '#bp-detail .bp-msg')), 'and says why');
  await page.fill('#bp-note', 'Retake the left bin'); await page.click('#bp-detail [data-act="reject"]'); await settle(page);
  const rj = (await posts(page, 'bin-preview-review'))[0];
  check(rj && rj.id === 41 && rj.decision === 'reject' && rj.note === 'Retake the left bin' && rj.expectedRevision === 2, `send-back carries the reason and the revision shown (${JSON.stringify(rj)})`);
  check(/Sent back/.test(await row(page, 41)), 'the list re-renders with it sent back');
});
await section('3b approve', async () => {
  const { page } = await open(ADMIN, { dark: true });
  await openBP(page);
  await page.click('#bp-list tr[data-id="41"] .bp-open'); await settle(page);
  await page.click('#bp-detail [data-act="approve"]'); await settle(page);
  const ap = (await posts(page, 'bin-preview-review'))[0];
  check(ap && ap.id === 41 && ap.decision === 'approve' && ap.expectedRevision === 2 && !('startsAt' in ap) && !('endsAt' in ap),
    `🛑 approve sends exactly the revision reviewed, and no times so the server applies the default (${JSON.stringify(ap)})`);
  check(/On the site/.test(await row(page, 41)), 'the list shows it on the site');
  check(/Social posts/.test(await text(page, '#bp-detail')), 'the detail says what happened to social posts');
});
await section('3c approve with chosen times', async () => {
  const { page } = await open(ADMIN, { dark: false });
  await openBP(page);
  await page.click('#bp-list tr[data-id="41"] .bp-open'); await settle(page);
  await page.check('#bp-custom'); await settle(page);
  await page.fill('#bp-start', '2026-12-03T09:00'); await page.fill('#bp-end', '2026-12-04T20:00');
  await page.click('#bp-detail [data-act="approve"]'); await settle(page);
  const ap = (await posts(page, 'bin-preview-review'))[0];
  check(ap && ap.startsAt === '2026-12-03T09:00' && ap.endsAt === '2026-12-04T20:00', `chosen times go as store-local wall times (${JSON.stringify(ap)})`);
});
await section('3d stale', async () => {
  const { page } = await open(ADMIN, { dark: true });
  await openBP(page);
  await page.click('#bp-list tr[data-id="41"] .bp-open'); await settle(page);
  const before = await page.evaluate(() => window.__calls.filter(a => a === 'bin-previews').length);
  await page.evaluate(() => window.__stale.add('bin-preview-review'));
  await page.click('#bp-detail [data-act="approve"]');
  const msg = await answer(page, 'OK');
  check(/changed/i.test(msg), `a 409 says someone changed it first (${msg.slice(0, 80)})`);
  const after = await page.evaluate(() => window.__calls.filter(a => a === 'bin-previews').length);
  check(after > before, 'and reloads the list, so the reviewer sees the new version');
});

// ── 4. Pull: needs a reason, asks first, then it is off the site ──────────────
await section('4 pull', async () => {
  const { page } = await open(SUPER, { dark: true });
  await openBP(page);
  await page.click('#bp-list tr[data-id="40"] .bp-open'); await settle(page);
  check(/On the site from Thu, Nov 26, 12:00 PM until Fri, Nov 27, 9:00 PM/.test(await text(page, '#bp-detail')), 'a live preview says its window in store time');
  await page.click('#bp-detail [data-act="pull"]'); await settle(page);
  check((await posts(page, 'bin-preview-pull')).length === 0, '🛑 a pull with no reason sends nothing');
  await page.fill('#bp-reason', 'Wrong photos'); await page.click('#bp-detail [data-act="pull"]');
  await answer(page, 'Cancel');
  check((await posts(page, 'bin-preview-pull')).length === 0, 'cancelling the question sends nothing');
  await page.click('#bp-detail [data-act="pull"]');
  const q = await answer(page, 'Pull from site');
  check(/Nov 27/.test(q), `the question names the sale day (${q.slice(0, 80)})`);
  const pl = (await posts(page, 'bin-preview-pull'))[0];
  check(pl && pl.id === 40 && pl.reason === 'Wrong photos', `the pull carries the reason (${JSON.stringify(pl)})`);
  check(/Pulled/.test(await text(page, '#bp-detail')), 'the detail shows it pulled');
});

// ── 5. New preview: default Friday, the photos in the order picked, then submit ──
await section('5 new', async () => {
  const { page } = await open(ADMIN, { dark: true });
  await openBP(page);
  await page.click('#bp-list [data-act="new"]'); await settle(page);
  const sd = await page.evaluate(() => document.getElementById('bp-sale').value);
  check(/^\d{4}-\d{2}-\d{2}$/.test(sd) && new Date(sd + 'T12:00:00Z').getUTCDay() === 5, `the sale day defaults to a Friday (${sd})`);
  const grid = await page.evaluate(() => [...document.querySelectorAll('#bp-detail .bp-pick')].map(x => +x.dataset.photo));
  check(grid.length === 8 && !grid.includes(509), `🛑 the picker offers the store's bin photos, not a rejected one (${JSON.stringify(grid)})`);
  await page.click('#bp-detail .bp-pick[data-photo="503"]'); await page.click('#bp-detail .bp-pick[data-photo="501"]'); await settle(page);
  check(/1/.test(await text(page, '#bp-detail .bp-pick[data-photo="503"] .bp-ord')) && /2/.test(await text(page, '#bp-detail .bp-pick[data-photo="501"] .bp-ord')), 'each picked photo shows its place');
  await page.fill('#bp-caption', 'Big drop this Friday');
  await page.click('#bp-detail [data-act="submit"]'); await settle(page); await settle(page);
  const sv = (await posts(page, 'bin-preview-save'))[0], sb = (await posts(page, 'bin-preview-submit'))[0];
  check(sv && sv.store === 'BL4' && sv.saleDate === sd && JSON.stringify(sv.photoIds) === '[503,501]' && sv.caption === 'Big drop this Friday' && !('id' in sv),
    `🛑 save sends the photos in the order picked (${JSON.stringify(sv)})`);
  check(sb && sb.id === 90 && sb.expectedRevision === 1, `then submit sends the saved revision (${JSON.stringify(sb)})`);
  check(/Waiting for review/.test(await row(page, 90)), 'and the list shows it waiting for review');
});

// ── 6. Settings: only what changed is sent; going public asks first ───────────
await section('6 settings', async () => {
  const { page } = await open(SUPER, { dark: true });
  await openBP(page);
  await page.fill('#bp-settings [data-tier="fri:1"] input[data-k="price"]', '8'); await settle(page);
  check(await page.evaluate(() => document.querySelector('#bp-settings [data-tier="fri:1"] input[data-k="price"]').classList.contains('bp-dirty')), 'a changed price is marked as changed');
  await page.check('#bp-public');
  const q = await answer(page, 'Cancel');
  check(/public/i.test(q), `turning the store public asks first (${q.slice(0, 70)})`);
  check(!(await page.evaluate(() => document.getElementById('bp-public').checked)), 'and cancelling leaves it off');
  await page.click('#bp-settings [data-act="save-settings"]'); await settle(page);
  const s = (await posts(page, 'store-settings-save'))[0];
  check(s && JSON.stringify(Object.keys(s).sort()) === '["binPrices","expectedRevision","store"]', `🛑 only the changed part is sent (${s && Object.keys(s)})`);
  check(s && s.expectedRevision === 3 && JSON.stringify(s.binPrices.fri) === '[{"from":"00:00","price":12},{"from":"14:00","price":8}]'
    && JSON.stringify(s.binPrices.sat) === '[{"from":"00:00","price":6}]', `with the other days intact (${JSON.stringify(s && s.binPrices)})`);
  check(!(await page.evaluate(() => document.querySelector('#bp-settings .bp-dirty'))), 'after saving nothing is marked changed (second render)');
  await page.fill('#bp-ov-date', '2026-12-31'); await page.fill('#bp-ov-open', '09:00'); await page.fill('#bp-ov-close', '17:00');
  await page.fill('#bp-ov-note', "New Year's Eve hours");
  await page.click('#bp-settings [data-act="add-override"]'); await settle(page);
  const ov = (await posts(page, 'store-override-save'))[0];
  check(ov && ov.store === 'BL4' && ov.date === '2026-12-31' && ov.open === '09:00' && ov.close === '17:00' && ov.note === "New Year's Eve hours" && !ov.closed,
    `a one-off day sends its hours and note (${JSON.stringify(ov)})`);
  check(/Dec 31/.test(await text(page, '#bp-settings .bp-ovlist')), 'and appears in the list');
  await page.click('#bp-settings [data-ov="2026-12-25"]');
  await answer(page, 'Remove');
  const rm = (await posts(page, 'store-override-save'))[1];
  check(rm && rm.date === '2026-12-25' && rm.remove === true, `removing one asks, then sends remove (${JSON.stringify(rm)})`);
});

// ── 8. Fresh-eyes review findings (2026-11-25), each pinned ──────────────────
await section('8a quotes in stored text', async () => {
  const { page } = await open(SUPER, { dark: true });
  await page.evaluate(() => { window.__st.settings.profile.displayName = 'Lane "Dupont" x" data-pwned="1'; });
  await openBP(page);
  const v = await page.evaluate(() => document.querySelector('#bp-settings input[data-path="profile.displayName"]').value);
  check(v === 'Lane "Dupont" x" data-pwned="1', `🛑 a store name with quotes shows whole in its field (${v})`);
  check(!(await page.evaluate(() => document.querySelector('[data-pwned]'))), '🛑 and cannot add an attribute of its own');
});
await section('8b other 409s', async () => {
  const { page } = await open(ADMIN, { dark: true });
  await openBP(page);
  await page.click('#bp-list tr[data-id="41"] .bp-open'); await settle(page);
  await page.fill('#bp-note', 'Looks good');
  const before = await page.evaluate(() => window.__calls.filter(a => a === 'bin-previews').length);
  await page.evaluate(() => { window.__fail['bin-preview-review'] = { status: 409, code: 'ALREADY_APPROVED_FOR_DAY', error: 'Preview #39 is already approved for this day. Pull it first.' }; });
  await page.click('#bp-detail [data-act="approve"]'); await settle(page);
  check(/already approved for this day/.test(await text(page, '#bp-detail .bp-msg')), 'a refusal that is not STALE is said in place');
  check(!(await page.locator('body > [role="dialog"][aria-modal="true"]:visible').count()), 'with no "changed" dialog');
  check(await page.evaluate(() => document.getElementById('bp-note').value) === 'Looks good', 'and the typed note survives');
  check(await page.evaluate(() => window.__calls.filter(a => a === 'bin-previews').length) === before, 'and nothing is reloaded');
});
await section('8c upload keeps its store', async () => {
  const { page } = await open(ADMIN, { dark: true });
  await openBP(page);
  await page.click('#bp-list [data-act="new"]'); await settle(page);
  await page.evaluate(() => { window.__gates['photo-upload'] = new Promise(r => { window.__openGate = r; }); });
  // Two photos: the first waits at the server while the store changes, so the second starts after the switch.
  await page.setInputFiles('#bp-files', [{ name: 'bin1.png', mimeType: 'image/png', buffer: PNG }, { name: 'bin2.png', mimeType: 'image/png', buffer: PNG }]);
  await page.waitForTimeout(400);
  await page.selectOption('#bp-store', 'BL2'); await settle(page);
  await page.evaluate(() => window.__openGate()); await page.waitForTimeout(500);
  const ups = await posts(page, 'photo-upload');
  check(ups.length === 2 && ups.every(u => u.store === 'BL4'), `🛑 photos picked for Dupont upload to Dupont after a store switch (${JSON.stringify(ups)})`);
  await page.click('#bp-list [data-act="new"]'); await settle(page);
  check((await page.evaluate(() => document.querySelectorAll('#bp-detail .bp-pick').length)) === 0, "🛑 and does not appear among South Bend's photos");
});
await section('8d settings save once', async () => {
  const { page } = await open(SUPER, { dark: true });
  await openBP(page);
  await page.click('#bp-list tr[data-id="41"] .bp-open'); await settle(page);
  await page.fill('#bp-note', 'Half-typed note');
  await page.fill('#bp-settings input[data-path="profile.phone"]', '(260) 555-0199');
  await page.evaluate(() => { window.__gates['store-settings-save'] = new Promise(r => { window.__openGate = r; }); });
  await page.evaluate(() => { const b = document.querySelector('#bp-settings [data-act="save-settings"]'); b.click(); b.click(); });
  await page.evaluate(() => window.__openGate()); await settle(page);
  check((await posts(page, 'store-settings-save')).length === 1, `🛑 a double click saves once (${(await posts(page, 'store-settings-save')).length})`);
  check(/Saved/.test(await text(page, '#bp-settings .bp-setmsg')), 'and says Saved, not "changed"');
  check(await page.evaluate(() => document.getElementById('bp-note')?.value) === 'Half-typed note', "saving an unrelated setting keeps a reviewer's half-typed note");
});
await section('8e empty first price', async () => {
  const { page } = await open(SUPER, { dark: false });
  await openBP(page);
  await page.fill('#bp-settings [data-tier="fri:0"] input[data-k="price"]', '');
  await page.click('#bp-settings [data-act="save-settings"]'); await settle(page);
  check((await posts(page, 'store-settings-save')).length === 0, '🛑 clearing the first of two prices sends nothing');
  check(/Fri: fill in or remove the empty price/.test(await text(page, '#bp-settings .bp-setmsg')), 'and says which day');
});
await section('8f holiday entry', async () => {
  const { page } = await open(SUPER, { dark: true });
  await openBP(page);
  await page.fill('#bp-ov-date', '2026-12-24'); await page.fill('#bp-ov-note', 'Closing early');
  await page.click('#bp-settings [data-act="add-tier"][data-day="mon"]'); await settle(page);
  check(await page.evaluate(() => [document.getElementById('bp-ov-date').value, document.getElementById('bp-ov-note').value].join('|')) === '2026-12-24|Closing early',
    'a half-typed holiday entry survives adding a price elsewhere in the panel');
  await page.fill('#bp-ov-date', '2026-12-25');
  await page.click('#bp-settings [data-act="add-override"]');
  const q = await answer(page, 'Cancel');
  check(/already has an entry/.test(q), `adding a day that has one asks to replace it (${q.slice(0, 60)})`);
  check((await posts(page, 'store-override-save')).length === 0, 'and cancelling sends nothing');
});
await section('8h holiday prefill', async () => {
  const { page } = await open(ADMIN, { dark: true });
  await page.evaluate(() => { window.__st.previews.find(p => p.id === 41).saleDate = '2026-12-25'; });
  await openBP(page);
  await page.click('#bp-list tr[data-id="41"] .bp-open'); await settle(page);
  const end = await page.evaluate(() => document.getElementById('bp-end').value);
  check(end === '2026-12-25T23:59', `the chosen-times prefill follows the sale day's holiday entry, as the worker's default does (${end})`);
});
await section('8g upload focus', async () => {
  const { page } = await open(ADMIN, { dark: true });
  await openBP(page);
  await page.click('#bp-list [data-act="new"]'); await settle(page);
  await page.focus('#bp-files');
  const o = await page.evaluate(() => getComputedStyle(document.querySelector('#bp-detail .bp-upload')).outlineStyle);
  check(o !== 'none', `the upload button shows keyboard focus (${o})`);
});

// ── 7. Who sees it: admins, superusers, and managers of a pilot store (Dupont) ──
// Slice 1 (Brian, 2026-11-25): a Dupont manager makes and submits previews; reviewing and the store's
// settings stay with admins. Everyone else still has no Bin Preview.
await section('7 Dupont manager', async () => {
  const { page, errs } = await open(MANAGER, { dark: true, width: 390, height: 844, mobile: true });
  check(await page.evaluate(() => { const e = document.getElementById('nav-bin-preview'); return !!e && !e.classList.contains('hidden'); }), 'a Dupont manager has Bin Preview');
  await openBP(page);
  check(await shown(page, '#page-bin-preview'), 'and the router opens it');
  check(JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('#bp-store option')].map(o => o.value))) === '["BL4"]', 'the store picker offers only Dupont');
  check(!(await shown(page, '#bp-settings')), '🛑 no store page settings for a manager');
  await page.click('#bp-list tr[data-id="41"] .bp-open'); await settle(page);
  check(!(await page.evaluate(() => document.querySelector('#bp-detail [data-act="approve"], #bp-detail [data-act="reject"]'))), '🛑 no Approve or Send back for a manager');
  check(/Waiting for a Bargain Lane admin/.test(await text(page, '#bp-detail')), 'it says an admin reviews it');
  // Review finding (2026-11-25): a manager who submitted a mistake can take it back to fix it.
  await page.click('#bp-detail [data-act="edit"]'); await settle(page);
  check(await shown(page, '#bp-caption'), 'a manager can take a submitted preview back to edit it');
  await page.fill('#bp-caption', 'Fixed caption');
  await page.click('#bp-detail [data-act="save"]'); await settle(page);
  const ed = (await posts(page, 'bin-preview-save'))[0];
  check(ed && ed.id === 41 && ed.expectedRevision === 2 && ed.caption === 'Fixed caption', `and saves it with the revision shown (${JSON.stringify(ed)})`);
  await page.evaluate(() => { window.__posts.length = 0; });
  await page.click('#bp-detail [data-act="close"]'); await settle(page);
  await page.click('#bp-list [data-act="new"]'); await settle(page);
  check((await page.evaluate(() => document.querySelectorAll('#bp-detail .bp-pick').length)) === 8, "the picker lists Dupont's bin photos (from bin-preview-photos)");
  check(await page.evaluate(() => window.__calls.includes('bin-preview-photos') && !window.__calls.includes('marketing-photos')), 'through the store-scoped list, not the admin one');
  await page.click('#bp-detail .bp-pick[data-photo="502"]');
  await page.click('#bp-detail [data-act="submit"]'); await settle(page); await settle(page);
  const sv = (await posts(page, 'bin-preview-save'))[0], sb = (await posts(page, 'bin-preview-submit'))[0];
  check(sv && sv.store === 'BL4' && JSON.stringify(sv.photoIds) === '[502]' && sb && sb.expectedRevision === 1, `a manager's preview is saved and submitted (${JSON.stringify(sv)})`);
  await readable(page, '#bp-list', 'manager');
  await readable(page, '#bp-detail', 'manager');
  check(errs.length === 0, `manager: no page errors ${JSON.stringify(errs.slice(0, 2))}`);
});
const SB_MANAGER = { ...MANAGER, email: 'sb@bargainlane.com', stores: ['BL2'] };
for (const [who, label] of [[SB_MANAGER, 'a South Bend manager'], [ASSOC, 'an associate']]) {
  await section(`7 ${label}`, async () => {
    const { page } = await open(who, { dark: true });
    check(await page.evaluate(() => { const e = document.getElementById('nav-bin-preview'); return !e || e.classList.contains('hidden'); }), `🛑 ${label} has no Bin Preview item`);
    await openBP(page);
    check(!(await shown(page, '#page-bin-preview')), `🛑 and the router refuses the page for ${label}`);
  });
}

await b.close(); srv.close();
const failed = results.filter(r => !r[0]);
for (const [ok, m] of results) console.log(`${ok ? '  ok ' : '  ✗  '} ${m}`);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
