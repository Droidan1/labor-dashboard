// Bin Dump — driven in a REAL BROWSER at phone width, against the real app shell.
//
// 🛑 NOT PART OF `scripts/test.sh`, deliberately: the runner globs `test-*` and this needs
// playwright-core and a Chromium, neither of which is a repo dependency. Run it by hand
// after a change to the page:
//
//   npm install --no-save playwright-core
//   bash scripts/build.sh && node scripts/browser-bin-dump.mjs
//
// 🔑 WHY IT EXISTS. scripts/test-bin-dump.mjs executes the pure pieces and pins the source
// order of the rest; it cannot see geometry, focus, paint or timing. The findings fixed on
// 2026-09-23 (docs/code-review-2026-09-22.md, bin-dump-1…23) were almost all of that kind:
// EDIT ~440px off-screen on a phone, a see-through sticky cell, a dialog whose Enter key
// ignored focus, a read that could hang, a form lost to a dismissed camera. Each is checked
// here the way a person would meet it — at 390px, by tapping.
//
// 🛑 THE APP'S THEME IS localStorage, NOT prefers-color-scheme (see browser-inventory-receiver):
// `darkMode` + `darkFlavor=oled` are written before boot, and the class is asserted.
// 🔑 Colours are computed from what the browser paints — CLAUDE.md requires ≥ 4.5:1 in
// light, dark and pure black, and a screenshot cannot tell you that.
let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch (e) {
  console.error(
    '\nThis check needs playwright-core, which is not a dependency of this repo.\n\n' +
    '  npm install --no-save playwright-core\n' +
    '  bash scripts/build.sh\n' +
    '  node scripts/browser-bin-dump.mjs\n\n' +
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
const PORT = 8096;
const srv = http.createServer((q, s) => {
  const f = path.join(root, q.url === '/' ? 'index.html' : q.url.split('?')[0]);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end('no'); }
  s.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(s);
});
await new Promise(r => srv.listen(PORT, r));

// A real image stands in for the tag photo (psShrink decodes it); a text file named .jpg
// is the photo that will not decode.
const PHOTO = path.join(repo, 'icon-192.png');
const BROKEN = path.join(os.tmpdir(), 'bin-dump-broken.jpg');
fs.writeFileSync(BROKEN, 'this is not an image');

const results = [], measured = [];
const check = (c, m) => { results.push([!!c, m]); };

// ── colour ─────────────────────────────────────────────────────────────
const rgba = s => { const m = String(s).match(/[\d.]+/g) || []; return [+m[0], +m[1], +m[2], m[3] == null ? 1 : +m[3]]; };
const over = (top, base) => [0, 1, 2].map(i => top[i] * top[3] + base[i] * (1 - top[3])).concat(1);
const lum = c => { const f = c.slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// ── the fake worker, run inside the page ───────────────────────────────
// Everything the page asks is answered here, and recorded, so a check can say what was
// POSTED and not only what was drawn. Nothing reaches the network.
function pageMocks({ who, theme }) {
  try {
    localStorage.setItem('darkMode', String(theme !== 'light'));
    localStorage.setItem('darkFlavor', theme === 'oled' ? 'oled' : 'dark');
  } catch (e) {}
  const pad = n => String(n).padStart(2, '0');
  const now = new Date();
  const sun = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
  const wk = w => { const d = new Date(sun.getFullYear(), sun.getMonth(), sun.getDate() - 7 * w); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const at = (day, h) => new Date(sun.getFullYear(), sun.getMonth(), sun.getDate() + day, h, 5).toISOString();
  const row = (id, store, extra) => ({ id, store, week: wk(0), logged_at: at(1, 9 + (id % 7)), barcode: `P-0921-${id}`,
    item_no: '50201', pallet_name: 'FG BL CONSUMABLES - FOOD - SNACKS', sup_ref: 'mix', po: 'RM1 - TJX', units: 40 + id,
    created_by_tag: 'Sam R', truck_no: null, logged_by: 'Alex M', edited_by: null, edited_at: null, has_photo: true, ...extra });
  const M = window.__bd = {
    calls: [], listDelay: {}, scanDelay: 0, scanHang: false, scanIgnoresAbort: false, logDelay: 0, updateDup: false,
    scan: { barcode: 'PRM-10490-31', item_no: '50201', pallet_name: 'PALLET AMAZON IND8', sup_ref: null,
            po: '5036', units: 48, created_by_tag: 'Sam R', truck_no: '10490' },
    rows: [
      row(12, 'BL1', { barcode: 'PRM-10488-12', pallet_name: 'PALLET AMAZON IND8', edited_by: 'Alex M', edited_at: at(1, 16) }),
      row(11, 'BL1', { barcode: 'PRM-10488-12', pallet_name: 'PALLET AMAZON IND8' }),
      row(10, 'BL1', {}),
      row(20, 'BL4', { barcode: 'P-0921-20' }),
    ],
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
    switch (action) {
      case 'auth-me': return J(who);
      case 'bin-dump-list': {
        const store = url.searchParams.get('store');
        await wait(M.listDelay[store] || 0);
        const mine = who.stores || ['BL1', 'BL4'];
        return J({ ok: true, truncated: false, rows: M.rows.filter(r => store === 'ALL' ? mine.includes(r.store) : r.store === store) });
      }
      case 'bin-dump-scan':
        // scanIgnoresAbort: the answer lands anyway, late — how a read cancelled mid-decode
        // (psShrink cannot be aborted) comes back. The generation number must ignore it.
        await wait(M.scanHang ? Infinity : M.scanDelay, M.scanIgnoresAbort ? null : o.signal);
        return J({ ok: true, fields: M.scan, read: Object.values(M.scan).filter(v => v != null).length, of: 8, truck_hint: null });
      case 'bin-dump-recent': {
        const bc = url.searchParams.get('barcode');
        return J({ ok: true, barcode_matches: M.rows.filter(r => bc && r.barcode === bc)
          .map(r => ({ store: r.store, logged_at: r.logged_at, logged_by: r.logged_by, pallet_name: r.pallet_name, units: r.units })) });
      }
      case 'bin-dump-log': {
        await wait(M.logDelay);
        const id = 100 + M.calls.length;
        M.rows.unshift(row(id, body.store, { barcode: body.barcode || null, pallet_name: body.pallet_name || null,
          sup_ref: body.sup_ref || null, logged_at: new Date().toISOString(), has_photo: !!body.image_b64 }));
        return J({ ok: true, id });
      }
      case 'bin-dump-update':
        if (M.updateDup && body.allow_duplicate !== true)
          return J({ error: 'This barcode has already been logged', code: 'DUPLICATE_BARCODE', matches: [] }, 409);
        return J({ ok: true });
      case 'bin-dump-delete': {
        const i = M.rows.findIndex(r => r.id === body.id);
        if (i >= 0) M.rows.splice(i, 1);
        return J({ ok: true });
      }
      default: return J({ ok: false, error: 'not in this harness' }, 404);
    }
  };
}

const b = await chromium.launch({ executablePath: CHROME });
// One section = one scenario. A wait that times out is a FAILED check, recorded, and the run
// goes on — a crash would hide every check after it (found by mutation: reverting the dialog
// fix stopped the run at its first wait).
const live = new Set();
async function section(name, fn) {
  try { await fn(); }
  catch (e) { check(false, `${name}: stopped — ${String((e && e.message) || e).split('\n')[0]}`); }
  finally { for (const c of live) { try { await c.close(); } catch (e) {} } live.clear(); }
}
const MANAGER = { authenticated: true, email: 'alex@example.com', name: 'Alex M', role: 'manager', stores: ['BL1', 'BL4'], pages: {}, businesses: ['bl'] };
const VIEWER = { authenticated: true, email: 'assoc_usr_0000000000000001@associate.invalid', role: 'staff', name: 'Jordan K',
  associate: true, pages: { 'bin-dump': 'view' }, stores: ['BL1'], businesses: [{ id: 'bl', name: 'Bargain Lane' }] };

async function open({ who = MANAGER, theme = 'light', clock = false } = {}) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    deviceScaleFactor: 2, timezoneId: 'America/New_York', locale: 'en-US', serviceWorkers: 'block' });
  live.add(ctx);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  // 🛑 Every request that is not this server is refused here, so nothing can reach the
  // production worker even if the fetch stub misses one (an <img> tag photo, a beacon).
  await page.route(u => !u.href.startsWith(`http://127.0.0.1:${PORT}`), r => {
    const u = r.request().url();
    if (u.includes('action=bin-dump-photo')) return r.fulfill({ status: 200, contentType: 'image/png', body: fs.readFileSync(PHOTO) });
    return r.abort();
  });
  if (clock) await page.clock.install();
  await page.addInitScript(pageMocks, { who, theme });
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.navigateToPage === 'function' && window.__bd.calls.some(c => c.action === 'auth-me'), null, { timeout: 10000 });
  await page.waitForTimeout(400);
  await page.addStyleTag({ content: '#error-banner,#swipe-label,#ptr-hint{display:none !important}' });
  await page.evaluate(() => window.navigateToPage('bin-dump'));
  await page.waitForFunction(() => !document.getElementById('page-bin-dump').classList.contains('hidden'), null, { timeout: 5000 });
  await page.waitForTimeout(400);
  const got = await page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light')
    + (document.documentElement.classList.contains('oled') ? '+oled' : ''));
  check(got === { light: 'light', dark: 'dark', oled: 'dark+oled' }[theme], `[${theme}] the app is ACTUALLY in ${theme} (${got})`);
  return { ctx, page, errs };
}
const modalOpen = page => page.evaluate(() => document.getElementById('bd-modal').style.display === 'flex');
const calls = (page, action) => page.evaluate(a => window.__bd.calls.filter(c => c.action === a), action);
const settle = page => page.waitForTimeout(350);
// The shared confirm overlay (_uiDialog), found by what it is rather than by text: the same
// words also sit, hidden, on other pages.
const dialogWith = (page, text) => page.evaluate(t => [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')]
  .some(d => d.style.zIndex === '99999' && d.textContent.includes(t)), text);
const waitDialog = (page, text) => page.waitForFunction(t => [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')]
  .some(d => d.style.zIndex === '99999' && d.textContent.includes(t)), text, { timeout: 5000 });
async function pickPhoto(page, file, via = '#bd-begin .bd-primary') {
  const [fc] = await Promise.all([page.waitForEvent('filechooser', { timeout: 3000 }), page.click(via)]);
  await fc.setFiles(file);
}

// ── 1-3. Geometry, opacity and contrast, in every theme ─────────────────
for (const theme of ['light', 'dark', 'oled']) await section(`1-3. geometry + paint [${theme}]`, async () => {
  const { ctx, page, errs } = await open({ theme });
  await page.click('#bd-tab-log');
  await settle(page);
  // The first row of the open week is the EDITED one (amber) — the hard case for both the
  // sticky background and the DUP chip.
  const btn = page.locator('#bd-weeks .bd-wk.open tr.edited .bd-when-btn').first();
  await btn.evaluate(e => e.scrollIntoView({ block: 'center' }));
  await settle(page);
  const hit = async () => btn.evaluate(e => {
    const r = e.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    return { l: r.left, r: r.right, t: r.top, b: r.bottom, h: r.height, w: innerWidth, H: innerHeight,
             top: document.elementFromPoint(x, y) === e };
  });
  const g0 = await hit();
  check(g0.l >= 0 && g0.r <= g0.w && g0.t >= 0 && g0.b <= g0.H, `[${theme}] 🔑 the row's opener is on screen at 390px (bin-dump-10)`);
  check(g0.h >= 40, `[${theme}] ...and at least 40px tall (${g0.h})`);
  check(g0.top, `[${theme}] ...and nothing covers it (elementFromPoint)`);
  const edit = await page.locator('#bd-weeks .bd-wk.open tr.edited .bd-row-btn').first().evaluate(e => {
    const r = e.getBoundingClientRect(); return r.right > innerWidth; });
  check(edit, `[${theme}] (the trailing EDIT really is off-screen — the case being fixed)`);
  const maxed = await btn.evaluate(e => { const sc = e.closest('.bd-scroll'); sc.scrollLeft = sc.scrollWidth; return sc.scrollLeft > 0; });
  await settle(page);
  const g1 = await hit();
  check(maxed && Math.abs(g1.l - g0.l) < 1 && g1.top, `[${theme}] ...and stays put and on top with the row scrolled fully left`);
  // 🛑 bin-dump-11: opaque, and the same amber as the rest of the row.
  const bg = await page.evaluate(() => {
    const td = document.querySelector('#bd-weeks .bd-wk.open tr.edited td.stick');
    const cell = td.nextElementSibling, sc = td.closest('.bd-scroll');
    const cs = getComputedStyle(td);
    return { img: cs.backgroundImage, col: cs.backgroundColor, cell: getComputedStyle(cell).backgroundColor,
             panel: getComputedStyle(sc).backgroundColor, ink: getComputedStyle(td.querySelector('.bd-when-btn')).color,
             btnBg: getComputedStyle(td.querySelector('.bd-when-btn')).backgroundColor };
  });
  const base = rgba(bg.col);
  check(/linear-gradient/.test(bg.img) && base[3] === 1, `[${theme}] 🛑 the sticky cell of an edited row is opaque (${bg.col} under ${bg.img.slice(0, 40)}…)`);
  const wash = rgba((bg.img.match(/rgba?\([^)]+\)/) || [''])[0]);
  const stickPaint = over(wash, base), cellPaint = over(rgba(bg.cell), rgba(bg.panel));
  check(stickPaint.slice(0, 3).every((v, i) => Math.abs(v - cellPaint[i]) < 1.5), `[${theme}] ...and the same amber as the cells beside it`);
  check(rgba(bg.btnBg)[3] === 0, `[${theme}] the time button paints no buttonface of its own (${bg.btnBg})`);
  const tr = ratio(rgba(bg.ink), stickPaint);
  check(tr >= 4.5, `[${theme}] the time reads ${tr.toFixed(2)}:1 on the amber cell`);
  // bin-dump-12: the DUP chip on the amber row.
  const dup = await page.evaluate(() => {
    const chip = document.querySelector('#bd-weeks .bd-wk.open tr.edited .bd-dup');
    const td = chip.closest('td'), sc = chip.closest('.bd-scroll');
    return { fg: getComputedStyle(chip).color, chip: getComputedStyle(chip).backgroundColor,
             td: getComputedStyle(td).backgroundColor, panel: getComputedStyle(sc).backgroundColor };
  });
  const dr = ratio(rgba(dup.fg), over(rgba(dup.chip), over(rgba(dup.td), rgba(dup.panel))));
  check(dr >= 4.5, `[${theme}] 🛑 the DUP chip reads ${dr.toFixed(2)}:1 on an amber row (bin-dump-12)`);
  // ...and on a plain row, where the same chip sits over no wash at all.
  const plain = await page.evaluate(() => {
    const chip = document.querySelector('#bd-weeks .bd-wk.open tr:not(.edited) .bd-dup');
    const td = chip.closest('td'), sc = chip.closest('.bd-scroll');
    return { fg: getComputedStyle(chip).color, chip: getComputedStyle(chip).backgroundColor,
             td: getComputedStyle(td).backgroundColor, panel: getComputedStyle(sc).backgroundColor };
  });
  const pr = ratio(rgba(plain.fg), over(rgba(plain.chip), over(rgba(plain.td), rgba(plain.panel))));
  check(pr >= 4.5, `[${theme}] the DUP chip reads ${pr.toFixed(2)}:1 on a plain row`);
  const line = `${theme.padEnd(5)}  time on amber ${tr.toFixed(2)}:1   DUP on amber ${dr.toFixed(2)}:1   DUP plain ${pr.toFixed(2)}:1`;
  // Tapping the time opens the row.
  await btn.evaluate(e => e.closest('.bd-scroll').scrollLeft = 0);
  await btn.tap();
  await settle(page);
  check(await modalOpen(page) && /Edit logged pallet · Coliseum/.test(await page.textContent('#bd-m-title')),
        `[${theme}] tapping the time opens "Edit logged pallet · Coliseum"`);
  // bin-dump-7: saving it is confirmed on the Log tab's own strip — measured as painted.
  await page.click('#bd-m-submit');
  await page.waitForFunction(() => !document.getElementById('bd-log-note').hidden, null, { timeout: 8000 });
  const note = await page.evaluate(() => {
    const n = document.getElementById('bd-log-note'), p = n.closest('.bd-panel');
    return { fg: getComputedStyle(n).color, bg: getComputedStyle(n).backgroundColor, panel: getComputedStyle(p).backgroundColor };
  });
  const nr = ratio(rgba(note.fg), over(rgba(note.bg), rgba(note.panel)));
  check(rgba(note.panel)[3] === 1 && nr >= 4.5, `[${theme}] the Log tab's "Changes saved." reads ${nr.toFixed(2)}:1 (bin-dump-7)`);
  measured.push(`${line}   Log strip ${nr.toFixed(2)}:1`);
  check(!errs.length, `[${theme}] no page errors (${errs.slice(0, 2).join(' | ')})`);
  await ctx.close();
});

// ── 4. A quote in a value: shown whole, posted whole, no injection (bin-dump-1) ──
await section('4. quotes (bin-dump-1)', async () => {
  const { ctx, page, errs } = await open();
  await page.evaluate(() => { Object.assign(window.__bd.scan, { pallet_name: 'TV 55" LED', sup_ref: 'x" data-pwned="1' }); });
  await pickPhoto(page, PHOTO);
  await page.waitForFunction(() => document.getElementById('bd-modal').style.display === 'flex', null, { timeout: 8000 });
  check(await page.inputValue('#bd-f-pallet_name') === 'TV 55" LED', '🛑 `TV 55" LED` is in the form whole, not cut at the quote');
  check(await page.inputValue('#bd-f-sup_ref') === 'x" data-pwned="1', '...and a hostile value stays a value');
  check(await page.evaluate(() => !document.querySelector('[data-pwned]')), '🛑 ...adding no attribute to the page');
  check((await page.getAttribute('#bd-f-barcode', 'autocapitalize')) === 'characters', 'the barcode keyboard types capitals (bin-dump-20)');
  await page.click('#bd-m-submit');
  await page.waitForFunction(() => document.getElementById('bd-modal').style.display === 'none', null, { timeout: 8000 });
  const log = (await calls(page, 'bin-dump-log')).pop();
  check(log && log.body.pallet_name === 'TV 55" LED' && log.body.sup_ref === 'x" data-pwned="1', '...and both are POSTED exactly as read');
  await page.click('#bd-tab-log'); await settle(page);
  const title = await page.locator('#bd-weeks .bd-wk.open tr .bd-dup').first().getAttribute('title');
  check(/^Barcode PRM-10488-12 is on more than one logged pallet$/.test(title || ''), 'the DUP chip title is the raw barcode');
  check(!errs.length, `no page errors (${errs.slice(0, 2).join(' | ')})`);
  await ctx.close();
});

// ── 5. The store: never "All stores", claimed once, named, kept (bin-dump-3) ──
await section('5. store (bin-dump-3)', async () => {
  const { ctx, page } = await open();
  await page.selectOption('#bd-store', 'ALL'); await settle(page);
  let chooser = false;
  page.on('filechooser', () => { chooser = true; });
  await page.click('#bd-begin .bd-primary'); await page.waitForTimeout(600);
  check(!chooser, '🛑 on "All stores", Begin opens no camera');
  check(/Pick the store this pallet is going into first/.test(await page.textContent('#bd-status')), '...and says to pick a store');
  check(await page.evaluate(() => document.activeElement && document.activeElement.id === 'bd-store'), '...pointing at the picker');
  await page.click('#bd-manual'); await settle(page);
  check(!(await modalOpen(page)), '...and Enter Manually opens no form either');
  await page.selectOption('#bd-store', 'BL4'); await settle(page);
  await page.evaluate(() => window.navigateToPage('dashboard')); await settle(page);
  await page.evaluate(() => window.navigateToPage('bin-dump')); await settle(page);
  check(await page.inputValue('#bd-store') === 'BL4', '🔑 the picked store survives leaving the page and coming back');
  await page.evaluate(() => { window.__bd.scanDelay = 900; });
  await pickPhoto(page, PHOTO);
  await page.waitForTimeout(150);
  await page.selectOption('#bd-store', 'BL1');                 // changed mid-read
  await page.waitForFunction(() => document.getElementById('bd-modal').style.display === 'flex', null, { timeout: 8000 });
  check(/^Verify pallet tag · Dupont$/.test((await page.textContent('#bd-m-title')).trim()), 'the form names the store it claimed ("· Dupont")');
  const tb = await page.evaluate(() => { const t = document.getElementById('bd-m-title').getBoundingClientRect(),
    x = document.getElementById('bd-m-close').getBoundingClientRect(); return Math.abs((t.top + t.bottom) / 2 - (x.top + x.bottom) / 2) < 12; });
  check(tb, '...on one line with the × (the longer title does not wrap it)');
  await page.click('#bd-m-submit');
  await page.waitForFunction(() => document.getElementById('bd-modal').style.display === 'none', null, { timeout: 8000 });
  const log = (await calls(page, 'bin-dump-log')).pop();
  check(log && log.body.store === 'BL4', '🛑 ...and POSTS it, though the picker changed while it read');
  check(/^Pallet logged at Dupont · /.test(await page.textContent('#bd-status')), 'the green line names the store too');
  await ctx.close();
});

// ── 6-7. The read: no stale photo, Cancel, late results, timeout (bin-dump-4, -13) ──
await section('6. stale photo + Cancel (bin-dump-4, -13)', async () => {
  const { ctx, page } = await open();
  await pickPhoto(page, PHOTO);
  await page.waitForFunction(() => document.getElementById('bd-modal').style.display === 'flex', null, { timeout: 8000 });
  await page.click('#bd-m-cancel'); await settle(page);          // a good photo, left behind
  await pickPhoto(page, BROKEN);                                  // one that will not decode
  await page.waitForFunction(() => document.getElementById('bd-modal').style.display === 'flex', null, { timeout: 8000 });
  check(/Couldn't read the tag/.test(await page.textContent('#bd-m-warn')), 'an undecodable photo opens the empty form, saying so');
  check(!(await page.isVisible('#bd-m-photo')), '🛑 ...WITHOUT the previous pallet\'s photo (bin-dump-4)');
  await page.fill('#bd-f-barcode', 'PRM-1-1');
  await page.click('#bd-m-submit');
  await page.waitForFunction(() => document.getElementById('bd-modal').style.display === 'none', null, { timeout: 8000 });
  const log = (await calls(page, 'bin-dump-log')).pop();
  check(log && !('image_b64' in log.body), '🛑 ...and uploads no photo with it');

  // Cancel, then a late answer to the cancelled read.
  await page.evaluate(() => { window.__bd.scanDelay = 1500; window.__bd.scanIgnoresAbort = true; });
  await pickPhoto(page, PHOTO);
  await page.waitForTimeout(300);
  const cb = await page.locator('#bd-read-cancel').evaluate(e => { const r = e.getBoundingClientRect();
    return { h: r.height, top: document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === e }; });
  check(cb.h >= 44 && cb.top, `the reading panel has a thumb-sized Cancel (${cb.h}px) (bin-dump-13)`);
  await page.click('#bd-read-cancel'); await settle(page);
  check(await page.isVisible('#bd-begin') && await page.isVisible('#bd-manual') && !(await page.isVisible('#bd-reading')),
        'Cancel puts Begin and Enter Manually back');
  await page.evaluate(() => { window.__bd.scanDelay = 2500; });
  await pickPhoto(page, PHOTO);                                   // a second read, started at once
  await page.waitForTimeout(1600);                                // the first read's answer lands now
  check(!(await modalOpen(page)) && await page.isVisible('#bd-reading'),
        '🛑 the cancelled read\'s late answer opens nothing and does not hide the new read');
  await page.waitForFunction(() => document.getElementById('bd-modal').style.display === 'flex', null, { timeout: 8000 });
  check(true, '...and the new read opens its own form');
  await ctx.close();
});
await section('7. timeout (bin-dump-13)', async () => {
  // The timeout, with the clock under control: a read that never answers.
  const { ctx, page } = await open({ clock: true });
  await page.evaluate(() => { window.__bd.scanHang = true; });
  await pickPhoto(page, PHOTO);
  await page.clock.runFor(2000);
  check(await page.isVisible('#bd-reading'), 'a read that never answers is still "Reading tag…" at 2s');
  await page.clock.runFor(44000);
  await page.waitForFunction(() => document.getElementById('bd-modal').style.display === 'flex', null, { timeout: 5000 }).catch(() => {});
  check(await modalOpen(page) && /took too long/.test(await page.textContent('#bd-m-warn')),
        '🛑 ...and at 46s it gives up and opens the form, saying so (bin-dump-13)');
  check(await page.isVisible('#bd-m-photo'), '...keeping the photo, so the tag can be read off it');
  await ctx.close();
});

// ── 8. Retake: a dismissed camera loses nothing typed (bin-dump-14) ──
await section('8. Retake (bin-dump-14)', async () => {
  const { ctx, page } = await open();
  await page.click('#bd-manual'); await settle(page);
  await page.fill('#bd-f-barcode', 'PRM-777-1');
  await page.fill('#bd-f-pallet_name', 'TYPED BY HAND');
  const [fc] = await Promise.all([page.waitForEvent('filechooser', { timeout: 3000 }), page.click('#bd-m-retake')]);
  void fc;                                                        // …and dismissed: no file is set
  await page.waitForTimeout(600);
  check(await modalOpen(page), '🛑 the typed form is still open after the camera is dismissed');
  check(await page.inputValue('#bd-f-barcode') === 'PRM-777-1' && await page.inputValue('#bd-f-pallet_name') === 'TYPED BY HAND',
        '...with everything typed still in it');
  await ctx.close();
});

// ── 9-10. Busy: locked while posting, free before the reload (bin-dump-15, -2) ──
await section('9-10. busy + load order (bin-dump-15, -2)', async () => {
  const { ctx, page } = await open();
  await page.evaluate(() => { window.__bd.logDelay = 1200; });
  await page.click('#bd-manual'); await settle(page);
  await page.fill('#bd-f-barcode', 'PRM-555-5');
  await page.click('#bd-m-submit');
  await page.waitForTimeout(250);
  const locked = await page.evaluate(() => ['bd-m-cancel', 'bd-m-close', 'bd-m-retake', 'bd-m-submit'].every(id => document.getElementById(id).disabled));
  check(locked, '🛑 while the pallet posts, Cancel, ×, Retake and Submit are locked');
  await page.evaluate(() => { window.__bd.listDelay.BL1 = 2500; });
  await page.waitForFunction(() => document.getElementById('bd-modal').style.display === 'none', null, { timeout: 8000 });
  check(await page.evaluate(() => ['bd-m-cancel', 'bd-m-close', 'bd-m-retake', 'bd-m-submit'].every(id => !document.getElementById(id).disabled)),
        '...and unlocked once it has');
  await page.evaluate(() => { window.__bd.scanDelay = 400; });
  await pickPhoto(page, PHOTO);                                   // while the log is still reloading
  await page.waitForTimeout(100);
  check(await page.isVisible('#bd-reading'), '🛑 a photo taken while the log reloads is read, not dropped');
  await page.waitForTimeout(3000);
  await page.evaluate(() => window.bdCloseModal());
  // Load order: "All stores" answers slowly, BL1 quickly — BL1 must be what stays.
  await page.evaluate(() => { window.__bd.listDelay = { ALL: 900, BL1: 0 }; });
  await page.click('#bd-tab-log'); await settle(page);
  await page.selectOption('#bd-store', 'ALL');
  await page.waitForTimeout(80);
  await page.selectOption('#bd-store', 'BL1');
  await page.waitForTimeout(1400);
  const shown = await page.evaluate(() => ({ store: [...document.querySelectorAll('#bd-weeks th')].some(t => t.textContent.trim() === 'Store'),
    status: document.getElementById('bd-log-status').textContent }));
  check(!shown.store, '🛑 an older "All stores" answer landing last does not redraw BL1 as All stores (bin-dump-2)');
  await ctx.close();
});

// ── 11. The duplicate prompt defaults to backing out (bin-dump-22) ──
await section('11. duplicate prompt (bin-dump-22)', async () => {
  const { ctx, page } = await open();
  await page.click('#bd-manual'); await settle(page);
  await page.fill('#bd-f-barcode', 'prm-10488-12');               // typed, lower case, a known pallet
  await page.click('#bd-m-submit');
  await waitDialog(page, 'Duplicate pallet');
  const rec = (await calls(page, 'bin-dump-recent')).pop();
  check(rec && /barcode=PRM-10488-12/.test(rec.url), '🔑 the pre-flight asks in capitals, so a typed repeat is caught (bin-dump-20)');
  const dlg = await page.evaluate(() => {
    const ok = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Log it anyway');
    return { focus: document.activeElement && document.activeElement.textContent.trim(), okBg: ok && getComputedStyle(ok).backgroundColor };
  });
  check(dlg.focus === "Don't log it", `Cancel — "Don't log it" — has focus (${dlg.focus})`);
  check(dlg.okBg === 'rgb(192, 57, 43)', `...and the override is red, not the green primary (${dlg.okBg})`);
  await page.keyboard.press('Enter'); await settle(page);
  check(!(await dialogWith(page, 'Duplicate pallet')) && (await calls(page, 'bin-dump-log')).length === 0,
        '🛑 a bare Enter backs out — nothing is logged');
  await page.click('#bd-m-submit');
  await waitDialog(page, 'Duplicate pallet');
  await page.keyboard.press('Tab');                               // to "Log it anyway"
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.getElementById('bd-modal').style.display === 'none', null, { timeout: 8000 });
  const log = (await calls(page, 'bin-dump-log')).pop();
  check(log && log.body.allow_duplicate === true && log.body.barcode === 'PRM-10488-12',
        'Tab to the override + Enter logs it, deliberately, in capitals');
  // Edit path: "Don't save".
  await page.evaluate(() => { window.__bd.updateDup = true; });
  await page.click('#bd-tab-log'); await settle(page);
  await page.locator('#bd-weeks .bd-wk.open .bd-when-btn').first().tap(); await settle(page);
  await page.click('#bd-m-submit');
  await waitDialog(page, 'Duplicate pallet');
  check(await page.evaluate(() => document.activeElement && document.activeElement.textContent.trim()) === "Don't save",
        'editing, Cancel reads "Don\'t save"');
  await page.keyboard.press('Escape'); await settle(page);
  // 🛑 The shared-dialog bug: Enter on a FOCUSED Cancel used to confirm. Delete's own
  // default (OK) is unchanged, but Shift+Tab to Cancel + Enter must now cancel.
  await page.click('#bd-m-delete');
  await waitDialog(page, 'Delete this pallet?');
  check(await page.evaluate(() => document.activeElement && document.activeElement.textContent.trim()) === 'Delete',
        'other dialogs are unchanged: Delete still opens focused on its OK');
  await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Enter'); await settle(page);
  check((await calls(page, 'bin-dump-delete')).length === 0 && !(await dialogWith(page, 'Delete this pallet?')),
        '🛑 ...and Enter on its focused Cancel cancels — it used to delete');
  await ctx.close();
});

// ── 12. View-only: copy and opener (bin-dump-23) ──
await section('12. view-only (bin-dump-23)', async () => {
  const { ctx, page, errs } = await open({ who: VIEWER });
  const s = await page.textContent('#bd-log-status');
  check(/tap a pallet's time to see it\./.test(s) && !/correct|Edit/.test(s), `a view-only account is told to "see", not "correct" (${s})`);
  await page.locator('#bd-weeks .bd-wk.open .bd-when-btn').first().tap(); await settle(page);
  check(/^Logged pallet/.test(await page.textContent('#bd-m-title')) && !(await page.isVisible('#bd-m-submit')),
        '...and the time opens the read-only "Logged pallet"');
  await page.evaluate(() => { window.bdCloseModal(); window.__bd.rows = []; window.bdLoad(); }); await settle(page);
  check((await page.textContent('#bd-log-status')).trim() === 'No pallets logged yet.', 'an empty log does not tell them to press a Begin they lack');
  check(!errs.length, `no page errors (${errs.slice(0, 2).join(' | ')})`);
  await ctx.close();
});

// ── 13. An edit or a delete is confirmed where the manager is (bin-dump-7) ──
await section('13. confirmations (bin-dump-7)', async () => {
  const { ctx, page, errs } = await open();
  const strip = async sel => (await page.isVisible(sel) ? (await page.textContent(sel)).trim() : null);
  // The element's OWN state, whether or not its pane is showing — "nothing written there".
  const own = id => page.evaluate(i => { const e = document.getElementById(i); return e.hidden ? null : e.textContent.trim(); }, id);
  const closed = () => page.waitForFunction(() => document.getElementById('bd-modal').style.display === 'none', null, { timeout: 8000 });
  // A pallet scanned first: its green line under Begin is what used to outlive its deletion.
  await page.click('#bd-manual'); await settle(page);
  await page.fill('#bd-f-barcode', 'PRM-700-1');
  await page.fill('#bd-f-pallet_name', 'MIS-SCAN');
  await page.click('#bd-m-submit'); await closed();
  check(/^Pallet logged at Coliseum · MIS-SCAN/.test(await strip('#bd-status') || ''), 'a new pallet is still confirmed under Begin');
  await page.click('#bd-tab-log'); await settle(page);
  check(await strip('#bd-log-note') === null, 'the Log strip is hidden until there is something to say');

  // Edit, with the list reload held back: the confirmation must not wait for it.
  await page.locator('#bd-weeks .bd-wk.open .bd-when-btn').first().tap(); await settle(page);
  check(await page.inputValue('#bd-f-pallet_name') === 'MIS-SCAN', '(the newest row is the pallet just scanned)');
  await page.fill('#bd-f-units', '12');
  await page.evaluate(() => { window.__bd.listDelay.BL1 = 1500; });
  await page.click('#bd-m-submit'); await closed();
  const early = [await strip('#bd-log-note'), await page.textContent('#bd-log-status')];
  check(early[0] === 'Changes saved.' && /Loading/.test(early[1]),
        `🛑 an edit is confirmed on the Log tab at once, before the reload lands (${early.join(' | ')})`);
  check(await own('bd-status') === null, '🛑 ...and nothing is under Begin — the old green line has gone too');
  // A newer load overtakes the slow one, then the slow one lands and is ignored (bin-dump-2).
  await page.evaluate(() => { window.__bd.listDelay.BL1 = 0; });
  await page.click('#bd-pane-log button:has-text("Refresh")');
  await page.waitForTimeout(1700);
  check(await strip('#bd-log-note') === 'Changes saved.' && /pallets? across/.test(await page.textContent('#bd-log-status')),
        '...and is still there, once, after both reloads have landed');
  // The second render (DESIGN.md §4.8 trap 8): a week toggle redraws the list, not the strip.
  await page.locator('#bd-weeks .bd-wk-head').first().click(); await settle(page);
  check(await strip('#bd-log-note') === 'Changes saved.', 'a week toggle redraws the list and leaves the strip alone');
  await page.locator('#bd-weeks .bd-wk-head').first().click(); await settle(page);

  // Delete the same pallet — the usual mis-scan correction.
  const before = await page.locator('#bd-weeks .bd-when-btn').count();
  await page.locator('#bd-weeks .bd-wk.open .bd-when-btn').first().tap(); await settle(page);
  const name = await page.inputValue('#bd-f-pallet_name');
  await page.click('#bd-m-delete');
  await waitDialog(page, 'Delete this pallet?');
  await page.keyboard.press('Enter'); await closed();
  const gone = await strip('#bd-log-note');
  check(name === 'MIS-SCAN' && (gone || '').startsWith('Deleted · MIS-SCAN'), `🛑 a delete is confirmed on the Log tab, naming the pallet (${gone})`);
  check(await own('bd-status') === null, '...and nothing is written under Begin');
  await settle(page);
  check(await page.locator('#bd-weeks .bd-when-btn').count() === before - 1, '(the reload drops the row)');

  // Back on Scan: nothing stale. A new pallet then clears the Log strip — one at a time.
  await page.click('#bd-tab-scan'); await settle(page);
  check(!(await page.isVisible('#bd-status')), '🛑 the Scan tab has nothing stale waiting under Begin');
  await page.click('#bd-manual'); await settle(page);
  await page.fill('#bd-f-barcode', 'PRM-700-2');
  await page.click('#bd-m-submit'); await closed();
  check(/^Pallet logged at Coliseum/.test(await strip('#bd-status') || '') && await own('bd-log-note') === null,
        'a new pallet is confirmed under Begin, and clears the Log strip');
  check(!errs.length, `no page errors (${errs.slice(0, 2).join(' | ')})`);

  // 🔑 By tab, not by action: the claim in bdSayDone's comment, proved rather than assumed.
  await page.click('#bd-tab-log'); await settle(page);
  await page.locator('#bd-weeks .bd-wk.open .bd-when-btn').first().tap(); await settle(page);
  await page.evaluate(() => window.navigateToPage('dashboard')); await settle(page);
  await page.evaluate(() => window.navigateToPage('bin-dump')); await settle(page);
  const back = await page.evaluate(() => ({ modal: document.getElementById('bd-modal').style.display,
    scan: !document.getElementById('bd-pane-scan').hidden, title: document.getElementById('bd-m-title').textContent.trim() }));
  check(back.modal === 'flex' && back.scan && /^Edit logged pallet/.test(back.title),
        `(an edit form left open across a visit comes back over the Scan tab: ${JSON.stringify(back)})`);
  await page.click('#bd-m-submit'); await closed();
  check(await strip('#bd-status') === 'Changes saved.' && await own('bd-log-note') === null,
        '...so its confirmation goes under Begin, where it can be seen');
  await ctx.close();
});

await b.close();
srv.close();
if (measured.length) console.log('Painted contrast:\n  ' + measured.join('\n  '));
const bad = results.filter(r => !r[0]);
for (const [okk, m] of results) if (!okk) console.log('  FAIL ' + m);
console.log(`\n${results.length - bad.length} passed, ${bad.length} failed`);
process.exit(bad.length ? 1 : 0);
