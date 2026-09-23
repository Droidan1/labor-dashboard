// Mark Out of Stock — the store an entry goes into, driven in a REAL BROWSER at phone width.
//
// 🛑 NOT PART OF `scripts/test.sh`, deliberately: the runner globs `test-*` and this needs
// playwright-core and a Chromium, neither of which is a repo dependency. Run it by hand
// after a change to the page:
//
//   npm install --no-save playwright-core
//   bash scripts/build.sh && node scripts/browser-mos.mjs
//
// 🔑 WHY IT EXISTS. oppbuys-mos-3 (docs/code-review-2026-09-22.md): with "All stores" picked,
// an entry was filed under the account's FIRST store, and a round trip away from the page
// put the picker back on that store without a word. scripts/test-mos.mjs executes the
// resolver, the claim and the lookup order; this checks what a person meets — at 390px, by
// tapping — and what was actually POSTED.
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
    '  node scripts/browser-mos.mjs\n\n' +
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
const PORT = 8094;
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
// Everything the page asks is answered here and recorded, so a check can say what was POSTED
// and not only what was drawn. Nothing reaches the network.
function pageMocks({ who, theme }) {
  try {
    localStorage.setItem('darkMode', String(theme !== 'light'));
    localStorage.setItem('darkFlavor', theme === 'oled' ? 'oled' : 'dark');
  } catch (e) {}
  const M = window.__mos = { calls: [], lookupDelay: 0 };
  const J = (x, st = 200) => new Response(JSON.stringify(x), { status: st, headers: { 'content-type': 'application/json' } });
  const API = 'https://api.retjghub.com/';
  const real = window.fetch;
  // A description with an ampersand: the green line must print it as "&", not "&amp;".
  const DESC = 'HEALTH & BEAUTY';
  window.fetch = async (u, o = {}) => {
    const s = String(u && u.url ? u.url : u);
    if (!s.startsWith(API)) return real(u, o);
    const url = new URL(s), action = url.searchParams.get('action');
    let body = {}; try { body = o.body ? JSON.parse(o.body) : {}; } catch (e) {}
    M.calls.push({ action, url: s, body });
    switch (action) {
      case 'auth-me': return J(who);
      case 'mos-list': return J({ ok: true, rows: [], months: [], truncated: false });
      case 'mos-lookup': {
        await new Promise(r => setTimeout(r, M.lookupDelay));
        const code = (url.searchParams.get('code') || '').toUpperCase();
        return J({ ok: true, code, item_no: '50038', description: DESC, description_source: 'learned',
                   unit_price_cents: 150, unit_cost_cents: 150, needs_description: false });
      }
      case 'mos-log':
        return J({ ok: true, id: 900 + M.calls.length, store: body.store, code: body.code, item_no: '50038',
                   description: DESC, description_source: 'learned', qty: body.qty,
                   unit_cost_cents: 150, unit_price_cents: 150 });
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
const MANAGER = { authenticated: true, email: 'alex@example.com', name: 'Alex M', role: 'manager', stores: ['BL1', 'BL4'], pages: {}, businesses: ['bl'] };
const ADMIN = { authenticated: true, email: 'sam@example.com', name: 'Sam A', role: 'admin', stores: [], pages: {}, businesses: ['bl'] };

async function open({ who = MANAGER, theme = 'light' } = {}) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    deviceScaleFactor: 2, timezoneId: 'America/New_York', locale: 'en-US', serviceWorkers: 'block' });
  live.add(ctx);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  // 🛑 Every request that is not this server is refused, so nothing can reach production.
  await page.route(u => !u.href.startsWith(`http://127.0.0.1:${PORT}`), r => r.abort());
  await page.addInitScript(pageMocks, { who, theme });
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.navigateToPage === 'function' && window.__mos.calls.some(c => c.action === 'auth-me'), null, { timeout: 10000 });
  await page.waitForTimeout(400);
  await page.addStyleTag({ content: '#error-banner,#swipe-label,#ptr-hint{display:none !important}' });
  await page.evaluate(() => window.navigateToPage('mos'));
  await page.waitForFunction(() => !document.getElementById('page-mos').classList.contains('hidden'), null, { timeout: 5000 });
  await page.waitForTimeout(400);
  const got = await page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light')
    + (document.documentElement.classList.contains('oled') ? '+oled' : ''));
  check(got === { light: 'light', dark: 'dark', oled: 'dark+oled' }[theme], `[${theme}] the app is ACTUALLY in ${theme} (${got})`);
  return { ctx, page, errs };
}
const settle = page => page.waitForTimeout(300);
const calls = (page, action) => page.evaluate(a => window.__mos.calls.filter(c => c.action === a), action);
const text = async (page, sel) => ((await page.textContent(sel)) || '').trim();
const lookUp = page => page.click('#mos-pane-mark button:has-text("Look it up")');
const revisit = async page => {
  await page.evaluate(() => window.navigateToPage('dashboard')); await settle(page);
  await page.evaluate(() => window.navigateToPage('mos')); await settle(page);
};
// Nothing wider than the phone: a longer Save label must wrap inside the commit bar.
const fits = page => page.evaluate(() => {
  const btn = document.getElementById('mos-save').getBoundingClientRect();
  return document.documentElement.scrollWidth <= innerWidth && btn.left >= 0 && btn.right <= innerWidth;
});

