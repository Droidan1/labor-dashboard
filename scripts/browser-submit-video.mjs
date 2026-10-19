// Store videos on Submit Photos, driven in a REAL BROWSER (2026-10-19).
//
// 🛑 NOT PART OF `scripts/test.sh` — it needs playwright-core and a Chromium. Run by hand:
//
//   npm install --no-save playwright-core
//   bash scripts/build.sh && node scripts/browser-submit-video.mjs
//   (on a Mac: PLAYWRIGHT_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
//
// test-video-upload.mjs proves the worker's rules and parts. This proves the page:
// the two video choices, the checks a manager hears BEFORE a 300 MB upload (length,
// sideways/upright), the parts it actually sends (sizes, order, a retry after a dropped
// part, abort after a refusal), the store-walk bar, and that it all reads in both themes.
//
// The test videos are built here byte by byte: a real MP4 header (ftyp, mdat, then moov
// at the END as an iPhone writes it) whose moov claims a length and frame size, around
// data no browser can play. That forces the page's header-reading fallback — the path
// an Android phone takes for an iPhone's HEVC .mov — which is the one worth proving.
//
// 🛑 THE APP'S THEME IS A `.dark` CLASS FROM localStorage — set, then ASSERTED.
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

// ── MP4 bytes ──────────────────────────────────────────────────────────────
function box(type, ...parts) {
  const body = Buffer.concat(parts);
  const h = Buffer.alloc(8); h.writeUInt32BE(8 + body.length); h.write(type, 4, 'ascii');
  return Buffer.concat([h, body]);
}
function mvhd(durMs) { const b = Buffer.alloc(100); b.writeUInt32BE(1000, 12); b.writeUInt32BE(durMs, 16); return box('mvhd', b); }
function tkhd(w, h, turned) {
  const b = Buffer.alloc(84);
  const M = turned ? [0, 65536, 0, -65536, 0, 0, 0, 0, 0x40000000] : [65536, 0, 0, 0, 65536, 0, 0, 0, 0x40000000];
  M.forEach((v, i) => b.writeInt32BE(v, 40 + i * 4));
  b.writeUInt32BE(w * 65536, 76); b.writeUInt32BE(h * 65536, 80);
  return box('tkhd', b);
}
// Version-1 headers (64-bit times), as long recordings use: timescale 600.
function mvhd1(durMs) { const b = Buffer.alloc(112); b.writeUInt8(1, 0); b.writeUInt32BE(600, 20); b.writeUInt32BE(0, 24); b.writeUInt32BE(durMs * 600 / 1000, 28); return box('mvhd', b); }
function tkhd1(w, h, M) {
  const b = Buffer.alloc(96); b.writeUInt8(1, 0);
  M.forEach((v, i) => b.writeInt32BE(v, 52 + i * 4));
  b.writeUInt32BE(w * 65536, 88); b.writeUInt32BE(h * 65536, 92);
  return box('tkhd', b);
}
// A box with a 64-bit size (size field 1, then the real size), as a big mdat is written.
function box64(type, payload) {
  const h = Buffer.alloc(16); h.writeUInt32BE(1, 0); h.write(type, 4, 'ascii'); h.writeUInt32BE(0, 8); h.writeUInt32BE(16 + payload.length, 12);
  return Buffer.concat([h, payload]);
}
const ROT180 = [-65536, 0, 0, 0, -65536, 0, 0, 0, 0x40000000];
// An audio track first (no frame size), then the video track, as a phone writes them.
const mp4 = ({ durMs, w, h, turned = false, extra = 0 }) => Buffer.concat([
  box('ftyp', Buffer.from('qt  \0\0\0\0qt  ', 'binary')),
  box('mdat', Buffer.alloc(20000 + extra, 0x5a)),
  box('moov', mvhd(durMs), box('trak', tkhd(0, 0)), box('trak', tkhd(w, h, turned))),
]);
const FILES = {
  walk: { name: 'IMG_0420.MOV', mimeType: 'video/quicktime', buffer: mp4({ durMs: 192000, w: 1920, h: 1080 }) },
  walkUpright: { name: 'IMG_0421.MOV', mimeType: 'video/quicktime', buffer: mp4({ durMs: 192000, w: 1920, h: 1080, turned: true }) },
  walkShort: { name: 'IMG_0422.MOV', mimeType: 'video/quicktime', buffer: mp4({ durMs: 95000, w: 1920, h: 1080 }) },
  clip: { name: 'clip.mp4', mimeType: 'video/mp4', buffer: mp4({ durMs: 45000, w: 1080, h: 1920 }) },
  clipNoType: { name: 'VID_2026.mp4', mimeType: '', buffer: mp4({ durMs: 30000, w: 1080, h: 1920 }) },
  // v1 mvhd + tkhd, a 64-bit mdat, the camera held upside down (180°: still sideways), and
  // a bare 8-byte box closing the moov — each a shape the header reader must get through.
  walkV1: { name: 'IMG_0500.MOV', mimeType: 'video/quicktime', buffer: Buffer.concat([
    box('ftyp', Buffer.from('qt  \0\0\0\0qt  ', 'binary')),
    box64('mdat', Buffer.alloc(9000, 0x5a)),
    box('moov', mvhd1(200000), box('trak', tkhd1(1920, 1080, ROT180)), box('udta')),
  ]) },
};

