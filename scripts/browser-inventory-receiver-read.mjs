// Inventory Receiver's photo reads — driven in a REAL BROWSER at phone width.
//
// 🛑 NOT PART OF `scripts/test.sh`, deliberately: the runner globs `test-*` and this needs
// playwright-core and a Chromium, neither of which is a repo dependency. Run it by hand
// after a change to the page:
//
//   npm install --no-save playwright-core
//   bash scripts/build.sh && node scripts/browser-inventory-receiver-read.mjs
//
// 🔑 WHY IT EXISTS. The Receiver reads a Bill of Lading and a pallet tag through irPhoto, which
// reuses Bin Dump's reader and had the three bugs #280 fixed there (bin-dump-4, -13, -14): a
// dismissed camera lost the form, an undecodable photo showed and uploaded the previous one, and
// a read could hang with no way out. It also had one of its own, found in design review: a read
// still running landed in whatever was started meanwhile — worst, over a row being corrected.
// scripts/test-inventory-receiver.mjs executes irPhoto over fakes; this is the half that needs a
// DOM, a file chooser, a clock and paint. Modelled on scripts/browser-bin-dump.mjs.
//
// 🛑 THE APP'S THEME IS localStorage, NOT prefers-color-scheme (see browser-inventory-receiver):
// `darkMode` + `darkFlavor=oled` are written before boot, and the class is asserted.
let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch (e) {
  console.error(
    '\nThis check needs playwright-core, which is not a dependency of this repo.\n\n' +
    '  npm install --no-save playwright-core\n' +
    '  bash scripts/build.sh\n' +
    '  node scripts/browser-inventory-receiver-read.mjs\n\n' +
    'A Chromium is also needed: /opt/pw-browsers/chromium, or PLAYWRIGHT_CHROMIUM.\n');
  process.exit(2);
}
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium';
const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const root = path.join(repo, 'dist');
if (!fs.existsSync(path.join(root, 'index.html'))) { console.error('No dist/ — run bash scripts/build.sh first.'); process.exit(2); }
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
// Overridable so that copies of the repo can run this side by side (mutation runs).
const PORT = Number(process.env.IR_READ_PORT) || 8100;
const srv = http.createServer((q, s) => {
  const f = path.join(root, q.url === '/' ? 'index.html' : q.url.split('?')[0]);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end('no'); }
  s.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(s);
});
await new Promise(r => srv.listen(PORT, r));

// A real image stands in for the photo (psShrink decodes it); a text file named .jpg is the
// photo that will not decode.
const PHOTO = path.join(repo, 'icon-192.png');
const BROKEN = path.join(os.tmpdir(), `ir-read-broken-${PORT}.jpg`);
fs.writeFileSync(BROKEN, 'this is not an image');

const results = [], measured = [];
const check = (c, m) => { results.push([!!c, m]); };

