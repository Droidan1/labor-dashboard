// The Supply Request detail panels show an invoice number as text, never as markup, driven in
// a REAL BROWSER: the manager's panel and the superuser's Fulfillment form.
//
// 🛑 NOT PART OF `scripts/test.sh`, deliberately: the runner globs `test-*` and this needs
// playwright-core and a Chromium, neither of which is a repo dependency. Run it by hand
// after a change to those panels:
//
//   npm install --no-save playwright-core
//   bash scripts/build.sh && PLAYWRIGHT_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node scripts/browser-supply-invoice-escape.mjs
//
// 🔑 WHY IT EXISTS. Since 2026-10-30 an agent writes invoice_number (MCP update_supply_request),
// copying it from a vendor's email, so it is no longer only what a superuser typed. Both panels
// put it into innerHTML raw; the Fulfillment form put it inside value="…", where a quote ends the
// attribute. mcp/writes.mjs refuses such a value too; this checks the pages on their own, with
// a value the worker would already hold.
let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch (e) {
  console.error('\nThis check needs playwright-core: npm install --no-save playwright-core\n');
  process.exit(2);
}
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium';
const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const root = path.join(repo, 'dist');
if (!fs.existsSync(path.join(root, 'index.html'))) { console.error('No dist/ — run bash scripts/build.sh first.'); process.exit(2); }
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.txt': 'text/plain' };
const PORT = Number(process.env.PORT || 8098);
const srv = http.createServer((q, s) => {
  const u = q.url.split('?')[0];
  const f = path.join(root, u === '/' ? 'index.html' : u);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end('no'); }
  s.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(s);
});
await new Promise(r => srv.listen(PORT, r));
const ORIGIN = `http://127.0.0.1:${PORT}`;

const results = [];
const check = (c, m) => { results.push([!!c, m]); };
const eq = (got, want, m) => { const same = JSON.stringify(got) === JSON.stringify(want);
  check(same, `${m}${same ? '' : `  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`); };

const EVIL = '"><img src=x onerror="window.__xss=1">#7';
function pageMocks(evil) {
  const J = (x, st = 200) => new Response(JSON.stringify(x), { status: st, headers: { 'content-type': 'application/json' } });
  const real = window.fetch;
  window.fetch = async (u, o = {}) => {
    const s = String(u && u.url ? u.url : u);
    if (!s.startsWith('https://')) return real(u, o);
    const action = new URL(s).searchParams.get('action');
    if (action === 'auth-me') {
      window.__authed = true;
      return J({ authenticated: true, email: 'sam@example.com', name: 'Sam U', role: 'superuser', stores: ['BL1'], pages: {}, businesses: ['bl'] });
    }
    if (action === 'supply-request') return J({ ok: true, request: { id: 'r1', store: 'BL1', status: 'ordered', priority: 'normal',
      user_email: 'mgr@example.com', invoice_number: evil, cost: 42.5, notes: null, submitted_at: '2026-10-30T14:00:00Z',
      updated_at: '2026-10-30T14:00:00Z', items: [{ id: 'i1', category: 'Cleaning', item_name: 'Mop head', quantity: 6, unit: 'units' }], history: [] } });
    return J({ ok: false, error: 'not in this harness' }, 404);
  };
}

const b = await chromium.launch({ executablePath: CHROME });
const errs = [];
for (const scheme of ['light', 'dark']) {
  const ctx = await b.newContext({ colorScheme: scheme, serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(`${scheme}: ${e}`));
  await page.route(u => !u.href.startsWith(ORIGIN), r => r.abort());
  await page.addInitScript(pageMocks, EVIL);
  await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.srToggleDetail === 'function' && window.__authed, null, { timeout: 10000 });
  const got = await page.evaluate(async () => {
    for (const pid of ['sr-detail-r1', 'sr-sdetail-r1']) {
      const d = document.createElement('div'); d.id = pid; d.className = 'hidden'; document.body.appendChild(d);
    }
    await window.srToggleDetail('r1');
    await window.srToggleSuperDetail('r1');
    await new Promise(r => setTimeout(r, 300));
    const mgr = document.getElementById('sr-detail-r1'), su = document.getElementById('sr-sdetail-r1');
    return {
      xss: window.__xss === 1,
      imgs: document.querySelectorAll('#sr-detail-r1 img, #sr-sdetail-r1 img').length,
      mgrText: mgr.textContent.includes('Invoice: #' + '"><img src=x onerror="window.__xss=1">#7'),
      inputValue: document.getElementById('sr-su-inv-r1')?.value ?? null,
      costValue: document.getElementById('sr-su-cost-r1')?.value ?? null,
      su: !!su.textContent,
    };
  });
  await page.waitForTimeout(200);   // an injected onerror would have fired by now
  eq(await page.evaluate(() => window.__xss === 1), false, `${scheme}: the invoice number runs no script`);
  eq(got.imgs, 0, `${scheme}: and makes no element`);
  check(got.mgrText, `${scheme}: the manager's panel shows it as text`);
  eq(got.inputValue, EVIL, `${scheme}: the Fulfillment input holds it exactly (the quote did not end the attribute)`);
  eq(got.costValue, '42.5', `${scheme}: the inputs after it still render`);
  await ctx.close();
}
check(!errs.length, `no page errors (${errs.slice(0, 2).join(' | ')})`);

await b.close();
srv.close();
const bad = results.filter(r => !r[0]);
if (process.env.VERBOSE) for (const [okk, m] of results) if (okk) console.log('  ok   ' + m);
for (const [okk, m] of results) if (!okk) console.log('  FAIL ' + m);
console.log(`\n${results.length - bad.length} passed, ${bad.length} failed`);
process.exit(bad.length ? 1 : 0);
