// Video posts in Content Studio, driven in a REAL BROWSER (2026-10-19).
//
// 🛑 NOT PART OF `scripts/test.sh` — it needs playwright-core and a Chromium. Run by hand:
//
//   npm install --no-save playwright-core
//   bash scripts/build.sh && node scripts/browser-content-video.mjs
//   (on a Mac: PLAYWRIGHT_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
//
// test-video-posts.mjs proves the worker. This proves the composer: a video turns the
// post into a video post (cover and photos cleared and hidden), a video with no poster
// gets one grabbed HERE from a really-playing video and saved, the preview and the save
// say video, and the board's card does too — in both themes.
//
// The playable video is recorded in the page itself (canvas → MediaRecorder, WebM), then
// served for ?action=video with the CORS-with-credentials headers the worker sends, so
// the frame grab runs exactly as it will against production.
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
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP438AARAwQCgAt7gX9iz9uhAAAAABJRU5ErkJggg==', 'base64');

const NOW = new Date().toISOString();
const VIDEOS = [
  { id: 11, store: 'BL2', video_type: 'store_walk', bytes: 2e8, duration_ms: 190000, width: 1920, height: 1080, uploader: 'm@x.com', note: 'Furniture aisle', created_at: NOW, has_poster: false },
  { id: 12, store: 'BL2', video_type: 'clip', bytes: 1.2e7, duration_ms: 45000, width: 1080, height: 1920, uploader: 'm@x.com', note: null, created_at: NOW, has_poster: true },
];
const DRAFTS = [
  { id: 5, store: 'BL2', thumbnail_id: null, photo_ids: [], video_id: 12, video_type: 'clip', video_duration_ms: 45000, caption: 'New today', caption_source: 'manual', status: 'draft', created_at: NOW, updated_at: NOW },
  // Its video is older than the 50 the picker lists.
  { id: 6, store: 'BL2', thumbnail_id: null, photo_ids: [], video_id: 3, video_type: 'store_walk', video_duration_ms: 200000, caption: 'Old walk', caption_source: 'manual', status: 'draft', created_at: NOW, updated_at: NOW },
];
const PHOTOS = Array.from({ length: 3 }, (_, i) => ({ id: 101 + i, store: 'BL2', photo_type: 'bins', note: null, uploader: 'm@x.com', status: 'new', created_at: NOW }));

function mocks({ who, VIDEOS, DRAFTS, PHOTOS, dark }) {
  try { localStorage.setItem('darkMode', String(dark)); localStorage.setItem('bioPromptDismissed', '1'); localStorage.setItem('coachTipsDisabled', '1'); } catch (e) {}
  window.__calls = []; window.__saved = null; window.__poster = null; window.__ai = null;
  const J = (x, status = 200) => new Response(JSON.stringify(x), { status, headers: { 'content-type': 'application/json' } });
  window.fetch = async (u, o = {}) => {
    const url = new URL(String(u), location.href), action = url.searchParams.get('action');
    window.__calls.push(action);
    switch (action) {
      case 'auth-me': return J(who);
      case 'thumbnails': return J({ ok: true, thumbnails: [{ id: 5, name: 'Bin day', post_type: 'bin_preview', created_at: '2026-10-01T00:00:00Z' }] });
      case 'drafts': return J({ ok: true, drafts: DRAFTS });
      case 'marketing-photos': return J({ ok: true, photos: PHOTOS });
      case 'marketing-videos': return J({ ok: true, videos: VIDEOS });
      case 'flow-calendar': return J({ ok: true, weeks: [], segments: [] });
      case 'content-setting': return J({ ok: true, value: null });
      case 'video-poster': { const f = o.body; const b = f.get('poster'); window.__poster = { id: f.get('id'), type: b && b.type, size: b && b.size }; return J({ ok: true }); }
      case 'draft-save': window.__saved = JSON.parse(o.body); return J({ ok: true, id: 99 });
      case 'draft-generate-caption': window.__ai = JSON.parse(o.body); return J({ ok: true, caption: 'Walk the floor with us! #BargainLaneSouthBend' });
      default: return J({ error: 'Forbidden' }, 403);
    }
  };
}

const b = await chromium.launch({ executablePath: CHROME, args: ['--autoplay-policy=no-user-gesture-required'] });

