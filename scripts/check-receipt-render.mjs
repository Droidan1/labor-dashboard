// The Transactions receipt, rendered through the REAL index.html and MEASURED.
//
// 🔑 DELIBERATELY NOT NAMED test-*.mjs. scripts/test.sh globs test-*.mjs and
// test-*.js, and every suite it runs is pure Node. This one drives a browser, so
// putting it in that glob would make the whole suite fail on any machine without
// a Chromium install. Run it by hand:
//
//     bash scripts/build.sh && node scripts/check-receipt-render.mjs
//     node scripts/check-receipt-render.mjs --shots /tmp/shots     # also write PNGs
//
// Needs Playwright and a browser: `npx playwright install chromium` once.
//
// WHY IT EXISTS. DESIGN.md requires contrast to be COMPUTED against the real
// background in both themes, never eyeballed — and the local tailwind.css is
// stale, so the only honest ground truth is a built dist/ in a real browser.
// Two defects shipped past review and were caught here on the first run:
// "Items sold (9.5)" for a basket holding a 1.5 lb weighed line, and a qty cell
// narrow enough to wrap "1.5 ×" onto two lines.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(repo, 'dist');
if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error('dist/index.html is missing — run `bash scripts/build.sh` first.');
  process.exit(1);
}
let chromium;
try { ({ chromium } = await import('playwright')); }
catch { console.error('playwright is not installed — `npm i -D playwright && npx playwright install chromium`.'); process.exit(1); }

const shotsAt = process.argv.indexOf('--shots');
const SHOTS = shotsAt > -1 ? process.argv[shotsAt + 1] : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };

const TYPES = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript',
                '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const f = path.join(dist, rel === '/' ? 'index.html' : rel);
  if (!f.startsWith(dist) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(0, r));
const port = server.address().port;

// Prefer whatever Playwright installed for itself. When the repo's playwright
// version and the browsers on disk disagree — as they do in the cloud sandbox,
// where PLAYWRIGHT_BROWSERS_PATH holds a build this playwright was not pinned to
// — fall back to any chromium sitting in that directory rather than failing on a
// revision number that has nothing to do with what is being checked.
async function launch() {
  try { return await chromium.launch(); } catch (e) {
    const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
    if (!root || !fs.existsSync(root)) throw e;
    const found = fs.readdirSync(root)
      .filter(d => d.startsWith('chromium'))
      .map(d => path.join(root, d, 'chrome-linux', 'chrome'))
      .find(p => fs.existsSync(p));
    if (!found) throw e;
    console.log(`(playwright's own browser is missing; using ${found})\n`);
    return chromium.launch({ executablePath: found });
  }
}
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1180, height: 1400 }, deviceScaleFactor: 2 });
page.on('pageerror', e => { fail++; console.log('  PAGEERROR: ' + e.message); });
// The page must not reach the real API; this check is about rendering only.
await page.route('**/api*.retjghub.com/**', r => r.abort());
await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const at = (h, m) => Date.parse(`2026-09-12T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00Z`) + 4 * 3600e3;
const PAYLOAD = {
  store: 'BL1', date: '2026-09-12',
  counts: { payment: 3, refund: 0, manual: 0, void: 0 },
  totals: { payments: 146.82, count: 3, tax: 8.26, tip: 0, refunded: 0 },
  rows: [
    // A mixed basket: counted goods, a merged line, a weighed line, and a name
    // Clover did not hold.
    { kind:'payment', id:'p-mixed', orderId:'o-mixed', ts: at(15,42), amount:74.36, tax:4.56, tip:0,
      tender:'Credit Card', tenderKind:'card', employee:'Lorrenda Watkins', customer:'Penny Egolof',
      source:'Device', cashTendered:null, result:'SUCCESS', reason:null,
      items:[
        { name:'Levi’s 501 denim jacket', qty:1, price:24.99, refunded:false },
        { name:'Pyrex mixing bowl, amber', qty:3, price:26.97, refunded:false },
        { name:'Hardcover fiction — assorted', qty:4, price:11.96, refunded:true },
        { name:'Loose beads, by weight', qty:1.5, price:6.00, refunded:false },
        { name:null, qty:1, price:4.44, refunded:false },
      ], itemsNote:null },
    // Split tender: the same basket hangs off both payments, with the caveat.
    { kind:'payment', id:'p-split', orderId:'o-split', ts: at(14,8), amount:60.00, tax:3.70, tip:0,
      tender:'Cash', tenderKind:'cash', employee:'Reshma Saeed', customer:null,
      source:'Device', cashTendered:60.00, result:'SUCCESS', reason:null,
      items:[{ name:'Mid-century armchair, walnut', qty:1, price:120.00, refunded:false }],
      itemsNote:'This order was settled with 2 payments. The items below are the whole order, not this payment’s share.' },
    // No order in hand: the drawer must draw no Items row at all.
    { kind:'payment', id:'p-bare', orderId:'o-bare', ts: at(10,55), amount:12.46, tax:0, tip:0,
      tender:'Cash', tenderKind:'cash', employee:'Lorrenda Watkins', customer:null,
      source:'Device', cashTendered:20.00, result:'SUCCESS', reason:null },
  ],
};

