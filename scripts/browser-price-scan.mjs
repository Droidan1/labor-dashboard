// Price Scan — the live barcode camera, driven in a REAL BROWSER at phone width.
//
// 🛑 NOT PART OF `scripts/test.sh`, deliberately: the runner globs `test-*` and this needs
// playwright-core and a Chromium, neither of which is a repo dependency. Run it by hand
// after a change to the page:
//
//   npm install --no-save playwright-core
//   bash scripts/build.sh && node scripts/browser-price-scan.mjs
//
// 🔑 WHY IT EXISTS. merch-price-scan-8 (docs/code-review-2026-09-22.md): a phone takes
// 300-500 ms to open the camera, with nothing on screen, so people tap Scan again. The second
// tap opened a SECOND stream that no Stop ever reached — camera light on, lens held — and a
// stream that arrived after the page, the Reprint tab or a full-body mode was left ran on,
// hidden. Swipe-back to store detail skipped the stop entirely. scripts/test-price-scan.mjs
// executes the scanner against a fake camera, including the paths Chromium's fake device
// cannot produce (a rejecting or slow play(), a torch, a hung start, the native detector);
// this checks what a person meets, with a real stream.
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
    '  node scripts/browser-price-scan.mjs\n\n' +
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
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const PORT = 8093;
const srv = http.createServer((q, s) => {
  const f = path.join(root, q.url === '/' ? 'index.html' : q.url.split('?')[0]);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end('no'); }
  s.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(s);
});
await new Promise(r => srv.listen(PORT, r));

const results = [], measured = [];
const check = (c, m) => { results.push([!!c, m]); };

