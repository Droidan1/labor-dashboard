// The Discounts & Returns page (Brian, 2026-11-12): how it is reached, who sees it, what it reads,
// and that nothing a cashier typed can become markup.
//
// Two halves. The WIRING is read from the markup: the sidebar item next to the Retail Summary,
// the router's financial gate, applyRoleUI's reveal, the business map. The BEHAVIOUR is the page's
// own code, cut out of index.html and run in a vm with a stub DOM and a stub fetch — the real
// initDiscounts → drLoad → render path, not a regex of it (tasks/lessons.md, "Tests must drive real
// entry points"). scripts/browser-discounts-page.mjs drives the same page in Chromium.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const REPO = process.argv[2] || '.';
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log(`  PASS  ${name}`); } else { fail++; console.log(`  FAIL  ${name}`); } };

// ── Wiring ──
console.log('how the page is reached:');
const navRetail = html.indexOf(`data-page="weekly-summary" data-menu-section="Store" onclick="navigateToPage('weekly-summary')"`);
const navItem = html.match(/<div id="nav-discounts" class="([^"]*)" data-page="discounts" data-menu-section="Store" onclick="navigateToPage\('discounts'\)">/);
ok('a sidebar item, in the Store section (so the phone Menu lists it)', !!navItem);
ok('it starts hidden, like every role-gated item', !!navItem && /\bhidden\b/.test(navItem[1]));
const between = navRetail >= 0 && navItem ? html.slice(navRetail, navItem.index) : '';
ok('it sits right after the Retail Summary', !!between && (between.match(/class="[^"]*nav-item/g) || []).length === 0);
ok('the page section exists, titled in the brand font', /<div id="page-discounts" class="hidden">/.test(html)
  && /<h1 class="text-2xl font-brand text-accent-green uppercase tracking-wide">Discounts &amp; Returns<\/h1>/.test(html));
ok("navigateToPage starts it", /if \(page === 'discounts'\) \{\n\s+if \(typeof initDiscounts === 'function'\) initDiscounts\(\);/.test(html));

console.log('\nwho sees it — the Retail Summary\'s gate, not a page grant:');
const fin = html.match(/const FINANCIAL_PAGES = \[([\s\S]*?)\];/);
ok("it is a FINANCIAL_PAGE, so staff and associates are refused", !!fin && /'discounts'/.test(fin[1]));
const adminOnly = html.match(/const adminOnly = \[([^\]]*)\]/);
ok('it is not admin-only (managers and executives see it)', !!adminOnly && !/'discounts'/.test(adminOnly[1]));
ok("applyRoleUI reveals it to whoever may see money", /const navDiscounts = el\('nav-discounts'\);\n\s+if \(navDiscounts\) navDiscounts\.classList\.toggle\('hidden', !seesMoney\);/.test(html));
ok("it belongs to Bargain Lane in NAV_BUSINESS", /'nav-discounts': 'bl',/.test(html));
const grant = html.match(/const GRANTABLE_PAGES = \[([\s\S]*?)\];/);
ok('it is not a grantable page', !grant || !/discounts/.test(grant[1]));

