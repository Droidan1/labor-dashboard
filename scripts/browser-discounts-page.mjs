// The Discounts & Returns page, driven in a REAL BROWSER, in light and dark (plus pure black and
// Halloween for the contrast audit).
//
// 🛑 NOT PART OF `scripts/test.sh` — needs playwright-core and a Chromium. Run by hand:
//
//   npm install --no-save playwright-core
//   bash scripts/build.sh && node scripts/browser-discounts-page.mjs
//   (on a Mac: PLAYWRIGHT_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
//
// scripts/test-discounts-page.mjs pins the markup and the wiring. This proves the page works:
//   1. it renders every table from realistic fixtures with no page error, and an error state with
//      Retry that recovers;
//   2. contrast COMPUTED against the composited background of every text node, ≥ 4.5:1, per kind
//      (body, muted, chips, table headers, tiles), in every theme — never a screenshot;
//   3. no horizontal page scroll at 375px, and the sticky first column stays put with an opaque
//      background when its table scrolls sideways (DESIGN.md §4.8 trap 2);
//   4. a filter change re-renders (trap 8: the SECOND render), and every read carries it;
//   5. Save sends exactly the names changed in the draft, and Discard asks with uiConfirm;
//   6. a manager sees their stores and no editor; staff never reach the page; a 403 says so;
//   7. hostile strings — `<img src=x onerror=alert(1)>` among them — render as inert text.
//
// Every API call is answered in the page by the mock below; any request that still reaches a
// retjghub.com host is aborted and fails the run.
let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch (e) {
  console.error('\nThis check needs playwright-core: npm install --no-save playwright-core\n');
  process.exit(2);
}
const CHROME = process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium';

import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'dist');
if (!fs.existsSync(path.join(root, 'index.html'))) {
  console.error('\ndist/ is not built. Run: bash scripts/build.sh\n'); process.exit(2);
}
const SHOTS = process.env.SHOT_DIR || '/tmp';
fs.mkdirSync(SHOTS, { recursive: true });
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, s) => {
  const f = path.join(root, q.url === '/' ? 'index.html' : q.url.split('?')[0]);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end('no'); }
  s.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(s);
});
await new Promise(r => srv.listen(8097, r));
const URL_ = 'http://127.0.0.1:8097/index.html';

const TZ = 'America/New_York';
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const HOSTILE = '<img src=x onerror=alert(1)>';
const HOSTILE2 = '"><img src=x onerror="window.__xss=(window.__xss||0)+1">';