// ── colour ─────────────────────────────────────────────────────────────
const rgba = s => { const m = String(s).match(/[\d.]+/g) || []; return [+m[0], +m[1], +m[2], m[3] == null ? 1 : +m[3]]; };
const over = (top, base) => [0, 1, 2].map(i => top[i] * top[3] + base[i] * (1 - top[3])).concat(1);
const lum = c => { const f = c.slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// ── the fake worker, run inside the page ───────────────────────────────
// Everything the page asks is answered here and recorded. Nothing reaches the network.
function pageMocks({ who, theme, detector }) {
  try {
    localStorage.setItem('darkMode', String(theme !== 'light'));
    localStorage.setItem('darkFlavor', theme === 'oled' ? 'oled' : 'dark');
  } catch (e) {}
  const M = window.__ps = { calls: [], gumCalls: 0, gumDelay: 0, streams: [], reads: [], detects: 0 };
  // A stand-in for Android's native BarcodeDetector, which Chromium on Linux does not have.
  // Each call "reads" the next of M.reads in turn — [] reads nothing, ['X'] reads X every
  // frame, ['X', 'Y'] alternates — so a check can make reads only the native detector gets.
  if (detector) {
    window.BarcodeDetector = class {
      static async getSupportedFormats() { return ['ean_13', 'upc_a', 'upc_e']; }
      async detect() {
        M.detects++;
        return M.reads.length ? [{ rawValue: M.reads[(M.detects - 1) % M.reads.length], format: 'upc_a' }] : [];
      }
    };
  }
  // The camera: Chromium's fake device (see the launch flags), slowed to a phone's 300-500 ms
  // and recorded, so a check can say how many cameras were opened and whether each still runs.
  const md = navigator.mediaDevices;
  if (md && md.getUserMedia) {
    const gum = md.getUserMedia.bind(md);
    md.getUserMedia = async (c) => {
      M.gumCalls++;
      await new Promise(r => setTimeout(r, M.gumDelay));
      const s = await gum(c);
      M.streams.push(s);
      return s;
    };
  }
  const J = (x, st = 200) => new Response(JSON.stringify(x), { status: st, headers: { 'content-type': 'application/json' } });
  const API = 'https://api.retjghub.com/';
  const real = window.fetch;
  window.fetch = async (u, o = {}) => {
    const s = String(u && u.url ? u.url : u);
    if (!s.startsWith(API)) return real(u, o);
    const url = new URL(s), action = url.searchParams.get('action');
    let body = {}; try { body = o.body ? JSON.parse(o.body) : {}; } catch (e) {}
    M.calls.push({ action, url: s, body });
    switch (action) {
      case 'auth-me': return J(who);
      case 'sticker-template': return J({ ok: true, template: null, markImage: null });
      case 'sticker-history': return J({ ok: true, prints: [] });
      case 'merch-categories': return J({ ok: true, categories: [] });
      // 24 open buys for the Buy sheet: more than a phone shows, so its list must scroll.
      case 'ps-buy-list': return J({ ok: true, buys: Array.from({ length: 24 }, (_, i) => ({
        po: String(40300 + i * 11), label: ['Drinks', 'Kitchen', 'HBA', 'Toys Q4', 'Pet', 'Bedding'][i % 6],
        vendor: ['Returns lot', 'Wayfair returns', 'CVS closeouts'][i % 3], received_on: '2026-09-' + String(28 - (i % 20)).padStart(2, '0'),
        units: i % 5 ? 100 + i * 40 : null, labels: i * 17 })) });
      default: return J({ ok: false, error: 'not in this harness' }, 404);
    }
  };
}

// A fake camera, accepted without a prompt: the scanner's start/stop races need a real stream.
const b = await chromium.launch({ executablePath: CHROME,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
// One section = one scenario. A wait that times out is a FAILED check, recorded, and the run
// goes on — a crash would hide every check after it.
const live = new Set();
async function section(name, fn) {
  try { await fn(); }
  catch (e) { check(false, `${name}: stopped — ${String((e && e.message) || e).split('\n')[0]}`); }
  finally { for (const c of live) { try { await c.close(); } catch (e) {} } live.clear(); }
}
// A store manager: Price Scan is a manager page, and the Reprint tab is offered to them.
const MANAGER = { authenticated: true, email: 'alex@example.com', name: 'Alex M', role: 'manager', stores: ['BL1', 'BL4'], pages: {}, businesses: ['bl'] };

async function open({ who = MANAGER, theme = 'light', detector = false } = {}) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    deviceScaleFactor: 2, timezoneId: 'America/New_York', locale: 'en-US', serviceWorkers: 'block' });
  live.add(ctx);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  // 🛑 Every request that is not this server is refused, so nothing can reach production.
  await page.route(u => !u.href.startsWith(`http://127.0.0.1:${PORT}`), r => r.abort());
  await page.addInitScript(pageMocks, { who, theme, detector });
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.navigateToPage === 'function' && window.__ps.calls.some(c => c.action === 'auth-me'), null, { timeout: 10000 });
  await page.waitForTimeout(400);
  await page.addStyleTag({ content: '#error-banner,#swipe-label,#ptr-hint{display:none !important}' });
  await page.evaluate(() => window.navigateToPage('merch-scan'));
  await page.waitForFunction(() => !document.getElementById('page-merch-scan').classList.contains('hidden'), null, { timeout: 5000 });
  await page.waitForTimeout(400);
  const got = await page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light')
    + (document.documentElement.classList.contains('oled') ? '+oled' : ''));
  check(got === { light: 'light', dark: 'dark', oled: 'dark+oled' }[theme], `[${theme}] the app is ACTUALLY in ${theme} (${got})`);
  return { ctx, page, errs };
}
const settle = page => page.waitForTimeout(300);
const text = async (page, sel) => ((await page.textContent(sel)) || '').trim();

