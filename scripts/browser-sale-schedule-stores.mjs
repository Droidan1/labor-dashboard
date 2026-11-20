// Schedule Sale across stores, driven in a REAL BROWSER.
//
// 🛑 NOT PART OF `scripts/test.sh` — it needs playwright-core and a Chromium. Run by hand:
//
//   npm install --no-save playwright-core
//   bash scripts/build.sh && node scripts/browser-sale-schedule-stores.mjs
//   (on a Mac: PLAYWRIGHT_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
//
// 🔑 WHY. The 2026-10-14 furniture sale was picked from BL1's inventory and sent, with BL1's
// Clover item ids, to every ticked store; the other five 404'd when it started. The page now
// sends where the items came from (sourceStore) and each item's code, asks the worker to match
// every store FIRST (dryRun), and shows what would be skipped before anything is scheduled.
// scripts/test-sale-scheduler.mjs covers the worker side.
let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch (e) {
  console.error('\nThis check needs playwright-core: npm install --no-save playwright-core\n');
  process.exit(2);
}
const CHROME = process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium';

import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root = process.env.DIST_DIR || path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'dist');
if (!fs.existsSync(path.join(root, 'index.html'))) { console.error('\ndist/ is not built. Run: bash scripts/build.sh\n'); process.exit(2); }
const types = { '.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json','.png':'image/png','.svg':'image/svg+xml' };
const srv = http.createServer((q, s) => {
  const f = path.join(root, q.url === '/' ? 'index.html' : q.url.split('?')[0]);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end('no'); }
  s.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(s);
});
await new Promise(r => srv.listen(8134, r));
const URL_ = 'http://127.0.0.1:8134/';

let pass = 0, fail = 0;
const check = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL ' + m); } };

const TS = 'FG BL FURNITURE - RTA - TABLES/STANDS';
const CATALOG = { BL1: [
  { id: 'A1', name: TS, code: 'BL-50251-300', price: 30000, hidden: false, categories: [] },
  { id: 'A2', name: TS, code: 'BL-50251-30', price: 3000, hidden: false, categories: [] },
] };

const b = await chromium.launch({ executablePath: CHROME });