// ── The fixture: a pure function of the query, so Node can compute what the page should show ──
function makeMock(cfg) {
  const ALL = ['BL1', 'BL2', 'BL4', 'BL14', 'BL16'];
  const scope = cfg.scope || null;
  const classes = Object.assign({}, cfg.classes || {});
  const H = cfg.hostile, H2 = cfg.hostile2;
  const BUTTONS = [
    { name: 'Halloween 10%', percent: 10, amount: null, level: 'item', item: 'Skeleton yard stake', cats: [['Seasonal', 'Halloween', 1]], base: 120 },
    { name: '$5 off', percent: null, amount: 5, level: 'order', item: null, cats: [['Housewares', 'Kitchen', 0.6], ['Toys', 'Games', 0.4]], base: 260 },
    { name: '$1 off', percent: null, amount: 1, level: 'item', item: 'Chips 3pk', cats: [['Grocery', 'Snacks', 1]], base: 18 },
    { name: 'Manager special', percent: 20, amount: null, level: 'item', item: 'Flannel shirt', cats: [['Apparel', 'Mens', 1]], base: 40 },
    { name: H, percent: null, amount: 3, level: 'item', item: H, cats: [[`Kids' & "Baby"`, H2, 1]], base: 9 },
    { name: 'Senior Tuesday', percent: 15, amount: null, level: 'order', item: null, cats: [['Housewares', 'Bath', 1]], base: 25 },
  ];
  const CAT_SHARE = { Seasonal: 0.2, Housewares: 0.25, Toys: 0.1, Grocery: 0.2, Apparel: 0.15, [`Kids' & "Baby"`]: 0.1 };
  const SF = { BL1: 1.4, BL2: 1.1, BL4: 0.9, BL14: 0.7, BL16: 1.0 };
  const EMP = { BL1: ['Dana Ruiz', H], BL2: ['Sam Lee', '(unknown)'], BL4: ['Lee Ortiz', 'Ana Wu'], BL14: ['Bo Chen', 'Ana Wu'], BL16: ['Cy Diaz', 'Eve Ng'] };
  const add = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const days = (a, b) => { const o = []; for (let d = a; d <= b; d = add(d, 1)) o.push(d); return o; };
  // Varies by month too, or two back-to-back 31-day ranges hold the same days of the month and tie.
  const dayF = (d) => 1 + (Number(d.slice(8)) % 7) / 10 + (Number(d.slice(5, 7)) % 3) / 20;
  const cls = (n) => classes[String(n).trim().toLowerCase()] || 'unclassified';
  const $ = (c) => Math.round(c) / 100;
  const weekEnding = (d) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + (6 - x.getUTCDay())); return x.toISOString().slice(0, 10); };
  const storesOf = (q) => q.store ? [q.store] : (scope || ALL);

  function lines(q) {
    const out = [];
    for (const d of days(q.from, q.to)) {
      if (d >= cfg.today) continue;            // today is recorded overnight
      for (const s of storesOf(q)) BUTTONS.forEach((b, bi) => {
        const di = Number(d.slice(8));
        const emp = EMP[s][(bi + di) % 2];
        const apps = 1 + ((bi + di) % 3);
        for (const [l2, l3, share] of b.cats) {
          out.push({ store: s, date: d, b, bi, name: b.name, cls: cls(b.name), l2, l3, emp, apps, level: b.level,
            cents: Math.round(b.base * SF[s] * dayF(d) * share * 100), app: `${s}:${d}:${bi}` });
        }
      });
    }
    return out.filter(r => (!q.category || r.l2 === q.category) && (!q.employee || r.emp === q.employee) && (!q.class || r.cls === q.class));
  }
  const apps = (rows) => { const m = new Map(); for (const r of rows) m.set(r.app, r.apps); let n = 0; for (const v of m.values()) n += v; return n; };
  const cents = (rows, f = () => true) => rows.filter(f).reduce((a, r) => a + r.cents, 0);
  const group = (rows, keyOf) => { const m = new Map(); for (const r of rows) { const k = keyOf(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return m; };
  const split = (rows) => ({ planned: $(cents(rows, r => r.cls === 'planned')), manual: $(cents(rows, r => r.cls === 'manual')), unclassified: $(cents(rows, r => r.cls === 'unclassified')) });

  function discounts(q) {
    const L = lines(q), stores = storesOf(q);
    const gross = (s) => days(q.from, q.to).filter(d => d < cfg.today)
      .reduce((a, d) => a + Math.round(4000 * SF[s] * (1 + (Number(d.slice(8)) % 5) / 10) * (q.category ? (CAT_SHARE[q.category] || 0) : 1) * 100), 0);
    const shape = (rows, g) => {
      const c = cents(rows), n = apps(rows);
      return { discounts: $(c), applications: n, discountedOrders: n - Math.floor(n / 5), itemLevel: $(cents(rows, r => r.level === 'item')),
        orderLevel: $(cents(rows, r => r.level === 'order')), ...split(rows), onBins: 0, grossRetail: $(g),
        pctOfGrossRetail: g > 0 ? Math.round(c / g * 10000) / 100 : null };
    };
    const byStore = stores.map(s => ({ store: s, ...shape(L.filter(r => r.store === s), gross(s)) }));
    const roll = (keyOf, name) => [...group(L, r => keyOf(r.date)).entries()].sort().map(([k, rows]) => ({ [name]: k, days: new Set(rows.map(r => r.date)).size,
      discounts: $(cents(rows)), applications: apps(rows), ...split(rows) }));
    const inRecent = (d) => d >= cfg.recentFrom;
    const recent = days(q.from, q.to).filter(d => d < cfg.today && inRecent(d));
    return {
      ok: true, from: q.from, to: q.to, stores, filters: {},
      totals: shape(L, stores.reduce((a, s) => a + gross(s), 0)),
      byStore,
      byCategory: [...group(L, r => r.l2 + '\u0000' + r.l3).values()].map(rows => ({ l2: rows[0].l2, l3: rows[0].l3, discounts: $(cents(rows)), applications: apps(rows) }))
        .sort((a, b) => b.discounts - a.discounts),
      byButton: [...group(L, r => r.name).values()].map(rows => ({ name: rows[0].name, class: rows[0].cls, discounts: $(cents(rows)), applications: apps(rows),
        stores: new Set(rows.map(r => r.store)).size, levels: [rows[0].level], percent: rows[0].b.percent, amount: rows[0].b.amount }))
        .sort((a, b) => b.discounts - a.discounts),
      byEmployee: [...group(L, r => r.store + '\u0000' + r.emp).values()].map(rows => ({ store: rows[0].store, employee: rows[0].emp,
        discounts: $(cents(rows)), applications: apps(rows), ...split(rows) })).sort((a, b) => b.discounts - a.discounts),
      byDay: roll(d => d, 'date').map(({ days: _, ...r }) => r),
      byWeek: roll(weekEnding, 'weekEnding'),
      byMonth: roll(d => d.slice(0, 7), 'month'),
      largest: [...L].sort((a, b) => b.cents - a.cents || (a.date < b.date ? -1 : 1)).slice(0, Number(q.limit) || 50).map(r => ({
        store: r.store, date: r.date, time: r.date + 'T18:30:00.000Z', orderId: 'O' + r.app, level: r.level, name: r.name, class: r.cls,
        percent: r.b.percent, amount: r.b.amount, discount: $(r.cents), lines: r.level === 'order' ? 3 : 1, lineName: r.b.item, l2: r.l2, l3: r.l3,
        employee: r.emp === '(unknown)' ? null : r.emp, approver: r.name === 'Manager special' ? 'Store Lead' : null })),
      coverage: {
        storeDays: stores.length * days(q.from, q.to).filter(d => d < cfg.today).length,
        complete: 0,
        incomplete: stores.includes('BL4') && recent.length > 2 ? [{ store: 'BL4', date: recent[2], note: 'short $1.20' }] : [],
        missing: stores.includes('BL2') && recent.length > 5 ? [{ store: 'BL2', days: 2, dates: [recent[4], recent[5]] }] : [],
      },
    };
  }

  // Refunds, placed by offset from the range's start so every range shows some.
  const REFUNDS = [
    { k: 0, store: 'BL1', kind: 'payment refund', amount: 45.1, employee: 'Dana Ruiz', reason: 'Changed mind', items: 'Throw pillow $19.99; Lamp $25.11', itemLines: 2, flags: [] },
    { k: 1, store: 'BL1', kind: 'payment refund', amount: 120, employee: 'Dana Ruiz', reason: H, items: 'Air fryer $120.00', itemLines: 1, flags: ['over $100'] },
    { k: 1, store: 'BL2', kind: 'payment refund', amount: 18, employee: 'Sam Lee', reason: null, items: null, itemLines: 0, flags: ['no item recorded'] },
    { k: 2, store: 'BL2', kind: 'payment refund', amount: 130, employee: null, reason: 'Defective', items: null, itemLines: 0, itemsChecked: false,
      saleReceipt: `Blender $125.00; ${H} $5.00`, flags: ['over $100'] },
    { k: 2, store: 'BL4', kind: 'manual refund', amount: 480, employee: 'Jo Park', reason: null, items: 'return fridge $-480.00', itemLines: 1, flags: ['over $100', '3+ manual refunds that week'] },
    { k: 3, store: 'BL4', kind: 'manual refund', amount: 12, employee: 'Jo Park', reason: null, items: 'Manual Transaction $-12.00', itemLines: 0, flags: ['no item recorded', '3+ manual refunds that week'] },
    { k: 3, store: 'BL4', kind: 'manual refund', amount: 9.99, employee: 'Jo Park', reason: H2, items: `${H} $-9.99`, itemLines: 1, flags: ['3+ manual refunds that week'] },
    { k: 4, store: 'BL14', kind: 'manual refund', amount: 4, employee: null, reason: null, items: 'forgot discount $-4.00', itemLines: 1, flags: [] },
    { k: 4, store: 'BL16', kind: 'payment refund', amount: 150, employee: 'Cy Diaz', reason: null, items: null, itemLines: 0, saleInArchive: false, itemsChecked: false, flags: ['over $100'] },
  ];
  function returns(q) {
    const stores = storesOf(q);
    const sunday = (d) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() - x.getUTCDay()); return x.toISOString().slice(0, 10); };
    const rows = REFUNDS.map((r, i) => {
      const date = add(q.from, r.k);
      const manual = r.kind === 'manual refund';
      const tax = Math.round(r.amount * 0.07 / 1.07 * 100) / 100;
      return { id: 'R' + i, store: r.store, date, time: `${date}T${15 + (i % 5)}:0${i}:00.000Z`, kind: r.kind, amount: r.amount, tax, preTax: Math.round((r.amount - tax) * 100) / 100,
        tender: manual ? 'Cash' : 'Credit Card', employee: r.employee, reason: r.reason, orderId: 'ORD' + i, saleDate: manual ? null : add(date, -5),
        items: r.items, itemLines: r.itemLines, saleInArchive: r.saleInArchive !== false, itemsChecked: r.itemsChecked !== false,
        ...(r.saleReceipt ? { saleReceipt: r.saleReceipt } : {}), flags: r.flags };
    }).filter(r => r.date <= q.to && stores.includes(r.store))
      .filter(r => (!q.employee || (r.employee || '(unknown)') === q.employee) && (!q.kind || (q.kind === 'manual') === (r.kind === 'manual refund')));
    const r2 = (n) => Math.round(n * 100) / 100;
    const banked = days(q.from, q.to).filter(d => d <= add(cfg.today, -3));
    const pay = (s) => banked.reduce((a, d) => a + 4000 * SF[s] * dayF(d) * 1.07, 0);
    const sum = (list, payments) => {
      const p = list.filter(r => r.kind === 'payment refund'), m = list.filter(r => r.kind === 'manual refund');
      const tot = p.reduce((a, r) => a + r.amount, 0) + m.reduce((a, r) => a + r.amount, 0);
      return { paymentRefunds: { count: p.length, amount: r2(p.reduce((a, r) => a + r.amount, 0)) }, manualRefunds: { count: m.length, amount: r2(m.reduce((a, r) => a + r.amount, 0)) },
        total: r2(tot), flagged: list.filter(r => r.flags.length).length, payments: r2(payments), ratePct: payments > 0 ? Math.round(tot / payments * 10000) / 100 : null };
    };
    const byEmp = [...group(rows, r => r.store + '\u0000' + (r.employee || '(unknown)')).values()].map(list => {
      const p = list.filter(r => r.kind === 'payment refund'), m = list.filter(r => r.kind === 'manual refund');
      return { store: list[0].store, employee: list[0].employee || '(unknown)', paymentRefunds: p.length, paymentRefundAmount: r2(p.reduce((a, r) => a + r.amount, 0)),
        manualRefunds: m.length, manualRefundAmount: r2(m.reduce((a, r) => a + r.amount, 0)), flagged: list.filter(r => r.flags.length).length };
    });
    const jo = rows.filter(r => r.employee === 'Jo Park' && r.kind === 'manual refund');
    const listed = q.filter === 'flagged' ? rows.filter(r => r.flags.length) : rows;
    return {
      ok: true, from: q.from, to: q.to, stores,
      totals: sum(rows, stores.reduce((a, s) => a + pay(s), 0)),
      byStore: stores.map(s => ({ store: s, ...sum(rows.filter(r => r.store === s), pay(s)) })),
      byEmployee: byEmp,
      repeatEmployees: jo.length >= 3 ? [{ store: 'BL4', employee: 'Jo Park', weekStart: sunday(jo[0].date), weekEnding: add(sunday(jo[0].date), 6), manualRefunds: 3 }] : [],
      rows: [...listed].sort((a, b) => a.time < b.time ? 1 : -1), rowsTotal: listed.length, rowsTruncated: false,
      coverage: { bankedStoreDays: banked.length * stores.length, incompleteStoreDays: 0, bankedThrough: banked.length ? banked[banked.length - 1] : null,
        note: 'Each store-day is banked 3 days after it, so the newest days of a range may not be in yet.' },
    };
  }
  function discountClasses() {
    const from = add(cfg.today, -120), to = cfg.today;
    const L = lines({ from, to });
    return { ok: true, from, to, classes: Object.entries(classes).map(([name, c]) => ({ name, class: c })),
      seen: [...group(L, r => r.name).values()].map(rows => ({ name: rows[0].name, class: rows[0].cls, discounts: $(cents(rows)), applications: apps(rows),
        stores: new Set(rows.map(r => r.store)).size, firstDate: rows[0].date, lastDate: rows[rows.length - 1].date, percent: rows[0].b.percent, amount: rows[0].b.amount }))
        .sort((a, b) => b.discounts - a.discounts) };
  }
  function post(body) {
    for (const c of body.classes || []) { const k = c.name.trim().toLowerCase(); if (c.class === null) delete classes[k]; else classes[k] = c.class; }
    return { ok: true, saved: (body.classes || []).length };
  }
  return { discounts, returns, discountClasses, post, add };
}

