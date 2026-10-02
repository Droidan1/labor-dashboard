// Opportunity Buys — driven in a REAL BROWSER, at phone and desktop width.
//
// 🛑 EVERY BUG THIS EXISTS TO CATCH SHIPPED PAST A GREEN SUITE AND WAS FOUND IN A
// SCREENSHOT. The heading scrolled under the iOS notch with nothing opaque behind it; the
// table ran off the right edge with a truncated word as its last column and no hint it
// scrolled; the legend stacked taller than the data it explained. Desktop looked perfect
// the whole time, and 5,326 source assertions had nothing to say about any of it.
//
// 🛑 NOT PART OF `scripts/test.sh`, deliberately — same reason as browser-inventory-receiver:
// the runner globs `test-*` and this needs playwright-core and a Chromium, neither a repo
// dependency. Run it by hand after touching this page:
//
//   npm install --no-save playwright-core
//   bash scripts/build.sh   (and if tailwind fails: ./node_modules/.bin/tailwindcss \
//                            -i tailwind.input.css -o dist/tailwind.css --minify)
//   node scripts/browser-opportunity-buys.mjs
//
// 🔑 A BUILD WITHOUT dist/tailwind.css RENDERS NOTHING USEFUL. Every layout class on this
// page is Tailwind's; without the stylesheet the screenshot is a column of unstyled text and
// every measurement below is meaningless. Checked explicitly rather than assumed.
let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.error('\nNeeds playwright-core: npm install --no-save playwright-core\n'); process.exit(2); }
const CHROME = process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'dist');
if (!fs.existsSync(path.join(root, 'tailwind.css'))) {
  console.error('\ndist/tailwind.css is missing — the render would carry no layout at all.\n'
    + 'Build it first (see the header of this file).\n');
  process.exit(2);
}
// 🛑 A STALE dist/ TESTS THE PREVIOUS VERSION AND REPORTS IT AS THIS ONE. This check exists
// because it happened: index.html was edited twice after a build, the run served the old
// bundle, and a column that had just been hidden came back "still visible" — a real-looking
// failure in code that was already correct. Refusing is the only safe answer; a warning gets
// scrolled past.
const srcT = fs.statSync(path.resolve(root, '..', 'index.html')).mtimeMs;
const outT = fs.statSync(path.join(root, 'index.html')).mtimeMs;
if (outT < srcT) {
  console.error(`\ndist/index.html is OLDER than index.html by ${Math.round((srcT - outT) / 1000)}s.\n`
    + 'This run would measure the previous build and attribute the result to your change.\n'
    + 'Rebuild first:  bash scripts/build.sh\n');
  process.exit(2);
}
const types = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript', '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml' };
const srv = http.createServer((q, s) => {
  const f = path.join(root, q.url === '/' ? 'index.html' : q.url.split('?')[0]);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end('no'); }
  s.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(s);
});
await new Promise(r => srv.listen(8098, r));

// The exact shape of the screenshot Brian sent: one buy, and two lines that differ ONLY in
// the code — an ordinary BL-50002-1_5 and the same item under PO 99999. That pair is the
// reason the code column may never be the one hidden on a phone.
const BUY = { po: '99999', label: 'test', vendor: 'Tester', received_on: null, units: 5, note: '',
  status: 'open', opened_by: 'bhoward@bargainlane.com', opened_at: '2026-09-21T20:11:50Z',
  closed_by: null, closed_at: null, labels: 11, items: 2, stores: 1, print_rows: 3,
  first_print: '2026-09-21T20:12:45Z', last_print: '2026-09-21T20:13:03Z' };
// The buy's own manifest, as ob-buy-detail reports it. Deliberately IMPERFECT: 12 lines of
// which only 9 can be reached by a scan, because the card's whole job is to say that out
// loud rather than let "12 lines" read as done. The unit count also disagrees with the
// buy's declared 5 — two claims about the same load, neither corrected into the other.
const MANIFEST = { id: 'm1', filename: 'nov-toys.csv', uploaded_at: '2026-09-21T19:40:00Z',
  uploaded_by: 'bhoward@bargainlane.com', lines: 12, priced: 10, matchable: 9, units: 240 };

const LINES = [
  { store: 'BL2', l3: 'FG BL CONSUMABLES - FOOD - BEVERAGES', code: 'BL-50002-1_5',
    title: 'LIFEWTR Enhanced Water', price: 1.5, retail: 2.48, labels: 10, presses: 2,
    sold: 0, refunded_units: 0, first_print: '2026-09-21T20:12:45Z', last_print: '2026-09-21T20:12:45Z' },
  { store: 'BL2', l3: 'FG BL CONSUMABLES - FOOD - BEVERAGES', code: 'BL-50002-1_5-P99999',
    title: 'LIFEWTR Enhanced Water', price: 1.5, retail: 2.48, labels: 1, presses: 1,
    sold: 0, refunded_units: 0, first_print: '2026-09-21T20:13:03Z', last_print: '2026-09-21T20:13:03Z' },
];