// ── 1. "All stores" refuses every way an entry starts ──────────────────
await section('1. All stores refuses', async () => {
  const { page, errs } = await open();
  check(await page.inputValue('#mos-store') === 'BL1' && await page.isVisible('#mos-pane-mark'),
        'the page opens on one store, on the Mark tab');
  await page.selectOption('#mos-store', 'ALL'); await settle(page);
  await page.fill('#mos-code', 'BL-50038-1_5');
  await lookUp(page); await settle(page);
  check((await calls(page, 'mos-lookup')).length === 0, '🛑 on "All stores", Look it up sends nothing');
  check(/^Pick the store this is being marked out at first\.$/.test(await text(page, '#mos-status')),
        '...and says to pick a store');
  // 🛑 On screen means ON TOP: the strip sits low in the panel, and a rect inside the viewport
  // can still be under the floating nav — which is exactly where it first landed at 390px.
  const seen = await page.evaluate(() => {
    const on = el => { const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      const hit = document.elementFromPoint(x, y); return r.top >= 0 && r.bottom <= innerHeight && !!hit && el.contains(hit); };
    return { status: on(document.getElementById('mos-status')), picker: on(document.getElementById('mos-store')) };
  });
  check(seen.status, '...where it can be read — nothing covers it');
  check(seen.picker, '...and the picker it points at is on screen too');
  check(await page.evaluate(() => document.activeElement && document.activeElement.id === 'mos-store'), '...pointing at the picker');
  check(await page.inputValue('#mos-code') === 'BL-50038-1_5', '...and the typed code stays in the box');
  await page.click('#mos-scan-btn'); await settle(page);
  check(await page.evaluate(() => !document.querySelector('script[src*="jsqr"]')) && /^Pick the store/.test(await text(page, '#mos-status')),
        '🛑 Scan QR refuses too, before the QR reader or the camera loads');
  let chooser = false;
  page.on('filechooser', () => { chooser = true; });
  await page.click('#mos-pane-mark button:has-text("Photo")'); await page.waitForTimeout(600);
  check(!chooser, '🛑 ...and so does Photo — no camera opens');
  check(!errs.length, `no page errors (${errs.slice(0, 2).join(' | ')})`);
});

// ── 2. A picked store is claimed, named and POSTED ─────────────────────
await section('2. Dupont, claimed and named', async () => {
  const { page, errs } = await open();
  await page.selectOption('#mos-store', 'ALL'); await settle(page);
  await page.fill('#mos-code', 'BL-50038-1_5');
  await lookUp(page); await settle(page);
  await page.selectOption('#mos-store', 'BL4'); await settle(page);
  // mosSetStatus('') HIDES the strip and leaves its text, so it is visibility that is checked.
  check(await page.inputValue('#mos-code') === 'BL-50038-1_5' && !(await page.isVisible('#mos-status')),
        '🔑 picking a store keeps the code and clears the refusal');
  await lookUp(page);
  await page.waitForFunction(() => !document.getElementById('mos-resolved').hidden, null, { timeout: 5000 });
  const look = (await calls(page, 'mos-lookup')).pop();
  check(look && /store=BL4/.test(look.url), 'the lookup asks as Dupont');
  check((await text(page, '#mos-save')) === 'Mark out at Dupont', 'the button says where it is going: "Mark out at Dupont"');
  check(await fits(page), '...and fits the phone');
  await page.click('#mos-reasons button:has-text("Damaged")');
  await page.click('button[aria-label="One more"]');
  await page.click('#mos-save');
  await page.waitForFunction(() => /^Marked out/.test(document.getElementById('mos-status').textContent), null, { timeout: 5000 });
  const log = (await calls(page, 'mos-log')).pop();
  check(log && log.body.store === 'BL4' && log.body.qty === 2, '🛑 the POST carries the claimed store');
  check((await text(page, '#mos-status')) === 'Marked out at Dupont · 2 × HEALTH & BEAUTY · $3.00 cost',
        'the green line names the store, and prints "&" as "&" (not "&amp;")');
  check((await text(page, '#mos-save')) === 'Mark out of stock', 'the button stops naming a store once the entry is done');
  check(!errs.length, `no page errors (${errs.slice(0, 2).join(' | ')})`);
});