const setup = async (cls) => {
  await page.evaluate(c => { document.documentElement.className = c; }, cls);
  await page.evaluate((p) => {
    currentStoreName = 'BL1';          // _txnKey() splits on '/', so no spaces
    selectedTxnDate = p.date;
    txnTab = 'payment'; txnSelected = null; txnItemsOpen = false;
    txnCache[`BL1:${p.date}`] = p;
    renderTransactions(p);
    // At rest the login gate covers the page and store-detail is hidden.
    document.getElementById('login-page')?.remove();
    document.getElementById('app')?.classList.remove('hidden');
    document.getElementById('page-store-detail')?.classList.remove('hidden');
    document.getElementById('sd-content-txns')?.classList.remove('hidden');
  }, PAYLOAD);
};

// ── Behaviour ─────────────────────────────────────────────────────────────
await setup('');
const b = await page.evaluate(() => {
  const out = {};
  const tog = () => document.querySelector('.txn-items-tog');
  out.beforeOpen = !tog();
  openTxnDetail('p-mixed');
  out.heading = tog()?.textContent.replace(/[\u25b8\u25be]/g, '').replace(/\s+/g, ' ').trim();
  out.folded = !document.querySelector('.txn-it-tbl');
  out.aria0 = tog()?.getAttribute('aria-expanded');
  toggleTxnItems();
  out.aria1 = tog()?.getAttribute('aria-expanded');
  out.note = !!document.querySelector('.txn-items-note');
  out.qtyWrapped = [...document.querySelectorAll('.txn-it-tbl td.txn-it-q')].some(td => {
    const r = document.createRange();
    r.selectNodeContents(td);
    return r.getClientRects().length > 1;   // more than one line box = it wrapped
  });
  out.refundedBadges = document.querySelectorAll('.txn-it-tbl .txn-chip.txn-refund').length;
  out.unnamed = !!document.querySelector('.txn-it-tbl .txn-none');
  openTxnDetail('p-split');
  out.refolded = !document.querySelector('.txn-it-tbl');
  toggleTxnItems();
  out.splitNote = document.querySelector('.txn-items-note')?.textContent.trim();
  openTxnDetail('p-bare');
  out.bareHasNoItemsRow = !tog();
  return out;
});
console.log('Behaviour');
ok(b.beforeOpen, 'no Items row until a transaction is open');
// 🛑 The rule a "9.5" caught: a weighed line is ONE item however much it weighs.
ok(b.heading === 'Items sold (10)', `the count treats a weighed line as one item (got ${JSON.stringify(b.heading)})`);
ok(b.folded, 'the receipt opens folded');
ok(b.aria0 === 'false' && b.aria1 === 'true', 'aria-expanded tracks the fold');
ok(!b.qtyWrapped, 'a fractional quantity does not wrap the qty cell onto two lines');
ok(b.refundedBadges === 1, `a refunded line is badged (got ${b.refundedBadges})`);
ok(b.unnamed, 'a line Clover held no name for is NAMED, not blank');
ok(b.refolded, 'a different transaction opens folded again');
ok(/settled with 2 payments/.test(b.splitNote || ''), 'the split-tender caveat opens with the list');
ok(b.bareHasNoItemsRow, 'a transaction with no items draws no Items row at all');