// ── 1. One camera, and none left running (merch-price-scan-8) ───────────
// Every check below waits for the camera to have been ASKED for, and for the stream to ARRIVE,
// before judging it; otherwise it would pass by never opening a camera at all.
await section('1. camera (merch-price-scan-8)', async () => {
  const { page, errs } = await open();
  const states = n0 => page.evaluate(n => window.__ps.streams.slice(n).map(s => s.getTracks()[0].readyState), n0);
  const count = () => page.evaluate(() => ({ gum: window.__ps.gumCalls, streams: window.__ps.streams.length }));
  const label = () => text(page, '#ps-barcode');
  const disabled = () => page.evaluate(() => document.getElementById('ps-barcode').disabled);
  const whenLive = () => page.waitForFunction(() => document.getElementById('ps-barcode').textContent === 'Stop', null, { timeout: 8000 });
  // Ends a scenario the way a person would find the page next: Scan goes live, Stop ends it.
  const freshScan = async (what) => {
    const n0 = (await count()).streams;
    await page.click('#ps-barcode'); await whenLive();
    const ok1 = (await states(n0)).join() === 'live';
    await page.click('#ps-barcode'); await page.waitForTimeout(150);
    check(ok1 && (await states(n0)).join() === 'ended' && (await label()) === 'Scan' && !(await disabled()),
          `...and the next Scan works as normal (${what})`);
  };
  await page.evaluate(() => { window.__ps.gumDelay = 500; });

  // A real double tap: the second lands on a disabled button (Playwright's click would WAIT
  // for it to be enabled, so the mouse is used directly).
  let c0 = await count();
  const bb = await page.locator('#ps-barcode').boundingBox();
  await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.waitForTimeout(80);
  const starting = { lbl: await label(), dis: await disabled() };
  check(starting.lbl === 'Starting…' && starting.dis, `the tap shows "Starting…" at once, and the button waits (${JSON.stringify(starting)})`);
  await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);   // the impatient second tap
  await whenLive();
  await page.waitForTimeout(800);                                      // a second camera would be here by now
  check((await states(c0.streams)).join() === 'live', `🛑 a double tap opens ONE camera (${JSON.stringify(await states(c0.streams))})`);
  await page.click('#ps-barcode'); await page.waitForTimeout(150);
  check((await states(c0.streams)).every(s => s === 'ended') && (await label()) === 'Scan', '...and Stop leaves none running');

  // The guard itself: a second call once the camera is being asked for.
  c0 = await count();
  await page.evaluate(() => { window.psBarcode(); setTimeout(() => window.psBarcode(), 150); });
  await whenLive(); await page.waitForTimeout(800);
  check((await count()).gum - c0.gum === 1, '🛑 a second call while the camera opens asks for no second camera');
  await page.click('#ps-barcode'); await page.waitForTimeout(150);

  // Every way off the camera — each taken while the camera is still opening.
  for (const [what, leave, back] of [
    ['leaving the page', p => p.evaluate(() => window.navigateToPage('dashboard')), p => p.evaluate(() => window.navigateToPage('merch-scan'))],
    ['the Reprint tab', p => p.click('#ps-tab-reprint'), p => p.click('#ps-tab-scan')],
    ['Manual mode', p => p.click('#ps-manual'), p => p.click('#ps-manual')],
    ['swipe-back to store detail', p => p.evaluate(() => window.showOnlyPage('store-detail')), p => p.evaluate(() => window.navigateToPage('merch-scan'))],
  ]) {
    c0 = await count();
    await page.evaluate(() => { window.__ps.gumDelay = 600; });
    await page.click('#ps-barcode');
    await page.waitForFunction(n => window.__ps.gumCalls > n, c0.gum, { timeout: 5000 });   // the camera is being opened
    await leave(page);
    await page.waitForFunction(n => window.__ps.streams.length > n, c0.streams, { timeout: 5000 });   // …and arrives late
    await page.waitForTimeout(200);
    check((await states(c0.streams)).join() === 'ended', `🛑 ${what} while the camera opens: the late stream is closed on arrival (${JSON.stringify(await states(c0.streams))})`);
    await back(page); await settle(page);
    await page.evaluate(() => { window.__ps.gumDelay = 0; });
    await freshScan(what);
  }

  // A scan already running: swipe-back used to skip the camera cleanup entirely.
  c0 = await count();
  await page.click('#ps-barcode'); await whenLive();
  await page.evaluate(() => window.showOnlyPage('store-detail'));
  await page.waitForTimeout(150);
  check((await states(c0.streams)).join() === 'ended', '🛑 a RUNNING scan ends on swipe-back to store detail too');
  await page.evaluate(() => window.navigateToPage('merch-scan')); await settle(page);
  await freshScan('after swipe-back');

  // A remembered lens that is gone used to fail every scan after it.
  await page.evaluate(() => { psLensId = 'no-such-camera'; });
  await page.click('#ps-barcode');
  // uiAlert's modal: the only dialog ON SCREEN (the page's other dialogs sit hidden in its
  // markup, and a role query skips hidden ones where `[role="dialog"]` would not).
  const dlg = page.getByRole('dialog');
  await dlg.waitFor({ state: 'visible', timeout: 5000 });
  check(/No camera available/.test((await dlg.textContent()) || '') && (await label()) === 'Scan' && !(await disabled()),
        'a camera that will not open says so, and gives the button back');
  await dlg.locator('button:has-text("OK")').click();
  await dlg.waitFor({ state: 'hidden', timeout: 5000 });
  await freshScan('the failed lens is forgotten');
  check(!errs.length, `no page errors — no uncaught "play() request was interrupted" (${errs.slice(0, 2).join(' | ')})`);
});

