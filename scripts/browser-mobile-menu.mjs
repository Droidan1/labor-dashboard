// The phone bar and the Menu page, driven in a REAL BROWSER, one account per role.
//
// 🛑 NOT PART OF `scripts/test.sh`, deliberately, for the same reason as
// browser-inventory-nav.mjs: it needs playwright-core and a Chromium. Run it by hand
// after any change to the sidebar, the bottom bar or the Menu page:
//
//   npm install --no-save playwright-core
//   bash scripts/build.sh && node scripts/browser-mobile-menu.mjs
//
// 🔑 WHAT IT PINS. The Menu page is GENERATED from the sidebar, so it inherits every
// role, associate and business gate the sidebar applies — and every sidebar item a role
// can see but navigateToPage refuses becomes a dead row on the phone. So this file:
//
//   1. States each role's Menu by hand (EXPECT below) instead of re-deriving it from the
//      sidebar, which would only prove the renderer agrees with itself.
//   2. OPENS EVERY ROW and checks its page actually shows. A row the router refuses is
//      the failure mode of a generated menu, and it is silent — the tap does nothing.
//   3. Measures the bar: tab order, equal widths, Submit dead centre on a manager's bar.
//   4. Computes contrast from what the browser paints, in light, dark and pure black,
//      against the composited background — CLAUDE.md's ≥ 4.5:1, never a screenshot.
//
// 🛑 THE APP'S THEME IS A `.dark` CLASS DRIVEN BY localStorage, NOT prefers-color-scheme,
// and pure black is `darkFlavor=oled` on top of it. Both are written before boot and
// asserted after, rather than trusted.
let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch (e) {
  console.error('\nThis check needs playwright-core, which is not a dependency of this repo.\n\n' +
    '  npm install --no-save playwright-core\n  bash scripts/build.sh\n  node scripts/browser-mobile-menu.mjs\n');
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
const types = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript', '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml' };
const srv = http.createServer((q, s) => {
  const f = path.join(root, q.url === '/' ? 'index.html' : q.url.split('?')[0]);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end('no'); }
  s.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(s);
});
await new Promise(r => srv.listen(8096, r));
const URL_ = 'http://127.0.0.1:8096/index.html';

const BL = { id: 'bl', name: 'Bargain Lane' }, ECOM = { id: 'ecom', name: 'E-Commerce' };
const STORE = ['dashboard', 'weekly-summary', 'labor', 'supply-request'];
const MARKETING = ['marketing', 'flow-calendar', 'comments', 'content', 'submit-photos'];
const MERCH = ['merch-scan', 'merch-coverage', 'merch-products', 'merch-velocity', 'merch-manifests', 'merch-criteria', 'merch-shelf-count'];
const INVENTORY = ['inventory-add', 'inventory-viewer', 'inventory-sale', 'bin-dump', 'inventory-receiver', 'mos', 'opportunity-buys'];
// Each role's phone, written down. '@switch' / '@signout' are the two action rows.
const EXPECT = {
  superuser: { role: 'superuser', businesses: [BL, ECOM], biz: 'bl',
    bar: ['Dashboard', 'Retail', 'Content', 'Flow', 'Menu'],
    menu: [['Store', STORE], ['Marketing', MARKETING], ['Merchandising', MERCH], ['Inventory', INVENTORY],
           ['Admin', ['users', 'admin-settings']], ['Account', ['@switch', 'settings', '@signout']]] },
  admin: { role: 'admin', businesses: [BL], biz: 'bl',
    bar: ['Dashboard', 'Retail', 'Content', 'Flow', 'Menu'],
    menu: [['Store', STORE], ['Marketing', MARKETING], ['Merchandising', MERCH], ['Inventory', INVENTORY],
           ['Admin', ['users']], ['Account', ['settings', '@signout']]] },
  // Price Scan left this bar for the Menu (Brian, 2026-09-22). Comments is NOT here: it is
  // admin-only in the router, and was a dead sidebar item for every manager until now.
  manager: { role: 'manager', businesses: [BL], biz: 'bl',
    bar: ['Dashboard', 'Retail', 'Submit', 'Supply', 'Menu'],
    menu: [['Store', STORE], ['Marketing', ['submit-photos']], ['Merchandising', ['merch-scan', 'merch-shelf-count']],
           ['Inventory', ['bin-dump', 'inventory-receiver', 'mos', 'opportunity-buys']], ['Account', ['settings', '@signout']]] },
  // The router admits an executive to Price Scan but not Shelf Count; the Merchandising
  // header used to hide both from them. No Supply, so four tabs, not five.
  executive: { role: 'executive', businesses: [BL], biz: 'bl',
    bar: ['Dashboard', 'Retail', 'Submit', 'Menu'],
    menu: [['Store', ['dashboard', 'weekly-summary', 'labor']], ['Marketing', ['submit-photos']], ['Merchandising', ['merch-scan']],
           ['Inventory', ['bin-dump', 'inventory-receiver', 'mos', 'opportunity-buys']], ['Account', ['settings', '@signout']]] },
  // Receiver is granted but has no bar tab of its own, so it lives on the Menu.
  associate: { role: 'associate', associate: true, businesses: [BL], biz: 'bl',
    pages: { 'bin-dump': 'edit', 'mos': 'edit', 'inventory-receiver': 'view' },
    bar: ['Bin Dump', 'MOS', 'Menu'],
    menu: [['Inventory', ['bin-dump', 'inventory-receiver', 'mos']], ['Account', ['@signout']]] },
  ecom: { role: 'superuser', businesses: [BL, ECOM], biz: 'ecom',
    bar: ['eBay Cases', 'Menu'],
    menu: [['E-Commerce', ['ebay-cases']], ['Account', ['@switch', 'settings', '@signout']]] },
};