function installFetch(cfg) {
  const api = window.__makeMock(cfg);
  const log = window.__drMock = { reqs: [], posts: [], failed: 0 };
  let failNext = !!cfg.failOnce;
  window.fetch = async (u, o = {}) => {
    const s = String(u);
    const J = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
    if (s.includes('auth-me')) return J({ authenticated: true, email: cfg.email, name: cfg.name, role: cfg.role, stores: cfg.stores ?? null,
      associate: false, pages: {}, businesses: [{ id: 'bl', name: 'Bargain Lane' }] });
    const q = s.includes('?') ? Object.fromEntries(new URL(s).searchParams) : {};
    if (['discounts', 'returns', 'discount-classes'].includes(q.action)) {
      log.reqs.push({ ...q, method: (o.method || 'GET').toUpperCase() });
      if (failNext && q.action === 'discounts') { failNext = false; log.failed++; throw new TypeError('Failed to fetch'); }
      if (cfg.deny) return J({ error: 'Forbidden', code: 'NO_STORE_ACCESS' }, 403);
      await new Promise(r => setTimeout(r, 60));    // long enough for the skeleton to paint
      if (q.action === 'discounts') return J(api.discounts(q));
      if (q.action === 'returns') return J(api.returns(q));
      if ((o.method || 'GET').toUpperCase() === 'POST') { const body = JSON.parse(o.body); log.posts.push(body); return J(api.post(body)); }
      return J(api.discountClasses());
    }
    if (s.includes('action=weekly-summary')) return J({ ok: true, from: '2026-09-14', to: '2026-09-20', stores: {}, totals: {} });
    return J({ ok: true });
  };
}