// ── 2. "Starting…", painted, in every theme ─────────────────────────────
// The start state reuses the page's own `.ps-btn:disabled` (opacity .5), as the MOS button and
// Look it up do. A disabled control is exempt from WCAG 1.4.3, so the number is REPORTED, not
// held to 4.5:1; the enabled button is held to it, which also proves the measurement.
for (const theme of ['light', 'dark', 'oled']) await section(`2. paint [${theme}]`, async () => {
  const { page, errs } = await open({ theme });
  // The group opacity composites the button — text and fill — over what is behind it.
  const paint = () => page.evaluate(() => {
    const n = document.getElementById('ps-barcode'), cs = getComputedStyle(n), chain = [];
    for (let p = n.parentElement; p; p = p.parentElement) {
      const bg = getComputedStyle(p).backgroundColor;
      chain.push(bg);
      const a = (bg.match(/[\d.]+/g) || [])[3];
      if (a == null || +a === 1) break;                  // opaque: nothing behind it shows
    }
    return { fg: cs.color, bg: cs.backgroundColor, opacity: +cs.opacity, chain, lbl: n.textContent, dis: n.disabled };
  });
  const painted = p => {
    let base = rgba(p.chain[p.chain.length - 1]);
    for (let i = p.chain.length - 2; i >= 0; i--) base = over(rgba(p.chain[i]), base);
    const f = rgba(p.fg), g = rgba(p.bg);
    return { r: ratio(over([f[0], f[1], f[2], f[3] * p.opacity], base), over([g[0], g[1], g[2], g[3] * p.opacity], base)),
             opaque: base[3] === 1 && rgba(p.chain[p.chain.length - 1])[3] === 1 };
  };
  const on = painted(await paint());
  check(on.opaque && on.r >= 4.5, `[${theme}] the enabled Scan button reads ${on.r.toFixed(2)}:1`);
  await page.evaluate(() => { window.__ps.gumDelay = 1500; });
  await page.click('#ps-barcode');
  await page.waitForTimeout(120);
  const p = await paint();
  check(p.lbl === 'Starting…' && p.dis, `[${theme}] "Starting…" is on screen while the camera opens (${JSON.stringify({ lbl: p.lbl, dis: p.dis })})`);
  const st = painted(p);
  measured.push(`${theme.padEnd(5)}  Scan ${on.r.toFixed(2)}:1   "Starting…" (disabled, opacity ${p.opacity}) ${st.r.toFixed(2)}:1`);
  await page.waitForFunction(() => document.getElementById('ps-barcode').textContent === 'Stop', null, { timeout: 8000 });
  await page.click('#ps-barcode'); await page.waitForTimeout(150);
  check(!errs.length, `[${theme}] no page errors (${errs.slice(0, 2).join(' | ')})`);
});

