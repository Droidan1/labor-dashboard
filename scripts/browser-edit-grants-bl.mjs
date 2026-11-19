// The Edit modal's Bargain Lane stores, driven in a REAL BROWSER.
//
// 🛑 NOT PART OF `scripts/test.sh` (needs playwright-core and a Chromium). Run by hand:
//   npm install --no-save playwright-core
//   bash scripts/build.sh && node scripts/browser-edit-grants-bl.mjs
//   (on a Mac: PLAYWRIGHT_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
//
// 🔑 WHY. "Every store" for Bargain Lane saved units NULL, which allowedUnits reads
// as NO stores below admin, so a manager saved that way signed in to nothing. The
// worker now refuses it (test-grant-editor.mjs); this checks the modal never offers
// it, flags an empty pick as it happens, sends nothing when Save would be refused,
// and posts the picked stores. Both themes; the warning is measured at >= 4.5:1.
//
// 🛑 THE APP'S THEME IS A `.dark` CLASS FROM localStorage, NOT prefers-color-scheme.
let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch (e) {
  console.error('\nThis check needs playwright-core:  npm install --no-save playwright-core\n');
  process.exit(2);
}
const CHROME = process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium';

import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'dist');
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, s) => {
  const f = path.join(root, q.url === '/' ? 'index.html' : q.url.split('?')[0]);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end('no'); }
  s.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(s);
});
await new Promise(r => srv.listen(8098, r));

const U = a => a.map(([code, name]) => ({ code, name }));
const BUSINESSES = [
  { id: 'bl', name: 'Bargain Lane', unitNoun: 'store', units: U([['BL1', 'Coliseum'], ['BL2', 'South Bend'], ['BL4', 'Dupont'], ['BL8', 'Holland'], ['BL14', 'Battle Creek'], ['BL16', 'Indy East']]) },
  { id: 'ecom', name: 'E-Commerce', unitNoun: 'storefront', units: [] },
  { id: 'live', name: 'Live Sales', unitNoun: 'store', units: U([['BL1', 'Coliseum'], ['BL14', 'Battle Creek'], ['BL16', 'Indy East'], ['BL2', 'South Bend']]) },
];
const USERS = [
  { id: 'u1', email: 'locked@bl.com', name: 'Locked', role: 'manager', status: 'active', created_at: '2026-01-01', has_approval_pin: 0, approval_pin_failures: 0, associate: 0, stores: null },
  { id: 'u2', email: 'fine@bl.com', name: 'Fine', role: 'manager', status: 'active', created_at: '2026-01-02', has_approval_pin: 0, approval_pin_failures: 0, associate: 0, stores: '["BL1"]' },
];
const GRANTS = {
  u1: [{ business_id: 'bl', role: 'manager', units: null }, { business_id: 'ecom', role: 'manager', units: null }],
  u2: [{ business_id: 'bl', role: 'manager', units: ['BL1'] }],
};

let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL ' + m); } };
const b = await chromium.launch({ executablePath: CHROME });
const rgb = x => (x.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
const lum = v => { const f = v.map(n => { n /= 255; return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4) }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2] };
const ratio = (fg, bg) => { const [hi, lo] = [lum(rgb(fg)), lum(rgb(bg))].sort((a, z) => z - a); return (hi + 0.05) / (lo + 0.05); };