const results = [];
const check = (c, m) => { results.push([!!c, m]); };
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const rgb = (s) => (String(s).match(/\d+(\.\d+)?/g) || []).map(Number);
const L = (s) => { const [r, g, b] = rgb(s); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
const ratio = (a, b) => { const x = L(a), y = L(b); const hi = Math.max(x, y), lo = Math.min(x, y); return (hi + 0.05) / (lo + 0.05); };

const b = await chromium.launch({ executablePath: CHROME });
// 390x844 is an iPhone 14; 1180 is the desktop the second screenshot was taken at.
for (const view of [{ name: 'phone', width: 390, height: 844 }, { name: 'desktop', width: 1180, height: 1000 }]) {
  for (const scheme of ['dark', 'light']) {
    const ctx = await b.newContext({ colorScheme: scheme, viewport: { width: view.width, height: view.height } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    // 🔑 CERT FAILURES ARE THE SANDBOX, NOT THE PAGE. This container's egress proxy refuses
    // the Google Fonts request, which surfaces as ERR_CERT_AUTHORITY_INVALID on every run.
    // Counting it as a page error would mean this check can never pass here — and a check
    // that always fails gets ignored, which is worse than not having it. Filtered by that
    // exact signature only, so a real network error still reports.
    page.on('console', m => {
      if (m.type() !== 'error') return;
      const t = m.text();
      if (/ERR_CERT_AUTHORITY_INVALID|ERR_TUNNEL_CONNECTION_FAILED|ERR_PROXY|ERR_NAME_NOT_RESOLVED|fonts\.googleapis|fonts\.gstatic/.test(t)) return;
      errs.push('console: ' + t);
    });

    await page.addInitScript((s) => { try { localStorage.setItem('darkMode', String(s === 'dark')); } catch {} }, scheme);
    await page.addInitScript(({ BUY, LINES }) => {
      const real = window.fetch;
      window.fetch = async (u, o) => {
        const s = String(u);
        const J = (x) => new Response(JSON.stringify(x), { status: 200, headers: { 'content-type': 'application/json' } });
        if (s.includes('auth-me')) return J({ authenticated: true, email: 'bhoward@bargainlane.com',
          name: 'Brian', role: 'superuser', stores: [], pages: {}, businesses: ['bl'] });
        if (s.includes('ob-buy-detail')) return J({ ok: true, can_edit: true, buy: BUY, lines: LINES,
          tracked_from: null, sold: 0, refunded_units: 0,
          alloc: { BL2: 5 }, store_list: ['BL1', 'BL2', 'BL4', 'BL14', 'BL16'],
          manifest: window.__OB_MANIFEST, manifest_history: window.__OB_MANIFEST ? 2 : 0 });
        if (s.includes('ob-buy-list')) return J({ ok: true, can_edit: true, buys: [BUY] });
        // 🛑 NEVER THE NETWORK for the API. This used to fall through to the real fetch, so the
        // page's other calls (ly-sales) went to PRODUCTION from a test, and four checks failed
        // on the CORS error. Anything this harness does not answer is refused here instead.
        if (s.includes('?action=')) return new Response(JSON.stringify({ ok: false, error: 'not in this harness' }),
          { status: 404, headers: { 'content-type': 'application/json' } });
        return real(u, o);
      };
    }, { BUY, LINES });
    // 🔑 BOTH STATES GET RENDERED, not just the interesting one. A buy with no sheet is the
    // common case on day one and has its own branch — "none yet" and a prompt — and a branch
    // nothing exercises is a branch that breaks silently.
    await page.addInitScript((m) => { window.__OB_MANIFEST = m; }, MANIFEST);

    await page.goto('http://127.0.0.1:8098/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.navigateToPage && window.navigateToPage('opportunity-buys'));
    await page.waitForTimeout(900);

    const tag = `${view.name}/${scheme}`;
    check(await page.evaluate(() => !document.getElementById('page-opportunity-buys').classList.contains('hidden')),
      `${tag}: the page is actually open`);
    // 🛑 The theme is a .dark class from localStorage, not prefers-color-scheme. Asserted,
    // because browser-inventory-receiver's header records "both themes" once meaning light twice.
    check(await page.evaluate((s) => document.documentElement.classList.contains('dark') === (s === 'dark'), scheme),
      `${tag}: the ${scheme} theme is genuinely applied`);

    const m = await page.evaluate(() => {
      const bar = document.querySelector('#page-opportunity-buys .sticky');
      const panel = document.getElementById('ob-panel');
      const scroll = document.getElementById('ob-scroll');
      const h1 = document.querySelector('#page-opportunity-buys h1');
      const cs = (e) => e ? getComputedStyle(e) : null;
      return {
        docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        barBg: bar ? cs(bar).backgroundColor : null,
        barPos: bar ? cs(bar).position : null,
        barPadTop: bar ? cs(bar).paddingTop : null,
        h1Color: h1 ? cs(h1).color : null,
        h1Text: h1 ? h1.textContent.trim() : null,
        panelBg: panel ? cs(panel).backgroundColor : null,
        scrollOver: scroll ? scroll.scrollWidth - scroll.clientWidth : null,
        hasFade: scroll ? scroll.classList.contains('ob-more') : null,
        legendH: (document.getElementById('ob-legend') || {}).offsetHeight ?? null,
        panelW: panel ? panel.getBoundingClientRect().width : null,
      };
    });

    // 🔑 THE ONE THAT MATTERS MOST. A page wider than its viewport is the whole class of bug
    // in the screenshot: the body scrolls sideways and the layout is simply wrong.
    check(m.docOverflow <= 1, `${tag}: the PAGE does not scroll sideways (overflow ${m.docOverflow}px)`);
    check(m.barPos === 'sticky', `${tag}: the app bar is sticky`);
    // Opaque, or the heading shows through as the ghost in the screenshot.
    const alpha = (s) => { const p = rgb(s); return p.length > 3 ? p[3] : 1; };
    check(alpha(m.barBg) === 1, `${tag}: the app bar background is OPAQUE (${m.barBg}) — a `
      + 'transparent bar is what let the heading render as a ghost under the status bar');
    check(ratio(m.h1Color, m.barBg) >= 4.5,
      `${tag}: the heading reads against its own bar (${ratio(m.h1Color, m.barBg).toFixed(2)}:1)`);
    check(m.h1Text === 'Opportunity Buys', `${tag}: the heading says what it should`);
    // The fade must agree with reality in both directions.
    check(m.scrollOver === null || (m.scrollOver > 1) === !!m.hasFade,
      `${tag}: the scroll hint matches reality (overflow ${m.scrollOver}px, hint ${m.hasFade})`);
    if (view.name === 'phone') {
      check(m.legendH !== null && m.legendH < 150,
        `${tag}: the legend is a key, not a wall (${m.legendH}px tall)`);
    }
    check(errs.length === 0, `${tag}: no page errors${errs.length ? ' — ' + errs.slice(0, 2).join(' | ') : ''}`);

    const shot = `/tmp/claude-0/-home-user-labor-dashboard/50e6f723-4395-5d11-8524-2f90bfbfab23/scratchpad/ob-${view.name}-${scheme}.png`;
    await page.screenshot({ path: shot, fullPage: view.name === 'phone' });
    console.log(`  shot: ${shot}`);

    // ── The DETAIL view, which is the harder one ──────────────────────────────
    //
    // 🛑 IT HAS TEN COLUMNS AND TWO ROWS THAT DIFFER ONLY IN THE CODE. The list fitting a
    // phone proves nothing about this; checking only the list is how the narrower half gets
    // verified and the wider half ships broken.
    await page.evaluate(() => window.obOpenDetail && window.obOpenDetail('99999'));
    await page.waitForTimeout(700);
    const d = await page.evaluate(() => {
      // Walks ancestors, not just the element: a cell inside a display:none row is not
      // visible however its own computed style reads.
      const vis = (e) => {
        for (let n = e; n && n !== document.body; n = n.parentElement) {
          const c = getComputedStyle(n);
          if (c.display === 'none' || c.visibility === 'hidden') return false;
        }
        return true;
      };
      const scroll = document.getElementById('ob-scroll');
      const body = document.getElementById('ob-body');
      // 🔑 WHEREVER IT LIVES. At desktop width the code is its own column; on a phone it is
      // stacked under the item name. What this asserts is that the code is ON SCREEN and
      // that the two rows' codes differ — not that either lives in a particular cell. Pinning
      // the cell is what the source test used to do, and it was satisfied while the code was
      // being clipped off the right edge.
      const codes = [...body.querySelectorAll('tbody tr')].map(tr => {
        const cell = [...tr.querySelectorAll('td.ob-po, span.ob-code-sub')].find(vis);
        return cell ? cell.textContent.trim() : null;
      }).filter(Boolean);
      const heads = [...body.querySelectorAll('th')];
      const cells = [...(body.querySelector('tbody tr') || { querySelectorAll: () => [] }).querySelectorAll('td')];
      return {
        docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        scrollOver: scroll ? scroll.scrollWidth - scroll.clientWidth : null,
        hasFade: scroll ? scroll.classList.contains('ob-more') : null,
        codes,
        // How many of those code elements sit entirely within the scroll container's box.
        codesInView: (() => {
          const box = scroll ? scroll.getBoundingClientRect() : null;
          if (!box) return 0;
          return [...body.querySelectorAll('tbody tr')].filter(tr => {
            const cell = [...tr.querySelectorAll('td.ob-po, span.ob-code-sub')].find(vis);
            if (!cell) return false;
            const r = cell.getBoundingClientRect();
            return r.left >= box.left - 1 && r.right <= box.right + 1;
          }).length;
        })(),
        headVis: heads.map(vis).join(','),
        cellVis: cells.map(vis).join(','),
        rows: body.querySelectorAll('tbody tr').length,
      };
    });
    check(d.rows === 2, `${tag}: the detail renders both lines (${d.rows})`);
    check(d.docOverflow <= 1, `${tag}: the detail does not make the PAGE scroll sideways (${d.docOverflow}px)`);
    // 🔑 THE TWO CODES ARE BOTH VISIBLE AND DIFFERENT. Hide the code column and these two
    // rows become indistinguishable — same store, item, category and price.
    check(d.codes.length === 2 && d.codes[0] !== d.codes[1],
      `${tag}: both codes are on screen and distinguishable (${d.codes.join(' / ')})`);
    // 🛑 AND NOT MERELY PRESENT — FULLY VISIBLE. A code clipped at the panel's right edge is
    // in the DOM, passes every source assertion, and still reads as the same row twice.
    check(d.codesInView === d.codes.length,
      `${tag}: both codes fit inside the panel rather than being clipped `
      + `(${d.codesInView}/${d.codes.length} fully in view)`);
    // 🛑 Header and body must hide the SAME columns, measured in a real browser rather than
    // grepped: a mismatch shifts every later cell by one and only ever on a phone.
    check(d.headVis === d.cellVis,
      `${tag}: header and row hide the same columns (${d.headVis} vs ${d.cellVis})`);
    check(d.scrollOver === null || (d.scrollOver > 1) === !!d.hasFade,
      `${tag}: the detail's scroll hint matches reality (overflow ${d.scrollOver}px, hint ${d.hasFade})`);

    // ── The manifest card ────────────────────────────────────────────────────
    const man = await page.evaluate(() => {
      const card = document.querySelector('#page-opportunity-buys .ob-man');
      if (!card) return null;
      const cs = (e) => getComputedStyle(e);
      const k = card.querySelector('.ob-man-k');
      const warn = card.querySelector('.ob-note.warn');
      const file = card.querySelector('input[type=file]');
      const box = card.getBoundingClientRect();
      const panel = document.getElementById('ob-panel').getBoundingClientRect();
      return {
        text: card.textContent.replace(/\s+/g, ' ').trim(),
        bg: cs(card).backgroundColor,
        ink: cs(card).color,
        kColor: k ? cs(k).color : null,
        warnColor: warn ? cs(warn).color : null,
        warnText: warn ? warn.textContent.replace(/\s+/g, ' ').trim() : null,
        hasFile: !!file,
        fileScheme: file ? cs(file).colorScheme : null,
        // A card wider than the panel it sits in is the same class of bug as the table
        // running off the right edge, and on a phone it is what a file input causes.
        over: Math.round(box.right - panel.right),
      };
    });
    check(!!man, `${tag}: the buy's manifest card renders`);
    if (man) {
      check(/9/.test(man.text) && /12/.test(man.text),
        `${tag}: the card shows BOTH how many lines there are and how many a scan can reach`);
      // 🛑 THE SHORTFALL IS SPELLED OUT. 12 and 9 side by side is a subtraction the reader
      // has to do; the whole point of the card is that nobody has to.
      check(man.warnText && /cannot be found by a scan/.test(man.warnText),
        `${tag}: …and says in words that 3 lines are unreachable`);
      check(/240/.test(man.text) && /nov-toys\.csv/.test(man.text),
        `${tag}: the sheet's units and filename are on the card`);
      check(man.hasFile, `${tag}: an admin can replace the sheet from here`);
      // 🛑 DESIGN.md trap 4, for a file input rather than a checkbox: the button is UA-drawn
      // and follows color-scheme, which this app never sets — so on a dark panel it renders
      // as a white slab unless the scheme is stated.
      check(scheme !== 'dark' || man.fileScheme === 'dark',
        `${tag}: the file input follows the dark scheme (${man.fileScheme})`);
      check(man.over <= 1, `${tag}: the card stays inside the panel (${man.over}px past its right edge)`);
      // 🛑 DESIGN.md trap 3/6 — measured against the card's OWN background in the live
      // browser, not asserted from the stylesheet.
      const rk = ratio(man.kColor, man.bg), ri = ratio(man.ink, man.bg), rw = ratio(man.warnColor, man.bg);
      check(ri >= 4.5, `${tag}: card text reads against the card (${ri.toFixed(2)}:1)`);
      check(rk >= 4.5, `${tag}: its captions read too (${rk.toFixed(2)}:1)`);
      check(rw >= 4.5, `${tag}: the unreachable-lines warning reads (${rw.toFixed(2)}:1)`);
    }

    // ── And the same card for a buy that has NO sheet ────────────────────────
    const bare = await page.evaluate(async () => {
      window.__OB_MANIFEST = null;
      await window.obOpenDetail('99999');
      await new Promise(r => setTimeout(r, 250));
      const card = document.querySelector('#page-opportunity-buys .ob-man');
      if (!card) return null;
      const none = card.querySelector('.ob-none');
      return {
        text: card.textContent.replace(/\s+/g, ' ').trim(),
        noneColor: none ? getComputedStyle(none).color : null,
        bg: getComputedStyle(card).backgroundColor,
        hasFile: !!card.querySelector('input[type=file]'),
      };
    });
    // 🛑 "NO SHEET" IS NOT "A SHEET OF ZERO LINES" — the same rule as this page's "not
    // tracked" and Coverage's "no count". Exercised as a SECOND render, per DESIGN.md
    // trap 8: both bugs that shipped on Coverage were invisible on first paint.
    check(bare && /none yet/.test(bare.text),
      `${tag}: a buy with no manifest says "none yet", never 0 lines`);
    check(bare && !/\b0 lines?\b/.test(bare.text),
      `${tag}: …and prints no zero anywhere on the card`);
    check(bare && bare.hasFile, `${tag}: …while still offering the upload`);
    check(bare && ratio(bare.noneColor, bare.bg) >= 4.5,
      `${tag}: …and "none yet" reads against the card (${bare ? ratio(bare.noneColor, bare.bg).toFixed(2) : '?'}:1)`);

    // Edit units and stores, from the buy's own page (2026-10-02): its stores, prefilled.
    await page.click('button:text-is("Edit units and stores")').catch(() => {});
    const ed = await page.evaluate(() => ({ open: !!document.getElementById('ob-edit'),
      stores: [...document.querySelectorAll('#ob-edit input[data-store]')].map(i => i.dataset.store + '=' + i.value).join() }));
    check(ed.open && ed.stores === 'BL1=,BL2=5,BL4=,BL14=,BL16=',
      `${tag}: the buy's page offers Edit units and stores, prefilled from the buy (${ed.stores})`);
    await page.keyboard.press('Escape');

    // Put the sheet back so the screenshot below shows the fuller card.
    await page.evaluate(async (m) => { window.__OB_MANIFEST = m; await window.obOpenDetail('99999'); }, MANIFEST);
    await page.waitForTimeout(250);

    const shot2 = `/tmp/claude-0/-home-user-labor-dashboard/50e6f723-4395-5d11-8524-2f90bfbfab23/scratchpad/ob-detail-${view.name}-${scheme}.png`;
    await page.screenshot({ path: shot2, fullPage: view.name === 'phone' });
    console.log(`  shot: ${shot2}`);
    await ctx.close();
  }
}
// ── The Reports tab and the Edit dialog (2026-10-02) ──────────────────────────
//
// Brian's preview, approved the same day: every buy, sold over units per store, tinted 60 %
// and up / under 25 %, days since received, a totals row, tap a row for its stores; Edit for
// admins and superusers, the total being the stores added up. Three buys cover every cell
// state: tinted, plain, no units, not in the buy, a closed store's history, and a buy received
// before sales carried a code (partial, never shaded).
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const ago = (n) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
const cellOf = (units, labels, sold, refunded = 0) => ({ units, labels, sold, refunded });
const REPORT = { ok: true, can_edit: true, tracked_from: ago(9),
  stores: ['BL1', 'BL2', 'BL4', 'BL8', 'BL14', 'BL16'], store_list: ['BL1', 'BL2', 'BL4', 'BL14', 'BL16'],
  buys: [
    { po: '12345', label: 'Drinks', vendor: 'Returns lot', status: 'open', received_on: ago(4), opened_at: `${ago(2)}T14:00:00Z`,
      units: 600, labels: 538, sold: 280, refunded: 3, stores: { BL1: cellOf(120, 120, 88, 2), BL2: cellOf(120, 118, 61),
        BL4: cellOf(120, 96, 20), BL14: cellOf(120, 120, 79, 1), BL16: cellOf(120, 84, 32) } },
    { po: '40302', label: 'Toys Q4', vendor: 'Walmart overstock', status: 'open', received_on: ago(6), opened_at: `${ago(6)}T14:00:00Z`,
      units: 900, labels: 860, sold: 165, refunded: 0, stores: { BL1: cellOf(null, 300, 90), BL2: cellOf(null, 556, 74), BL8: cellOf(null, 4, 1) } },
    { po: '40355', label: 'HBA', vendor: 'CVS closeouts', status: 'open', received_on: ago(12), opened_at: `${ago(12)}T14:00:00Z`,
      units: 1200, labels: 1100, sold: 120, refunded: 1, stores: { BL1: cellOf(300, 300, 40, 1), BL2: cellOf(300, 300, 30),
        BL4: cellOf(300, 250, 25), BL14: cellOf(300, 250, 25) } },
  ] };
const REPORT_ALL = Object.assign({}, REPORT, { buys: REPORT.buys.concat([
  { po: '40488', label: 'Books', vendor: 'Amazon returns', status: 'closed', received_on: ago(20), opened_at: `${ago(20)}T14:00:00Z`,
    units: 400, labels: 400, sold: 232, refunded: 0, stores: { BL1: cellOf(100, 100, 61), BL2: cellOf(100, 100, 52),
      BL4: cellOf(100, 100, 55), BL14: cellOf(100, 100, 64) } }]) });
const over = (t, b) => [0, 1, 2].map(i => t[i] * t[3] + b[i] * (1 - t[3])).concat(1);
const rgba = (s) => { const v = rgb(s); return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1]; };
const ratio4 = (fg, bgs) => {   // fg over the stack of backgrounds, innermost first
  let base = rgba(bgs[bgs.length - 1]);
  for (let i = bgs.length - 2; i >= 0; i--) base = over(rgba(bgs[i]), base);
  const f = over(rgba(fg), base);
  const Lc = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const [hi, lo] = [Lc(f), Lc(base)].sort((x, y) => y - x);
  return { r: (hi + 0.05) / (lo + 0.05), opaque: rgba(bgs[bgs.length - 1])[3] === 1 };
};
for (const view of [{ name: 'phone', width: 390, height: 844 }, { name: 'desktop', width: 1180, height: 1000 }]) {
  for (const scheme of ['dark', 'light']) {
    const ctx = await b.newContext({ viewport: { width: view.width, height: view.height } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    page.on('console', m => {
      if (m.type() !== 'error') return;
      const t = m.text();
      if (/ERR_CERT_AUTHORITY_INVALID|ERR_TUNNEL_CONNECTION_FAILED|ERR_PROXY|ERR_NAME_NOT_RESOLVED|fonts\.googleapis|fonts\.gstatic|status of 404/.test(t)) return;
      errs.push('console: ' + t);
    });
    await page.addInitScript((s) => { try { localStorage.setItem('darkMode', String(s === 'dark')); localStorage.setItem('bioPromptDismissed', '1'); localStorage.setItem('coachTipsDisabled', '1'); } catch {} }, scheme);
    await page.addInitScript(({ REP, REP_ALL }) => {
      window.__rep = REP; window.__repAll = REP_ALL; window.__edits = []; window.__repCalls = 0;
      const real = window.fetch;
      window.fetch = async (u, o = {}) => {
        const s = String(u);
        const J = (x, st = 200) => new Response(JSON.stringify(x), { status: st, headers: { 'content-type': 'application/json' } });
        if (s.includes('auth-me')) return J({ authenticated: true, email: 'bhoward@bargainlane.com',
          name: 'Brian', role: 'superuser', stores: [], pages: {}, businesses: ['bl'] });
        if (s.includes('ob-report')) { window.__repCalls++; return J(s.includes('status=all') ? window.__repAll : window.__rep); }
        if (s.includes('ob-buy-edit')) {
          const bd = JSON.parse(o.body); window.__edits.push(bd);
          return J({ ok: true, po: bd.po, units: Object.values(bd.stores).reduce((a, c) => a + c, 0) || bd.units, alloc: bd.stores });
        }
        if (s.includes('ob-buy-list')) return J({ ok: true, can_edit: true, buys: [] });
        if (s.includes('?action=')) return J({ ok: false, error: 'not in this harness' }, 404);   // never the network
        return real(u, o);
      };
    }, { REP: REPORT, REP_ALL: REPORT_ALL });
    await page.goto('http://127.0.0.1:8098/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.navigateToPage && window.navigateToPage('opportunity-buys'));
    await page.waitForTimeout(700);
    await page.click('#ob-tab-reports');
    await page.waitForSelector('#ob-rep', { timeout: 5000 });
    const tag = `report ${view.name}/${scheme}`;
    const paint = (sel) => page.evaluate((q) => {
      const n = document.querySelector(q); if (!n) return null;
      const chain = [];
      for (let p = n; p; p = p.parentElement) {
        const bg = getComputedStyle(p).backgroundColor; chain.push(bg);
        const a = (bg.match(/[\d.]+/g) || [])[3];
        if (a == null || +a === 1) break;
      }
      return { fg: getComputedStyle(n).color, chain };
    }, sel);
    const reads = async (what, sel) => {
      const p = await paint(sel);
      if (!p) return check(false, `${tag}: ${what} is on the page (${sel})`);
      const x = ratio4(p.fg, p.chain);
      check(x.opaque && x.r >= 4.5, `${tag}: ${what} reads ${x.r.toFixed(2)}:1`);
    };

    // What the hero says, the cells' states, and the days.
    const st = await page.evaluate(() => {
      const row = (po) => document.querySelector(`#ob-rep tr.ob-row[data-po="${po}"]`);
      const cells = (po) => [...row(po).querySelectorAll('td')];
      const heads = [...document.querySelectorAll('#ob-rep thead th')].map(t => t.textContent.trim());
      const at = (po, store) => cells(po)[heads.indexOf(store)];
      return {
        tabOn: document.getElementById('ob-tab-reports').getAttribute('aria-selected'),
        hero: [...document.querySelectorAll('#ob-hero .ob-hv')].map(n => n.textContent.trim()),
        heads,
        days: cells('12345')[1].textContent.trim(),
        good: at('12345', 'BL1').querySelector('.ob-hc').className, plain: at('12345', 'BL2').querySelector('.ob-hc').className,
        slow: at('12345', 'BL4').querySelector('.ob-hc').className, notIn: at('12345', 'BL8').textContent.trim(),
        noUnits: [...at('40302', 'BL1').querySelectorAll('b, small')].map(n => n.textContent.trim()).join(' '),
        closedHist: [...at('40302', 'BL8').querySelectorAll('b, small')].map(n => n.textContent.trim()).join(' '),
        partial: !!row('40355').querySelector('.ob-part'), partialTinted: !!row('40355').querySelector('.ob-hc.good, .ob-hc.slow'),
        total: (document.querySelector('#ob-rep tr.ob-tot td') || {}).textContent,
        legend: document.getElementById('ob-legend').textContent.replace(/\s+/g, ' '),
        sentence: document.getElementById('ob-status').textContent,
      };
    });
    check(st.tabOn === 'true', `${tag}: the Reports tab is the one selected`);
    check(JSON.stringify(st.hero) === JSON.stringify(['2,700', '2,498', '565', '21%']),
          `${tag}: the totals read units 2,700, labeled 2,498, sold 565, sell-through 21% (${st.hero.join(' · ')})`);
    check(JSON.stringify(st.heads) === JSON.stringify(['PO', 'Days', 'Units', 'Sold', '%', 'BL1', 'BL2', 'BL4', 'BL8', 'BL14', 'BL16']),
          `${tag}: the columns: PO, Days, Units, Sold, %, then a store each (${st.heads.join(',')})`);
    check(st.days === '4', `${tag}: 🔑 days since received is counted from the received date, not the day it was opened (${st.days})`);
    check(/ good/.test(st.good) && !/good|slow/.test(st.plain.replace('ob-hc', '')) && / slow/.test(st.slow),
          `${tag}: 73% shades good, 51% plain, 17% slow (${st.good} | ${st.plain} | ${st.slow})`);
    check(st.notIn === '—', `${tag}: a store not in the buy reads —`);
    check(st.noUnits === '90 no units', `${tag}: 🔑 sold with no units set says so rather than inventing a % (${st.noUnits})`);
    check(st.closedHist === '1 no units', `${tag}: a closed store's history still shows (${st.closedHist})`);
    check(st.partial && !st.partialTinted, `${tag}: 🛑 a buy received before tracking is marked partial and never shaded`);
    check(/All 3 buys/.test(st.total || ''), `${tag}: a totals row closes the table`);
    check(/60% or more sold/.test(st.legend) && /Partial/.test(st.legend) && /no units/.test(st.legend),
          `${tag}: the legend explains every cell state`);
    check(/565 sold/.test(st.sentence) && /Sales count from/.test(st.sentence), `${tag}: one sentence reads the numbers back (${st.sentence})`);

    // Trap 6: every pair measured on what is painted under it.
    await reads('a hero number', '#ob-hero .ob-hv');
    await reads('a hero caption', '#ob-hero .ob-hk');
    await reads('the PO', '#ob-rep tr.ob-row .ob-po');
    await reads('the buy\'s name', '#ob-rep tr.ob-row .ob-sub');
    await reads('a shaded-good cell', '#ob-rep tr.ob-row .ob-hc.good b');
    await reads('…and its green "of" line', '#ob-rep tr.ob-row .ob-hc.good small');
    await reads('a slow cell', '#ob-rep tr.ob-row .ob-hc.slow b');
    await reads('…and its amber "of" line', '#ob-rep tr.ob-row .ob-hc.slow small');
    await reads('the Partial tag', '#ob-rep .ob-part');
    await reads('the totals row', '#ob-rep tr.ob-tot td');
    await reads('the legend', '#ob-legend');
    await reads('the selected tab', '#ob-tab-reports');
    await reads('the other tab', '#ob-tab-buys');
    await reads('the sentence', '#ob-status');

    // Trap 2: the PO column stays put, opaque, when the table scrolls sideways.
    const sticky = await page.evaluate(async () => {
      const box = document.getElementById('ob-scroll'), cell = document.querySelector('#ob-rep tr.ob-row .ob-l');
      const before = cell.getBoundingClientRect().left;
      box.scrollLeft = 400; await new Promise(r => setTimeout(r, 80));
      const r = cell.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + 20, r.top + r.height / 2);
      const bg = (getComputedStyle(cell).backgroundColor.match(/[\d.]+/g) || [])[3];
      const res = { moved: Math.abs(r.left - before), onTop: !!(top && top.closest('.ob-l')), opaque: bg == null || +bg === 1, scrolled: box.scrollLeft };
      box.scrollLeft = 0; return res;
    });
    if (sticky.scrolled > 0) check(sticky.moved < 1 && sticky.onTop && sticky.opaque, `${tag}: the PO column stays put, on top and opaque while the stores scroll (${JSON.stringify(sticky)})`);
    if (view.name === 'phone') {
      const ph = await page.evaluate(() => ({ cols: getComputedStyle(document.getElementById('ob-hero')).gridTemplateColumns.split(' ').length,
        over: document.getElementById('ob-scroll').scrollWidth - document.getElementById('ob-scroll').clientWidth,
        fade: document.getElementById('ob-scroll').classList.contains('ob-more'),
        page: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
      check(ph.cols === 2, `${tag}: the totals sit two by two on a phone`);
      check(ph.over > 1 && ph.fade && ph.page <= 1, `${tag}: the stores scroll inside the panel, say so, and the page does not (${JSON.stringify(ph)})`);
    }

    // A row unfolds into its stores, with Edit for an admin.
    await page.click('#ob-rep tr.ob-row[data-po="12345"]');
    const kid = await page.evaluate(() => { const k = document.querySelector('#ob-rep tr.ob-kid'); return k && {
      rows: k.querySelectorAll(':scope table > tbody > tr').length, edit: [...k.querySelectorAll('button')].some(b => /Edit units and stores/.test(b.textContent)) }; });
    check(kid && kid.rows === 5 && kid.edit, `${tag}: tapping a buy unfolds its 5 stores, with Edit (${JSON.stringify(kid)})`);
    await reads('the unfolded stores', '#ob-rep tr.ob-kid table tbody td');

    // The dialog: open stores only, the total is the stores added up, Save posts them.
    await page.click('#ob-rep tr.ob-kid button:text-is("Edit units and stores")');
    await page.waitForSelector('#ob-edit input[data-store]', { timeout: 3000 });
    const dlg = await page.evaluate(() => ({ stores: [...document.querySelectorAll('#ob-edit input[data-store]')].map(i => i.dataset.store + '=' + i.value),
      tot: document.getElementById('ob-edit-tot').textContent.trim(), type: document.querySelector('#ob-edit input[data-store]').getAttribute('type') }));
    check(dlg.stores.join() === 'BL1=120,BL2=120,BL4=120,BL14=120,BL16=120', `${tag}: 🔑 Edit offers the open stores only — no BL8 — with their units (${dlg.stores.join()})`);
    check(dlg.tot === '600' && dlg.type === 'text', `${tag}: …the total is them added up, inputs are type=text (trap 1)`);
    await reads('the dialog title', '#ob-edit .ob-et');
    await reads('the dialog note', '#ob-edit .ob-ed');
    await reads('a store input', '#ob-edit input[data-store]');
    await reads('Cancel', '#ob-edit .ob-ecancel');
    await page.fill('#ob-edit input[data-store="BL1"]', '150');
    await page.fill('#ob-edit input[data-store="BL16"]', '');
    check((await page.textContent('#ob-edit-tot')).trim() === '510', `${tag}: the total follows the stores as they are typed`);
    const calls0 = await page.evaluate(() => window.__repCalls);
    await page.click('#ob-edit-save');
    await page.waitForFunction(() => !document.getElementById('ob-edit'), null, { timeout: 3000 }).catch(() => {});
    const e1 = await page.evaluate(() => window.__edits[0]);
    check(JSON.stringify(e1) === JSON.stringify({ po: '12345', stores: { BL1: 150, BL2: 120, BL4: 120, BL14: 120 } }),
          `${tag}: 🔑 Save posts the stores, a blank one left out (${JSON.stringify(e1)})`);
    check(await page.evaluate((c) => !document.getElementById('ob-edit') && window.__repCalls > c, calls0),
          `${tag}: …closes, and the report reloads`);

    // A buy with no store units: the total itself is typed.
    await page.click('#ob-rep tr.ob-row[data-po="40302"]');
    await page.click('#ob-rep tr.ob-kid button:text-is("Edit units and stores")');
    await page.waitForSelector('#ob-edit-units', { timeout: 3000 });
    check((await page.inputValue('#ob-edit-units')) === '900', `${tag}: with no store set, the dialog offers the typed total (900)`);
    await page.fill('#ob-edit-units', '950');
    await page.click('#ob-edit-save');
    await page.waitForFunction(() => window.__edits.length === 2, null, { timeout: 3000 }).catch(() => {});
    check(JSON.stringify(await page.evaluate(() => window.__edits[1])) === JSON.stringify({ po: '40302', stores: {}, units: 950 }),
          `${tag}: …and Save sends it as the total`);
    await page.click('#ob-rep tr.ob-row[data-po="40302"]');   // fold it away again (it stays open across the reload)
    await page.click('#ob-rep tr.ob-row[data-po="40302"]');
    await page.click('#ob-rep tr.ob-kid button:text-is("Edit units and stores")');
    await page.waitForSelector('#ob-edit', { timeout: 3000 });
    await page.keyboard.press('Escape');
    check(!(await page.$('#ob-edit')), `${tag}: Escape cancels the dialog`);

    // Trap 8: the second render. The filter, then away to Buys and back.
    await page.selectOption('#ob-filter', 'all');
    await page.waitForFunction(() => !!document.querySelector('#ob-rep tr.ob-row[data-po="40488"]'), null, { timeout: 3000 }).catch(() => {});
    const second = await page.evaluate(() => ({ closed: !!document.querySelector('#ob-rep tr.ob-row[data-po="40488"] .ob-badge'),
      hero: document.querySelector('#ob-hero .ob-hv').textContent.trim() }));
    check(second.closed && second.hero === '3,100', `${tag}: switching to All re-renders: the closed buy appears, the totals follow (${JSON.stringify(second)})`);
    await page.click('#ob-tab-buys');
    await page.waitForTimeout(300);
    const buysBack = await page.evaluate(() => ({ hero: document.getElementById('ob-hero').hidden,
      legend: /taking labels/.test(document.getElementById('ob-legend').textContent) }));
    check(buysBack.hero && buysBack.legend, `${tag}: Buys puts its own legend back and hides the report's totals`);
    await page.evaluate(() => { window.__rep.can_edit = false; window.__repAll.can_edit = false; });
    await page.click('#ob-tab-reports');
    await page.waitForSelector('#ob-rep tr.ob-row[data-po="12345"]', { timeout: 3000 });
    await page.click('#ob-rep tr.ob-row[data-po="12345"]');
    const noEdit = await page.evaluate(() => !!document.querySelector('#ob-rep tr.ob-kid') &&
      ![...document.querySelectorAll('#ob-rep tr.ob-kid button')].some(b => /Edit/.test(b.textContent)));
    check(noEdit, `${tag}: 🛑 with can_edit false (a manager), there is no Edit`);
    check(errs.length === 0, `${tag}: no page errors${errs.length ? ' — ' + errs.slice(0, 2).join(' | ') : ''}`);
    await ctx.close();
  }
}

await b.close();
srv.close();

console.log('\nOpportunity Buys — browser check\n');
let bad = 0;
for (const [okk, msg] of results) { if (!okk) bad++; console.log(`  ${okk ? 'ok  ' : 'FAIL'} ${msg}`); }
console.log(`\n${results.length - bad} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