// A real, playable video: record a moving canvas for ~1.5 s in a scratch page.
const WEBM = await (async () => {
  const ctx = await b.newContext(); const page = await ctx.newPage();
  await page.goto(ORIGIN + '/index.html', { waitUntil: 'domcontentloaded' }).catch(() => {});
  const bytes = await page.evaluate(async () => {
    const cv = document.createElement('canvas'); cv.width = 320; cv.height = 180;
    const g = cv.getContext('2d'); let t = 0;
    const draw = () => { g.fillStyle = `hsl(${(t += 6) % 360},70%,50%)`; g.fillRect(0, 0, 320, 180); g.fillStyle = '#fff'; g.fillRect(t % 300, 60, 20, 60); };
    const iv = setInterval(draw, 33); draw();
    const rec = new MediaRecorder(cv.captureStream(30), { mimeType: 'video/webm' });
    const chunks = []; rec.ondataavailable = e => chunks.push(e.data);
    const done = new Promise(r => rec.onstop = r);
    rec.start(); await new Promise(r => setTimeout(r, 1500)); rec.stop(); await done; clearInterval(iv);
    return [...new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer())];
  });
  await ctx.close();
  return Buffer.from(bytes);
})();
check(WEBM.length > 1000, `(recorded a ${WEBM.length}-byte playable test video)`);