// ── 3. Android's native detector confirms a read on its own ─────────────
// On Android the scan loop asks the native detector first, then always runs our own row
// decoder. A frame where our decoder missed used to reset "twice running" even when the
// detector had read the code — so a code only the detector could read (at an angle, in
// shadow, a little out of focus) was never accepted.
await section('3. native detector (Android)', async () => {
  const { page, errs } = await open({ detector: true });
  const X = '036000291452', Y = '012345678905';
  const lookups = () => page.evaluate(() => window.__ps.calls.filter(c => c.action === 'merch-scan').map(c => c.body.identifier));
  const label = () => text(page, '#ps-barcode');
  const whenLive = () => page.waitForFunction(() => document.getElementById('ps-barcode').textContent === 'Stop', null, { timeout: 8000 });
  const detects = () => page.evaluate(() => window.__ps.detects);

  // The control: nothing for the detector to read. Our own decoder finds no barcode in the fake
  // camera's picture either, so whatever is accepted below was read by the detector alone.
  await page.evaluate(() => { window.__ps.reads = []; });
  let d0 = await detects();
  await page.click('#ps-barcode'); await whenLive();
  await page.waitForTimeout(1500);
  const ran = (await detects()) - d0;
  check(ran > 5 && (await label()) === 'Stop' && !(await lookups()).length,
        `(control) with nothing to read, the scan keeps looking and looks nothing up — the detector ran ${ran} times`);
  await page.click('#ps-barcode'); await page.waitForTimeout(150);

  // Two different codes, alternating: never the same code twice running.
  await page.evaluate(([x, y]) => { window.__ps.reads = [x, y]; }, [X, Y]);
  d0 = await detects();
  await page.click('#ps-barcode'); await whenLive();
  await page.waitForTimeout(1500);
  check((await detects()) - d0 > 5 && (await label()) === 'Stop' && !(await lookups()).length,
        'two different codes on alternating frames are never accepted — a wrong read cannot sneak through');
  await page.click('#ps-barcode'); await page.waitForTimeout(150);

  // A steady read the detector alone makes: accepted, the camera stops, and it is looked up.
  const n0 = await page.evaluate(() => window.__ps.streams.length);
  await page.evaluate((x) => { window.__ps.reads = [x]; }, X);
  await page.click('#ps-barcode'); await whenLive();
  const took = await page.waitForFunction(() => window.__ps.calls.some(c => c.action === 'merch-scan'), null, { timeout: 4000 })
    .then(() => true, () => false);
  const st = await page.evaluate(n => window.__ps.streams.slice(n).map(s => s.getTracks()[0].readyState), n0);
  check(took && (await lookups()).join() === X && (await page.inputValue('#ps-input')) === X
        && st.join() === 'ended' && (await label()) === 'Scan',
        `🛑 a code only the native detector reads is accepted on its second frame: looked up, and the camera stops (${JSON.stringify({ took, lookups: await lookups(), st })})`);
  check(!errs.length, `no page errors (${errs.slice(0, 2).join(' | ')})`);
});

