// Opportunity Buys: a manifest that will not load, the buy page's upload button, and deleting
// a buy — driven in a real browser, both themes, at phone width.
//
// Brian, 2026-10-06: "my CSV upload isn't uploading". Two causes, neither visible to a test that
// greps source:
//   1. The buy page's Upload / Replace manifest button did NOTHING. obReplaceManifest asked for
//      #ob-m-note, which the card never rendered, and returned before sending a byte.
//   2. On the Open-a-buy path a refused sheet was reported in the grey status line, where nobody
//      read it. It is now a warning box at the upload control.
// And the delete he asked for the same day: it asks first, naming what goes, and sends the PO
// twice (the worker refuses a delete whose `confirm` does not repeat it).
//
// Not part of scripts/test.sh, like the other browser-* checks. Run by hand:
//   npm install --no-save playwright-core
//   bash scripts/build.sh
//   PLAYWRIGHT_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
//     node scripts/browser-ob-manifest-delete.mjs
let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.error('\nNeeds playwright-core: npm install --no-save playwright-core\n'); process.exit(2); }
const CHROME = process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'dist');
if (!fs.existsSync(path.join(root, 'tailwind.css'))) {
  console.error('\ndist/tailwind.css is missing. Build first: bash scripts/build.sh\n');
  process.exit(2);
}
const srcT = fs.statSync(path.resolve(root, '..', 'index.html')).mtimeMs;
const outT = fs.statSync(path.join(root, 'index.html')).mtimeMs;
if (outT < srcT && !process.env.OB_ALLOW_STALE_DIST) {
  console.error('\ndist/index.html is OLDER than index.html. Rebuild first: bash scripts/build.sh\n');
  process.exit(2);
}
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, s) => {
  const f = path.join(root, q.url === '/' ? 'index.html' : q.url.split('?')[0]);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end('no'); }
  s.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(s);
});
await new Promise(r => srv.listen(8099, r));

const BUY = { po: '99999', label: 'test', vendor: 'Tester', received_on: null, units: 5, note: '',
  status: 'open', opened_by: 'bhoward@bargainlane.com', opened_at: '2026-09-21T20:11:50Z',
  closed_by: null, closed_at: null, labels: 11, items: 2, stores: 1, print_rows: 3,
  first_print: '2026-09-21T20:12:45Z', last_print: '2026-09-21T20:13:03Z' };
// Brian's own file: UPC, Description, QTY. and no price column.
const CSV = 'UPC,Description,QTY.\r\n76753041959,3PK COOKIE SHEET IN FLOORSTAND,324\r\n';
const REFUSED = 'This sheet is missing UPC. Nothing was changed — buy 99999 still has no manifest.';