console.log('\nthe markup traps (DESIGN.md §4.8):');
ok('trap 1: the date inputs say type="date"', /id="dr-f-from" type="date"/.test(html) && /id="dr-f-to" type="date"/.test(html));
ok('trap 2: the sticky first column has an opaque background of its own',
  /#page-discounts \.dr-tbl th,#page-discounts \.dr-tbl td\{[^}]*background:var\(--dr-panel\)\}/.test(html)
  && /#page-discounts \.dr-tbl \.dr-first\{position:sticky;left:0;/.test(html));
ok('trap 3: colour is stated for both themes on the page, dark through the op-* variables',
  /#page-discounts\{--dr-panel:#ffffff;--dr-panelHi:#fafaf6;--dr-ink:#14110a;--dr-dim:#6b6453;/.test(html)
  && /\.dark #page-discounts\{--dr-panel:rgb\(var\(--op-panel\)\);--dr-panelHi:rgb\(var\(--op-panelHi\)\);--dr-ink:rgb\(var\(--op-ink\)\);/.test(html));
ok('trap 4: native controls follow the dark theme', /\.dark #page-discounts select,\.dark #page-discounts input\{color-scheme:dark\}/.test(html));
ok('trap 7: the render targets hold nothing else', /<section id="dr-disc"><\/section>/.test(html) && /<section id="dr-ret"><\/section>/.test(html)
  && /<div id="dr-edit-body"><\/div>/.test(html));

// ── Behaviour: the page's own code, run ──
const start = html.indexOf('  // ══ Discounts & Returns (Brian, 2026-11-12) ═');
const end = html.indexOf('  // ── Coverage scorecard ─');
ok("the page's code is in index.html", start > 0 && end > start);
if (!(start > 0 && end > start)) {
  console.log(`\n${fail} FAILED`);
  process.exit(1);
}
const block = html.slice(start, end);
console.log('\nthe code itself:');
ok('no native confirm() or alert() (they freeze the PWA)', !/(^|[^\w.])(confirm|alert)\(/m.test(block.replace(/uiConfirm\(|uiAlert\(/g, '')));
ok('Discard asks with uiConfirm', /await uiConfirm\(`Discard \$\{n\} unsaved change/.test(block));

// The app's own helpers the page calls, cut from index.html rather than re-written here.
const grab = (re, what) => { const m = html.match(re); ok(`found ${what}`, !!m); return m ? m[0] : ''; };
const dateMath = (() => {
  const a = html.indexOf("  // ── 'YYYY-MM-DD' date math"), b = html.indexOf('  // Derive the retail week that seeds');
  ok('found the date-range engine', a > 0 && b > a);
  return html.slice(a, b);
})();
const helpers = [
  grab(/function etTodayStr\(\) \{[^\n]*\}/, 'etTodayStr'),
  grab(/function fmtDollar\(n\) \{\n[\s\S]*?\n  \}/, 'fmtDollar'),
  dateMath,
].join('\n');

const H = '<img src=x onerror=alert(1)>';
const HQ = `"><img src=x onerror="x=1">`;
function makeEl(id) {
  const set = new Set();
  return { id, innerHTML: '', textContent: '', value: '', hidden: false, disabled: false, dataset: {}, className: '',
    classList: { add: c => set.add(c), remove: c => set.delete(c), contains: c => set.has(c),
      toggle: (c, on) => { const v = on === undefined ? !set.has(c) : !!on; v ? set.add(c) : set.delete(c); return v; } } };
}
function boot(user, answer) {
  const els = new Map();
  const reqs = [], posts = [], confirms = [];
  const ctx = {
    URLSearchParams, setTimeout, console,
    WORKER_BASE: 'https://api.example.test/',
    currentUser: user,
    el: (id) => { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id); },
    uiConfirm: async (m) => { confirms.push(m); return true; },
    fetch: async (url, o = {}) => {
      const q = Object.fromEntries(new URL(url).searchParams);
      if ((o.method || 'GET') === 'POST') { posts.push(JSON.parse(o.body)); return { ok: true, status: 200, json: async () => ({ ok: true }) }; }
      reqs.push(q);
      const [status, body] = answer(q);
      return { ok: status < 400, status, json: async () => body };
    },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(`${helpers}\n${block}\n;globalThis.__dr = { initDiscounts, drLoad, drState, drEsc, drEditSet, drEditSave, drEditDiscard };`, ctx);
  return { dr: ctx.__dr, el: ctx.el, reqs, posts, confirms, ctx };
}
const tick = () => new Promise(r => setTimeout(r, 30));

// A fixture with a hostile string in every field a person types.
const disc = {
  ok: true, stores: ['BL1', 'BL2'],
  totals: { discounts: 1234.5, applications: 40, discountedOrders: 31, itemLevel: 1000, orderLevel: 234.5, planned: 600, manual: 400, unclassified: 234.5,
    onBins: 0, grossRetail: 20000, pctOfGrossRetail: 6.17 },
  byStore: [{ store: 'BL1', discounts: 800, applications: 25, discountedOrders: 20, planned: 400, manual: 300, unclassified: 100, grossRetail: 12000, pctOfGrossRetail: 6.67 },
    { store: 'BL2', discounts: 434.5, applications: 15, discountedOrders: 11, planned: 200, manual: 100, unclassified: 134.5, grossRetail: 8000, pctOfGrossRetail: 5.43 }],
  byCategory: [{ l2: `Kids' & "Baby"`, l3: H, discounts: 300, applications: 9 }, { l2: 'Seasonal', l3: 'Halloween', discounts: 600, applications: 20 }],
  byButton: [{ name: 'Halloween 10%', class: 'planned', discounts: 600, applications: 20, stores: 2, levels: ['item'], percent: 10, amount: null },
    { name: H, class: 'unclassified', discounts: 234.5, applications: 8, stores: 1, levels: ['item'], percent: null, amount: 3 },
    { name: '$5 off', class: 'manual', discounts: 400, applications: 12, stores: 2, levels: ['order'], percent: null, amount: 5 }],
  byEmployee: [{ store: 'BL1', employee: H, discounts: 500, applications: 10, planned: 200, manual: 200, unclassified: 100 },
    { store: 'BL2', employee: HQ, discounts: 100, applications: 3, planned: 0, manual: 100, unclassified: 0 },
    { store: 'BL2', employee: '(unknown)', discounts: 50, applications: 2, planned: 0, manual: 50, unclassified: 0 }],
  byDay: [], byWeek: [{ weekEnding: '2026-10-03', days: 3, discounts: 100, applications: 3, planned: 50, manual: 50, unclassified: 0 }],
  byMonth: [{ month: '2026-10', days: 31, discounts: 1234.5, applications: 40, planned: 600, manual: 400, unclassified: 234.5 }],
  largest: [{ store: 'BL1', date: '2026-10-05', time: '2026-10-05T18:30:00.000Z', orderId: 'O1', level: 'item', name: H, class: 'unclassified', percent: null, amount: 3,
    discount: 3, lines: 1, lineName: H, l2: 'Seasonal', l3: H, employee: H, approver: H }],
  coverage: { storeDays: 62, complete: 61, incomplete: [{ store: 'BL2', date: '2026-10-04', note: 'x' }], missing: [] },
};
const ret = {
  ok: true, stores: ['BL1', 'BL2'],
  totals: { paymentRefunds: { count: 2, amount: 160 }, manualRefunds: { count: 1, amount: 480 }, total: 640, flagged: 3, payments: 21400, ratePct: 2.99 },
  byStore: [{ store: 'BL1', paymentRefunds: { count: 2, amount: 160 }, manualRefunds: { count: 1, amount: 480 }, total: 640, flagged: 3, payments: 21400, ratePct: 2.99 }],
  byEmployee: [{ store: 'BL1', employee: H, paymentRefunds: 2, paymentRefundAmount: 160, manualRefunds: 1, manualRefundAmount: 480, flagged: 3 }],
  repeatEmployees: [{ store: 'BL1', employee: H, weekStart: '2026-10-04', weekEnding: '2026-10-10', manualRefunds: 3 }],
  rows: [
    { id: 'a', store: 'BL1', date: '2026-10-06', time: '2026-10-06T15:00:00.000Z', kind: 'manual refund', amount: 480, tax: 0, preTax: 480, employee: H, reason: H,
      items: `return fridge $-480.00 ${H}`, itemLines: 1, saleInArchive: true, itemsChecked: true, flags: ['over $100'] },
    { id: 'b', store: 'BL1', date: '2026-10-07', time: '2026-10-07T15:00:00.000Z', kind: 'payment refund', amount: 130, tax: 8.5, preTax: 121.5, employee: 'Sam',
      reason: null, items: null, itemLines: 0, saleInArchive: true, itemsChecked: false, saleReceipt: `Blender $125.00; ${H} $5.00`, flags: ['over $100'] },
    { id: 'c', store: 'BL1', date: '2026-10-08', time: '2026-10-08T15:00:00.000Z', kind: 'payment refund', amount: 30, tax: 2, preTax: 28, employee: 'Sam',
      reason: null, items: null, itemLines: 0, saleInArchive: true, itemsChecked: true, flags: ['no item recorded'] },
  ],
  rowsTotal: 3, rowsTruncated: false, coverage: { bankedThrough: '2026-10-29', incompleteStoreDays: 0 },
};
const classes = { ok: true, from: '2026-07-14', to: '2026-11-11', classes: [],
  seen: [{ name: 'Halloween 10%', class: 'planned', discounts: 600, applications: 20, stores: 2, lastDate: '2026-10-31', percent: 10, amount: null },
    { name: H, class: 'unclassified', discounts: 234.5, applications: 8, stores: 1, lastDate: '2026-10-30', percent: null, amount: 3 },
    { name: '$1 off', class: 'manual', discounts: 50, applications: 50, stores: 2, lastDate: '2026-10-30', percent: null, amount: 1 }] };
const answer = (q) => q.action === 'discounts' ? [200, disc] : q.action === 'returns' ? [200, ret] : [200, classes];

const ADMIN = { email: 'a@example.com', role: 'admin', stores: null };
{
  const t = boot(ADMIN, answer);
  t.dr.initDiscounts();
  await tick();
  const out = ['dr-disc', 'dr-ret', 'dr-edit-body', 'dr-f-emp', 'dr-f-cat', 'dr-period'].map(id => t.el(id).innerHTML).join('\n');
  console.log('\nwhat it reads (admin):');
  const d = t.reqs.filter(q => q.action === 'discounts');
  ok('discounts, twice: the range and the period of equal length before it', d.length === 2
    && Math.round((Date.parse(d[0].to) - Date.parse(d[0].from)) / 864e5) === Math.round((Date.parse(d[1].to) - Date.parse(d[1].from)) / 864e5)
    && d[1].to < d[0].from);
  ok('the default range is the last full calendar month', d[0].from.endsWith('-01') && new Date(d[0].to + 'T12:00:00Z').getUTCDate()
    === new Date(Date.UTC(+d[0].to.slice(0, 4), +d[0].to.slice(5, 7), 0)).getUTCDate() && d[0].to < new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()).slice(0, 7) + '-01');
  ok('returns once, flagged rows, for the same range', t.reqs.some(q => q.action === 'returns' && q.filter === 'flagged' && q.from === d[0].from && q.to === d[0].to));
  ok('the discount names, for the editor', t.reqs.some(q => q.action === 'discount-classes'));
  ok('the editor is shown to an admin', !t.el('dr-edit-wrap').classList.contains('hidden'));

  console.log('\n🛑 nothing typed at a register becomes markup:');
  ok('no <img> survives anywhere the page drew', !/<img/i.test(out));
  const esc = '&lt;img src=x onerror=alert(1)&gt;';
  const n = out.split(esc).length - 1;
  ok(`the hostile string is drawn as text wherever it lands (${n} places)`, n >= 12);
  for (const [where, re] of [
    ['a discount button name', /<td class="dr-first">&lt;img src=x onerror=alert\(1\)&gt;<\/td><td class="l"><span class="dr-chip unc">/],
    ['an employee', />&lt;img src=x onerror=alert\(1\)&gt;<\/td><td class="l">Coliseum/],
    ["a cashier's note on a manual refund", /Ticket:<\/span> return fridge \$-480\.00 &lt;img src=x onerror=alert\(1\)&gt;/],
    ["the sale's receipt on an unchecked refund", /The sale's receipt: Blender \$125\.00; &lt;img src=x onerror=alert\(1\)&gt; \$5\.00/],
    ['an L3', /<span class="dr-lvl l3">L3<\/span>&lt;img src=x onerror=alert\(1\)&gt;/],
    ['the editor row', /aria-label="Planned or manual: &lt;img src=x onerror=alert\(1\)&gt;"/],
  ]) ok(`…${where}`, re.test(out));
  ok('a quote cannot close an attribute: the employee option value is escaped whole',
    out.includes('value="&quot;&gt;&lt;img src=x onerror=&quot;x=1&quot;&gt;"') && !out.includes('value=""><'));
  ok("…and so is a category with both quotes", out.includes(`value="Kids&#39; &amp; &quot;Baby&quot;"`));
  ok('drEsc escapes all five', t.dr.drEsc(`<a href='x'>"&"</a>`) === '&lt;a href=&#39;x&#39;&gt;&quot;&amp;&quot;&lt;/a&gt;');

  console.log('\nwhat it says:');
  ok('seven discount tiles and four refund tiles', (t.el('dr-disc').innerHTML.match(/class="dr-tile"/g) || []).length === 7
    && (t.el('dr-ret').innerHTML.match(/class="dr-tile"/g) || []).length === 4);
  ok('an item that could not be checked says so, not "no item"', /Not checked: the sale's receipt was archived before this return\./.test(out));
  ok('the three flags are chips', /<span class="dr-chip flag">Over \$100<\/span>/.test(out) && /<span class="dr-chip flag">No item recorded<\/span>/.test(out));
  ok('the 3-day banking lag, with the day the range is in through', /banked 3 days after each day, so this range is in through Oct 29, 2026/.test(out));
  ok('the coverage line names the incomplete day', /Discounts are recorded for 62 store-days; 1 of them incomplete \(South Bend Oct 4\)\./.test(out));
  ok('an employee with none recorded reads as such', /No employee recorded/.test(out));

  console.log('\nthe editor sends only what changed:');
  const rowsOf = t.dr.drState().edit.seen;
  const sel = (i, v) => ({ dataset: { i: String(i) }, value: v, className: '' });
  t.dr.drEditSet(sel(1, 'manual'));            // the hostile name: unclassified → manual
  t.dr.drEditSet(sel(0, 'manual'));            // Halloween: planned → manual
  t.dr.drEditSet(sel(2, 'planned'));           // $1 off: manual → planned …
  const back = sel(2, 'manual'); t.dr.drEditSet(back);    // … and back
  ok('a cell changed back to where it was reads as set, not changed', back.className === 'dr-cls own');
  ok('Save counts two changes', t.el('dr-edit-save').textContent === 'Save 2 changes' && !t.el('dr-edit-save').disabled);
  await t.dr.drEditSave();
  await tick();
  const sent = (t.posts[0]?.classes || []).map(c => `${c.name}=${c.class}`).sort();
  ok(`one POST with exactly those two (${JSON.stringify(sent)})`, t.posts.length === 1 && JSON.stringify(sent) === JSON.stringify([`${H}=manual`, 'Halloween 10%=manual'].sort()));
  ok('saving re-reads the page and the names', t.reqs.filter(q => q.action === 'discounts').length === 4 && t.reqs.filter(q => q.action === 'discount-classes').length === 2);
  // The stub does not apply a POST, so the names come back as they were: Halloween is planned.
  t.dr.drEditSet(sel(0, ''));
  await t.dr.drEditSave();
  ok('back to unclassified is sent as null', JSON.stringify(t.posts[1]?.classes) === JSON.stringify([{ name: 'Halloween 10%', class: null }]) && rowsOf.length === 3);
  t.dr.drEditSet(sel(2, 'planned'));
  await t.dr.drEditDiscard();
  ok('Discard asks first, then drops the draft', t.confirms.length === 1 && t.dr.drState().edit.draft.size === 0);
}

{
  console.log('\na manager:');
  const t = boot({ email: 'm@example.com', role: 'manager', stores: ['BL1', 'BL2'] }, answer);
  t.dr.initDiscounts();
  await tick();
  ok('no editor', t.el('dr-edit-wrap').classList.contains('hidden'));
  ok('the discount names are never read', !t.reqs.some(q => q.action === 'discount-classes'));
  ok('the store filter offers only their stores', /<option value="">All my stores<\/option><option value="BL1">Coliseum<\/option><option value="BL2">South Bend<\/option>$/.test(t.el('dr-f-store').innerHTML));
  ok('…and the legend does not offer a control', /an admin sets it/.test(t.el('dr-disc').innerHTML));
}

{
  console.log('\nempty, refused, failed:');
  const empty = { ...disc, totals: { ...disc.totals, applications: 0, discounts: 0 }, byStore: [], byButton: [], byCategory: [], byEmployee: [], largest: [] };
  let t = boot(ADMIN, q => q.action === 'discounts' ? [200, empty] : q.action === 'returns' ? [200, { ...ret, totals: null }] : [200, classes]);
  t.dr.initDiscounts(); await tick();
  ok('"No discounts recorded for this range."', /No discounts recorded for this range\./.test(t.el('dr-disc').innerHTML));
  ok('"No refunds recorded for this range."', /No refunds recorded for this range\./.test(t.el('dr-ret').innerHTML));
  t = boot(ADMIN, q => q.action === 'discount-classes' ? [200, classes] : [403, { error: 'Forbidden', code: 'NO_FINANCIAL_ACCESS' }]);
  t.dr.initDiscounts(); await tick();
  ok('a 403 says it is access, and offers no Retry', /Couldn't load discounts\.<\/b> Your account does not have access to sales figures\./.test(t.el('dr-disc').innerHTML)
    && !/Retry/.test(t.el('dr-disc').innerHTML));
  t = boot(ADMIN, q => q.action === 'discounts' ? [503, { error: 'The discount record is not available (migration-089)' }] : q.action === 'returns' ? [200, ret] : [200, classes]);
  t.dr.initDiscounts(); await tick();
  ok('a 503 shows the reason and Retry', /The discount record is not available \(migration-089\)/.test(t.el('dr-disc').innerHTML) && /onclick="drLoad\(true\)">Retry/.test(t.el('dr-disc').innerHTML));
  ok('…while the refunds still render', (t.el('dr-ret').innerHTML.match(/class="dr-tile"/g) || []).length === 4);
  t.dr.drState().preset = 'custom'; t.dr.drState().cFrom = '2026-01-01'; t.dr.drState().cTo = '2026-06-30';
  const before = t.reqs.length;
  await t.dr.drLoad(true);
  ok('a range over 92 days is refused before any read', t.reqs.length === before && /at most 92 days/.test(t.el('dr-period').innerHTML));
}

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `\nall ${pass} assertions passed`);
process.exit(fail ? 1 : 0);
