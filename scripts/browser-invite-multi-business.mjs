// The Invite modal granting SEVERAL businesses, driven in a REAL BROWSER.
//
// 🛑 NOT PART OF `scripts/test.sh` — the runner globs `test-*`, and this needs
// playwright-core and a Chromium, neither of which is a repo dependency. Run by hand:
//
//   npm install --no-save playwright-core
//   bash scripts/build.sh && node scripts/browser-invite-multi-business.mjs
//   (on a Mac: PLAYWRIGHT_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
//
// The worker side is pinned by scripts/test-invite-business.mjs. This checks what a
// source test cannot: which blocks render ticked, that a unit grid shows only for a
// ticked business and a store-scoped role, the exact body POSTed, and that the taller
// modal still fits a phone and reads at >= 4.5:1 in both themes.
//
// 🛑 THE APP'S THEME IS A `.dark` CLASS FROM localStorage, NOT prefers-color-scheme.
// The class is set explicitly AND asserted before anything is measured.
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
await new Promise(r => srv.listen(8096, r));

// The three businesses as grant-options really returns them (migrations 030/031/085).
const BL = { id: 'bl', name: 'Bargain Lane', unitNoun: 'store', units: [
  ['BL1', 'Coliseum'], ['BL2', 'South Bend'], ['BL4', 'Dupont'], ['BL8', 'Holland'], ['BL14', 'Battle Creek'], ['BL16', 'Indy East'],
].map(([code, name]) => ({ code, name })) };
const ECOM = { id: 'ecom', name: 'E-Commerce', unitNoun: 'storefront', units: [] };
const LIVE = { id: 'live', name: 'Live Sales', unitNoun: 'store', units: [
  ['BL1', 'Coliseum'], ['BL14', 'Battle Creek'], ['BL16', 'Indy East'], ['BL2', 'South Bend'],
].map(([code, name]) => ({ code, name })) };

let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL ' + m); } };
const b = await chromium.launch({ executablePath: CHROME });

async function open(scheme, { role, businesses, roles, viewport }) {
  const ctx = await b.newContext({ colorScheme: scheme, viewport: viewport || { width: 1300, height: 1000 } });
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript(sc => { try { localStorage.setItem('darkMode', String(sc === 'dark')) } catch (e) {} }, scheme);
  await page.addInitScript(({ role, businesses, roles }) => {
    const real = window.fetch;
    window.__sent = null;
    window.fetch = async (u, o) => {
      const s = String(u);
      const J = x => new Response(JSON.stringify(x), { status: 200, headers: { 'content-type': 'application/json' } });
      if (s.includes('auth-me')) return J({ authenticated: true, email: 'a@b.com', name: 'Boss', role, stores: null, pages: {}, businesses: businesses.map(x => x.id) });
      if (s.includes('list-users')) return J({ ok: true, users: [] });
      if (s.includes('grant-options')) return J({ ok: true, businesses, roles });
      if (s.includes('invite-user')) { window.__sent = JSON.parse(o.body); return J({ ok: true, emailed: true }); }
      return real(u, o);
    };
  }, { role, businesses, roles });
  await page.goto('http://127.0.0.1:8096/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const l = document.getElementById('login-page'); if (l) l.style.display = 'none';
    const a = document.getElementById('app'); if (a) a.style.display = 'flex';
  });
  await page.evaluate(w => document.documentElement.classList.toggle('dark', w === 'dark'), scheme);
  await page.evaluate(() => window.navigateToPage('users'));
  await page.waitForTimeout(900);
  await page.evaluate(() => window.openInviteModal()); await page.waitForTimeout(400);
  return { ctx, page, errs };
}

const blk = id => `#invite-grants [data-invite-biz="${id}"]`;
const summary = page => page.textContent('#invite-access-summary').then(t => t.replace(/\s+/g, ' ').trim());
const submit = async page => { await page.evaluate(() => { window.__sent = null; }); await page.click('#invite-submit-btn'); await page.waitForTimeout(300); };