async function run({ dark, answer }) {
  const label = `${dark ? 'dark' : 'light'} · ${answer}`;
  console.log(`\n── ${label} ──`);
  const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.addInitScript(d => { try { localStorage.setItem('darkMode', String(d)); localStorage.setItem('bioPromptDismissed', '1'); } catch (e) {} }, dark);
  await page.addInitScript(({ CATALOG }) => {
    window.__sched = [];
    window.fetch = async (u, o = {}) => {
      const s = String(u);
      const J = (x, status = 200) => new Response(JSON.stringify(x), { status, headers: { 'content-type': 'application/json' } });
      if (s.includes('auth-me')) return J({ authenticated: true, email: 'b@b.com', name: 'Brian',
        role: 'superuser', associate: false, pages: {}, businesses: [{ id: 'bl', name: 'Bargain Lane' }] });
      if (s.includes('inventory-items')) {
        const el = CATALOG[new URL(s).searchParams.get('store')] || [];
        return J({ ok: true, elements: el, offset: 0, total: el.length, hasMore: false });
      }
      if (s.includes('action=schedule-sale')) {
        const body = JSON.parse(o.body || '{}');
        window.__sched.push(body);
        // The worker's answers, as saleResolveItems gives them: BL1 is where the items came from;
        // BL2 has A1's code + name once and A2's twice.
        const m = (sourceId, id) => ({ sourceId, id, name: 'FG BL FURNITURE - RTA - TABLES/STANDS' });
        const plan = body.store === 'BL1'
          ? { matched: [m('A1', 'A1'), m('A2', 'A2')], skipped: [] }
          : { matched: [m('A1', 'B1')], skipped: [{ sourceId: 'A2', name: 'FG BL FURNITURE - RTA - TABLES/STANDS', code: 'BL-50251-30',
              reason: '2 items at BL2 have code BL-50251-30 and this name' }] };
        if (body.dryRun) return J({ ok: true, dryRun: true, store: body.store, count: plan.matched.length, ...plan });
        return J({ ok: true, store: body.store, scheduleGroup: 'sg_' + body.store, count: plan.matched.length, ...plan });
      }
      if (s.includes('list-sale-schedules')) return J({ ok: true, groups: [] });
      return J({ ok: true });
    };
  }, { CATALOG });
  await page.goto(URL_, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.getElementById('app')?.classList.contains('hidden'), { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(300);

  await page.evaluate(() => navigateToPage('inventory-viewer'));
  await page.waitForTimeout(120);
  await page.selectOption('#inv-view-store', 'BL1');
  await page.click('#page-inventory-viewer button:text-is("Load")', { timeout: 3000 });
  await page.waitForFunction(() => !document.getElementById('inv-view-table-wrap').classList.contains('hidden'), { timeout: 3000 });
  for (const cb of await page.$$('#inv-view-tbody input[type=checkbox]')) await cb.check();
  check((await page.evaluate(() => [...invSelectedItems.values()].map(i => i.code).join(','))) === 'BL-50251-300,BL-50251-30',
    `${label}: the selection carries each item's code`);

  await page.evaluate(() => openSaleModal());
  await page.waitForTimeout(200);
  await page.check('.inv-sale-store-cb[value="BL2"]');
  await page.fill('#inv-sale-discount-val', '30');
  await page.evaluate(() => updateSalePreview());
  await page.click('#inv-sale-submit');
  await page.waitForTimeout(400);

  const first = await page.evaluate(() => window.__sched.slice());
  check(first.length === 2 && first.every(x => x.dryRun === true),
    `${label}: 🔑 both stores are asked with dryRun first (${first.map(x => `${x.store}:${x.dryRun}`).join(', ')})`);
  check(first.every(x => x.sourceStore === 'BL1'), `${label}: 🔑 every request says the items came from BL1`);
  check(first.every(x => (x.items || []).map(i => i.code).join(',') === 'BL-50251-300,BL-50251-30'), `${label}: and carries the codes`);

  const dialog = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Schedule the rest');
    if (!btn) return null;
    let box = btn; for (let i = 0; i < 4 && box.parentElement; i++) box = box.parentElement;
    const msg = [...box.querySelectorAll('div')].find(d => /skipped/.test(d.textContent) && d.children.length === 0);
    if (!msg) return { text: box.textContent };
    const opaque = (el) => { for (let n = el; n; n = n.parentElement) { const bg = getComputedStyle(n).backgroundColor; const p = bg.match(/[\d.]+/g); if (p && (p.length < 4 || Number(p[3]) === 1)) return bg; } return 'rgb(255,255,255)'; };
    return { text: msg.textContent, fg: getComputedStyle(msg).color, bg: opaque(msg) };
  });
  check(!!dialog && /BL2: 1 of 2 skipped/.test(dialog.text) && /2 items at BL2 have code BL-50251-30/.test(dialog.text),
    `${label}: 🔑 a dialog says BL2 skips one item, and why, before scheduling (${dialog && dialog.text && dialog.text.slice(0, 120)})`);
  check((await page.evaluate(() => window.__sched.filter(x => !x.dryRun).length)) === 0, `${label}: nothing is scheduled while the dialog is open`);
  if (dialog && dialog.fg) {
    const rgb = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const lum = (c) => { const a = rgb(c).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]; };
    const ratio = (Math.max(lum(dialog.fg), lum(dialog.bg)) + 0.05) / (Math.min(lum(dialog.fg), lum(dialog.bg)) + 0.05);
    check(ratio >= 4.5, `${label}: dialog text contrast ${ratio.toFixed(2)}:1 >= 4.5 (${dialog.fg} on ${dialog.bg})`);
    console.log(`   dialog contrast ${ratio.toFixed(2)}:1`);
  }

  if (answer === 'schedule') {
    if (dialog) await page.click('button:text-is("Schedule the rest")');
    await page.waitForTimeout(500);
    const real = await page.evaluate(() => window.__sched.filter(x => !x.dryRun));
    check(real.map(x => x.store).sort().join(',') === 'BL1,BL2', `${label}: then both stores are scheduled (${real.map(x => x.store)})`);
    check(real.every(x => x.sourceStore === 'BL1'), `${label}: still saying the items came from BL1`);
    const status = await page.$eval('#inv-sale-status', e => e.textContent.replace(/\s+/g, ' ').trim());
    check(/Scheduled 3 items across 2 stores/.test(status), `${label}: the page reports 3 items across 2 stores (${status})`);
  } else {
    // The dialog's own Cancel: the page has a score of other "Cancel" buttons, hidden.
    if (dialog) await page.evaluate(() => {
      const ok = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Schedule the rest');
      [...ok.parentElement.querySelectorAll('button')].find(x => x.textContent.trim() === 'Cancel').click();
    });
    await page.waitForTimeout(300);
    check((await page.evaluate(() => window.__sched.filter(x => !x.dryRun).length)) === 0, `${label}: 🔑 Cancel schedules nothing`);
    const status = await page.$eval('#inv-sale-status', e => e.textContent.replace(/\s+/g, ' ').trim());
    check(/Nothing was scheduled/.test(status), `${label}: and says so (${status})`);
  }
  check(errs.length === 0, `${label}: no page errors ${errs.join(' | ')}`);
  await ctx.close();
}

for (const dark of [false, true]) for (const answer of ['schedule', 'cancel']) await run({ dark, answer });
await b.close(); srv.close();
console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
