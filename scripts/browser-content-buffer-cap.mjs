// Content Studio's 9-photo cap (Buffer takes 10 images on a Facebook post: the cover
// plus 9), driven in a REAL BROWSER.
//
// 🛑 NOT PART OF `scripts/test.sh` — it needs playwright-core and a Chromium. Run by hand:
//
//   npm install --no-save playwright-core
//   bash scripts/build.sh && node scripts/browser-content-buffer-cap.mjs
//   (on a Mac: PLAYWRIGHT_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
//
// test-buffer-publish.mjs proves the worker refuses an over-limit post. This proves the
// page never builds one by accident, says how many to remove on a draft that already
// has too many, and reads in both themes. Brian chose (2026-10-19) that the admin picks
// the 9 — so nothing here may drop a photo on its own.
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

const NOW = new Date().toISOString();
const PHOTOS = Array.from({ length: 12 }, (_, i) => ({ id: 101 + i, store: 'BL2', photo_type: 'bins', note: null, uploader: 'm@x.com', status: 'new', created_at: NOW }));
const DRAFTS = [
  // The weekly bin auto-draft: cover + all 12 of the week's photos. Three too many.
  { id: 7, store: 'BL2', thumbnail_id: 5, photo_ids: PHOTOS.map(p => p.id), caption: 'Fresh bins', caption_source: 'ai', topic: "This week's bin photos",
    post_type: 'bin_preview', status: 'draft', origin: 'photos', created_at: NOW, updated_at: NOW },
  { id: 8, store: 'BL2', thumbnail_id: 5, photo_ids: [101, 102], caption: 'Two photos', caption_source: 'manual', topic: null,
    post_type: 'bin_preview', status: 'draft', origin: null, created_at: NOW, updated_at: NOW },
  // Scheduled before Buffer was switched on, with 11 photos: it would fail at its time.
  { id: 9, store: 'BL2', thumbnail_id: 5, photo_ids: PHOTOS.slice(0, 11).map(p => p.id), caption: 'Queued early', caption_source: 'ai', topic: null,
    post_type: 'bin_preview', status: 'scheduled', scheduled_at: new Date(Date.now() + 864e5).toISOString(), publish_live: 1, origin: null, created_at: NOW, updated_at: NOW },
];

function mocks({ who, PHOTOS, DRAFTS, dark }) {
  try {
    localStorage.setItem('darkMode', String(dark));
    localStorage.setItem('bioPromptDismissed', '1'); localStorage.setItem('coachTipsDisabled', '1');
  } catch (e) {}
  window.__calls = [];
  const J = (x, status = 200) => new Response(JSON.stringify(x), { status, headers: { 'content-type': 'application/json' } });
  window.fetch = async (u) => {
    const action = new URL(String(u), location.href).searchParams.get('action');
    window.__calls.push(action);
    switch (action) {
      case 'auth-me': return J(who);
      case 'thumbnails': return J({ ok: true, thumbnails: [{ id: 5, name: 'Bin day', post_type: 'bin_preview', created_at: '2026-10-01T00:00:00Z' }] });
      case 'drafts': return J({ ok: true, drafts: DRAFTS });
      case 'marketing-photos': return J({ ok: true, photos: PHOTOS });
      case 'flow-calendar': return J({ ok: true, weeks: [], segments: [] });
      case 'content-setting': return J({ ok: true, value: null });
      default: return J({ error: 'Forbidden' }, 403);
    }
  };
}