// ── 4. Backgrounding the app stops the camera (merch-price-scan-20) ─────
// Switching apps or tabs hides the page without leaving it, so no page switch stops the
// camera; the scan loop's own 30 s stop rides requestAnimationFrame, which browsers pause for
// a hidden page. So the camera and its light stayed on for as long as the app sat in the
// background. Headless Chromium keeps every page visible (minimising, a second tab and
// dropping Playwright's anti-backgrounding flags were all tried), so this does what the
// browser does: it sets document.hidden and dispatches the event.
const setHidden = (page, hidden) => page.evaluate(h => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
  document.dispatchEvent(new Event('visibilitychange'));
}, hidden);
const BG = /stopped while the app was in the background/;
for (const theme of ['light', 'dark', 'oled']) await section(`4. background [${theme}] (merch-price-scan-20)`, async () => {
  const { page, errs } = await open({ theme });
  const states = n0 => page.evaluate(n => window.__ps.streams.slice(n).map(s => s.getTracks()[0].readyState), n0);
  const count = () => page.evaluate(() => ({ gum: window.__ps.gumCalls, streams: window.__ps.streams.length }));
  const label = () => text(page, '#ps-barcode');
  const status = () => text(page, '#ps-status');
  const whenLive = () => page.waitForFunction(() => document.getElementById('ps-barcode').textContent === 'Stop', null, { timeout: 8000 });

  // A running scan.
  let c0 = await count();
  await page.click('#ps-barcode'); await whenLive();
  await setHidden(page, true); await page.waitForTimeout(200);
  check((await states(c0.streams)).join() === 'ended' && (await label()) === 'Scan' && BG.test(await status()),
        `🛑 [${theme}] a running scan stops when the app goes to the background, and says why (${JSON.stringify({ st: await states(c0.streams), status: await status() })})`);
  // The message is text on the page itself, so it is held to 4.5:1 against what is behind it.
  const paint = await page.evaluate(() => {
    const n = document.getElementById('ps-status'), chain = [];
    for (let p = n; p; p = p.parentElement) {
      const bg = getComputedStyle(p).backgroundColor; chain.push(bg);
      const a = (bg.match(/[\d.]+/g) || [])[3];
      if (a == null || +a === 1) break;
    }
    return { fg: getComputedStyle(n).color, chain };
  });
  let base = rgba(paint.chain[paint.chain.length - 1]);
  for (let i = paint.chain.length - 2; i >= 0; i--) base = over(rgba(paint.chain[i]), base);
  const pr = ratio(over(rgba(paint.fg), base), base);
  check(rgba(paint.chain[paint.chain.length - 1])[3] === 1 && pr >= 4.5, `[${theme}] the background message reads ${pr.toFixed(2)}:1`);
  measured.push(`${theme.padEnd(5)}  background message ${pr.toFixed(2)}:1`);
  await setHidden(page, false); await page.waitForTimeout(600);
  check((await count()).gum === c0.gum + 1 && (await label()) === 'Scan',
        `[${theme}] coming back does not turn the camera back on`);

  // A scan still opening when the app goes to the background.
  c0 = await count();
  await page.evaluate(() => { window.__ps.gumDelay = 600; });
  await page.click('#ps-barcode');
  await page.waitForFunction(n => window.__ps.gumCalls > n, c0.gum, { timeout: 5000 });
  await setHidden(page, true);
  await page.waitForFunction(n => window.__ps.streams.length > n, c0.streams, { timeout: 5000 });
  await page.waitForTimeout(200);
  check((await states(c0.streams)).join() === 'ended' && (await label()) === 'Scan',
        `🛑 [${theme}] a scan still opening when the app goes to the background: the late camera is closed on arrival`);
  await setHidden(page, false);
  await page.evaluate(() => { window.__ps.gumDelay = 0; });

  // No scan: going to the background leaves the page alone.
  await page.evaluate(() => { document.getElementById('ps-status').textContent = ''; });
  await setHidden(page, true); await page.waitForTimeout(150);
  check((await status()) === '' && (await label()) === 'Scan', `[${theme}] with no scan, going to the background changes nothing`);
  await setHidden(page, false);

  // And the next Scan works as normal.
  c0 = await count();
  await page.click('#ps-barcode'); await whenLive();
  const ok1 = (await states(c0.streams)).join() === 'live';
  await page.click('#ps-barcode'); await page.waitForTimeout(150);
  check(ok1 && (await states(c0.streams)).join() === 'ended', `[${theme}] ...and the next Scan works as normal`);
  check(!errs.length, `[${theme}] no page errors (${errs.slice(0, 2).join(' | ')})`);
});