const results = [];
const allBlocked = new Set();
const check = (c, m) => { results.push([!!c, m]); };
const eq = (got, want, m) => {
  const same = JSON.stringify(got) === JSON.stringify(want);
  check(same, `${m}${same ? '' : `  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`);
};

const b = await chromium.launch({ executablePath: CHROME });

async function open(key, { theme = 'dark', width = 393, height = 852 } = {}) {
  const x = EXPECT[key];
  const ctx = await b.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errs = [], blocked = new Set();
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => {
    if (m.type() !== 'error' || /Failed to load resource|net::ERR_/.test(m.text())) return;
    errs.push('console: ' + m.text());
  });
  page.on('requestfailed', r => { try { const h = new URL(r.url()).host; if (!h.startsWith('127.0.0.1')) blocked.add(h); } catch (e) {} });
  await page.addInitScript(({ theme, biz }) => {
    try {
      localStorage.setItem('darkMode', String(theme !== 'light'));
      localStorage.setItem('darkFlavor', theme === 'oled' ? 'oled' : 'dark');
      sessionStorage.setItem('retjg.activeBusiness', biz);
    } catch (e) {}
  }, { theme, biz: x.biz });
  await page.addInitScript(({ x }) => {
    window.fetch = async (u) => {
      const s = String(u);
      const J = v => new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });
      if (s.includes('auth-me')) return J({ authenticated: true, email: 'dana.ruiz@example.com', name: 'Dana Ruiz',
        role: x.role, associate: !!x.associate, pages: x.pages || {}, businesses: x.businesses });
      // Weekly Retail renders `d.stores[s]` for every store; a bare {ok:true} throws there
      // at any width. That is the stub's fault, not the Menu's, so give it the shape.
      if (s.includes('action=weekly-summary')) return J({ ok: true, from: '2026-09-14', to: '2026-09-20', stores: {}, totals: {} });
      return J({ ok: true });
    };
  }, { x });
  await page.goto(URL_, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.getElementById('app')?.classList.contains('hidden'), { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(500);
  const got = await page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light')
    + (document.documentElement.classList.contains('oled') ? '+oled' : ''));
  check(got === { light: 'light', dark: 'dark', oled: 'dark+oled' }[theme], `${key}: theme loaded as ${theme} (${got})`);
  return { ctx, page, errs, blocked };
}

const barState = page => page.evaluate(() => {
  const nav = document.getElementById('bottom-nav');
  const nr = nav.getBoundingClientRect();
  const tabs = [...nav.querySelectorAll('.bn-tab')].filter(t => t.offsetParent !== null).map(t => {
    const r = t.getBoundingClientRect();
    return { label: t.querySelector('.bn-lb').textContent, id: t.id, w: r.width, cx: r.left + r.width / 2,
             on: t.classList.contains('text-accent-green') };
  });
  return { tabs, cx: nr.left + nr.width / 2 };
});
const visiblePages = page => page.$$eval('[id^="page-"]', ps => ps.filter(p => !p.classList.contains('hidden')).map(p => p.id));
const menuState = page => page.evaluate(() => [...document.querySelectorAll('#menu-list [data-menu-sec]')]
  .filter(s => !s.hidden)
  .map(s => [s.querySelector('h2').textContent,
             [...s.querySelectorAll('.menu-row')].filter(r => !r.hidden)
               .map(r => r.dataset.page || '@' + r.dataset.act)]));

// ── 1. Every role: the bar, the Menu, and every row on it ───────────────────────
for (const key of Object.keys(EXPECT)) {
  const x = EXPECT[key];
  const { ctx, page, errs, blocked } = await open(key);

  const bar = await barState(page);
  eq(bar.tabs.map(t => t.label), x.bar, `${key}: bar tabs`);
  const ws = bar.tabs.map(t => t.w);
  check(Math.max(...ws) - Math.min(...ws) <= 1, `${key}: tabs share the bar evenly (${ws.map(w => w.toFixed(1)).join(' / ')})`);
  check(Math.min(...ws) >= 48, `${key}: narrowest tab is ≥ 48px (${Math.min(...ws).toFixed(1)})`);
  // Centred by construction on the manager's five: two tabs either side. An executive has
  // no Supply, so Submit is third of four there — even widths, not centre, is the promise.
  const sub = bar.tabs.find(t => t.id === 'bn-submit-photos');
  if (key === 'manager') check(sub && Math.abs(sub.cx - bar.cx) <= 1, `${key}: Submit sits dead centre (off by ${sub ? (sub.cx - bar.cx).toFixed(2) : '?'}px)`);
  check(bar.tabs.filter(t => t.on).length === 1, `${key}: exactly one tab is lit on the landing page`);

  // Open the Menu from the bar, like a thumb would.
  const from = (await visiblePages(page))[0];
  await page.click('#bn-menu');
  await page.waitForTimeout(150);
  eq(await visiblePages(page), ['page-menu'], `${key}: the Menu tab opens the Menu page, alone`);
  check((await barState(page)).tabs.find(t => t.id === 'bn-menu')?.on, `${key}: and lights the Menu tab`);
  eq(await menuState(page), x.menu, `${key}: the Menu lists exactly this role's pages, grouped`);
  check(await page.evaluate(() => [...document.querySelectorAll('#menu-list .menu-row')]
          .every(r => r.getBoundingClientRect().height >= 44)), `${key}: every row is at least 44px tall`);

  // The Menu tab again goes back where you came from.
  await page.click('#bn-menu');
  await page.waitForTimeout(150);
  eq(await visiblePages(page), [from], `${key}: tapping Menu again returns to ${from}`);

  // 🛑 No dead rows: open every one and check its page is what shows.
  await page.evaluate(() => navigateToPage('menu'));
  const rowPages = await page.$$eval('#menu-list .menu-row[data-page]', rs => rs.map(r => r.dataset.page));
  const dead = [];
  for (const p of rowPages) {
    await page.evaluate(() => navigateToPage('menu'));
    await page.waitForTimeout(40);
    const row = page.locator(`#menu-list .menu-row[data-page="${p}"]`);
    await row.evaluate(e => e.scrollIntoView({ block: 'center' }));
    await row.click({ timeout: 3000 });
    await page.waitForTimeout(80);
    const shown = await visiblePages(page);
    if (JSON.stringify(shown) !== JSON.stringify(['page-' + p])) dead.push(`${p} -> ${shown}`);
  }
  check(dead.length === 0, `${key}: all ${rowPages.length} page rows open their page${dead.length ? ': ' + dead.join(', ') : ''}`);
  // ...and the lit tab follows: a page with a tab lights it, anything else lights Menu.
  await page.evaluate(() => navigateToPage('settings'));
  if (x.menu.at(-1)[1].includes('settings')) {
    const lit = (await barState(page)).tabs.filter(t => t.on).map(t => t.label);
    eq(lit, ['Menu'], `${key}: standing on Settings lights Menu`);
  }

  // Account card: name first, then role · business.
  await page.evaluate(() => navigateToPage('menu'));
  const acct = await page.evaluate(() => ({
    av: document.getElementById('menu-avatar').textContent,
    name: document.getElementById('menu-name').textContent,
    sub: document.getElementById('menu-sub').innerText,
  }));
  eq(acct.av, 'DR', `${key}: avatar initials`);
  eq(acct.name, 'Dana Ruiz', `${key}: the name, not the email`);
  check(acct.sub.includes(x.biz === 'ecom' ? 'E-Commerce' : 'Bargain Lane'), `${key}: says which business (${acct.sub})`);

  check(errs.length === 0, `${key}: no JS errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
  blocked.forEach(h => allBlocked.add(h));
  await ctx.close();
}

// ── 2. Search, Enter, and the one row Enter must never press ────────────────────
{
  const { ctx, page, errs, blocked } = await open('superuser');
  await page.click('#bn-menu');
  await page.fill('#menu-search', 'rec');
  eq(await menuState(page), [['Inventory', ['inventory-receiver']]], 'search "rec" leaves only Inventory Receiver');
  await page.fill('#menu-search', 'store');
  eq((await menuState(page)).map(s => s[0]), ['Store'], 'a section name finds its whole section');
  await page.fill('#menu-search', 'zzz');
  eq(await menuState(page), [], 'no match hides every section');
  check(await page.$eval('#menu-empty', e => !e.hidden && e.textContent.includes('zzz')), '...and says nothing matches');
  await page.fill('#menu-search', 'sign');
  eq(await menuState(page), [['Account', ['@signout']]], 'search "sign" leaves only Sign out');
  await page.press('#menu-search', 'Enter');
  await page.waitForTimeout(150);
  eq(await visiblePages(page), ['page-menu'], '🛑 Enter does NOT press Sign out');
  await page.fill('#menu-search', 'velo');
  await page.press('#menu-search', 'Enter');
  await page.waitForTimeout(150);
  eq(await visiblePages(page), ['page-merch-velocity'], 'Enter opens the first page left');
  await page.evaluate(() => navigateToPage('menu'));
  eq(await page.$eval('#menu-search', e => e.value), '', 'coming back to the Menu starts with an empty search');
  eq((await menuState(page)).length, 6, '...and every section showing');
  // The six pages the phone never had, and the Desktop tag on the five wide tables.
  const hints = await page.$$eval('#menu-list .menu-row[data-page]', rs => rs
    .filter(r => r.querySelectorAll('span').length > 2).map(r => r.dataset.page));
  eq(hints, ['merch-coverage', 'merch-products', 'merch-velocity', 'merch-manifests', 'merch-criteria'],
     'the five Merchandising tables carry the Desktop tag');
  // Dark mode from the account card.
  const before = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  await page.click('#menu-dark');
  const after = await page.evaluate(() => ({ dark: document.documentElement.classList.contains('dark'),
    pressed: document.getElementById('menu-dark').getAttribute('aria-pressed') }));
  check(after.dark === !before && after.pressed === String(after.dark), `the moon toggles dark mode (${JSON.stringify(after)})`);
  await page.click('#menu-dark');
  // Switch business goes to the picker.
  await page.$eval('#menu-list .menu-row[data-act="switch"]', e => e.scrollIntoView({ block: 'center' }));
  await page.click('#menu-list .menu-row[data-act="switch"]');
  await page.waitForTimeout(200);
  eq(await visiblePages(page), ['page-landing'], 'Switch business opens the picker');
  check(errs.length === 0, `search: no JS errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
  blocked.forEach(h => allBlocked.add(h));
  await ctx.close();
}

// ── 3. Geometry on the smallest phone: the last row clears the bar ──────────────
for (const key of ['superuser', 'manager']) {
  const { ctx, page, errs, blocked } = await open(key, { width: 375, height: 667 });
  const ws = (await barState(page)).tabs.map(t => t.w);
  check(Math.min(...ws) >= 48 && Math.max(...ws) - Math.min(...ws) <= 1, `SE ${key}: even tabs, none under 48px (${ws.map(w => w.toFixed(1)).join(' / ')})`);
  await page.click('#bn-menu');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(200);
  // The bar hides on scroll-down; show it, the worst case, and check it covers nothing.
  await page.evaluate(() => document.getElementById('bottom-nav').classList.remove('translate-y-full'));
  await page.waitForTimeout(350);
  const g = await page.evaluate(() => {
    const out = document.querySelector('#menu-list .menu-row[data-act="signout"]').getBoundingClientRect();
    const bar = document.getElementById('bottom-nav').getBoundingClientRect();
    const hit = document.elementFromPoint(out.left + out.width / 2, out.top + out.height / 2);
    return { bottom: out.bottom, barTop: bar.top, hit: !!hit?.closest('[data-act="signout"]') };
  });
  check(g.bottom <= g.barTop && g.hit, `SE ${key}: Sign out ends at ${g.bottom.toFixed(0)}px, above the bar at ${g.barTop.toFixed(0)}px, and takes the tap`);
  check(errs.length === 0, `SE ${key}: no JS errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
  blocked.forEach(h => allBlocked.add(h));
  await ctx.close();
}

// ── 4. Contrast on the Menu and the bar, three themes, computed not eyeballed ───
for (const theme of ['light', 'dark', 'oled']) {
  for (const key of ['superuser', 'manager']) {
    const { ctx, page, errs, blocked } = await open(key, { theme });
    await page.click('#bn-menu');
    await page.waitForTimeout(200);
    const bad = await page.evaluate(() => {
      const lum = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
        return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); };
      const ratio = (a, b) => { const [h, l] = lum(a) > lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)]; return (h + .05) / (l + .05); };
      const parse = s => { const m = s && s.match(/rgba?\(([^)]+)\)/); if (!m) return null;
        const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return { rgb: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 }; };
      const over = (fg, a, bg) => fg.map((c, i) => c * a + bg[i] * (1 - a));
      // Composite every translucent wash up to the first opaque ground.
      const bgOf = node => {
        const stack = []; let e = node;
        while (e && e !== document.documentElement) {
          const c = parse(getComputedStyle(e).backgroundColor);
          if (c && c.a > 0) { stack.push(c); if (c.a === 1) break; }
          e = e.parentElement;
        }
        const rootBg = parse(getComputedStyle(document.body).backgroundColor) || { rgb: [255, 255, 255], a: 1 };
        let base = stack.length && stack[stack.length - 1].a === 1 ? stack.pop().rgb : rootBg.rgb;
        for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i].rgb, stack[i].a, base);
        return base;
      };
      const out = [], seen = new Set();
      const judge = (label, el, color) => {
        const cs = getComputedStyle(el);
        const fg = parse(color || cs.color); if (!fg) return;
        const bg = bgOf(el);
        const eff = fg.a < 1 ? over(fg.rgb, fg.a, bg) : fg.rgb;
        const px = parseFloat(cs.fontSize);
        const min = (px >= 24 || (px >= 18.66 && parseInt(cs.fontWeight) >= 700)) ? 3 : 4.5;
        const key = (color || cs.color) + '|' + bg.map(Math.round).join() + '|' + min;
        if (seen.has(key)) return; seen.add(key);
        const r = ratio(eff, bg);
        if (r < min) out.push(`${r.toFixed(2)}:1 (min ${min}) "${label}" ${color || cs.color} on rgb(${bg.map(Math.round).join(',')})`);
      };
      for (const root of [document.getElementById('page-menu'), document.getElementById('bottom-nav')]) {
        const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = w.nextNode())) {
          if (!n.textContent.trim()) continue;
          const e = n.parentElement, cs = getComputedStyle(e);
          if (cs.display === 'none' || cs.visibility === 'hidden' || !e.getClientRects().length) continue;
          judge(n.textContent.trim().slice(0, 30), e);
        }
      }
      const q = document.getElementById('menu-search');
      judge('placeholder', q, getComputedStyle(q, '::placeholder').color);
      return out;
    });
    check(bad.length === 0, `${theme} ${key}: every visible text node on the Menu and bar clears AA`
      + (bad.length ? '\n     ' + bad.join('\n     ') : ''));
    check(errs.length === 0, `${theme} ${key}: no JS errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
    blocked.forEach(h => allBlocked.add(h));
    await ctx.close();
  }
}

await b.close();
srv.close();
if (allBlocked.size) {
  console.log(`\nOff-origin requests that did not load (not a page fault): ${[...allBlocked].join(', ')}`);
  console.log('The fonts are the only ones expected; anything else here is worth a look.');
}
const failed = results.filter(([ok]) => !ok);
for (const [ok, m] of results) console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${m}`);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