// ── 3. Leaving the page: the pick survives, "All stores" never comes back ──
await section('3. round trips', async () => {
  const { page } = await open();
  await page.selectOption('#mos-store', 'BL4'); await settle(page);
  await revisit(page);
  check(await page.inputValue('#mos-store') === 'BL4', '🔑 the picked store survives leaving the page and coming back');
  // The second path in oppbuys-mos-3: a sticker on screen across a round trip.
  await page.fill('#mos-code', 'BL-50038-1_5');
  await lookUp(page);
  await page.waitForFunction(() => !document.getElementById('mos-resolved').hidden, null, { timeout: 5000 });
  await page.click('#mos-reasons button:has-text("Expired")');
  await revisit(page);
  check(!(await page.isHidden('#mos-resolved')) && (await text(page, '#mos-save')) === 'Mark out at Dupont',
        '(the looked-up sticker is still on screen after the round trip)');
  await page.click('#mos-save');
  await page.waitForFunction(() => /^Marked out/.test(document.getElementById('mos-status').textContent), null, { timeout: 5000 });
  const log = (await calls(page, 'mos-log')).pop();
  check(log && log.body.store === 'BL4', '🛑 ...and Save still files it under Dupont — it used to be Coliseum');
  await page.selectOption('#mos-store', 'ALL'); await settle(page);
  await revisit(page);
  check(await page.inputValue('#mos-store') === 'BL1', '"All stores" is never restored: the page opens on a real store');
});

// ── 4. A lookup that answers after the store changed fills nothing in ──
await section('4. late lookup', async () => {
  const { page } = await open();
  await page.selectOption('#mos-store', 'BL4'); await settle(page);
  await page.evaluate(() => { window.__mos.lookupDelay = 900; });
  await page.fill('#mos-code', 'BL-50038-1_5');
  await lookUp(page);
  await page.waitForTimeout(150);
  await page.selectOption('#mos-store', 'BL1');                  // changed while it was out
  await page.waitForTimeout(1200);
  check(await page.isHidden('#mos-resolved') && (await text(page, '#mos-save')) === 'Mark out of stock',
        '🛑 the late answer fills nothing in under the new store');
  check(await page.inputValue('#mos-code') === 'BL-50038-1_5', '...and the code is still there to look up again');
});

// ── 5. The longest name, and painted contrast, in every theme ──────────
for (const theme of ['light', 'dark', 'oled']) await section(`5. Battle Creek + paint [${theme}]`, async () => {
  const { page, errs } = await open({ who: ADMIN, theme });
  await page.selectOption('#mos-store', 'BL14'); await settle(page);
  await page.fill('#mos-code', 'BL-50038-1_5');
  await lookUp(page);
  await page.waitForFunction(() => !document.getElementById('mos-resolved').hidden, null, { timeout: 5000 });
  check((await text(page, '#mos-save')) === 'Mark out at Battle Creek' && await fits(page),
        `[${theme}] "Mark out at Battle Creek" fits the phone`);
  // The refusal and the pressed Stolen reason are red TEXT on their own wash (oppbuys-mos-11).
  const paint = sel => page.evaluate(s => {
    const n = document.querySelector(s), p = n.closest('.mos-panel');
    return { fg: getComputedStyle(n).color, bg: getComputedStyle(n).backgroundColor, panel: getComputedStyle(p).backgroundColor };
  }, sel);
  await page.click('#mos-reasons button:has-text("Stolen")');
  const stolen = await paint('#mos-reasons .mos-rz[data-r="Stolen"]');
  await page.selectOption('#mos-store', 'ALL'); await settle(page);
  await lookUp(page); await settle(page);
  const refusal = await paint('#mos-status');
  const rr = ratio(rgba(refusal.fg), over(rgba(refusal.bg), rgba(refusal.panel)));
  const sr = ratio(rgba(stolen.fg), over(rgba(stolen.bg), rgba(stolen.panel)));
  check(rgba(refusal.panel)[3] === 1 && rr >= 4.5, `[${theme}] the refusal reads ${rr.toFixed(2)}:1`);
  check(sr >= 4.5, `[${theme}] a pressed "Stolen" reads ${sr.toFixed(2)}:1`);
  measured.push(`${theme.padEnd(5)}  refusal ${rr.toFixed(2)}:1   Stolen pressed ${sr.toFixed(2)}:1`);
  check(!errs.length, `[${theme}] no page errors (${errs.slice(0, 2).join(' | ')})`);
});

await b.close();
srv.close();
if (measured.length) console.log('Painted contrast:\n  ' + measured.join('\n  '));
const bad = results.filter(r => !r[0]);
for (const [okk, m] of results) if (!okk) console.log('  FAIL ' + m);
console.log(`\n${results.length - bad.length} passed, ${bad.length} failed`);
process.exit(bad.length ? 1 : 0);