// ── colour ─────────────────────────────────────────────────────────────
const rgba = s => { const m = String(s).match(/[\d.]+/g) || []; return [+m[0], +m[1], +m[2], m[3] == null ? 1 : +m[3]]; };
const over = (top, base) => [0, 1, 2].map(i => top[i] * top[3] + base[i] * (1 - top[3])).concat(1);
const lum = c => { const f = c.slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// ── fixtures ───────────────────────────────────────────────────────────
// The truck on the dock (open), and a truck that has come down with forty pallets on it, so
// its read-back is long enough to scroll a manager away from the "Reading tag…" line.
const TRUCK = { id: 1, store: 'BL1', bol_no: '7679', ship_from: 'RM1', ship_from_addr: '1450 Atlantic Ave, Rocky Mount NC 27801',
  ship_to: 'BL1', carrier: 'Arrive Logistics', trailer_no: '19353', seal_no: '4949941', pallet_count: 40,
  opened_by: 'Kevin R', opened_at: '2026-09-15T11:04:00Z', closed_at: null, month: '2026-09' };
const DOCK_PALLETS = [
  { id: 9, barcode: 'P-082626-725979', pallet_name: 'FG BL CONSUMABLES - FOOD - SNACKS', item_no: '50007', po: '14373', sup_ref: 'mix', units: 362, created_by_tag: 'Oo Aung', logged_at: '2026-09-15T12:16:00Z', dup_approved_by: null },
  { id: 8, barcode: 'PRM-10490-30', pallet_name: 'PALLET AMAZON IND8', item_no: '50201', po: '5036', sup_ref: null, units: 1, created_by_tag: 'Ranon Price', logged_at: '2026-09-15T11:54:00Z', dup_approved_by: null },
];
const CLOSED = { ...TRUCK, id: 2, bol_no: '7644', opened_by: 'Oo Aung', opened_at: '2026-08-11T10:48:00Z',
  closed_at: '2026-08-11T17:22:00Z', closed_by: 'Kevin R', month: '2026-08', close_note: null };
const PALLETS = Array.from({ length: 40 }, (_, i) => ({ id: 100 + i, barcode: `P-0811-${100 + i}`,
  pallet_name: 'FG BL CONSUMABLES - FOOD - SNACKS', item_no: '50007', po: '14373', sup_ref: 'mix', units: 10 + i,
  created_by_tag: 'Oo Aung', logged_at: '2026-08-11T12:16:00Z', dup_approved_by: null }));

// ── the fake worker, run inside the page ───────────────────────────────
// Everything the page asks is answered here, and recorded, so a check can say what was POSTED
// and not only what was drawn. Nothing reaches the network.
function pageMocks({ who, theme, TRUCK, DOCK_PALLETS, CLOSED, PALLETS }) {
  try {
    localStorage.setItem('darkMode', String(theme !== 'light'));
    localStorage.setItem('darkFlavor', theme === 'oled' ? 'oled' : 'dark');
  } catch (e) {}
  const M = window.__ir = {
    calls: [], aborts: 0,
    scanDelay: 0, scanHang: false, scanIgnoresAbort: false, scanBodyHang: false, scanEmpty: false,
    openDelay: 0, openFail: false,
    truck: null,                                    // what truck-current reports on the dock
    shrinkArgs: [], decoded: 0, shrinkDelay: 0,      // see the psShrink wrapper in open()
    bol: { bol_no: '7702', ship_from: 'RM1', ship_from_addr: null, ship_to: 'BL1', bol_date: '9/28/2026',
           carrier: 'Arrive Logistics', trailer_no: '20411', seal_no: '5050052', pro_no: null, pallet_count: 38 },
    tag: { barcode: 'PRM-99999-1', pallet_name: 'PALLET MISSED', item_no: '50999', po: '7001', sup_ref: null,
           units: 41, created_by_tag: 'Dana F', truck_no: '99999' },
  };
  const J = (x, st = 200) => new Response(JSON.stringify(x), { status: st, headers: { 'content-type': 'application/json' } });
  const wait = (ms, sig) => new Promise((res, rej) => {
    const t = ms === Infinity ? null : setTimeout(res, ms);
    if (sig) sig.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('Aborted', 'AbortError')); });
  });
  const API = 'https://api.retjghub.com/';
  const real = window.fetch;
  window.fetch = async (u, o = {}) => {
    const s = String(u && u.url ? u.url : u);
    if (!s.startsWith(API)) return real(u, o);
    const url = new URL(s), action = url.searchParams.get('action');
    let body = {}; try { body = o.body ? JSON.parse(o.body) : {}; } catch (e) {}
    M.calls.push({ action, url: s, body });
    // Counted whether or not the answer below honours it: "Cancel aborts" is about the page.
    if (o.signal) o.signal.addEventListener('abort', () => { M.aborts++; });
    switch (action) {
      case 'auth-me': return J(who);
      case 'truck-current': return J({ ok: true, truck: M.truck, pallets: M.truck ? DOCK_PALLETS : [] });
      case 'truck-list': return J({ ok: true, rows: [{ ...CLOSED, received: PALLETS.length, units: 1180, dup_approved: 0 }], truncated: false });
      case 'truck-detail': return J({ ok: true, truck: CLOSED, pallets: PALLETS });
      case 'truck-bol-scan':
      case 'truck-pallet-scan': {
        const fields = action === 'truck-bol-scan' ? M.bol : M.tag;
        if (M.scanBodyHang) {
          // The headers arrive; the body never does. An abort then errors the stream mid-download,
          // and irPost's `r.json().catch(() => ({}))` turns that into `{}`, not an error.
          const sig = o.signal;
          return new Response(new ReadableStream({ start(c) {
            if (sig) sig.addEventListener('abort', () => c.error(new DOMException('Aborted', 'AbortError')));
          } }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        // scanIgnoresAbort: the answer lands anyway, late — how a read that was already past the
        // point of no return comes back. The generation number must ignore it.
        await wait(M.scanHang ? Infinity : M.scanDelay, M.scanIgnoresAbort ? null : o.signal);
        if (M.scanEmpty) return J({});
        return J({ ok: true, fields, read: Object.values(fields).filter(v => v != null).length, of: Object.keys(fields).length });
      }
      case 'truck-open':
        await wait(M.openDelay);
        return M.openFail ? J({ error: 'The worker refused it' }, 400) : J({ ok: true, id: 3 });
      case 'truck-pallet-log': return J({ ok: true, id: 77 });
      case 'truck-pallet-update': return J({ ok: true });
      default: return J({ ok: false, error: 'not in this harness' }, 404);
    }
  };
}

const b = await chromium.launch({ executablePath: CHROME });
// One section = one scenario. A wait that times out is a FAILED check, recorded, and the run
// goes on — a crash would hide every check after it.
const live = new Set();
async function section(name, fn) {
  try { await fn(); }
  catch (e) { check(false, `${name}: stopped — ${String((e && e.message) || e).split('\n')[0]}`); }
  finally { for (const c of live) { try { await c.close(); } catch (e) {} } live.clear(); }
}
const MANAGER = { authenticated: true, email: 'kevin@example.com', name: 'Kevin R', role: 'manager', stores: ['BL1', 'BL4'], pages: {}, businesses: ['bl'] };

async function open({ theme = 'light', clock = false } = {}) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    deviceScaleFactor: 2, timezoneId: 'America/New_York', locale: 'en-US', serviceWorkers: 'block' });
  live.add(ctx);
  const page = await ctx.newPage();
  page.setDefaultTimeout(5000);
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  // 🛑 Every request that is not this server is refused here, so nothing can reach the
  // production worker even if the fetch stub misses one.
  await page.route(u => !u.href.startsWith(`http://127.0.0.1:${PORT}`), r => r.abort());
  if (clock) await page.clock.install();
  await page.addInitScript(pageMocks, { who: MANAGER, theme, TRUCK, DOCK_PALLETS, CLOSED, PALLETS });
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.navigateToPage === 'function' && window.__ir.calls.some(c => c.action === 'auth-me'), null, { timeout: 10000 });
  await page.waitForTimeout(400);
  await page.addStyleTag({ content: '#error-banner,#swipe-label,#ptr-hint{display:none !important}' });
  await page.evaluate(() => window.navigateToPage('inventory-receiver'));
  await page.waitForFunction(() => !document.getElementById('page-inventory-receiver').classList.contains('hidden'), null, { timeout: 5000 });
  await page.waitForTimeout(400);
  const got = await page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light')
    + (document.documentElement.classList.contains('oled') ? '+oled' : ''));
  check(got === { light: 'light', dark: 'dark', oled: 'dark+oled' }[theme], `[${theme}] the app is ACTUALLY in ${theme} (${got})`);
  // The decode, instrumented: its arguments are recorded, and it can be made slow AFTER the
  // real decode has finished — a Cancel or a clock then lands at a known point. 🛑 Installed
  // here, after boot: an init script would be overwritten by the page's own declaration.
  await page.evaluate(() => {
    const M = window.__ir, real = window.psShrink;
    window.psShrink = async (...a) => {
      M.shrinkArgs.push(a.slice(1));
      const out = await real(...a);
      M.decoded++;
      if (M.shrinkDelay) await new Promise(r => setTimeout(r, M.shrinkDelay));
      return out;
    };
  });
  return { ctx, page, errs };
}
const set = (page, patch) => page.evaluate(p => Object.assign(window.__ir, p), patch);
const get = (page, k) => page.evaluate(key => window.__ir[key], k);
const calls = (page, action) => page.evaluate(a => window.__ir.calls.filter(c => c.action === a), action);
const settle = page => page.waitForTimeout(350);
const modalOpen = page => page.evaluate(() => document.getElementById('ir-modal').style.display === 'flex');
const title = page => page.evaluate(() => document.getElementById('ir-m-title').textContent.trim());
const warnText = page => page.evaluate(() => { const w = document.getElementById('ir-m-warn'); return w.hidden ? '' : w.textContent; });
const waitModal = (page, re) => page.waitForFunction(r => document.getElementById('ir-modal').style.display === 'flex'
  && (!r || new RegExp(r).test(document.getElementById('ir-m-title').textContent)), re ? re.source : null, { timeout: 8000 });