const live = new Set();
async function open(who, { dark, width = 1280, height = 900 }) {
  const ctx = await b.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
  live.add(ctx);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  // Registered first, so the specific route below wins (Playwright: last registered first).
  await page.route(u => !u.href.startsWith(ORIGIN), r => r.abort());
  await page.route(u => /[?&]action=video(&|$)/.test(u.search), r => {
    const u = new URL(r.request().url());
    const cors = { 'Access-Control-Allow-Origin': ORIGIN, 'Access-Control-Allow-Credentials': 'true' };
    if (u.searchParams.get('size') === 'thumb') return r.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'image/png' }, body: PNG });
    return r.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'video/webm', 'Accept-Ranges': 'bytes' }, body: WEBM });
  });
  await page.addInitScript(mocks, { who, VIDEOS, DRAFTS, PHOTOS, dark });
  await page.goto(ORIGIN + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__calls?.includes('auth-me'), null, { timeout: 10000 });
  await page.waitForTimeout(800);
  await page.evaluate(() => window.navigateToPage('content'));
  await page.waitForTimeout(600);
  await page.evaluate(() => { document.getElementById('ct-store').value = 'BL2'; window.ctOnStoreChange(); });
  await page.waitForFunction(() => window.__calls.includes('marketing-videos'), null, { timeout: 10000 });
  await page.waitForTimeout(500);
  return { page, errs };
}
async function section(name, fn) {
  try { await fn(); }
  catch (e) { check(false, `${name}: stopped — ${String((e && e.message) || e).split('\n')[0]}`); }
  finally { for (const c of live) { try { await c.close(); } catch (e) {} } live.clear(); }
}
const shot = (page, name) => process.env.SHOTS ? page.screenshot({ path: path.join(process.env.SHOTS, name + '.png') }) : null;
const text = (page, sel) => page.evaluate(s => document.querySelector(s)?.textContent.replace(/\s+/g, ' ').trim() || '', sel);
const hidden = (page, sel) => page.evaluate(s => document.querySelector(s)?.classList.contains('hidden'), sel);
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
  await section(`video ${t}`, async () => {
    const { page, errs } = await open(ADMIN, { dark });
    check(await page.evaluate(() => document.documentElement.classList.contains('dark')) === dark, `[${t}] the .dark class matches the theme under test`);
    const tiles = await text(page, '#ct-video-pick');
    check(/Store walk/.test(tiles) && /3:10/.test(tiles) && /Clip/.test(tiles) && /0:45/.test(tiles), `[${t}] the store's videos are offered with type and length (${tiles.slice(0, 120)})`);

    // A photo post in progress, then a video: the cover and photos are cleared and hidden.
    await page.evaluate(() => { window.ctPickThumb(5); window.ctTogglePhoto(101); });
    await page.evaluate(() => window.ctPickVideo(11));
    await page.waitForFunction(() => window.__poster || /No preview frame/.test(document.getElementById('ct-video-status')?.textContent || ''), null, { timeout: 30000 });
    check(await hidden(page, '#ct-cover-section') && await hidden(page, '#ct-photos-section'), `[${t}] video mode hides the cover and photo pickers`);
    check(!(await hidden(page, '#ct-video-mode-note')), `[${t}] and says why`);
    check(/cleared/.test(await text(page, '#ct-compose-status')), `[${t}] and that the cover and photos were cleared`);
    const nr = await page.evaluate(RATIO, '#ct-video-mode-note');
    check(nr >= 4.5, `[${t}] the video-mode note clears AA (${nr}:1)`);

    // 🔑 The poster frame was taken here, from the playing video, and saved.
    const poster = await page.evaluate(() => window.__poster);
    check(poster && poster.id === '11' && poster.type === 'image/jpeg' && poster.size > 500, `[${t}] 🔑 a frame was grabbed in the browser and saved as the poster (${JSON.stringify(poster)})`);
    check(await page.evaluate(() => !!document.querySelector('#ct-video-pick [data-vid="11"] img')), `[${t}] and the tile now shows it`);
    check(/Store walk · 3:10 · posts as a Facebook video/.test(await text(page, '#ct-preview-foot')), `[${t}] the preview says what it posts as (${await text(page, '#ct-preview-foot')})`);
    check(/▶/.test(await text(page, '#ct-pv-carousel')), `[${t}] with a play mark`);
    await shot(page, `content-video-${t}`);

    // Save and AI: a video post, nothing else.
    await page.fill('#ct-caption', 'Walk the floor');
    await page.evaluate(() => window.ctSaveDraft());
    await page.waitForFunction(() => window.__saved, null, { timeout: 5000 });
    const saved = await page.evaluate(() => window.__saved);
    check(saved.video_id === 11 && saved.thumbnail_id === null && saved.photo_ids.length === 0, `[${t}] it saves as a video post only (${JSON.stringify({ v: saved.video_id, t: saved.thumbnail_id, p: saved.photo_ids })})`);
    await page.evaluate(() => window.ctPickVideo(12));
    await page.evaluate(() => window.ctAiCaption());
    await page.waitForFunction(() => window.__ai, null, { timeout: 5000 });
    check((await page.evaluate(() => window.__ai)).video_id === 12, `[${t}] the AI caption asks about the video`);
    check(/Clip · 0:45 · posts as a Reel/.test(await text(page, '#ct-preview-foot')), `[${t}] a clip posts as a Reel`);
    check(!(await page.evaluate(() => window.__calls.filter(c => c === 'video-poster').length > 1)), `[${t}] a video that has a poster is not re-grabbed`);

    // Unselect: back to a photo post.
    await page.evaluate(() => window.ctPickVideo(12));
    check(!(await hidden(page, '#ct-cover-section')) && !(await hidden(page, '#ct-photos-section')), `[${t}] unselecting the video brings the photo pickers back`);

    // The board's card for a video draft.
    await page.evaluate(() => window.ctSetTab('posts'));
    await page.waitForTimeout(300);
    const card = await text(page, '#ct-drafts');
    check(/South Bend · Clip 0:45 · Reel/.test(card), `[${t}] the board's card says Clip 0:45 · Reel (${card.slice(0, 100)})`);
    // Editing a draft whose video the picker doesn't list: shown, selected, removable.
    await page.evaluate(() => window.ctEditDraft(6));
    await page.waitForTimeout(500);
    check(await page.evaluate(() => !!document.querySelector('#ct-video-pick [data-vid="3"] .border-accent-green')), `[${t}] an unlisted video on an edited draft is shown, selected`);
    check(/Store walk · 3:20 · posts as a Facebook video/.test(await text(page, '#ct-preview-foot')), `[${t}] and previewed`);
    await page.evaluate(() => window.ctPickVideo(3));
    check(!(await hidden(page, '#ct-cover-section')), `[${t}] and it can be unselected (the photo pickers come back)`);
    check(errs.length === 0, `[${t}] no page errors (${errs.join(' | ').slice(0, 200)})`);
  });
}

await b.close(); srv.close();
let pass = 0, fail = 0;
for (const [c, m] of results) { if (c) pass++; else { fail++; console.log('  FAIL ' + m); } }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