// ── 5. Printer tools, top right, painted in every theme (2026-10-01) ────
// Calibrate printer and the printer choice left the scan bar for one menu at the top right of
// the page. It opens over the scan card, so each item is asked what is actually ON TOP at its
// centre, and each line of text what it reads against what is painted behind it.
for (const theme of ['light', 'dark', 'oled']) await section(`5. printer tools [${theme}]`, async () => {
  const { page, errs } = await open({ theme });
  const box = sel => page.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect();
    return { l: r.left, t: r.top, r: r.right, b: r.bottom }; }, sel);
  const open_ = () => page.evaluate(() => document.getElementById('ps-tools-menu').style.display !== 'none');
  const btn = await box('#ps-tools-btn'), h1 = await box('#ps-wrap h1'), card = await box('#ps-card');
  check(btn.r > 390 - 16 - 2 && btn.b <= card.t && Math.abs(btn.t - h1.t) < 12,
        `[${theme}] Printer tools sits top right, beside the title, above the scan card (${JSON.stringify({ btn, h1: h1.t, card: card.t })})`);
  check(btn.b - btn.t >= 40, `[${theme}] …a 40 px tap target (${btn.b - btn.t})`);
  check(!(await open_()), `[${theme}] …closed until it is opened`);
  await page.click('#ps-tools-btn');
  const menu = await box('#ps-tools-menu');
  check(await open_() && menu.l >= 0 && menu.r <= 390, `[${theme}] it opens inside the phone's width (${JSON.stringify(menu)})`);
  const onTop = await page.evaluate(() => ['ps-calibrate', 'ps-printer'].every(id => {
    const r = document.getElementById(id).getBoundingClientRect();
    return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('#' + id);
  }));
  check(onTop, `[${theme}] 🛑 both items are on top where they are drawn, not under the scan card`);
  // What each line reads: its colour over every background behind it, down to the first opaque one.
  const paintOf = sel => page.evaluate(s => {
    const n = document.querySelector(s), chain = [];
    for (let p = n; p; p = p.parentElement) {
      const bg = getComputedStyle(p).backgroundColor;
      chain.push(bg);
      const a = (bg.match(/[\d.]+/g) || [])[3];
      if (a == null || +a === 1) break;
    }
    return { fg: getComputedStyle(n).color, chain };
  }, sel);
  const reads = [];
  for (const [what, sel] of [['Printer tools', '#ps-tools-btn'], ['Calibrate printer', '#ps-calibrate b'],
                             ['its hint', '#ps-calibrate span'], ['Not set on this PC', '#ps-printer-now']]) {
    const p = await paintOf(sel);
    let base = rgba(p.chain[p.chain.length - 1]);
    for (let i = p.chain.length - 2; i >= 0; i--) base = over(rgba(p.chain[i]), base);
    const r = ratio(over(rgba(p.fg), base), base);
    check(rgba(p.chain[p.chain.length - 1])[3] === 1 && r >= 4.5, `[${theme}] "${what}" reads ${r.toFixed(2)}:1`);
    reads.push(`${what} ${r.toFixed(2)}:1`);
  }
  measured.push(`${theme.padEnd(5)}  ${reads.join('   ')}`);
  await page.click('#ps-wrap h1');
  check(!(await open_()), `[${theme}] a tap anywhere else closes it`);
  await page.click('#ps-tools-btn');
  await page.keyboard.press('Escape');
  check(!(await open_()) && (await page.getAttribute('#ps-tools-btn', 'aria-expanded')) === 'false', `[${theme}] …and so does Escape`);
  check(!errs.length, `[${theme}] no page errors (${errs.slice(0, 2).join(' | ')})`);
});

