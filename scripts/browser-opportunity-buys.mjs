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
          manifest: window.__OB_MANIFEST, manifest_history: window.__OB_MANIFEST ? 2 : 0 });
        if (s.includes('ob-buy-list')) return J({ ok: true, can_edit: true, buys: [BUY] });
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

    // Put the sheet back so the screenshot below shows the fuller card.
    await page.evaluate(async (m) => { window.__OB_MANIFEST = m; await window.obOpenDetail('99999'); }, MANIFEST);
    await page.waitForTimeout(250);

    const shot2 = `/tmp/claude-0/-home-user-labor-dashboard/50e6f723-4395-5d11-8524-2f90bfbfab23/scratchpad/ob-detail-${view.name}-${scheme}.png`;
    await page.screenshot({ path: shot2, fullPage: view.name === 'phone' });
    console.log(`  shot: ${shot2}`);
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
