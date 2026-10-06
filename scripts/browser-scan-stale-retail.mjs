// Price Scan — an expired street price says how old it is, in a REAL BROWSER, both themes.
//
// 🛑 NOT PART OF `scripts/test.sh`: it needs playwright-core and a Chromium. Run by hand:
//
//   npm install --no-save playwright-core
//   bash scripts/build.sh && node scripts/browser-scan-stale-retail.mjs
//   (on a Mac: PLAYWRIGHT_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
//
// 🔑 WHY IT EXISTS. A cached street price expires after 30 days (2026-10-06). When the fresh
// lookup finds nothing, merch-scan still answers with the old price and adds the flag
// "street price last seen YYYY-MM-DD". The scan screen shows only flags it knows, so
// without the client half that flag reached nobody and an old price looked current.
// scripts/test-price-scan.mjs pins the worker half.
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
const types = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript', '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml' };
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

const MANAGER = { authenticated: true, email: 'alex@example.com', name: 'Alex M', role: 'manager',
  stores: ['BL1'], pages: {}, businesses: ['bl'] };
// What merch-scan answers for a price past its 30 days that the fresh lookup could not replace.
const STALE = { ok: true, identifier: '070010000024', identifier_type: 'upc', title: 'Aged Item',
  brand: 'Aged', size: '12 oz', l2: 'Consumable Food', l3: 'FG BL CONSUMABLES - FOOD - SNACKS',
  retail: 9.99, retail_source: 'walmart.com', retail_confidence: 'medium', retail_overridden: false,
  asp: 3.1, cost: 1.2, price: 4.99, price_basis: 'street retail', price_overridden: false,
  gp_pct: 76, below_gp_floor: false, gp_floor_pct: 30, rounding: '$0.25 down',
  flags: ['street price last seen 2026-09-05'],
  categories: [], from_cache: true, looked_up: true, from_photo: false, manifest: null };
const FRESH = { ...STALE, flags: [] };

function mocks({ who, scan, theme }) {
  try {
    localStorage.setItem('bioPromptDismissed', '1'); localStorage.setItem('coachTipsDisabled', '1');
    localStorage.setItem('darkMode', String(theme !== 'light'));
    localStorage.setItem('darkFlavor', 'dark');
  } catch (e) {}
  window.__calls = [];
  const J = (x, status = 200) => new Response(JSON.stringify(x), { status, headers: { 'content-type': 'application/json' } });
  window.fetch = async (u) => {
    const action = new URL(String(u), location.href).searchParams.get('action');
    window.__calls.push(action);
    switch (action) {
      case 'auth-me': return J(who);
      case 'merch-scan': return J(scan);
      case 'sticker-template': return J({ ok: true, template: null, markImage: null });
      case 'sticker-history': return J({ ok: true, prints: [] });
      case 'ps-buy-list': return J({ ok: true, buys: [] });
      default: return J({ error: 'Forbidden' }, 403);
    }
  };
}

const b = await chromium.launch({ executablePath: CHROME });
async function scanWith(scan, theme) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.route(u => !u.href.startsWith(ORIGIN), r => r.abort());
  await page.addInitScript(mocks, { who: MANAGER, scan, theme });
  await page.goto(ORIGIN + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__calls?.includes('auth-me'), null, { timeout: 10000 });
  await page.waitForTimeout(900);
  await page.evaluate(() => window.navigateToPage('merch-scan'));
  await page.fill('#ps-input', scan.identifier, { timeout: 3000 });
  await page.click('#ps-go', { timeout: 3000 });
  await page.waitForFunction(() => /\$4\.99/.test(document.getElementById('ps-result')?.textContent || ''), null, { timeout: 5000 });
  const out = {
    text: (await page.textContent('#ps-result')) || '',
    dark: await page.evaluate(() => document.documentElement.classList.contains('dark')),
    errs,
  };
  await ctx.close();
  return out;
}

for (const theme of ['light', 'dark']) {
  try {
    const stale = await scanWith(STALE, theme);
    check(stale.dark === (theme === 'dark'), `[${theme}] the page really is in ${theme} mode`);
    check(/street price was last seen 2026-09-05; nothing newer was found/.test(stale.text),
          `🔑 [${theme}] an expired price that nothing replaced says how old it is`);
    check(/\$9\.99/.test(stale.text), `[${theme}] …beside the price it is talking about`);
    check(stale.errs.length === 0, `[${theme}] no JS errors${stale.errs.length ? ': ' + stale.errs.join(' | ') : ''}`);
    const fresh = await scanWith(FRESH, theme);
    check(!/last seen/.test(fresh.text), `[${theme}] …and a current price says nothing of the kind`);
  } catch (e) {
    check(false, `[${theme}] stopped — ${String((e && e.message) || e).split('\n')[0]}`);
  }
}

await b.close();
srv.close();
const failed = results.filter(([ok]) => !ok);
for (const [ok, m] of results) console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${m}`);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