const closeForm = async page => { await page.click('#ir-modal button:text-is("Cancel")'); await settle(page); };
// An id, else a button's words. Never the body's text: that is the whole app.
const focused = page => page.evaluate(() => { const a = document.activeElement;
  return !a || a === document.body ? 'body' : (a.id || a.textContent.trim().slice(0, 40)); });
// On screen, and what a tap at its centre would actually hit. null when it is missing or hidden.
const box = (page, sel) => page.evaluate(s => {
  const e = document.querySelector(s);
  if (!e || e.hidden || !e.getClientRects().length) return null;
  const r = e.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
  const hit = document.elementFromPoint(x, y);
  return { h: r.height, on: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth,
           top: !!hit && (hit === e || e.contains(hit)), text: e.textContent.trim() };
}, sel);
async function pickPhoto(page, file, via = '#ir-begin .ir-primary') {
  const [fc] = await Promise.all([page.waitForEvent('filechooser', { timeout: 3000 }), page.click(via)]);
  await fc.setFiles(file);
}
async function dismissChooser(page, via) {
  const [fc] = await Promise.all([page.waitForEvent('filechooser', { timeout: 3000 }), page.click(via)]);
  void fc;                                   // …and dismissed: no file is set, no change event
}
async function openReadBack(page) {
  await page.evaluate(() => { window.irSetTab('trucks'); window.irOpenTruck(2); });
  await page.waitForFunction(() => !document.getElementById('ir-det-scan').hidden, null, { timeout: 5000 });
  await settle(page);
}
async function dockTruck(page) {
  await set(page, { truck: TRUCK });
  await page.evaluate(() => { window.irSetTab('receive'); window.irLoadCurrent(); });
  await page.waitForFunction(() => !document.getElementById('ir-open').hidden, null, { timeout: 5000 });
  await settle(page);
}