function mocks({ who, dark, script }) {
  try {
    localStorage.setItem('darkMode', String(dark));
    localStorage.setItem('bioPromptDismissed', '1'); localStorage.setItem('coachTipsDisabled', '1');
  } catch (e) {}
  window.__calls = []; window.__start = null; window.__parts = []; window.__complete = null; window.__aborts = [];
  let failedOnce = false;
  const J = (x, status = 200) => new Response(JSON.stringify(x), { status, headers: { 'content-type': 'application/json' } });
  const targets = { ok: true, week: { start: '2026-10-11', end: '2026-10-17', due: new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10) },
    targets: { retail: 20, bins: 20, store_walk: 1 },
    stores: [{ store: 'BL1', label: 'Coliseum', retail: 4, bins: 21, store_walk: 0, people: 2 }, { store: 'BL4', label: 'Dupont', retail: 0, bins: 9, store_walk: 1, people: 1 }] };
  window.fetch = async (u, o = {}) => {
    const url = new URL(String(u), location.href), action = url.searchParams.get('action');
    window.__calls.push(action);
    switch (action) {
      case 'auth-me': return J(who);
      case 'photo-targets': return J(targets);
      case 'video-upload-start': {
        window.__start = JSON.parse(o.body);
        const pb = 4096;   // small parts, so a small test file still takes several
        return J({ ok: true, id: 77, part_bytes: pb, parts: Math.ceil(window.__start.bytes / pb) });
      }
      case 'video-upload-part': {
        if (o.method !== 'POST') return J({ error: 'the worker\u2019s CORS allows POST, not ' + o.method }, 405);
        const part = Number(url.searchParams.get('part'));
        if (script === 'retry' && part === 2 && !failedOnce) { failedOnce = true; return J({ error: 'upstream' }, 503); }
        if (script === 'refuse' && part === 2) return J({ error: 'Part 2 is 9 bytes; expected 4096' }, 400);
        window.__parts.push({ part, size: o.body.size });
        return J({ ok: true, part, etag: 'e' + part });
      }
      case 'video-upload-complete': {
        const f = o.body;
        window.__completeCalls = (window.__completeCalls || 0) + 1;
        if (window.__complete && script === 'completeLost') return J({ ok: true, id: 77, already: true });
        window.__complete = { id: f.get('id'), parts: JSON.parse(f.get('parts')), poster: !!f.get('poster') };
        targets.stores[0].store_walk = 1;
        // The worker finished it, but the answer never reaches the phone.
        if (script === 'completeLost') throw new TypeError('Failed to fetch');
        return J({ ok: true, id: 77 });
      }
      case 'video-upload-abort': window.__aborts.push(JSON.parse(o.body).id); return J({ ok: true });
      default: return J({ error: 'Forbidden' }, 403);
    }
  };
}