const results = [];
const check = (c, m) => { results.push([!!c, m]); };
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const rgba = (s) => { const p = (String(s).match(/\d+(\.\d+)?/g) || []).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
const L = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
// The colour an element's text actually sits on: its own background composited over every
// translucent ancestor down to the first opaque one. A wash measured alone reads as white.
const groundOf = (page, sel) => page.evaluate((sel) => {
  const stack = [];
  for (let e = document.querySelector(sel); e; e = e.parentElement) {
    const c = getComputedStyle(e).backgroundColor;
    stack.push(c);
    const a = (c.match(/[\d.]+/g) || []).map(Number);
    if (a.length === 3 || (a.length > 3 && a[3] === 1)) break;
  }
  return { stack, color: getComputedStyle(document.querySelector(sel)).color };
}, sel);
const composite = (stack) => {
  let out = [255, 255, 255];
  for (const c of [...stack].reverse()) {
    const [r, g, b, a] = rgba(c);
    out = [r * a + out[0] * (1 - a), g * a + out[1] * (1 - a), b * a + out[2] * (1 - a)];
  }
  return out;
};
const contrastAt = async (page, sel) => {
  if (!(await page.$(sel))) return 0;
  const { stack, color } = await groundOf(page, sel);
  return ratio(rgba(color), composite(stack));
};

// Missing controls are failed checks, not a crash: run against the page before this change,
// this script has to report what is wrong rather than stop at the first absent button.
const clickIf = async (page, sel) => { if (!(await page.$(sel))) return false; await page.click(sel); return true; };
const pressIf = async (page, name) => {
  try { await page.getByRole('button', { name }).click({ timeout: 1500 }); return true; } catch { return false; }
};

const b = await chromium.launch({ executablePath: CHROME });
for (const scheme of ['dark', 'light']) {
  const tag = scheme;
  const ctx = await b.newContext({ colorScheme: scheme, viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.addInitScript((s) => { try { localStorage.setItem('darkMode', String(s === 'dark')); } catch {} }, scheme);
  await page.addInitScript(({ BUY, REFUSED }) => {
    window.__OB = { manifest: null, canEdit: true, deleted: false, posts: [],
      upload: { status: 400, body: { ok: false, error: REFUSED, code: 'MISSING_COLUMNS' } } };
    const real = window.fetch;
    window.fetch = async (u, o) => {
      const s = String(u), S = window.__OB;
      const J = (x, st = 200) => new Response(JSON.stringify(x), { status: st, headers: { 'content-type': 'application/json' } });
      if (s.includes('auth-me')) return J({ authenticated: true, email: 'bhoward@bargainlane.com',
        name: 'Brian', role: 'superuser', stores: [], pages: {}, businesses: ['bl'] });
      if (o && o.method === 'POST' && s.includes('?action=')) {
        let body = null; try { body = JSON.parse(o.body); } catch {}
        S.posts.push({ action: (s.match(/action=([\w-]+)/) || [])[1], body });
      }
      if (s.includes('ob-buy-detail')) return J({ ok: true, can_edit: S.canEdit, buy: BUY, lines: [],
        tracked_from: null, sold: 0, refunded_units: 0, alloc: { BL2: 5, BL4: 3 },
        store_list: ['BL1', 'BL2', 'BL4', 'BL14', 'BL16'], manifest: S.manifest, manifest_history: 0 });
      if (s.includes('ob-buy-list')) return J({ ok: true, can_edit: S.canEdit, buys: S.deleted ? [] : [BUY] });
      if (s.includes('manifest-upload')) return J(S.upload.body, S.upload.status);
      if (s.includes('ob-buy-open')) return J({ ok: true, po: String(JSON.parse(o.body).po).toUpperCase() });
      if (s.includes('ob-buy-delete')) { S.deleted = true; return J({ ok: true, po: BUY.po, prints_unlinked: 3, manifests_deleted: 0 }); }
      if (s.includes('?action=')) return J({ ok: false, error: 'not in this harness' }, 404);
      return real(u, o);
    };
  }, { BUY, REFUSED });

  await page.goto('http://127.0.0.1:8099/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.navigateToPage && window.navigateToPage('opportunity-buys'));
  await page.waitForTimeout(700);
  check(await page.evaluate((s) => document.documentElement.classList.contains('dark') === (s === 'dark'), scheme),
    `${tag}: the ${scheme} theme is genuinely applied`);
  await page.evaluate(() => window.obOpenDetail('99999'));
  await page.waitForTimeout(400);
  const posts = (a) => page.evaluate((a) => window.__OB.posts.filter(p => p.action === a), a);
  const boxText = () => page.evaluate(() => { const n = document.getElementById('ob-m-note');
    return n && !n.hidden && n.offsetHeight > 0 ? n.textContent : null; });
  const file = { name: 'test.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) };

  // ── 1. The buy page's upload button actually uploads ─────────────────────
  check(await page.$('#ob-m-go') !== null, `${tag}: a buy with no manifest offers Upload manifest`);
  await clickIf(page, '#ob-m-go');
  await page.waitForTimeout(200);
  check(/Choose a CSV first/.test(await boxText() || ''), `${tag}: no file chosen says so, in the box`);
  await page.setInputFiles('#ob-m-csv', file);
  await clickIf(page, '#ob-m-go');
  await page.waitForTimeout(500);
  const up = await posts('manifest-upload');
  check(up.length === 1, `🛑 ${tag}: Upload manifest SENDS the sheet (${up.length} request) — it used to return before sending`);
  check(up[0]?.body?.load_id === '99999' && up[0]?.body?.filename === 'test.csv' && up[0]?.body?.csv === CSV,
    `${tag}: …for this buy, with the file as chosen`);
  const refused = await boxText();
  check(/Manifest not loaded/.test(refused || '') && (refused || '').includes(REFUSED),
    `🔑 ${tag}: a refused sheet is a visible warning with the worker's reason (${refused})`);
  check(await page.evaluate(() => document.getElementById('ob-m-note')?.getAttribute('role') === 'alert'),
    `${tag}: …announced as an alert`);
  const boxC = await contrastAt(page, '#ob-m-note');
  check(boxC >= 4.5, `${tag}: the warning reads against its own wash (${boxC.toFixed(2)}:1)`);
  const boxFont = await page.evaluate(() => { const n = document.getElementById('ob-m-note');
    return n ? parseFloat(getComputedStyle(n).fontSize) : 0; });
  check(boxFont >= 13, `${tag}: …at a size people read (${boxFont}px; the status line it replaced is 12.5px grey)`);

  // A sheet with no price column loads, and the page says where prices will come from.
  await page.evaluate(() => {
    window.__OB.upload = { status: 200, body: { ok: true, rows: 38, ob_matchable: 34, ob_priced: 0, ob_units: 5000,
      ob_price_column: false, replaced: null,
      note: '4 of 38 lines cannot be reached by a scan — they have no barcode. Check the flags on those lines. There is no price column, so a scan looks up the street price and prices each item the usual way.' } };
    window.__OB.manifest = { id: 'm1', filename: 'test.csv', uploaded_at: '2026-10-06T17:00:00Z',
      uploaded_by: 'bhoward@bargainlane.com', lines: 38, priced: 0, matchable: 34, units: 5000 };
  });
  await page.setInputFiles('#ob-m-csv', file);
  await clickIf(page, '#ob-m-go');
  await page.waitForTimeout(600);
  const said = await page.evaluate(() => document.getElementById('ob-status').textContent);
  check(/Manifest loaded: 34 of 38 lines can be found by a scan/.test(said) && /looks up the street price/.test(said),
    `${tag}: a sheet with no prices loads and says how it will be priced (${said.slice(0, 90)}…)`);
  const card = await page.evaluate(() => (document.querySelector('#page-opportunity-buys .ob-man') || {}).textContent || '');
  check(/The sheet has no prices, so a scan looks up the street price/.test(card), `${tag}: …and the card keeps saying so`);
  check(!/no barcode, or no price/.test(card), `${tag}: …and no longer calls an unpriced line unscannable`);

  // ── 2. Open a buy with a sheet that is refused ───────────────────────────
  await page.evaluate(() => {
    window.__OB.manifest = null; window.__OB.posts = [];
    window.__OB.upload = { status: 400, body: { ok: false, error: 'This sheet is missing UPC. Nothing was changed — buy NEW1 still has no manifest.' } };
  });
  await page.evaluate(() => window.obShowList());
  await page.waitForTimeout(400);
  await page.evaluate(() => window.obToggleNew(true));
  await page.fill('#ob-f-po', 'new1');
  await page.setInputFiles('#ob-f-csv', file);
  await page.click('#ob-f-go');
  await page.waitForTimeout(800);
  const order = await page.evaluate(() => window.__OB.posts.map(p => p.action).join(','));
  check(order === 'ob-buy-open,manifest-upload', `${tag}: the buy opens, then its sheet is sent (${order})`);
  const createBox = await boxText();
  check(/Manifest not loaded/.test(createBox || '') && /PO NEW1 is open, but its manifest did not load/.test(createBox || ''),
    `🔑 ${tag}: a refused sheet on Open a buy is the warning box, not the grey line (${createBox})`);
  check(!/did not load/.test(await page.evaluate(() => document.getElementById('ob-status').textContent)),
    `${tag}: …and is not ALSO left in the status line`);

  // ── 3. Delete ────────────────────────────────────────────────────────────
  await page.evaluate(() => { window.__OB.posts = []; return window.obOpenDetail('99999'); });
  await page.waitForTimeout(400);
  check(await page.$('#ob-del') !== null, `${tag}: an editor is offered Delete this buy`);
  const delC = await contrastAt(page, '#ob-del');
  check(delC >= 4.5, `${tag}: the delete button's red reads (${delC.toFixed(2)}:1)`);
  await clickIf(page, '#ob-del');
  await page.waitForTimeout(300);
  const ask = await page.evaluate(() => document.body.innerText);
  check(/Delete PO 99999\?/.test(ask), `${tag}: it asks first, naming the PO`);
  check(/its units for 2 stores/.test(ask) && /11 printed labels stay on the shelf/.test(ask) && /There is no undo/.test(ask),
    `${tag}: …saying what goes, what stays, and that there is no undo`);
  await pressIf(page, 'Cancel');
  await page.waitForTimeout(300);
  check((await posts('ob-buy-delete')).length === 0, `🛑 ${tag}: Cancel deletes nothing`);
  await clickIf(page, '#ob-del');
  await page.waitForTimeout(300);
  await pressIf(page, 'Delete buy');
  await page.waitForTimeout(700);
  const del = await posts('ob-buy-delete');
  check(del.length === 1 && del[0].body?.po === '99999' && del[0].body?.confirm === '99999',
    `${tag}: Delete buy sends the PO and its confirmation (${JSON.stringify(del[0]?.body)})`);
  const after = await page.evaluate(() => document.getElementById('ob-status').textContent);
  check(/Deleted PO 99999\. 3 label records no longer count toward a buy\./.test(after),
    `${tag}: back on the list, it says what it did (${after})`);

  // ── 4. Someone who cannot edit is not offered it ─────────────────────────
  await page.evaluate(() => { window.__OB.canEdit = false; window.__OB.deleted = false; return window.obOpenDetail('99999'); });
  await page.waitForTimeout(400);
  check(await page.$('#ob-del') === null, `${tag}: a reader without edit gets no delete button`);

  check(errs.length === 0, `${tag}: no page errors${errs.length ? ' — ' + errs.slice(0, 2).join(' | ') : ''}`);
  await ctx.close();
}
await b.close();
srv.close();

let bad = 0;
for (const [p, m] of results) { if (!p) bad++; console.log(`${p ? 'PASS' : 'FAIL'}  ${m}`); }
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