// ── 1. Retake: a dismissed camera loses nothing typed (bin-dump-14) ──
await section('1. Retake (bin-dump-14)', async () => {
  const { page, errs } = await open();
  await pickPhoto(page, PHOTO);                                   // Receive Truck → a BOL
  await waitModal(page, /Verify Bill of Lading/);
  check((await get(page, 'shrinkArgs')).length === 1, '(the psShrink wrapper is live — the decode checks below rest on it)');
  await page.fill('#ir-f-bol_no', 'TYPED-7702');
  await page.fill('#ir-f-carrier', 'MY CARRIER');
  await dismissChooser(page, '#ir-m-retake');
  await page.waitForTimeout(600);
  check(await modalOpen(page), '🛑 the BOL form is still open after the camera is dismissed (bin-dump-14)');
  check(await page.inputValue('#ir-f-bol_no').catch(() => '') === 'TYPED-7702'
        && await page.inputValue('#ir-f-carrier').catch(() => '') === 'MY CARRIER', '...with what was typed still in it');
  // A photo that does arrive replaces the form — and only then is the form closed.
  await set(page, { scanDelay: 900 });
  await pickPhoto(page, PHOTO, '#ir-m-retake');
  await page.waitForTimeout(250);
  check(!(await modalOpen(page)) && await page.isVisible('#ir-reading'), 'a photo that does arrive closes the form and is read');
  await waitModal(page, /Verify Bill of Lading/);
  check(await page.inputValue('#ir-f-bol_no') === '7702', '...and the new read opens its own form');
  check(!errs.length, `no page errors (${errs.slice(0, 2).join(' | ')})`);
});