for (const scheme of ['dark', 'light']) {
  const t = scheme;
  const ctx = await b.newContext({ colorScheme: scheme, viewport: { width: 1300, height: 1000 } });
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript(sc => { try { localStorage.setItem('darkMode', String(sc === 'dark')) } catch (e) {} }, scheme);
  await page.addInitScript(({ USERS, GRANTS, BUSINESSES }) => {
    const real = window.fetch;
    window.__calls = [];
    window.fetch = async (u, o) => {
      const s = String(u);
      const J = x => new Response(JSON.stringify(x), { status: 200, headers: { 'content-type': 'application/json' } });
      if (s.includes('auth-me')) return J({ authenticated: true, email: 'a@b.com', name: 'Boss', role: 'superuser', stores: null, pages: {}, businesses: ['bl', 'ecom', 'live'] });
      if (s.includes('list-users')) return J({ ok: true, users: USERS });
      if (s.includes('grant-options')) return J({ ok: true, businesses: BUSINESSES, roles: ['admin', 'executive', 'manager', 'staff'] });
      if (s.includes('set-user-grants')) { window.__calls.push(['set-user-grants', JSON.parse(o.body)]); return J({ ok: true }); }
      if (s.includes('user-grants')) { const id = new URL(s, location.href).searchParams.get('id'); return J({ ok: true, grants: GRANTS[id] || [] }); }
      if (s.includes('update-user')) { window.__calls.push(['update-user', JSON.parse(o.body)]); return J({ ok: true }); }
      return real(u, o);
    };
  }, { USERS, GRANTS, BUSINESSES });
  await page.goto('http://127.0.0.1:8098/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const l = document.getElementById('login-page'); if (l) l.style.display = 'none';
    const a = document.getElementById('app'); if (a) a.style.display = 'flex';
  });
  await page.evaluate(w => document.documentElement.classList.toggle('dark', w === 'dark'), scheme);
  await page.evaluate(() => window.navigateToPage('users'));
  await page.waitForTimeout(900);
  ok(await page.evaluate(() => document.documentElement.classList.contains('dark')) === (t === 'dark'),
     `[${t}] 🛑 the app is ACTUALLY in ${t} mode before anything is measured`);

  const BL = '#edit-grants [data-biz="bl"]', LIVE = '#edit-grants [data-biz="live"]';
  const open = async id => { await page.evaluate(id => window.openEditUserModal(id), id); await page.waitForTimeout(500); await page.evaluate(() => { window.__calls = []; }); };
  const save = async () => { await page.click('#edit-user-submit-btn'); await page.waitForTimeout(400); return page.evaluate(() => window.__calls); };

  // ── The manager "Every store" already locked out ──────────────────────
  await open('u1');
  ok(await page.locator(`${BL} .gr-all`).count() === 0, `[${t}] 🛑 Bargain Lane offers no "Every store" box`);
  ok(await page.locator(`${LIVE} .gr-all`).count() === 1, `[${t}] Live Sales keeps "Every store" (NULL means every unit there)`);
  ok(await page.isVisible(`${BL} .gr-units`), `[${t}] the store grid is shown straight away`);
  ok(await page.locator(`${BL} .gr-unit:checked`).count() === 0, `[${t}] no store is ticked for the locked-out manager`);
  ok(await page.isVisible(`${BL} .gr-warn`), `[${t}] the empty pick is flagged`);
  ok((await page.textContent(`${BL} .gr-warn`)).includes('see nothing in Bargain Lane'), `[${t}] and says what it means`);

  const warnC = await page.evaluate(() => ({
    fg: getComputedStyle(document.querySelector('#edit-grants [data-biz="bl"] .gr-warn')).color,
    bg: getComputedStyle(document.querySelector('#edit-user-modal > div')).backgroundColor }));
  const wr = ratio(warnC.fg, warnC.bg);
  ok(wr >= 4.5, `[${t}] the warning is ${wr.toFixed(2)}:1 on the modal — needs >= 4.5:1`);

  const none = await save();
  ok(none.length === 0, `[${t}] 🛑 Save sends NOTHING (not even the status) while no store is picked: ${JSON.stringify(none)}`);
  ok((await page.textContent('#edit-user-status')).includes('Select at least one Bargain Lane store'), `[${t}] and says why`);
  ok(await page.isVisible('#edit-user-modal'), `[${t}] the modal stays open`);

  await page.check(`${BL} .gr-unit[value="BL4"]`);
  ok(!(await page.isVisible(`${BL} .gr-warn`)), `[${t}] picking a store clears the warning`);
  const sent = await save();
  const grants = (sent.find(c => c[0] === 'set-user-grants') || [])[1];
  ok(grants && JSON.stringify(grants.grants) === JSON.stringify([
    { business_id: 'bl', role: 'manager', units: ['BL4'] }, { business_id: 'ecom', role: 'manager', units: null } ]),
     `[${t}] 🔑 the picked store is POSTed: ${JSON.stringify(grants)}`);

  // ── Admin: no stores needed, none sent ─────────────────────────────────
  await open('u1');
  await page.selectOption(`${BL} .gr-role`, 'admin');
  ok(!(await page.isVisible(`${BL} .gr-units`)) && !(await page.isVisible(`${BL} .gr-warn`)),
     `[${t}] an admin gets no store grid and no warning`);
  const adm = (await save()).find(c => c[0] === 'set-user-grants');
  ok(adm && JSON.stringify(adm[1].grants[0]) === JSON.stringify({ business_id: 'bl', role: 'admin', units: null }),
     `[${t}] an admin is sent with units null: ${JSON.stringify(adm && adm[1].grants[0])}`);

  // Back to manager: the grid and the warning return.
  await open('u1');
  await page.selectOption(`${BL} .gr-role`, 'admin');
  await page.selectOption(`${BL} .gr-role`, 'manager');
  ok(await page.isVisible(`${BL} .gr-units`) && await page.isVisible(`${BL} .gr-warn`), `[${t}] switching back to manager brings both back`);

  // ── A manager who already has a store ──────────────────────────────────
  await open('u2');
  ok(await page.isChecked(`${BL} .gr-unit[value="BL1"]`), `[${t}] an existing store shows ticked`);
  ok(!(await page.isVisible(`${BL} .gr-warn`)), `[${t}] and no warning`);

  const spill = await page.evaluate(() => {
    const m = document.querySelector('#edit-user-modal > div'); const mb = m.getBoundingClientRect();
    return [...m.querySelectorAll('#edit-grants *')].filter(e => { const r = e.getBoundingClientRect();
      return r.width && (r.right > mb.right + 0.5 || r.left < mb.left - 0.5); }).length;
  });
  ok(spill === 0, `[${t}] nothing overflows the modal sideways (${spill})`);
  ok(errs.length === 0, `[${t}] no JS errors (${errs.slice(0, 2).join('; ')})`);
  await ctx.close();
}
await b.close(); srv.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