// ── 6. The Buy sheet and its banner, on a phone, painted in every theme (2026-10-01) ──
// The sheet replaced a row of chips that would not hold many buys. It is a bottom sheet over
// the page, its list scrolls inside it, and every line of it — and of the banner a pick
// leaves behind — is measured against what is actually painted under it.
const readsAt = (page, sel) => page.evaluate(s => {
  const n = document.querySelector(s), chain = [];
  for (let p = n; p; p = p.parentElement) {
    const bg = getComputedStyle(p).backgroundColor;
    chain.push(bg);
    const a = (bg.match(/[\d.]+/g) || [])[3];
    if (a == null || +a === 1) break;
  }
  return { fg: getComputedStyle(n).color, chain };
}, sel).then(p => {
  let base = rgba(p.chain[p.chain.length - 1]);
  for (let i = p.chain.length - 2; i >= 0; i--) base = over(rgba(p.chain[i]), base);
  return { r: ratio(over(rgba(p.fg), base), base), opaque: rgba(p.chain[p.chain.length - 1])[3] === 1 };
});
for (const theme of ['light', 'dark', 'oled']) await section(`6. buy sheet [${theme}]`, async () => {
  const { page, errs } = await open({ theme });
  await page.click('#ps-ob');
  await page.waitForSelector('#ps-ob-sheet [data-po]', { timeout: 5000 });
  const box = await page.evaluate(() => { const r = document.querySelector('#ps-ob-sheet .ps-obs-box').getBoundingClientRect();
    return { l: r.left, r: r.right, t: r.top, b: r.bottom }; });
  check(Math.abs(box.b - 844) < 2 && box.l >= 0 && box.r <= 390 && box.t >= 844 * 0.13,
        `[${theme}] a bottom sheet that fits the phone (${JSON.stringify(box)})`);
  const sc = await page.evaluate(() => { const l = document.getElementById('ps-obs-list'); return { sh: l.scrollHeight, ch: l.clientHeight }; });
  check(sc.sh > sc.ch && sc.ch > 200, `[${theme}] 24 buys scroll inside the sheet (${sc.sh} > ${sc.ch})`);
  const onTop = await page.evaluate(() => { const r = document.querySelector('#ps-ob-sheet [data-po]').getBoundingClientRect();
    return !!document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('[data-po]'); });
  check(onTop, `[${theme}] a row is on top where it is drawn`);
  // …and so is its BOTTOM edge, where the phone's floating bar sits: a sheet below the bar's
  // stacking order would lose its last rows and its Stop button under it.
  const bottomOnTop = await page.evaluate(b => !!document.elementFromPoint(195, b - 24)?.closest('#ps-ob-sheet'), box.b);
  check(bottomOnTop, `[${theme}] the sheet's bottom edge is above the phone bar, not under it`);
  const reads = [];
  for (const [what, sel] of [['title', '#ps-obs-title'], ['group', '#ps-ob-sheet .ps-obs-g'], ['PO', '#ps-ob-sheet [data-po] b'],
                             ['detail', '#ps-ob-sheet [data-po] .ps-obs-sub'], ['count', '#ps-ob-sheet [data-po] .ps-obs-n']]) {
    const x = await readsAt(page, sel);
    check(x.opaque && x.r >= 4.5, `[${theme}] the sheet's ${what} reads ${x.r.toFixed(2)}:1`);
    reads.push(`${what} ${x.r.toFixed(2)}`);
  }
  await page.fill('#ps-obs-q', 'HBA');
  const hits = await page.$$eval('#ps-ob-sheet [data-po]', r => r.length);
  check(hits === 4, `[${theme}] search narrows the list (${hits} HBA buys)`);
  const po = await page.$eval('#ps-ob-sheet [data-po]', r => r.dataset.po);
  await page.click(`#ps-ob-sheet [data-po="${po}"]`);
  for (const [what, sel] of [['banner label', '#ps-ob-bar .ps-ob-k'], ['banner name', '#ps-ob-bar .ps-ob-name'],
                             ['banner detail', '#ps-ob-bar .ps-ob-meta'], ['Change', '#ps-ob-bar .ps-link']]) {
    const x = await readsAt(page, sel);
    check(x.opaque && x.r >= 4.5, `[${theme}] the ${what} reads ${x.r.toFixed(2)}:1`);
    reads.push(`${what} ${x.r.toFixed(2)}`);
  }
  await page.click('#ps-ob');
  await page.waitForSelector('#ps-ob-sheet .ps-obs-row.on', { timeout: 5000 });
  const cur = await readsAt(page, '#ps-ob-sheet .ps-obs-row.on .ps-obs-sub');
  check(cur.opaque && cur.r >= 4.5, `[${theme}] "pricing into it now" reads ${cur.r.toFixed(2)}:1`);
  reads.push(`now ${cur.r.toFixed(2)}`);
  measured.push(`${theme.padEnd(5)}  ${reads.join('  ')}`);
  await page.mouse.click(195, 30);
  check(!(await page.$('#ps-ob-sheet')) && /PO /.test(await page.textContent('#ps-ob-bar')),
        `[${theme}] a tap on the page behind cancels, keeping the buy`);
  check(!errs.length, `[${theme}] no page errors (${errs.slice(0, 2).join(' | ')})`);
});

await b.close();
srv.close();
if (measured.length) console.log('Painted contrast:\n  ' + measured.join('\n  '));
const bad = results.filter(r => !r[0]);
for (const [okk, m] of results) if (!okk) console.log('  FAIL ' + m);
console.log(`\n${results.length - bad.length} passed, ${bad.length} failed`);
process.exit(bad.length ? 1 : 0);