// ── 2. No stale photo (bin-dump-4) ──
await section('2. stale photo (bin-dump-4)', async () => {
  const { page, errs } = await open();
  await pickPhoto(page, PHOTO);
  await waitModal(page, /Verify Bill of Lading/);
  check(await page.isVisible('#ir-m-photo'), '(a good photo is shown in its own form — the positive half)');
  const args = (await get(page, 'shrinkArgs')).slice(-1)[0];
  check(args && args[0] === 1800 && args[1] === 0.88, `the BOL is decoded at 1800px, q0.88, not the tag's defaults (${JSON.stringify(args)})`);
  await closeForm(page);
  await pickPhoto(page, BROKEN);                                  // one that will not decode
  await waitModal(page, /Verify Bill of Lading/);
  check(/Couldn't read it/.test(await warnText(page)), 'an undecodable photo opens the empty form, saying so');
  check(!(await page.isVisible('#ir-m-shot')) && !(await page.isVisible('#ir-m-photo')), '🛑 ...WITHOUT the previous read\'s photo (bin-dump-4)');
  check(await page.evaluate(() => !document.getElementById('ir-m-photo').hasAttribute('src')),
        '...and no stale src behind the hidden box, which irLbOpen() would show');
  check(await page.textContent('#ir-m-retake') === 'Take Photo', '...and the button offers "Take Photo": there is no photo to retake');
  await page.fill('#ir-f-bol_no', '7703');
  await page.fill('#ir-f-ship_from', 'RM1');
  await page.click('#ir-m-submit');
  await page.waitForFunction(() => window.__ir.calls.some(c => c.action === 'truck-open'), null, { timeout: 5000 });
  const post = (await calls(page, 'truck-open')).pop();
  // 🔑 `== null`, not `!('image_b64' in body)`: the Receiver posts `image_b64: null` for no photo.
  check(post && post.body.bol_no === '7703' && post.body.image_b64 == null, '🛑 ...and truck-open is posted with no photo at all');
  check(!errs.length, `no page errors (${errs.slice(0, 2).join(' | ')})`);
});

// ── 3. Cancel on the dock, and a read nothing else can overtake (bin-dump-13) ──
await section('3. dock Cancel (bin-dump-13)', async () => {
  const { page, errs } = await open();
  // A cancelled read whose answer lands anyway, late.
  await set(page, { scanDelay: 1500, scanIgnoresAbort: true });
  await pickPhoto(page, PHOTO);
  await page.waitForTimeout(300);
  const cb = await box(page, '#ir-read-cancel');
  check(cb && cb.h >= 44 && cb.on && cb.top, `the reading panel has a thumb-sized Cancel (${cb ? cb.h + 'px' : 'none'}) (bin-dump-13)`);
  if (cb) await page.click('#ir-read-cancel');
  await settle(page);
  check(await page.isVisible('#ir-begin .ir-primary') && !(await page.isVisible('#ir-reading')), 'Cancel puts Receive Truck back');
  check(await focused(page) === 'Receive Truck', `...and focuses it (${await focused(page)})`);
  await set(page, { scanDelay: 2500 });
  await pickPhoto(page, PHOTO);                                   // a second read, started at once
  await page.waitForTimeout(1600);                                // the first read's answer lands now
  check(!(await modalOpen(page)) && await page.isVisible('#ir-reading'),
        '🛑 the cancelled read\'s late answer opens nothing and does not hide the new read');
  await waitModal(page, /Verify Bill of Lading/);
  check(true, '...and the new read opens its own form');
  await closeForm(page);

  // A cancelled read whose request honours the abort: the rejection must report nothing either.
  await set(page, { scanDelay: 3000, scanIgnoresAbort: false, aborts: 0 });
  await pickPhoto(page, PHOTO);
  await page.waitForTimeout(300);
  await page.click('#ir-read-cancel', { timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(800);
  check(await get(page, 'aborts') === 1, 'Cancel aborts the request');
  check(!(await modalOpen(page)), '🛑 ...and the aborted read opens no form');

  // Cancel while the photo is still decoding (psShrink cannot be aborted): nothing is sent.
  await set(page, { scanDelay: 0, shrinkDelay: 1500 });
  const before = (await calls(page, 'truck-bol-scan')).length, dec = await get(page, 'decoded');
  await pickPhoto(page, PHOTO);
  await page.waitForFunction(d => window.__ir.decoded > d, dec, { timeout: 5000 });
  await page.click('#ir-read-cancel', { timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(2000);
  check((await calls(page, 'truck-bol-scan')).length === before && !(await modalOpen(page)),
        '🛑 a read cancelled while it decodes sends nothing and opens nothing');
  await set(page, { shrinkDelay: 0 });

  // A store change mid-read re-renders the dock and brings Receive Truck back. Tapping it starts
  // over: the read in flight is abandoned, so a dismissed camera leaves nothing to land.
  await set(page, { scanDelay: 1500, scanIgnoresAbort: true, aborts: 0 });
  await pickPhoto(page, PHOTO);
  await page.waitForTimeout(250);
  await page.selectOption('#ir-store', 'BL4');
  await settle(page);
  check(await page.isVisible('#ir-begin .ir-primary'), '(a store change mid-read puts Receive Truck back on screen)');
  await dismissChooser(page, '#ir-begin .ir-primary');
  await page.waitForTimeout(1600);
  check(!(await modalOpen(page)) && await get(page, 'aborts') === 1,
        '🛑 Receive Truck tapped mid-read abandons that read: aborted, and its answer opens nothing');
  await page.selectOption('#ir-store', 'BL1');
  await settle(page);

  // With a truck on the dock, Cancel leaves the truck's own controls, not Receive Truck.
  await dockTruck(page);
  await set(page, { scanDelay: 0, scanIgnoresAbort: false, scanHang: true });
  await pickPhoto(page, PHOTO, '#ir-btn-pallet');
  await page.waitForTimeout(300);
  await page.click('#ir-read-cancel', { timeout: 2000 }).catch(() => {});
  await settle(page);
  check(!(await page.isVisible('#ir-begin')) && await page.isVisible('#ir-open') && !(await page.isVisible('#ir-reading')),
        'with a truck on the dock, Cancel leaves Receive Truck hidden');
  check(await focused(page) === 'ir-btn-pallet', `...and focuses Scan Pallet Tag (${await focused(page)})`);

  // 🛑 A row's Edit, tapped mid-read. The read used to land ON the correction: the form kept
  // saying "Correct pallet" while the scanned tag replaced its fields, and Save wrote it over
  // that row.
  await set(page, { scanHang: false, scanDelay: 1500, scanIgnoresAbort: true, aborts: 0 });
  await pickPhoto(page, PHOTO, '#ir-btn-pallet');
  await page.waitForTimeout(300);
  await page.click('#ir-pallets .ir-row-btn');
  await settle(page);
  const bc = await page.inputValue('#ir-f-barcode');
  await page.waitForTimeout(1600);                                // the read's answer lands now
  check(/^Correct pallet/.test(await title(page)) && await page.inputValue('#ir-f-barcode') === bc && bc !== 'PRM-99999-1',
        `🛑 an Edit started mid-read keeps the row's own values (${bc} → ${await page.inputValue('#ir-f-barcode')})`);
  check(await get(page, 'aborts') === 1, '...because the read was abandoned, and aborted');
  await closeForm(page);
  check(!errs.length, `no page errors (${errs.slice(0, 2).join(' | ')})`);
});

// ── 4. The timeout: from the request, decided by a flag (bin-dump-13) ──
await section('4. timeout (bin-dump-13)', async () => {
  // 🔑 page.clock runs at real speed after install(): fake time = real time + runFor.
  const { page } = await open({ clock: true });
  // A decode that takes 10s, then a request that never answers.
  await set(page, { scanHang: true, shrinkDelay: 10000 });
  await pickPhoto(page, PHOTO);
  await page.waitForFunction(() => window.__ir.decoded >= 1, null, { timeout: 5000 });
  await page.clock.runFor(10500);                                 // the decode "ends": the request goes out
  await page.waitForFunction(() => window.__ir.calls.some(c => c.action === 'truck-bol-scan'), null, { timeout: 5000 });
  await page.clock.runFor(39500);                                 // ~50s after the photo, ~40s after the request
  check(await page.isVisible('#ir-reading') && !(await modalOpen(page)),
        '🛑 still reading ~50s after the photo: the clock starts at the request, not at the photo');
  await page.clock.runFor(10000);                                 // ~60s after the photo
  await page.waitForFunction(() => document.getElementById('ir-modal').style.display === 'flex', null, { timeout: 5000 }).catch(() => {});
  check(await modalOpen(page) && /took too long/.test(await warnText(page)),
        '🛑 ...and ~50s after the request it has given up and opened the form, saying so (bin-dump-13)');
  check(await page.isVisible('#ir-m-photo'), '...keeping the photo, so it can still be read off it');
  await closeForm(page);

  // An abort that lands while the BODY downloads comes back as `{}`, not as an error — only the
  // flag the timer sets can say it was the timer.
  await set(page, { scanHang: false, shrinkDelay: 0, scanBodyHang: true });
  await pickPhoto(page, PHOTO);
  await page.waitForFunction(() => window.__ir.calls.filter(c => c.action === 'truck-bol-scan').length === 2, null, { timeout: 5000 });
  await page.clock.runFor(46000);
  await page.waitForFunction(() => document.getElementById('ir-modal').style.display === 'flex', null, { timeout: 5000 }).catch(() => {});
  const w1 = await warnText(page);
  check(await modalOpen(page) && /took too long/.test(w1) && !/cut off/.test(w1),
        `🛑 a timeout mid-body still says "took too long" (${w1 || 'no form'})`);
  await closeForm(page);

  // A 200 that is not the reader's answer: the body never arrived, and the form says so.
  await set(page, { scanBodyHang: false, scanEmpty: true });
  await pickPhoto(page, PHOTO);
  await page.waitForFunction(() => document.getElementById('ir-modal').style.display === 'flex', null, { timeout: 5000 }).catch(() => {});
  const w2 = await warnText(page);
  check(await modalOpen(page) && /cut off/.test(w2), `a 200 without ok:true is reported, not shown as "Read 0 fields" (${w2 || 'no warning'})`);
});

// ── 5. The read-back: a manager adding a missed pallet to a truck that is down ──
await section('5. read-back', async () => {
  const { page, errs } = await open();
  await openReadBack(page);
  // A typed entry survives a dismissed camera, and a real photo turns it into a read.
  await page.click('#ir-det-manual');
  await settle(page);
  await page.fill('#ir-f-barcode', 'P-TYPED-0001');
  check(await page.isVisible('#ir-m-manual'), '(a typed entry carries its instructions)');
  await dismissChooser(page, '#ir-m-retake');                     // "Take Photo"
  await page.waitForTimeout(600);
  check(await modalOpen(page) && await page.inputValue('#ir-f-barcode').catch(() => '') === 'P-TYPED-0001',
        '🛑 Take Photo, dismissed, leaves the typed entry open and as typed (bin-dump-14)');
  if (!(await modalOpen(page))) await page.click('#ir-det-manual');
  await pickPhoto(page, PHOTO, '#ir-m-retake');
  await waitModal(page, /Verify pallet tag/);
  check(await title(page) === 'Verify pallet tag · BOL 7644' && !(await page.isVisible('#ir-m-manual')),
        `a photo from a typed entry makes it a read of that truck (${await title(page)})`);
  check(!(await page.isVisible('#ir-det-status')) && !(await page.isVisible('#ir-det-read-cancel')),
        '...and the finished read leaves neither "Reading tag…" nor its Cancel behind');
  await closeForm(page);

  // From deep in the pallet list: Scan Tag is in the sticky bar, the reading line is not.
  await page.evaluate(() => { const p = document.querySelector('#ir-det .ir-panel'); p.scrollTop = p.scrollHeight; });
  await settle(page);
  const sub = await box(page, '#ir-det-sub');
  check(sub && (!sub.on || !sub.top), '(the read-back is scrolled into its pallet list: the lines above it are off screen)');
  await set(page, { scanDelay: 1500, scanIgnoresAbort: true, aborts: 0 });
  await pickPhoto(page, PHOTO, '#ir-det-scan');
  await page.waitForTimeout(400);
  const st = await box(page, '#ir-det-status'), cb = await box(page, '#ir-det-read-cancel');
  check(st && st.on && st.top && /Reading tag/.test(st.text), `🛑 "Reading tag…" is brought on screen (${JSON.stringify(st)})`);
  // What #ir-det-readline's scroll-margin-top has to clear: the sticky bar, which wraps here.
  const gap = await page.evaluate(() => { const bar = document.querySelector('#ir-det .ir-bar').getBoundingClientRect(),
    line = document.getElementById('ir-det-status').getBoundingClientRect(); return [bar.height, line.top - bar.bottom]; });
  measured.push(`read-back at 390px: sticky bar ${gap[0].toFixed(0)}px tall, "Reading tag…" ${gap[1].toFixed(0)}px below it`);
  check(cb && cb.h >= 44 && cb.on && cb.top, `...with a thumb-sized Cancel under it (${cb ? cb.h + 'px' : 'none'})`);
  if (cb) await page.click('#ir-det-read-cancel');
  await settle(page);
  check(!(await page.isVisible('#ir-det-status')) && !(await page.isVisible('#ir-det-read-cancel')) && await page.isVisible('#ir-det'),
        'Cancel clears both and leaves the read-back open');
  check(await focused(page) === 'ir-det-scan', `...focusing Scan Tag (${await focused(page)})`);
  await page.waitForTimeout(1600);
  check(!(await modalOpen(page)) && await get(page, 'aborts') === 1, '🛑 the cancelled read was aborted, and its late answer opens nothing');

  // Enter Manually mid-read: the typed form is what stays.
  await set(page, { aborts: 0 });
  await pickPhoto(page, PHOTO, '#ir-det-scan');
  await page.waitForTimeout(300);
  await page.click('#ir-det-manual');
  await settle(page);
  await page.fill('#ir-f-barcode', 'P-TYPED-0002');
  await page.waitForTimeout(1600);
  check(await modalOpen(page) && await page.inputValue('#ir-f-barcode') === 'P-TYPED-0002' && /^Add pallet by hand/.test(await title(page)),
        '🛑 Enter Manually mid-read keeps the typed form: the scan does not land on it');
  check(await get(page, 'aborts') === 1, '...the read was abandoned, and aborted');
  await closeForm(page);

  // × mid-read: closing the screen a tag is being read for abandons the read.
  await set(page, { aborts: 0 });
  await pickPhoto(page, PHOTO, '#ir-det-scan');
  await page.waitForTimeout(300);
  await page.click('#ir-det button[aria-label="Close"]');
  await page.waitForTimeout(1600);
  check(!(await modalOpen(page)) && await get(page, 'aborts') === 1, '🛑 closing the read-back mid-read abandons it: aborted, nothing opens');

  // A DOCK read survives a tab switch — but not the next scan being started somewhere else.
  await dockTruck(page);
  await set(page, { scanDelay: 2500, scanIgnoresAbort: true, aborts: 0 });
  await pickPhoto(page, PHOTO, '#ir-btn-pallet');
  await page.waitForTimeout(300);
  check(await page.isVisible('#ir-reading'), '(a dock read is running)');
  await openReadBack(page);
  check(await get(page, 'aborts') === 0, 'switching to the Trucks tab does not abandon a dock read');
  await dismissChooser(page, '#ir-det-scan');
  await page.waitForTimeout(2600);
  const t = await modalOpen(page) ? await title(page) : '';
  check(!/7644/.test(t), `🛑 that dock read does not land on the read-back's truck after its Scan Tag (${t || 'no form'})`);
  check(!errs.length, `no page errors (${errs.slice(0, 2).join(' | ')})`);
});

// ── 6. Retake is locked while a submit posts ──
await section('6. submit locks Retake', async () => {
  const { page } = await open();
  await pickPhoto(page, PHOTO);
  await waitModal(page, /Verify Bill of Lading/);
  await set(page, { openDelay: 1200, openFail: true });
  await page.click('#ir-m-submit');
  await page.waitForTimeout(300);
  check(await page.evaluate(() => document.getElementById('ir-m-retake').disabled),
        '🛑 Retake is locked while the truck posts — a read cannot start inside an operation that is finishing');
  await page.waitForFunction(() => !document.getElementById('ir-m-submit').disabled, null, { timeout: 5000 });
  check(await modalOpen(page) && !(await page.evaluate(() => document.getElementById('ir-m-retake').disabled)),
        '...and unlocked when the post fails and the form stays');
});

// ── 7. Paint: both Cancels, in every theme ──
// The ghost button paints no ground of its own, so its ink is measured against what is really
// under it: every ancestor's background, composited down to the first opaque one.
const paintOf = (page, sel) => page.evaluate(s => {
  const e = document.querySelector(s);
  if (!e || e.hidden) return null;
  const layers = [];
  for (let n = e; n; n = n.parentElement) {
    const bg = getComputedStyle(n).backgroundColor;
    layers.push(bg);
    const a = (bg.match(/[\d.]+/g) || []).map(Number);
    if (a.length === 3 || a[3] === 1) break;
  }
  return { fg: getComputedStyle(e).color, layers, body: getComputedStyle(document.body).backgroundColor };
}, sel);
const inkRatio = p => {
  if (!p) return 0;
  const last = rgba(p.layers[p.layers.length - 1]);
  let ground = last[3] === 1 ? last : over(last, rgba(p.body));
  for (let i = p.layers.length - 2; i >= 0; i--) ground = over(rgba(p.layers[i]), ground);
  return ratio(over(rgba(p.fg), ground), ground);
};
for (const theme of ['light', 'dark', 'oled']) await section(`7. paint [${theme}]`, async () => {
  const { page } = await open({ theme });
  await set(page, { scanHang: true });
  await pickPhoto(page, PHOTO);
  await page.waitForTimeout(300);
  const dock = inkRatio(await paintOf(page, '#ir-read-cancel'));
  check(dock >= 4.5, `[${theme}] the dock's Cancel reads ${dock.toFixed(2)}:1`);
  await page.click('#ir-read-cancel', { timeout: 2000 }).catch(() => {});
  await openReadBack(page);
  await pickPhoto(page, PHOTO, '#ir-det-scan');
  await page.waitForTimeout(300);
  const det = inkRatio(await paintOf(page, '#ir-det-read-cancel'));
  check(det >= 4.5, `[${theme}] the read-back's Cancel reads ${det.toFixed(2)}:1`);
  measured.push(`${theme.padEnd(5)}  dock Cancel ${dock.toFixed(2)}:1   read-back Cancel ${det.toFixed(2)}:1`);
});

await b.close();
srv.close();
try { fs.unlinkSync(BROKEN); } catch (e) {}
if (measured.length) console.log('Measured:\n  ' + measured.join('\n  '));
const bad = results.filter(r => !r[0]);
for (const [okk, m] of results) if (!okk) console.log('  FAIL ' + m);
console.log(`\n${results.length - bad.length} passed, ${bad.length} failed`);
process.exit(bad.length ? 1 : 0);