const mockScript = (cfg) => `window.__makeMock = ${makeMock.toString()};\n(${installFetch.toString()})(${JSON.stringify(cfg)});`;

// ── Expectations, from the same fixture ──
const ymdShift = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const lastMonthOf = (t) => { const d = new Date(t.slice(0, 7) + '-01T12:00:00Z'); d.setUTCDate(0); const to = d.toISOString().slice(0, 10); return { from: to.slice(0, 7) + '-01', to }; };
const LM = lastMonthOf(TODAY);
const BASE_CFG = { today: TODAY, recentFrom: LM.from, hostile: HOSTILE, hostile2: HOSTILE2,
  classes: { 'halloween 10%': 'planned', '$5 off': 'manual', '$1 off': 'manual', 'senior tuesday': 'planned' } };
const node = makeMock(BASE_CFG);
const money = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS  ' + m); } else { fail++; console.log('  FAIL  ' + m); } };
const shots = [];
const contrastRows = [];

const b = await chromium.launch({ executablePath: CHROME });

async function open({ theme = 'light', width = 1400, height = 900, mobile = false, cfg = {} } = {}) {
  const ctx = await b.newContext({ timezoneId: TZ, viewport: { width, height }, ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  const page = await ctx.newPage();
  const errs = [], dialogs = [], escaped = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('dialog', d => { dialogs.push(d.type() + ': ' + d.message()); d.dismiss().catch(() => {}); });
  await ctx.route(/retjghub\.com/, r => { escaped.push(r.request().url()); r.abort(); });
  await page.addInitScript(({ theme }) => {
    try {
      localStorage.setItem('darkMode', String(theme !== 'light'));
      localStorage.setItem('darkFlavor', theme === 'light' ? 'dark' : theme);
      sessionStorage.setItem('retjg.activeBusiness', 'bl');
      localStorage.setItem('bioPromptDismissed', '1');
    } catch (e) {}
  }, { theme });
  await page.addInitScript(mockScript({ ...BASE_CFG, email: 'dana.ruiz@example.com', name: 'Dana Ruiz', role: 'admin', ...cfg }));
  await page.goto(URL_, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.getElementById('app')?.classList.contains('hidden'), { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(400);
  return { ctx, page, errs, dialogs, escaped };
}
const reqs = (page) => page.evaluate(() => window.__drMock.reqs);
const settle = async (page) => {
  await page.waitForFunction(() => !document.querySelector('#page-discounts [aria-busy="true"]'), { timeout: 10000 });
  await page.waitForTimeout(250);
};
const text = (page, sel) => page.$eval(sel, n => n.innerText).catch(() => '');
const panelText = async (page, sectionSel, title) => page.evaluate(([sec, t]) => {
  const p = [...document.querySelectorAll(`${sec} .dr-panel`)].find(x => x.querySelector('.dr-barlbl')?.textContent === t);
  return p ? p.innerText : '';
}, [sectionSel, title]);
const firstCells = (page, sectionSel, title) => page.evaluate(([sec, t]) => {
  const p = [...document.querySelectorAll(`${sec} .dr-panel`)].find(x => x.querySelector('.dr-barlbl')?.textContent === t);
  return p ? [...p.querySelectorAll('tbody tr')].map(tr => tr.querySelector('td').innerText.trim()) : null;
}, [sectionSel, title]);

// Contrast from what the browser paints: each element holding text, against the composite of every
// translucent background between it and the first opaque one.
const audit = (page) => page.evaluate(() => {
  const parse = (s) => { const m = String(s).match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const over = (t, u) => ({ r: t.r * t.a + u.r * (1 - t.a), g: t.g * t.a + u.g * (1 - t.a), b: t.b * t.a + u.b * (1 - t.a), a: 1 });
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const bgOf = (n) => {
    const layers = [];
    for (let e = n; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; } }
    let base = layers.length && layers[layers.length - 1].a >= 1 ? layers.pop() : { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base);
    return base;
  };
  const probe = document.createElement('span'); probe.style.color = 'var(--dr-dim)';
  document.getElementById('page-discounts').appendChild(probe);
  const dim = getComputedStyle(probe).color; probe.remove();
  const out = {};
  const root = document.getElementById('page-discounts');
  const els = [...root.querySelectorAll('*')].filter(e => {
    if (['STYLE', 'SCRIPT', 'OPTION', 'svg', 'path', 'line'].includes(e.tagName) || e.closest('.skel,svg')) return false;
    const own = e.tagName === 'SELECT' || e.tagName === 'INPUT' || [...e.childNodes].some(c => c.nodeType === 3 && c.textContent.trim());
    if (!own) return false;
    const r = e.getBoundingClientRect(); if (!r.width || !r.height) return false;
    if (e.closest('[disabled]')) return false;
    for (let x = e; x; x = x.parentElement) if (Number(getComputedStyle(x).opacity) < 1) return false;
    return true;
  });
  for (const e of els) {
    const cs = getComputedStyle(e);
    const fg0 = parse(cs.color), bg = bgOf(e);
    const fg = fg0.a < 1 ? over(fg0, bg) : fg0;
    const kind = e.closest('th') ? 'table headers' : e.closest('.dr-chip,.dr-lvl') ? 'chips' : e.closest('.dr-tile') ? 'tiles'
      : e.closest('.dr-err') || /--dr-bad/.test(e.getAttribute('style') || '') ? 'errors'
      : cs.color === dim ? 'muted text' : 'body text';
    const v = ratio(fg, bg);
    const label = (e.innerText || e.value || '').trim().slice(0, 40);
    if (!out[kind] || v < out[kind].min) out[kind] = { min: v, n: (out[kind]?.n || 0), what: `${e.tagName.toLowerCase()}.${[...e.classList].join('.')} "${label}"` };
    out[kind].n++;
  }
  return out;
});

// ═══ 1. Admin, desktop, each theme ═══════════════════════════════════════════════════════════════
for (const theme of ['light', 'dark', 'oled', 'halloween']) {
  const full = theme === 'light' || theme === 'dark';
  console.log(`\n── admin · ${theme} ──`);
  const { ctx, page, errs, dialogs, escaped } = await open({ theme, cfg: { failOnce: true } });
  const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  ok(isDark === (theme !== 'light'), `rendered in the ${theme} theme`);
  ok(await page.isVisible('#nav-discounts'), 'the sidebar offers Discounts & Returns');
  const order = await page.$$eval('#sidebar nav > .nav-item[data-page]', ns => ns.map(n => n.dataset.page).slice(0, 3));
  ok(JSON.stringify(order) === JSON.stringify(['dashboard', 'weekly-summary', 'discounts']), `…right after the Retail Summary (${order.join(', ')})`);
  await page.click('#nav-discounts');
  await page.waitForSelector('#dr-disc .dr-err', { timeout: 10000 });

  // The first discounts read fails: an error note with Retry, and the rest of the page still works.
  ok(/Couldn't load discounts\./.test(await text(page, '#dr-disc')), 'a failed read says what failed');
  ok(await page.isVisible('#dr-disc .dr-err button'), '…and offers Retry');
  const errAudit = await audit(page);
  ok(errAudit.errors && errAudit.errors.min >= 4.5, `the error note is ≥ 4.5:1 (${errAudit.errors?.min.toFixed(2)})`);
  await page.click('#dr-disc .dr-err button');
  await settle(page);
  ok(await page.$$eval('#dr-disc .dr-tile', n => n.length) === 7, 'Retry recovers: seven discount tiles');
  ok(await page.$$eval('#dr-ret .dr-tile', n => n.length) === 4, 'four refund tiles');

  // Every read carries the default range: the last full month, and the period of equal length before it.
  const R = await reqs(page);
  const cur = R.filter(r => r.action === 'discounts' && r.from === LM.from && r.to === LM.to);
  const days = Math.round((Date.parse(LM.to) - Date.parse(LM.from)) / 864e5) + 1;
  const pTo = ymdShift(LM.from, -1), pFrom = ymdShift(pTo, -(days - 1));
  const prev = R.filter(r => r.action === 'discounts' && r.from === pFrom && r.to === pTo);
  ok(cur.length >= 1 && prev.length >= 1, `discounts read for ${LM.from}..${LM.to} and the ${days} days before (${pFrom}..${pTo})`);
  ok(R.some(r => r.action === 'returns' && r.from === LM.from && r.to === LM.to && r.filter === 'flagged'), 'returns read for the same range, flagged rows');
  ok(R.some(r => r.action === 'discount-classes'), 'the editor loads the discount names (admin)');

  // Tiles: the values and their change are the fixture's, formatted per §8.
  const exp = node.discounts({ from: LM.from, to: LM.to, limit: 25 });
  const expP = node.discounts({ from: pFrom, to: pTo, limit: 1 });
  const tiles = await page.$$eval('#dr-disc .dr-tile', ns => ns.map(n => [n.querySelector('.l').innerText, n.querySelector('.v').innerText, n.querySelector('.d').innerText]));
  ok(tiles[0][0] === 'Discounts' && tiles[0][1] === money(exp.totals.discounts), `Discounts tile ${tiles[0][1]} = ${money(exp.totals.discounts)}`);
  const diff = Math.round((exp.totals.discounts - expP.totals.discounts) * 100) / 100;
  const wantD = `${diff > 0 ? '+' : '−'}${money(Math.abs(diff))} · ${diff > 0 ? '+' : '−'}${Math.abs(diff / expP.totals.discounts * 100).toFixed(1)}%`;
  ok(tiles[0][2] === wantD, `…with its change vs the previous period: "${tiles[0][2]}" (want "${wantD}")`);
  ok(tiles[1][1] === `${exp.totals.pctOfGrossRetail.toFixed(2)}%` && /pts$/.test(tiles[1][2]), `Of gross retail ${tiles[1][1]}, change in points (${tiles[1][2]})`);
  ok(tiles.map(t => t[0]).join('|') === 'Discounts|Of gross retail|Planned|Manual|Unclassified|Uses|Discounted orders', 'the seven tiles, in order');

  if (full) {
    // Tables
    const stores = await firstCells(page, '#dr-disc', 'By store');
    ok(stores && stores.length === 6 && stores[5] === 'All stores', `by store: five stores and a total (${stores && stores.length})`);
    const btn = await page.evaluate(() => document.querySelector('#dr-disc').innerText);
    ok(btn.includes('Halloween 10%') && btn.includes('$5 off') && btn.includes('$1 off') && btn.includes('Manager special'), 'the buttons are listed');
    const cat = await page.evaluate(() => {
      const p = [...document.querySelectorAll('#dr-disc .dr-panel')].find(x => x.querySelector('.dr-barlbl')?.textContent === 'By category');
      return [...p.querySelectorAll('tbody tr')].map(tr => tr.className + ':' + tr.querySelector('.dr-lvl')?.textContent);
    });
    ok(cat.includes('dr-l2:L2') && cat.includes('dr-l3:L3'), `by category draws L2 rows with L3 children (${cat.length} rows)`);
    const l3 = await page.$eval('#dr-disc tr.dr-l3 td.dr-first', n => ({ pad: getComputedStyle(n).paddingLeft, rule: getComputedStyle(n, '::before').borderLeftStyle }));
    ok(l3.pad === '34px' && l3.rule === 'solid', `an L3 indents and draws its rule back up (${l3.pad}, ${l3.rule})`);
    const wk = await panelText(page, '#dr-disc', 'Week by week');
    const mo = await panelText(page, '#dr-disc', 'Month by month');
    ok(/Week ending/.test(wk) && /Change/.test(wk), 'week by week renders');
    const monthRows = await firstCells(page, '#dr-disc', 'Month by month');
    const lmName = new Date(LM.from + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' });
    ok(monthRows && monthRows.includes(lmName) && monthRows.length >= 2, `month by month includes ${lmName} and the month before it (${monthRows && monthRows.join(', ')})`);
    const moChange = await page.evaluate((m) => {
      const p = [...document.querySelectorAll('#dr-disc .dr-panel')].find(x => x.querySelector('.dr-barlbl')?.textContent === 'Month by month');
      const tr = [...p.querySelectorAll('tbody tr')].find(t => t.querySelector('td').innerText.trim() === m);
      return tr ? tr.children[3].innerText : null;
    }, lmName);
    ok(moChange && /^[+−]\$/.test(moChange), `…and compares it with that month (${moChange})`);
    ok((await panelText(page, '#dr-disc', 'Largest single discounts')).includes('Whole order'), 'largest single discounts renders, order-level as "Whole order"');
    const cov = await text(page, '#dr-disc .dr-status');
    ok(/recorded for \d+ store-days; 1 of them incomplete \(Dupont .*\); 2 store-days with sales have no record yet \(South Bend 2\)\./.test(cov), `one coverage sentence: "${cov}"`);

    // Sort by uses.
    await page.click('#dr-disc button[aria-pressed]:not([aria-pressed="true"])');
    await page.waitForTimeout(150);
    const byUses = [...exp.byButton].sort((a, b) => (b.applications - a.applications) || (b.discounts - a.discounts))[0].name;
    const top = (await firstCells(page, '#dr-disc', 'By discount button'))[0];
    ok(top === byUses, `sorting by uses puts ${byUses} first (${top})`);

    // Returns
    const rt = await text(page, '#dr-ret');
    ok(/Refunds are banked 3 days after each day/.test(rt), 'the 3-day banking lag is stated');
    const flagged = await firstCells(page, '#dr-ret', 'Flagged refunds');
    ok(flagged && flagged.length === 7, `flagged refunds: the seven with a flag (${flagged && flagged.length})`);
    const ft = await panelText(page, '#dr-ret', 'Flagged refunds');
    ok(ft.includes('No item recorded') && ft.includes('Over $100') && ft.includes('3+ manual refunds that week'), 'all three flag kinds show as chips');
    ok(/Ticket:\s*return fridge \$-480\.00/.test(ft), "a manual refund's ticket line is its note");
    ok(/Not checked: the sale's receipt was archived before this return\. The sale's receipt: Blender \$125\.00/.test(ft), 'itemsChecked:false says "not checked" and lists the sale\'s receipt');
    ok(/older than the receipt archive/.test(ft), 'a sale older than the archive says so');
    ok((await panelText(page, '#dr-ret', 'Repeat manual refunds')).includes('Jo Park'), 'repeat manual refunds lists Jo Park');

    // 🛑 Hostile strings are text, everywhere they land.
    const xss = await page.evaluate(() => ({
      imgs: document.querySelectorAll('#page-discounts img').length,
      onattr: [...document.querySelectorAll('#page-discounts *')].filter(n => [...n.attributes].some(a => /^on/i.test(a.name) && !['onclick', 'onchange'].includes(a.name.toLowerCase()))).length,
      flag: window.__xss || 0,
      count: (document.getElementById('page-discounts').innerText.match(/<img src=x onerror=alert\(1\)>/g) || []).length,
      quoted: document.getElementById('page-discounts').innerText.includes('"><img src=x onerror="window.__xss'),
      catOpt: [...document.querySelectorAll('#dr-f-cat option')].some(o => o.value === `Kids' & "Baby"`),
      empOpt: [...document.querySelectorAll('#dr-f-emp option')].some(o => o.value === '<img src=x onerror=alert(1)>'),
    }));
    ok(xss.imgs === 0 && xss.onattr === 0 && xss.flag === 0, `the hostile strings made no element, no handler and ran nothing (img ${xss.imgs}, on* ${xss.onattr}, ran ${xss.flag})`);
    ok(xss.count >= 6 && xss.quoted, `…and read as literal text (${xss.count} copies of <img src=x onerror=alert(1)>)`);
    ok(xss.catOpt && xss.empOpt, 'quotes and markup survive whole into the filter options');

    // ── The second render: change the store, then the dates. ──
    const before = (await reqs(page)).length;
    await page.selectOption('#dr-f-store', 'BL1');
    await settle(page);
    const R2 = (await reqs(page)).slice(before);
    ok(R2.filter(r => r.store === 'BL1').length === 3 && R2.length === 3, `a store change re-reads all three with store=BL1 (${R2.map(r => r.action + ':' + (r.store || '-')).join(', ')})`);
    const bl1 = node.discounts({ from: LM.from, to: LM.to, store: 'BL1', limit: 25 });
    const s2 = await firstCells(page, '#dr-disc', 'By store');
    const t2 = await page.$eval('#dr-disc .dr-tile .v', n => n.innerText);
    ok(s2 && s2.length === 1 && /^Coliseum/.test(s2[0]) && t2 === money(bl1.totals.discounts), `…and re-renders: by store is Coliseum alone, Discounts ${t2} = ${money(bl1.totals.discounts)}`);
    ok((await firstCells(page, '#dr-ret', 'By store')).join() .startsWith('Coliseum'), '…refunds by store too');
    ok(await page.$eval('#dr-period', n => n.innerText.length > 20), 'the period line survives the re-render (trap 7)');
    await page.selectOption('#dr-f-range', 'lastWeek');
    await settle(page);
    const lw = (await reqs(page)).filter(r => r.action === 'discounts').slice(-2);
    ok(lw[0].store === 'BL1' && Math.round((Date.parse(lw[0].to) - Date.parse(lw[0].from)) / 864e5) === 6, `a date change keeps the store and reads a 7-day week (${lw[0].from}..${lw[0].to})`);
    ok((await text(page, '#dr-period')).includes('the 7 days before'), 'the period line names the new comparison');
    await page.selectOption('#dr-f-range', 'custom');
    ok(await page.isVisible('#dr-f-from') && await page.isVisible('#dr-f-to'), 'Custom dates opens two date fields');
    await page.fill('#dr-f-from', '2026-01-01'); await page.fill('#dr-f-to', '2026-06-30');
    await page.click('#dr-f-apply');
    await page.waitForTimeout(150);
    ok(/at most 92 days/.test(await text(page, '#dr-period')), 'a range over 92 days is refused before any read');
    await page.selectOption('#dr-f-range', 'lastMonth');
    await page.selectOption('#dr-f-store', '');
    await settle(page);

    // Empty state: an employee with refunds and no discounts.
    await page.selectOption('#dr-f-emp', 'Jo Park');
    await settle(page);
    ok(/No discounts recorded for this range with these filters\./.test(await text(page, '#dr-disc')), 'empty state: "No discounts recorded for this range with these filters."');
    ok((await firstCells(page, '#dr-ret', 'Flagged refunds')).length === 3, "…while Jo Park's three flagged refunds still show");
    await page.selectOption('#dr-f-emp', '');
    await settle(page);

    // ── The editor: three states, Discard asks, Save sends only what changed. ──
    const setRow = async (name, v) => page.evaluate(([name, v]) => {
      const tr = [...document.querySelectorAll('#dr-edit-body tbody tr')].find(t => t.querySelector('td').innerText.trim() === name);
      const sel = tr.querySelector('select'); sel.value = v; sel.dispatchEvent(new Event('change', { bubbles: true }));
      return sel.className;
    }, [name, v]);
    const states0 = await page.$$eval('#dr-edit-body select', ns => ns.map(n => n.className));
    ok(states0.some(c => /\binherit\b/.test(c)) && states0.some(c => /\bown\b/.test(c)), 'unclassified names look inherited, set ones look set');
    ok(await setRow('Manager special', 'planned') === 'dr-cls dirty', 'a change turns its cell amber');
    await setRow(HOSTILE, 'manual');
    await setRow('$1 off', 'planned');
    ok(await setRow('$1 off', 'manual') === 'dr-cls own', 'changing a name back clears its draft');
    ok(await text(page, '#dr-edit-save') === 'Save 2 changes', `Save counts the changes (${await text(page, '#dr-edit-save')})`);
    const edAudit = await audit(page);

    await page.click('#dr-edit-discard');
    const DLG = 'body > div[role="dialog"][aria-modal="true"]:not(#hourly-overlay)';
    await page.waitForSelector(DLG, { timeout: 3000 });
    ok(/Discard 2 unsaved changes/.test(await text(page, DLG)), 'Discard asks first, in the app\'s own dialog');
    await page.click(`${DLG} button:has-text("Keep editing")`);
    await page.waitForTimeout(100);
    ok(await text(page, '#dr-edit-save') === 'Save 2 changes', 'Keep editing keeps the draft');

    const nDisc = (await reqs(page)).filter(r => r.action === 'discounts').length;
    await page.click('#dr-edit-save');
    await page.waitForFunction(() => window.__drMock.posts.length === 1, { timeout: 5000 });
    await settle(page);
    await page.waitForTimeout(300);
    const posts = await page.evaluate(() => window.__drMock.posts);
    const sent = (posts[0].classes || []).map(c => `${c.name}=${c.class}`).sort();
    const want = [`Manager special=planned`, `${HOSTILE}=manual`].sort();
    ok(posts.length === 1 && JSON.stringify(sent) === JSON.stringify(want), `Save POSTs exactly the two changed names (${JSON.stringify(sent)})`);
    ok((await reqs(page)).filter(r => r.action === 'discounts').length > nDisc, 'saving refreshes the page data');
    const after = await page.evaluate(() => {
      const tr = [...document.querySelectorAll('#dr-edit-body tbody tr')].find(t => t.querySelector('td').innerText.trim() === 'Manager special');
      return tr && tr.querySelector('select').className;
    });
    ok(after === 'dr-cls own', `…and the saved name now reads as set (${after})`);
    ok(/Manager special\s+Planned/.test(await panelText(page, '#dr-disc', 'By discount button')), "…and the button table shows it planned");

    // Contrast, measured on the page as it now stands plus the editor while it had a draft.
    const a = await audit(page);
    for (const [k, v] of Object.entries(edAudit)) if (!a[k] || v.min < a[k].min) a[k] = v;
    if (errAudit.errors) a.errors = errAudit.errors;
    for (const k of ['body text', 'muted text', 'chips', 'table headers', 'tiles', 'errors']) {
      const v = a[k];
      ok(v && v.min >= 4.5, `${theme}: ${k} ≥ 4.5:1 — min ${v ? v.min.toFixed(2) : '?'} over ${v ? v.n : 0} (${v ? v.what : 'none found'})`);
      contrastRows.push([theme, k, v ? v.min : null, v ? v.what : '']);
    }
    const shot = path.join(SHOTS, `discounts-desktop-${theme}.png`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: shot, fullPage: true });
    shots.push(shot);
  } else {
    const a = await audit(page);
    for (const k of ['body text', 'muted text', 'chips', 'table headers', 'tiles']) {
      const v = a[k];
      ok(v && v.min >= 4.5, `${theme}: ${k} ≥ 4.5:1 — min ${v ? v.min.toFixed(2) : '?'} (${v ? v.what : 'none found'})`);
      contrastRows.push([theme, k, v ? v.min : null, v ? v.what : '']);
    }
  }
  ok(errs.length === 0, `no page errors${errs.length ? ': ' + errs.join(' | ') : ''}`);
  ok(dialogs.length === 0, `no native dialog ever opened${dialogs.length ? ': ' + dialogs.join(' | ') : ''}`);
  ok(escaped.length === 0, `no request left the page for a real host${escaped.length ? ': ' + escaped.join(' ') : ''}`);
  await ctx.close();
}

// ═══ 2. Phone, 375px, both themes: reached from the Menu, nothing scrolls the page sideways ═══════
for (const theme of ['light', 'dark']) {
  console.log(`\n── 375px · ${theme} ──`);
  const { ctx, page, errs, escaped } = await open({ theme, width: 375, height: 812, mobile: true });
  await page.click('#bn-menu');
  await page.waitForTimeout(200);
  ok(await page.isVisible('#menu-list .menu-row[data-page="discounts"]'), 'the phone Menu lists Discounts & Returns');
  await page.click('#menu-list .menu-row[data-page="discounts"]');
  await settle(page);
  ok(await page.isVisible('#page-discounts') && await page.$$eval('#dr-disc .dr-tile', n => n.length) === 7, 'the Menu row opens the page');
  const geo = await page.evaluate(() => {
    const vw = window.innerWidth;
    const over = [...document.querySelectorAll('#page-discounts *')].filter(n => {
      if (n.closest('.dr-scroll') && !n.classList.contains('dr-scroll')) return false;
      if (n.closest('svg') || ['STYLE', 'OPTION'].includes(n.tagName)) return false;
      const r = n.getBoundingClientRect();
      return r.width > 0 && (r.right > vw + 0.5 || r.left < -0.5);
    }).map(n => `${n.tagName.toLowerCase()}.${[...n.classList].join('.')}`);
    const ms = document.getElementById('main-scroll');
    return { vw, doc: document.documentElement.scrollWidth, ms: ms.scrollWidth - ms.clientWidth, over: over.slice(0, 5), n: over.length };
  });
  ok(geo.doc <= geo.vw && geo.ms <= 0, `no horizontal page scroll (document ${geo.doc} / viewport ${geo.vw}, scroller overflow ${geo.ms})`);
  ok(geo.n === 0, `nothing outside a table scroller pokes past the screen edge${geo.n ? ': ' + geo.over.join(', ') : ''}`);
  // Scroll the by-store table sideways: the first column stays, opaque.
  const sticky = await page.evaluate(async () => {
    const p = [...document.querySelectorAll('#dr-disc .dr-panel')].find(x => x.querySelector('.dr-barlbl')?.textContent === 'By store');
    const sc = p.querySelector('.dr-scroll'), td = p.querySelector('tbody td.dr-first');
    const wide = sc.scrollWidth > sc.clientWidth;
    const x0 = td.getBoundingClientRect().left;
    sc.scrollLeft = 200;
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const x1 = td.getBoundingClientRect().left, s0 = sc.getBoundingClientRect().left;
    const bg = getComputedStyle(td).backgroundColor;
    sc.scrollLeft = 0;
    return { wide, x0, x1, s0, bg, moved: sc.scrollWidth - sc.clientWidth };
  });
  ok(sticky.wide, `the by-store table is wider than the phone and scrolls inside its panel (${sticky.moved}px)`);
  ok(Math.abs(sticky.x1 - sticky.s0) < 1, `its first column stays pinned when scrolled (${sticky.x0.toFixed(1)} → ${sticky.x1.toFixed(1)})`);
  ok(/^rgb\(/.test(sticky.bg), `…on an opaque background of its own (${sticky.bg})`);
  const shot = path.join(SHOTS, `discounts-375-${theme}.png`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: shot, fullPage: true });
  shots.push(shot);
  ok(errs.length === 0, `no page errors${errs.length ? ': ' + errs.join(' | ') : ''}`);
  ok(escaped.length === 0, 'no request left the page for a real host');
  await ctx.close();
}

// ═══ 3. A manager: their stores, no editor ═════════════════════════════════════════════════════════
{
  console.log('\n── manager (BL1, BL2) ──');
  const { ctx, page, errs } = await open({ cfg: { role: 'manager', stores: ['BL1', 'BL2'], scope: ['BL1', 'BL2'], email: 'm@example.com', name: 'Mo Manager' } });
  ok(await page.isVisible('#nav-discounts'), 'a manager has the page in the sidebar');
  await page.click('#nav-discounts');
  await settle(page);
  const opts = await page.$$eval('#dr-f-store option', ns => ns.map(o => o.value + ':' + o.textContent));
  ok(JSON.stringify(opts) === JSON.stringify([':All my stores', 'BL1:Coliseum', 'BL2:South Bend']), `the store filter offers their stores only (${opts.join(', ')})`);
  ok(!(await page.isVisible('#dr-edit-wrap')) && !(await page.isVisible('#dr-edit-save')), 'no planned/manual editor');
  ok(!(await reqs(page)).some(r => r.action === 'discount-classes'), 'and the discount names are never read');
  const st = await firstCells(page, '#dr-disc', 'By store');
  ok(st && st.length === 3 && /^Coliseum/.test(st[0]) && /^South Bend/.test(st[1]), `the tables show what the worker scoped (${st && st.join(' | ')})`);
  ok(/an admin sets it/.test(await panelText(page, '#dr-disc', 'By discount button')), 'the legend says who classifies, without offering a control');
  ok(errs.length === 0, `no page errors${errs.length ? ': ' + errs.join(' | ') : ''}`);
  await ctx.close();
}

// ═══ 4. Staff never reach it; a 403 says so ═════════════════════════════════════════════════════════
{
  console.log('\n── staff ──');
  const { ctx, page, errs } = await open({ cfg: { role: 'staff', email: 's@example.com', name: 'Sy Staff' } });
  ok(!(await page.isVisible('#nav-discounts')), 'staff have no sidebar item');
  await page.evaluate(() => navigateToPage('discounts'));
  await page.waitForTimeout(200);
  ok(!(await page.isVisible('#page-discounts')), 'and the router refuses the page');
  ok(!(await reqs(page)).length, 'nothing was read');
  ok(errs.length === 0, 'no page errors');
  await ctx.close();
}
{
  console.log('\n── a 403 from the worker ──');
  const { ctx, page, errs } = await open({ cfg: { deny: true } });
  await page.click('#nav-discounts');
  await page.waitForSelector('#dr-disc .dr-err');
  const t = await text(page, '#dr-disc');
  ok(/Couldn't load discounts\. Your account cannot see this/.test(t), `a 403 reads as access, not an outage ("${t.slice(0, 80)}…")`);
  ok(!(await page.$('#dr-disc .dr-err button')), 'and offers no Retry, which cannot help');
  ok(/Couldn't load refunds\./.test(await text(page, '#dr-ret')), 'refunds say the same');
  ok(errs.length === 0, 'no page errors');
  await ctx.close();
}

await b.close();
srv.close();
console.log('\ncontrast minimums (computed):');
for (const [t, k, v, w] of contrastRows) console.log(`  ${t.padEnd(9)} ${k.padEnd(14)} ${v == null ? '—' : v.toFixed(2)}  ${w}`);
console.log(`\nscreenshots:\n  ${shots.join('\n  ')}`);
console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `\nall ${pass} checks passed`);
process.exit(fail ? 1 : 0);