for (const scheme of ['dark', 'light']) {
  const t = scheme;

  // ── A superuser, three grantable businesses ─────────────────────────────
  {
    const { ctx, page, errs } = await open(scheme, { role: 'superuser', businesses: [BL, ECOM, LIVE], roles: ['admin', 'executive', 'manager', 'staff'] });
    ok(await page.evaluate(() => document.documentElement.classList.contains('dark')) === (t === 'dark'),
       `[${t}] 🛑 the app is ACTUALLY in ${t} mode before anything is measured`);
    ok(await page.isVisible('#invite-modal'), `[${t}] the invite modal opens`);
    ok(await page.locator('#invite-grants [data-invite-biz]').count() === 3, `[${t}] one block per grantable business`);
    ok(await page.isChecked(`${blk('bl')} .ig-on`), `[${t}] Bargain Lane starts ticked`);
    ok(!(await page.isChecked(`${blk('ecom')} .ig-on`)) && !(await page.isChecked(`${blk('live')} .ig-on`)),
       `[${t}] the other businesses start unticked`);
    ok(await page.isVisible(`${blk('bl')} .ig-units`), `[${t}] the Bargain Lane store grid shows for a manager`);
    ok(!(await page.isVisible(`${blk('live')} .ig-body`)), `[${t}] an unticked business shows no picker`);
    ok((await page.textContent(blk('ecom'))).includes('no storefronts yet'), `[${t}] E-Commerce says it has no storefronts yet`);
    ok(/No store picked in Bargain Lane/.test(await summary(page)), `[${t}] summary warns before a store is picked: "${await summary(page)}"`);

    await page.fill('#invite-email', 'new@x.com');
    await submit(page);
    ok(await page.evaluate(() => !window.__sent), `[${t}] a Bargain Lane manager with no store is not sent`);
    ok((await page.textContent('#invite-status')).includes('Select at least one store in Bargain Lane'), `[${t}] and says why`);

    // Pick stores, tick both other businesses.
    await page.check(`${blk('bl')} .ig-unit[value="BL1"]`);
    await page.check(`${blk('bl')} .ig-unit[value="BL4"]`);
    await page.check(`${blk('ecom')} .ig-on`);
    await page.check(`${blk('live')} .ig-on`);
    ok(await page.isChecked(`${blk('live')} .ig-all`), `[${t}] Live Sales defaults to every store`);
    ok(!(await page.isVisible(`${blk('live')} .ig-units`)), `[${t}] ...with its grid folded away`);
    const s1 = await summary(page);
    ok(s1 === 'Signs in as Manager with access to Bargain Lane (Coliseum, Dupont), E-Commerce and Live Sales (every store).',
       `[${t}] the summary names all three: "${s1}"`);

    // Narrow Live Sales to one store.
    await page.uncheck(`${blk('live')} .ig-all`);
    ok(await page.isVisible(`${blk('live')} .ig-units`), `[${t}] unticking Every store opens the grid`);
    ok(/No store picked in Live Sales/.test(await summary(page)), `[${t}] and warns until one is picked`);
    await page.check(`${blk('live')} .ig-unit[value="BL2"]`);
    ok((await summary(page)).includes('Live Sales (South Bend)'), `[${t}] the summary shows the narrowed store`);

    // 🛑 Nothing may spill outside the dialog sideways.
    const spill = await page.evaluate(() => {
      const m = document.querySelector('#invite-modal > div'); const mb = m.getBoundingClientRect();
      return [...m.querySelectorAll('#invite-grants *')].filter(e => {
        const r = e.getBoundingClientRect(); return r.width && (r.right > mb.right + 0.5 || r.left < mb.left - 0.5);
      }).map(e => e.className || e.tagName);
    });
    ok(spill.length === 0, `[${t}] 🛑 nothing overflows the modal sideways (spilling: ${spill.slice(0, 3)})`);

    // Contrast of every text style the blocks add, on the panel they sit on.
    const shades = await page.evaluate(() => {
      const bg = getComputedStyle(document.querySelector('#invite-modal > div')).backgroundColor;
      const pick = s => { const e = document.querySelector(s); return e ? { s, fg: getComputedStyle(e).color, bg } : null; };
      return [
        pick('#invite-grants [data-invite-biz="bl"] .ig-on + span'),
        pick('#invite-grants [data-invite-biz="ecom"] label span:last-child'),
        pick('#invite-grants [data-invite-biz="live"] .ig-all + span'),
        pick('#invite-grants [data-invite-biz="bl"] .ig-unit ~ span:last-child'),
        pick('#invite-access-summary'),
        pick('#invite-access-summary span'),
      ].filter(Boolean);
    });
    const rgb = x => (x.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const lum = v => { const f = v.map(n => { n /= 255; return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4) }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2] };
    ok(shades.length === 6, `[${t}] all six text styles found (${shades.length})`);
    for (const c of shades) {
      const [hi, lo] = [lum(rgb(c.fg)), lum(rgb(c.bg))].sort((a, z) => z - a);
      const ratio = (hi + 0.05) / (lo + 0.05);
      ok(ratio >= 4.5, `[${t}] ${c.s} is ${ratio.toFixed(2)}:1 on the modal — needs >= 4.5:1`);
    }

    await submit(page);
    const sent = await page.evaluate(() => window.__sent);
    ok(JSON.stringify(sent) === JSON.stringify({ email: 'new@x.com', role: 'manager', grants: [
      { business_id: 'bl', units: ['BL1', 'BL4'] }, { business_id: 'ecom', units: null }, { business_id: 'live', units: ['BL2'] },
    ] }), `[${t}] 🔑 one grant per business is POSTed: ${JSON.stringify(sent)}`);
    ok(!(await page.isVisible('#invite-modal')), `[${t}] the modal closes on success`);

    // Admin role: no unit pickers, and no unit list sent even though boxes were ticked.
    await page.evaluate(() => window.openInviteModal()); await page.waitForTimeout(300);
    ok(!(await page.isChecked(`${blk('ecom')} .ig-on`)), `[${t}] reopening starts fresh`);
    await page.fill('#invite-email', 'boss@x.com');
    await page.check(`${blk('bl')} .ig-unit[value="BL1"]`);
    await page.check(`${blk('live')} .ig-on`);
    await page.selectOption('#invite-role', 'admin');
    ok(!(await page.isVisible(`${blk('bl')} .ig-body`)) && !(await page.isVisible(`${blk('live')} .ig-body`)),
       `[${t}] an admin gets no unit pickers`);
    ok((await summary(page)) === 'Signs in as Admin with access to Bargain Lane (every store) and Live Sales (every store).',
       `[${t}] admin summary: "${await summary(page)}"`);
    await submit(page);
    ok(JSON.stringify(await page.evaluate(() => window.__sent)) === JSON.stringify({ email: 'boss@x.com', role: 'admin', grants: [
      { business_id: 'bl', units: null }, { business_id: 'live', units: null } ] }),
       `[${t}] an admin is sent with no unit lists: ${JSON.stringify(await page.evaluate(() => window.__sent))}`);

    // Nothing ticked.
    await page.evaluate(() => window.openInviteModal()); await page.waitForTimeout(300);
    await page.fill('#invite-email', 'none@x.com');
    await page.uncheck(`${blk('bl')} .ig-on`);
    ok(/No business ticked/.test(await summary(page)), `[${t}] summary says no business is ticked`);
    await submit(page);
    ok(await page.evaluate(() => !window.__sent), `[${t}] nothing is sent with no business ticked`);
    ok((await page.textContent('#invite-status')).includes('Tick at least one business'), `[${t}] and says why`);

    ok(errs.length === 0, `[${t}] no JS errors (${errs.slice(0, 2).join('; ')})`);
    await ctx.close();
  }

  // ── An admin who can grant only Bargain Lane: no tick-box to fiddle with ──
  {
    const { ctx, page, errs } = await open(scheme, { role: 'admin', businesses: [BL], roles: ['manager'] });
    ok(await page.locator('#invite-grants [data-invite-biz]').count() === 1, `[${t}] one block for a one-business admin`);
    ok(!(await page.isVisible(`${blk('bl')} .ig-on`)), `[${t}] its tick-box is hidden`);
    ok(await page.isVisible(`${blk('bl')} .ig-units`), `[${t}] and the store grid shows`);
    ok(!(await page.isVisible('#invite-role-admin')) || (await page.evaluate(() => el('invite-role-admin').classList.contains('hidden'))),
       `[${t}] Admin is not offered to an admin`);
    await page.fill('#invite-email', 'mgr@x.com');
    await page.check(`${blk('bl')} .ig-unit[value="BL16"]`);
    await submit(page);
    ok(JSON.stringify(await page.evaluate(() => window.__sent)) === JSON.stringify({ email: 'mgr@x.com', role: 'manager',
      grants: [{ business_id: 'bl', units: ['BL16'] }] }), `[${t}] a one-business invite posts one grant`);
    ok(errs.length === 0, `[${t}] no JS errors (${errs.slice(0, 2).join('; ')})`);
    await ctx.close();
  }

  // ── A phone: three businesses, every grid open, must still reach Send ────
  {
    const { ctx, page, errs } = await open(scheme, { role: 'superuser', businesses: [BL, ECOM, LIVE], roles: ['admin', 'manager'],
      viewport: { width: 375, height: 667 } });
    await page.check(`${blk('ecom')} .ig-on`);
    await page.check(`${blk('live')} .ig-on`);
    await page.uncheck(`${blk('live')} .ig-all`);
    const geo = await page.evaluate(() => {
      const m = document.querySelector('#invite-modal > div');
      return { h: m.getBoundingClientRect().height, vh: innerHeight, scrolls: m.scrollHeight > m.clientHeight,
               oy: getComputedStyle(m).overflowY, docW: document.documentElement.scrollWidth, vw: innerWidth };
    });
    ok(geo.h <= geo.vh, `[${t}] the modal fits the phone's height (${Math.round(geo.h)} ≤ ${geo.vh})`);
    ok(geo.scrolls && geo.oy === 'auto', `[${t}] and scrolls inside itself (overflow-y ${geo.oy})`);
    await page.locator('#invite-submit-btn').scrollIntoViewIfNeeded();
    ok(await page.isVisible('#invite-submit-btn'), `[${t}] Send Invite is reachable`);
    ok(geo.docW <= geo.vw, `[${t}] no sideways page scroll (${geo.docW} ≤ ${geo.vw})`);
    ok(errs.length === 0, `[${t}] no JS errors (${errs.slice(0, 2).join('; ')})`);
    await ctx.close();
  }
}
await b.close(); srv.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
