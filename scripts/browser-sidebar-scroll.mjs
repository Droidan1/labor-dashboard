// The desktop sidebar on a SHORT window, driven in a REAL BROWSER.
//
// 🛑 NOT PART OF `scripts/test.sh`, deliberately — it needs playwright-core and a Chromium,
// like every browser-*.mjs. Run it by hand after touching the sidebar's layout or adding
// nav items:
//
//   npm install --no-save playwright-core
//   bash scripts/build.sh && node scripts/browser-sidebar-scroll.mjs
//   (on a Mac: PLAYWRIGHT_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
//
// 🔑 WHY IT EXISTS. The sidebar is `h-screen overflow-hidden`, and its nav list is a flex
// child whose min-height defaults to its content — so the list could never be shorter than
// itself and the aside clipped whatever did not fit, with nothing to scroll. On a Mac's
// tall window everything fit and nobody saw it. On a store's Windows PC (1080p at 125–150%
// scaling, ~600px of page) a superuser's list is ~800px with every group CLOSED: Settings,
// dark mode and the collapse toggle sat below the bottom edge, unreachable, and opening the
// three groups hid twenty more items. Reported 2026-09-30 as "can't scroll the side bar".
// A text test can confirm the CSS rule is present; only layout can show it WORKS.
let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch (e) {
  console.error(
    '\nThis check needs playwright-core, which is not a dependency of this repo.\n\n' +
    '  npm install --no-save playwright-core\n' +
    '  bash scripts/build.sh\n' +
    '  node scripts/browser-sidebar-scroll.mjs\n\n' +
    'A Chromium is also needed: PLAYWRIGHT_CHROMIUM=<path>, or `npx playwright install chromium`.\n');
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
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const URL_ = `http://127.0.0.1:${srv.address().port}/index.html`;

const results = [];
const check = (c, m) => { results.push([!!c, m]); };
const b = await chromium.launch({ executablePath: CHROME });

// A superuser sees every item and all three groups — the longest list there is.
async function open({ width, height }) {
  const ctx = await b.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  // The app's own opt-outs for its post-login popups. On a Mac with Touch ID the passkey
  // prompt opens over the page a beat after sign-in and swallows clicks and wheel events,
  // which reads exactly like a sidebar that will not scroll.
  await page.addInitScript(() => {
    try { localStorage.setItem('bioPromptDismissed', '1'); localStorage.setItem('coachTipsDisabled', '1'); } catch (e) {}
  });
  await page.addInitScript(() => {
    window.fetch = async (u) => {
      const J = x => new Response(JSON.stringify(x), { status: 200, headers: { 'content-type': 'application/json' } });
      if (String(u).includes('auth-me')) return J({ authenticated: true, email: 'b@b.com', name: 'Brian',
        role: 'superuser', associate: false, pages: {}, businesses: [{ id: 'bl', name: 'Bargain Lane' }] });
      return J({ ok: true });
    };
  });
  await page.goto(URL_, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.getElementById('app')?.classList.contains('hidden'), { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(350);
  // A click that cannot land is a failed check, not a crash that hides every other result.
  const click = async (sel) => {
    try { await page.click(sel, { timeout: 3000 }); return true; }
    catch (e) { check(false, `could not click ${sel}: ${e.message.split('\n')[0]}`); return false; }
  };
  return { ctx, page, errs, click };
}

// Smooth scrolling lands over several frames; read once it has stopped moving.
const settle = async (page) => {
  let last = -1;
  for (let i = 0, same = 0; i < 40 && same < 3; i++) {
    await page.waitForTimeout(100);
    const now = await page.evaluate(() => document.querySelector('#sidebar > nav').scrollTop + ':' + scrollY);
    same = now === last ? same + 1 : 0; last = now;
  }
};

// Rects of the things that must stay reachable, plus the list's own scroll state.
const measure = (page) => page.evaluate(() => {
  const nav = document.querySelector('#sidebar > nav');
  const box = e => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; };
  const items = [...nav.querySelectorAll('.nav-item')].filter(e => e.offsetParent);
  return {
    vh: innerHeight, scrollY,
    nav: { ...box(nav), client: nav.clientHeight, scroll: nav.scrollHeight, scrollTop: nav.scrollTop,
           wide: nav.scrollWidth > nav.clientWidth },
    last: box(items[items.length - 1]), lastName: items[items.length - 1]?.textContent.trim().replace(/\s+/g, ' '),
    items: items.length,
    bottom: ['nav-settings', 'dark-toggle', 'sidebar-toggle'].map(id => ({ id, ...box(document.getElementById(id)) })),
  };
});
const inView = (m) => m.bottom.filter(x => x.top < 0 || x.bottom > m.vh + 0.5).map(x => x.id);

// ── 1. A store PC's window, groups as shipped (closed) ───────────────────────
{
  const { ctx, page, errs, click } = await open({ width: 1280, height: 600 });
  const m = await measure(page);
  check(m.items >= 8, `a superuser's sidebar rendered (${m.items} top-level items visible)`);
  const off = inView(m);
  check(off.length === 0, `🛑 at 1280×600 Settings, dark mode and the collapse toggle are on screen${off.length ? ` — off screen: ${off.join(', ')}` : ''}`);

  // ── 2. …and with all three groups open, the longest the list gets ───────────
  for (const id of ['nav-marketing', 'nav-merch', 'nav-inventory']) {
    const shown = await page.$eval(`#${id}`, e => !!e.offsetParent).catch(() => false);
    check(shown, `the ${id} group header is visible to a superuser`);
    if (shown) await click(`#${id}`);
  }
  const open3 = await measure(page);
  check(open3.nav.scroll > open3.nav.client + 200,
        `with the groups open the list is taller than its box (${open3.nav.scroll}px in ${open3.nav.client}px) — the case that needs a scroller`);
  check(inView(open3).length === 0, '…and the bottom controls stay on screen regardless');

  // A real wheel over the list, not a scrollTop write: that is what a person does. Start
  // from the top — Playwright's click already scrolled the list to reach the Inventory
  // header, which would otherwise pass for the wheel working.
  await page.evaluate(() => { document.querySelector('#sidebar > nav').scrollTop = 0; scrollTo(0, 0); });
  await settle(page);
  await page.mouse.move(120, (open3.nav.top + open3.nav.bottom) / 2);
  for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, 300); await page.waitForTimeout(60); }
  await settle(page);
  const after = await measure(page);
  check(after.nav.scrollTop > 0, `🔑 the wheel scrolls the list (scrollTop ${after.nav.scrollTop})`);
  check(after.last.bottom <= Math.min(after.nav.bottom, after.vh) + 1 && after.last.top >= after.nav.top - 1,
        `🔑 …down to the last item, "${after.lastName}", which is now inside the list's box`);
  check(after.scrollY === 0, `the page behind it did not scroll instead (scrollY ${after.scrollY})`);
  check(!after.nav.wide, 'no sideways scrollbar in the list');

  // ── 3. The collapsed rail scrolls too, and does not grow a sideways bar ─────
  await click('#sidebar-toggle');
  await page.waitForTimeout(400);
  const rail = await measure(page);
  check(await page.$eval('#sidebar', e => e.classList.contains('collapsed')), 'the toggle collapsed the sidebar');
  const toggle = rail.bottom.find(x => x.id === 'sidebar-toggle');
  check(toggle.top >= 0 && toggle.bottom <= rail.vh + 0.5,
        '🛑 the collapsed rail keeps its expand toggle on screen — lose it and the sidebar cannot be reopened');
  check(!rail.nav.wide, 'the collapsed rail has no sideways scrollbar');
  check(errs.length === 0, `no JS errors${errs.length ? ': ' + errs.join(' | ') : ''}`);
  await ctx.close();
}

// ── 4. A tall window gets no scrollbar it never had ─────────────────────────
{
  const { ctx, page } = await open({ width: 1512, height: 982 });
  const m = await measure(page);
  check(m.nav.scroll <= m.nav.client, `at 1512×982 with groups closed the list fits — nothing to scroll (${m.nav.scroll}px in ${m.nav.client}px)`);
  check(inView(m).length === 0, '…and the bottom controls are where they always were');
  await ctx.close();
}

await b.close();
srv.close();
const failed = results.filter(([ok]) => !ok);
for (const [ok, m] of results) console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${m}`);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