const b = await chromium.launch({ executablePath: CHROME });
const live = new Set();
async function open(who, { dark, script = null, width = 390, height = 844 }) {
  const ctx = await b.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
  live.add(ctx);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.route(u => !u.href.startsWith(ORIGIN), r => r.abort());
  await page.addInitScript(mocks, { who, dark, script });
  await page.goto(ORIGIN + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__calls?.includes('auth-me'), null, { timeout: 10000 });
  await page.waitForTimeout(800);
  await page.evaluate(() => window.navigateToPage('submit-photos'));
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
const pick = async (page, f) => { await page.setInputFiles('#sp-files', f); await page.waitForFunction(() => !document.getElementById('sp-video-card')?.textContent.includes('Reading'), null, { timeout: 15000 }); };
const chip = (page, label) => page.evaluate(l => [...document.querySelectorAll('#sp-type-chips button')].find(b => b.textContent.trim() === l)?.click(), label);
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

const MGR = { authenticated: true, email: 'mgr@bargainlane.com', name: 'Pat', role: 'manager', stores: ['BL1'], pages: {}, businesses: ['bl'] };
const ADMIN = { authenticated: true, email: 'a@b.com', name: 'Admin', role: 'admin', stores: null, pages: {}, businesses: ['bl'] };

for (const dark of [true, false]) {
  const t = dark ? 'dark' : 'light';

  // ── 1. A manager uploads a store walk, end to end ──────────────────────────
  await section(`walk ${t}`, async () => {
    const { page, errs } = await open(MGR, { dark, script: 'retry' });
    check(await page.evaluate(() => document.documentElement.classList.contains('dark')) === dark, `[${t}] the .dark class matches the theme under test`);
    const card = await text(page, '#sp-targets');
    check(/Store walk video\s*0 \/ 1/.test(card), `[${t}] the store-walk bar shows 0 / 1 (${card.slice(0, 160)})`);

    await chip(page, 'Store walk (video)');
    check(await page.evaluate(() => document.getElementById('sp-files').accept) === 'video/*', `[${t}] the picker takes videos`);
    check(await page.evaluate(() => document.getElementById('sp-files').multiple) === false, `[${t}] one video at a time`);
    check(await text(page, '#sp-files-label') === 'Video', `[${t}] the section reads Video`);
    check(/sideways.*at least 3 minutes.*1080p/.test(await text(page, '#sp-video-hint')), `[${t}] the hint says sideways, 3 minutes, 1080p`);
    const hr = await page.evaluate(RATIO, '#sp-video-hint');
    check(hr >= 4.5, `[${t}] the hint clears AA (${hr}:1)`);

    // Too short, then upright: each refused before any upload.
    await pick(page, FILES.walkShort);
    check(/at least 3:00; this one is 1:35/.test(await text(page, '#sp-video-error')), `[${t}] a 1:35 walk is refused on the phone`);
    check(await page.evaluate(() => document.getElementById('sp-submit').disabled), `[${t}] and Upload stays off`);
    const er = await page.evaluate(RATIO, '#sp-video-error');
    check(er >= 4.5, `[${t}] the refusal clears AA (${er}:1)`);
    await pick(page, FILES.walkUpright);
    check(/sideways/.test(await text(page, '#sp-video-error')), `[${t}] 🛑 an upright walk (rotated in its header) is refused: film it sideways`);
    await shot(page, `video-refused-${t}`);

    await pick(page, FILES.walk);
    check(!(await page.evaluate(() => !!document.getElementById('sp-video-error'))), `[${t}] a sideways 3:12 walk passes`);
    check(/3:12 · sideways/.test(await text(page, '#sp-video-card')), `[${t}] and the card says 3:12 · sideways (${await text(page, '#sp-video-card')})`);
    check(!(await page.evaluate(() => document.getElementById('sp-submit').disabled)), `[${t}] Upload is on`);
    check(await text(page, '#sp-submit') === 'Upload video', `[${t}] the button reads Upload video`);
    await page.fill('#sp-note', 'New furniture aisle');
    await page.click('#sp-submit');
    await page.waitForFunction(() => /sent to marketing/.test(document.getElementById('sp-status')?.textContent || ''), null, { timeout: 20000 });
    const st = await page.evaluate(() => window.__start);
    check(st && st.store === 'BL1' && st.video_type === 'store_walk' && st.content_type === 'video/quicktime'
      && st.duration_ms === 192000 && st.width === 1920 && st.height === 1080 && st.note === 'New furniture aisle'
      && st.bytes === FILES.walk.buffer.length, `[${t}] start carries what the phone read (${JSON.stringify(st)})`);
    const parts = await page.evaluate(() => window.__parts);
    const n = Math.ceil(FILES.walk.buffer.length / 4096);
    check(parts.length === n && parts.every((p, i) => p.part === i + 1), `[${t}] all ${n} parts, in order, once each (${parts.length})`);
    check(parts.slice(0, -1).every(p => p.size === 4096) && parts.at(-1).size === FILES.walk.buffer.length - (n - 1) * 4096,
      `[${t}] every part the agreed size, the last the remainder`);
    const done = await page.evaluate(() => window.__complete);
    check(done && done.id === '77' && done.parts.length === n && done.parts[1].etag === 'e2', `[${t}] complete names every part with its etag (part 2 after its retry)`);
    check(await page.evaluate(() => window.__calls.filter(c => c === 'video-upload-part').length) === n + 1, `[${t}] part 2 was retried once after the dropped request`);
    check((await page.evaluate(() => window.__aborts)).length === 0, `[${t}] nothing was aborted`);
    check(/✓ Store walk sent to marketing/.test(await text(page, '#sp-status')), `[${t}] the manager is told it arrived`);
    await page.waitForTimeout(300);
    check(/Store walk video\s*1 \/ 1 ✓/.test(await text(page, '#sp-targets')), `[${t}] and the bar moves to 1 / 1`);
    check(!(await page.evaluate(() => !!document.getElementById('sp-video-card'))), `[${t}] the picked video is cleared`);
    await shot(page, `video-sent-${t}`);
    check(errs.length === 0, `[${t}] no page errors (${errs.join(' | ').slice(0, 200)})`);
  });

  // ── 2. A short clip, a typeless Android file, and a refused part ──────────
  await section(`clip ${t}`, async () => {
    const { page, errs } = await open(MGR, { dark, script: 'refuse' });
    await chip(page, 'Short clip (video)');
    check(/upright.*90 seconds/.test(await text(page, '#sp-video-hint')), `[${t}] the clip hint says upright, 90 seconds`);
    await pick(page, FILES.walk);
    check(/at most 1:30/.test(await text(page, '#sp-video-error')), `[${t}] a 3:12 video is too long for a clip`);
    await chip(page, 'Store walk (video)');
    check(!(await page.evaluate(() => !!document.getElementById('sp-video-error'))), `[${t}] switching to Store walk re-judges the same file: it passes`);
    await chip(page, 'Short clip (video)');
    await pick(page, FILES.clipNoType);
    check(!(await page.evaluate(() => !!document.getElementById('sp-video-error'))), `[${t}] a video with no type but a .mp4 name is taken`);
    await page.click('#sp-submit');
    await page.waitForFunction(() => /refused|expected/.test(document.getElementById('sp-status')?.textContent || ''), null, { timeout: 15000 });
    check((await page.evaluate(() => window.__aborts)).join() === '77', `[${t}] 🛑 a refused part aborts the upload`);
    check(!(await page.evaluate(() => window.__complete)), `[${t}] and never completes it`);
    check((await page.evaluate(() => window.__start)).content_type === 'video/mp4', `[${t}] the typeless file was sent as video/mp4`);
    // Switching back to photos clears the video.
    await chip(page, 'Bins');
    check(!(await page.evaluate(() => !!document.getElementById('sp-video-card'))), `[${t}] choosing a photo type clears the video`);
    check(await page.evaluate(() => document.getElementById('sp-files').accept) === 'image/*' && await page.evaluate(() => document.getElementById('sp-files').multiple), `[${t}] and the picker takes photos again`);
    check(errs.length === 0, `[${t}] no page errors (${errs.join(' | ').slice(0, 200)})`);
  });

  // ── 2b. The finish answer is lost: retried, not aborted, and reported as sent ──
  await section(`lost finish ${t}`, async () => {
    const { page, errs } = await open(MGR, { dark, script: 'completeLost' });
    await chip(page, 'Store walk (video)');
    await pick(page, FILES.walkV1);
    check(!(await page.evaluate(() => !!document.getElementById('sp-video-error'))), `[${t}] a v1 / 64-bit / upside-down header reads as a sideways walk`);
    check(/3:20 · sideways/.test(await text(page, '#sp-video-card')), `[${t}] at 3:20 (${await text(page, '#sp-video-card')})`);
    await page.click('#sp-submit');
    await page.waitForFunction(() => /sent to marketing|could not/i.test(document.getElementById('sp-status')?.textContent || ''), null, { timeout: 20000 });
    check(/✓ Store walk sent to marketing/.test(await text(page, '#sp-status')), `[${t}] 🛑 a lost finish answer is retried and reported as sent (${await text(page, '#sp-status')})`);
    check(await page.evaluate(() => window.__completeCalls) === 2, `[${t}] after one retry`);
    check((await page.evaluate(() => window.__aborts)).length === 0, `[${t}] 🛑 and the stored video is never aborted`);
    check(errs.length === 0, `[${t}] no page errors (${errs.join(' | ').slice(0, 200)})`);
  });

  // ── 3. The admin's table and editor ──────────────────────────────────────
  await section(`admin ${t}`, async () => {
    const { page, errs } = await open(ADMIN, { dark, width: 1280, height: 900 });
    const tbl = await text(page, '#sp-targets');
    check(/Walk/.test(tbl) && /Coliseum.*0\/1.*Dupont.*1\/1/.test(tbl), `[${t}] the admin table has a Walk column (${tbl.slice(0, 200)})`);
    await page.evaluate(() => window.spToggleTargetEdit());
    check(await page.evaluate(() => document.getElementById('sp-tgt-walk')?.value) === '1', `[${t}] and the editor a store-walk field at 1`);
    check(errs.length === 0, `[${t}] no page errors`);
  });
}

await b.close(); srv.close();
let pass = 0, fail = 0;
for (const [c, m] of results) { if (c) pass++; else { fail++; console.log('  FAIL ' + m); } }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