const b = await chromium.launch({ executablePath: CHROME });
const live = new Set();
async function open(who, { dark, width = 1280, height = 900 }) {
  const ctx = await b.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
  live.add(ctx);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.route(u => !u.href.startsWith(ORIGIN), r => r.abort());
  await page.addInitScript(mocks, { who, PHOTOS, DRAFTS, dark });
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
  ? page.screenshot({ path: path.join(process.env.SHOTS, name + '.png'), fullPage: false }) : null;
const text = (page, sel) => page.evaluate(s => document.querySelector(s)?.textContent.replace(/\s+/g, ' ').trim() || '', sel);

// Contrast of ONE element against its real composited ground (browser-associate-reveal.mjs's measure).
const RATIO = (sel) => {
  const el = document.querySelector(sel); if (!el) return null;
  const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const parse = s => { const m = String(s).match(/[\d.]+/g); return m ? m.map(Number) : null; };
  const over = (f, b) => { const a = f.length > 3 ? f[3] : 1; return [0, 1, 2].map(i => f[i] * a + b[i] * (1 - a)); };
  let g = [255, 255, 255]; const st = [];
  for (let n = el; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (!c) continue;
    const a = c.length > 3 ? c[3] : 1; if (a === 0) continue; st.push(c); if (a === 1) { g = c.slice(0, 3); break; } }
  for (let i = st.length - 1; i >= 0; i--) g = over(st[i], g);
  const fg = parse(getComputedStyle(el).color);
  const [l1, l2] = [lum(over(fg, g)), lum(g)].sort((a, b) => b - a);
  return Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100;
};

const ADMIN = { authenticated: true, email: 'a@b.com', name: 'Admin', role: 'admin', stores: null, pages: {}, businesses: ['bl'] };

for (const dark of [true, false]) {
  const t = dark ? 'dark' : 'light';
  await section(`cap ${t}`, async () => {
    const { page, errs } = await open(ADMIN, { dark });
    check(await page.evaluate(() => document.documentElement.classList.contains('dark')) === dark, `[${t}] the .dark class matches the theme under test`);
    await page.evaluate(() => window.navigateToPage('content'));
    await page.waitForTimeout(700);

    // ── The over-limit auto-draft in the Drafts lane ──
    const lane = await text(page, '#ct-drafts');
    check(/12 photos · remove 3 to post/.test(lane), `[${t}] the 12-photo draft says to remove 3 (${lane.slice(0, 120)})`);
    check(!/(^|[^0-9])2 photos · remove/.test(lane), `[${t}] the 2-photo draft carries no warning`);
    const warn = await page.evaluate(() => [...document.querySelectorAll('#ct-drafts div')].find(d => /remove 3 to post/.test(d.textContent) && !d.children.length)?.className || '');
    check(/text-opl-bad/.test(warn), `[${t}] the warning is in the bad colour`);
    await page.evaluate(() => { const d = [...document.querySelectorAll('#ct-drafts div')].find(x => /remove 3 to post/.test(x.textContent) && !x.children.length); d.id = '__warn'; });
    const wr = await page.evaluate(RATIO, '#__warn');
    check(wr >= 4.5, `[${t}] the card warning clears AA (${wr}:1)`);

    const sched = await text(page, '#ct-scheduled');
    check(/remove 2 to post/.test(sched), `[${t}] a scheduled post with 11 photos says to remove 2 (${sched.slice(0, 120)})`);
    await page.evaluate(() => { const d = [...document.querySelectorAll('#ct-scheduled div')].find(x => /remove 2 to post/.test(x.textContent) && !x.children.length); d.id = '__warn2'; });
    const wr2 = await page.evaluate(RATIO, '#__warn2');
    check(wr2 >= 4.5, `[${t}] that warning clears AA (${wr2}:1)`);

    // Publish on it stops before anything is sent.
    await page.evaluate(() => { window.ctPublishDraft(7); });   // resolves only when the dialog closes
    await page.waitForTimeout(300);
    const dlg = await page.evaluate(() => document.body.innerText);
    check(/Too many photos/.test(dlg) && /keep your best 9/.test(dlg), `[${t}] Publish explains: keep your best 9`);
    check(!(await page.evaluate(() => window.__calls.includes('publish-draft'))), `🛑 [${t}] and never calls publish-draft`);
    await shot(page, `cap-publish-${t}`);
    await page.keyboard.press('Escape');
    await page.evaluate(() => document.querySelectorAll('.ui-dialog-backdrop, [data-ui-dialog]').forEach(n => n.remove()));

    // ── Editing it: the counter says how many to remove, and nothing more can be added ──
    await page.evaluate(() => window.ctEditDraft(7));
    await page.waitForTimeout(700);
    const cnt = await text(page, '#ct-photo-count');
    check(cnt === '12 of 9 attached · remove 3 to post', `[${t}] the counter on the 12-photo draft (${cnt})`);
    const cr = await page.evaluate(RATIO, '#ct-photo-count');
    check(cr >= 4.5, `[${t}] the over-limit counter clears AA (${cr}:1)`);
    await page.evaluate(() => { window.ctOpenPhotoFolder('undated'); window.ctOpenPhotoType('bins'); });
    await page.waitForTimeout(300);
    // Deselect three; every photo still on the draft is one the admin left there.
    for (const id of [110, 111, 112]) await page.evaluate(i => window.ctTogglePhoto(i), id);
    check(await text(page, '#ct-photo-count') === '9 of 9 attached', `[${t}] after removing 3: 9 of 9`);
    const cr2 = await page.evaluate(RATIO, '#ct-photo-count');
    check(cr2 >= 4.5, `[${t}] the plain counter clears AA (${cr2}:1)`);
    // A 10th is refused, with a reason.
    await page.evaluate(() => window.ctTogglePhoto(110));
    check(await text(page, '#ct-photo-count') === '9 of 9 attached', `🛑 [${t}] a 10th photo is not added`);
    const note = await text(page, '#ct-compose-status');
    check(/9 photos plus the cover/.test(note), `[${t}] and the composer says why (${note})`);
    await shot(page, `cap-composer-${t}`);

    // ── Select-all fills only the free slots ──
    for (const id of [101, 102, 103, 104, 105]) await page.evaluate(i => window.ctTogglePhoto(i), id);
    check(await text(page, '#ct-photo-count') === '4 of 9 attached', `[${t}] down to 4`);
    await page.evaluate(() => window.ctSelectAllInFolder());
    check(await text(page, '#ct-photo-count') === '9 of 9 attached', `[${t}] select-all stops at 9`);
    check(/Added 5 of 8/.test(await text(page, '#ct-compose-status')), `[${t}] and says it added 5 of 8`);
    const order = await page.evaluate(() => [...document.querySelectorAll('.ct-tile[data-pid]')].filter(b => !b.querySelector('.ct-tile-badge.hidden')).map(b => Number(b.dataset.pid)));
    check(order.length === 9, `[${t}] nine tiles show as picked (${order.length})`);
    // Full, with photos still unpicked in the folder: the button offers the way out, not a no-op.
    const btn = () => page.evaluate(() => [...document.querySelectorAll('#ct-photo-pick button')].find(b => /select all/i.test(b.textContent))?.textContent.trim());
    check(await btn() === 'Deselect all', `[${t}] at the cap the folder button reads Deselect all (${await btn()})`);
    await page.evaluate(() => window.ctSelectAllInFolder());
    check(await text(page, '#ct-photo-count') === '0 of 9 attached', `[${t}] and clears the folder`);
    check(await btn() === 'Select all', `[${t}] then reads Select all again`);

    check(errs.length === 0, `[${t}] no page errors (${errs.join(' | ').slice(0, 200)})`);
  });
}

await b.close(); srv.close();
let pass = 0, fail = 0;
for (const [c, m] of results) { if (c) pass++; else { fail++; console.log('  FAIL ' + m); } }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