// ── Contrast, computed against the composited background ──────────────────
const PICK = {
  'toggle label': '.txn-items-tog',
  'qty': '.txn-it-tbl td.txn-it-q', 'item name': '.txn-it-tbl td.txn-it-n',
  'line total': '.txn-it-tbl td.txn-it-p', 'unit price': '.txn-it-u',
  'Refunded chip': '.txn-it-tbl .txn-chip.txn-refund', 'unnamed item': '.txn-it-tbl .txn-none',
};
const CAVEAT = { 'caveat': '.txn-items-note' };
for (const [name, cls] of [['light', ''], ['dark', 'dark'], ['pure black', 'dark oled']]) {
  await setup(cls);
  console.log(`\n${name}`);
  // Two rows, because no single one carries every state: p-mixed has the item
  // lines, the badge and the unnamed line; only p-split carries a caveat.
  for (const [row, pick] of [['p-mixed', PICK], ['p-split', CAVEAT]]) {
  await page.evaluate((id) => { openTxnDetail(id); toggleTxnItems(); }, row);
  if (SHOTS && row === 'p-mixed') await (await page.$('#txn-body')).screenshot({ path: path.join(SHOTS, `receipt-${name.replace(' ', '-')}.png`) });
  const res = await page.evaluate((pick) => {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const lum = c => 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
    const parse = s => { const m = String(s).match(/rgba?\(([^)]+)\)/); if (!m) return null;
      const p = m[1].split(',').map(parseFloat); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
    // Walk up compositing translucent backgrounds — a wash over a panel is not
    // the wash's own colour, and measuring it as one is how a "pass" lies.
    const effBg = node => { const stack = [];
      while (node) { const c = parse(getComputedStyle(node).backgroundColor);
        if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; } node = node.parentElement; }
      if (!stack.length) return { r: 255, g: 255, b: 255 };
      let o = stack[stack.length - 1];
      if (o.a < 1) o = { r: o.a*o.r + (1-o.a)*255, g: o.a*o.g + (1-o.a)*255, b: o.a*o.b + (1-o.a)*255 };
      for (let i = stack.length - 2; i >= 0; i--) { const t = stack[i];
        o = { r: t.a*t.r + (1-t.a)*o.r, g: t.a*t.g + (1-t.a)*o.g, b: t.a*t.b + (1-t.a)*o.b }; }
      return o; };
    const out = {};
    for (const [k, sel] of Object.entries(pick)) {
      const el = document.querySelector(sel);
      if (!el) { out[k] = null; continue; }
      const fg = parse(getComputedStyle(el).color), bg = effBg(el);
      const a = lum(fg), b2 = lum(bg); const [hi, lo] = a > b2 ? [a, b2] : [b2, a];
      out[k] = { r: Math.round((hi + 0.05) / (lo + 0.05) * 100) / 100,
                 fg: `rgb(${[fg.r,fg.g,fg.b].map(Math.round)})`, bg: `rgb(${[bg.r,bg.g,bg.b].map(Math.round)})` };
    }
    return out;
  }, pick);
  for (const [k, v] of Object.entries(res)) {
    if (!v) { ok(false, `${name}: ${k} did not render`); continue; }
    console.log(`  ${k.padEnd(16)} ${String(v.r).padStart(6)}:1  ${v.fg.padEnd(20)} on ${v.bg}`);
    ok(v.r >= 4.5, `${name}: ${k} is ${v.r}:1 — below AA on ${v.bg}`);
  }
  }
}

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
