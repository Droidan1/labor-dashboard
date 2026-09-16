// Holland's budget on the All Stores card, driven in a REAL BROWSER.
//
// 🛑 NOT PART OF `scripts/test.sh` — the runner globs `test-*`, and this needs
// playwright-core and a Chromium, neither of which is a repo dependency. Run by hand:
//
//   npm install --no-save playwright-core
//   bash scripts/build.sh && node scripts/browser-holland-budget.mjs
//
// 🔑 WHY IT EXISTS. scripts/test-closed-stores.mjs can prove the rosters are right and
// that each sum CALLS the fold. It cannot prove the rendered dollar figure is the
// six-store one — and a rendered dollar figure is the entire bug. On 2026-09-15 Holland
// left the frontend STORES roster and its budget silently left every chain total with
// it, while every assertion in the repo stayed green.
//
// 🔑 THE BUDGETS ARE A BITMASK, NOT ROUND NUMBERS. Each store's daily budget is its own
// power of two times $1,000 — Holland is 32. So a wrong total does not just fail, it
// NAMES the missing store: short by $32k/day means Holland, by $16k means Indy East.
// Round numbers would have said only "wrong".
let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch (e) {
  console.error('\nThis check needs playwright-core, which is not a dependency of this repo.\n\n'
    + '  npm install --no-save playwright-core\n'
    + '  bash scripts/build.sh\n'
    + '  node scripts/browser-holland-budget.mjs\n\n'
    + 'A Chromium is also needed: this container ships one at /opt/pw-browsers/chromium.\n');
  process.exit(2);
}
const CHROME = process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium';

import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'dist');
if (!fs.existsSync(path.join(root, 'index.html'))) {
  console.error('\ndist/ is not built. Run: bash scripts/build.sh\n'); process.exit(2);
}
const types = { '.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json','.png':'image/png','.svg':'image/svg+xml' };
const srv = http.createServer((q, s) => {
  const f = path.join(root, q.url === '/' ? 'index.html' : q.url.split('?')[0]);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end('no'); }
  s.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(s);
});
await new Promise(r => srv.listen(8097, r));

// ── The chain, as a bitmask. BL8 is the bit under test. ─────────────────────
const TZ = 'America/New_York';
const WEIGHT = { BL1: 1, BL2: 2, BL4: 4, BL14: 8, BL16: 16, BL8: 32 };
const OPEN   = ['BL1', 'BL2', 'BL4', 'BL14', 'BL16'];   // drawn AND counted
const CLOSED = ['BL8'];                                  // counted only
const UNIT = 1000;

const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
const TODAY = ymd(new Date());
// Walk UTC noon so a day step can never land on a DST seam.
const noon = (s) => new Date(s + 'T12:00:00Z');
const shift = (s, n) => ymd(new Date(noon(s).getTime() + n * 86400000));

// 90 days back, 30 forward — enough that the whole calendar month is covered whatever
// today is, so the Monthly card has a full month to sum.
const DATES = [];
for (let i = -90; i <= 30; i++) DATES.push(shift(TODAY, i));

// Week numbers roll at each Sunday, which is what the retail week does.
const WEEK = {};
{
  let w = 100;
  for (const d of DATES) {
    if (noon(d).getUTCDay() === 0 && d !== DATES[0]) w++;
    WEEK[d] = w;
  }
}
const DATA = {};                       // store → { date → row }
for (const st of [...OPEN, ...CLOSED]) {
  DATA[st] = {};
  for (const d of DATES) {
    const budget = WEIGHT[st] * UNIT;
    // Holland is closed: a real budget against a real $0, exactly as prod holds it.
    const total = st === 'BL8' ? 0 : WEIGHT[st] * 500;
    DATA[st][d] = { week: WEEK[d], budget, total, retail: total, bin: 0, auction: 0, laborPct: 10 };
  }
}

const CUR_WEEK = WEEK[TODAY];
const MONTH = TODAY.slice(0, 7);
const sum = (stores, keep) => stores.reduce((n, st) =>
  n + DATES.filter(keep).reduce((m, d) => m + DATA[st][d].budget, 0), 0);

const ALL = [...OPEN, ...CLOSED];
const expect = {
  today:  { all: sum(ALL, d => d === TODAY),                 open: sum(OPEN, d => d === TODAY) },
  week:   { all: sum(ALL, d => WEEK[d] === CUR_WEEK),        open: sum(OPEN, d => WEEK[d] === CUR_WEEK) },
  month:  { all: sum(ALL, d => d.slice(0, 7) === MONTH),     open: sum(OPEN, d => d.slice(0, 7) === MONTH) },
};
const money = (n) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL ' + m); } };

const b = await chromium.launch({ executablePath: CHROME });
// 🛑 Browser-local === ET. The page derives "today" from an ET Intl format but reads
// getTodayRow off browser-local toDateString(); a UTC browser makes those disagree after
// 8 PM ET and the test would chase a phantom off-by-one that prod never has.
const ctx = await b.newContext({ timezoneId: TZ, viewport: { width: 1400, height: 1200 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(e.message));

await page.addInitScript(({ DATA, OPEN }) => {
  try { localStorage.setItem('darkMode', 'false'); } catch (e) {}
  window.__hist = [];   // stores whose D1 history was read
  window.__live = [];   // stores whose Clover till was polled
  const real = window.fetch;
  window.fetch = async (u, o) => {
    const s = String(u);
    const J = (x) => new Response(JSON.stringify(x), { status: 200, headers: { 'content-type': 'application/json' } });
    if (s.includes('auth-me')) {
      return J({ authenticated: true, email: 'a@b.com', name: 'Admin', role: 'admin',
                 stores: null, pages: {}, businesses: ['bl'] });
    }
    if (s.includes('history_d1=true')) {
      const st = new URL(s).searchParams.get('store');
      window.__hist.push(st);
      return J(DATA[st] || {});
    }
    const q = s.includes('?') ? new URL(s).searchParams : null;
    if (q && q.get('since') && q.get('store')) {
      const st = q.get('store').toUpperCase();
      window.__live.push(st);
      if (!OPEN.includes(st)) return J({});           // a closed till returns nothing
      const row = DATA[st][Object.keys(DATA[st])[0]];
      return J({ aggregate: { total: row.total, retail: row.total, bin: 0, avgCart: 20,
                              avgItems: 2, orderCount: 5, avgTxnSec: 60, avgASP: 10 } });
    }
    return real(u, o);
  };
}, { DATA, OPEN });

await page.goto('http://localhost:8097/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  const e = document.getElementById('c-budget');
  return e && e.textContent && e.textContent !== '—';
}, { timeout: 30000 });
await page.waitForTimeout(1200);   // let the live fan-out settle into a re-render

const txt = (id) => page.$eval('#' + id, e => e.textContent.trim());
const got = { today: await txt('c-today-budget'), week: await txt('c-budget'), month: await txt('c-month-budget') };
const hist = [...new Set(await page.evaluate(() => window.__hist))].sort();
const live = [...new Set(await page.evaluate(() => window.__live))].sort();
const cards = await page.$$eval('#store-cards > *', n => n.length);
const reporting = await txt('h-reporting');

console.log('\n── Holland\'s budget on the chain totals ──');
console.log(`   today ${got.today}   week ${got.week}   month ${got.month}`);
console.log(`   history read: ${hist.join(',')}`);
console.log(`   clover polled: ${live.join(',')}`);

for (const k of ['today', 'week', 'month']) {
  ok(got[k] === money(expect[k].all),
    `${k} budget is the SIX-store figure — got ${got[k]}, want ${money(expect[k].all)}`);
  ok(got[k] !== money(expect[k].open),
    `${k} budget is NOT the five-store figure (${money(expect[k].open)}) — that is the bug this fixes`);
}

// The request log is the load-bearing evidence, exactly as it was for the change that
// broke this: a stale card can hide, a request cannot.
ok(hist.includes('BL8'), '🔑 Holland\'s D1 history IS read — without the rows there is no budget to sum');
ok(hist.length === 6, `all six counted stores are read (${hist.join(',')})`);
ok(!live.includes('BL8'), '🔑 Holland\'s Clover till is NOT polled — the expensive half stays off');
ok(live.length === 5, `exactly the five trading stores are polled (${live.join(',')})`);

// And none of that put Holland back on the dashboard.
ok(cards === 5, `five store cards, no Holland card (${cards})`);
ok(/^5 of 5 reporting$/.test(reporting), `reporting reads "5 of 5", not "6 of 5" (got "${reporting}")`);

// ── The All Stores page: a chain total ALWAYS has its breakdown under it. ───
// This page's hero is a chain figure, so it carries Holland — which means the rows
// beneath it must too, or the report visibly fails to add up to its own headline.
await page.evaluate(() => window.showAllStoresDetail());
await page.waitForTimeout(400);
const asHero = await page.$eval('#as-metrics', e => e.textContent.replace(/\s+/g, ' '));
const ROWS = '#as-content-stores > div[onclick]';   // header and total footer are not rows
const asRows = await page.$$eval(ROWS, ns => ns.map(n => n.textContent.replace(/\s+/g, ' ')));
const asBudgets = await page.$$eval(ROWS,
  ns => ns.map(n => (n.textContent.match(/vs \$([\d,]+\.\d\d)/) || [])[1] || null));
const asFooter = await page.$eval('#as-content-stores', e => {
  const k = [...e.children]; return k[k.length - 1].textContent.replace(/\s+/g, ' ');
});

ok(asHero.includes(money(expect.week.all)),
  `the All Stores hero budget is the six-store week — want ${money(expect.week.all)}`);
ok(asRows.length === 6, `six rows: five trading plus Holland (${asRows.length})`);
const holland = asRows.find(r => /Holland/.test(r));
ok(!!holland, 'Holland has a row');
ok(!!holland && /CLOSED|Closed/i.test(holland), 'and it is badged Closed, not passed off as trading');
const rowSum = asBudgets.filter(Boolean).reduce((n, v) => n + Number(v.replace(/,/g, '')), 0);
ok(Math.abs(rowSum - expect.week.all) < 0.01,
  `🔑 the rows ADD UP to the hero — rows ${money(rowSum)} vs hero ${money(expect.week.all)}`);
ok(/5 \/ 5/.test(asHero), 'and Stores Reporting still reads 5 / 5 — a closed store reports nothing');
ok(/All Stores Total/.test(asFooter) && asFooter.includes(money(expect.week.all)),
  `the list's own total footer carries Holland too (${asFooter})`);

ok(errs.length === 0, 'no page errors: ' + errs.join(' | '));

// ── The Closed badge, in BOTH themes, measured not eyeballed. ───────────────
// The class string is byte-identical to the "Closed · historical" pill the Retail
// Summary already ships, so no new token is introduced — but it now sits on a
// different surface (a list row, not a tab strip), so the contrast is re-measured
// against the background it actually lands on rather than assumed from the source.
// 🛑 The theme is a `.dark` CLASS from localStorage, not prefers-color-scheme.
for (const scheme of ['dark', 'light']) {
  const c2 = await b.newContext({ timezoneId: TZ, viewport: { width: 1400, height: 1200 },
                                  colorScheme: scheme });
  const p2 = await c2.newPage();
  const e2 = [];
  p2.on('pageerror', e => e2.push(e.message));
  await p2.addInitScript((sc) => { try { localStorage.setItem('darkMode', String(sc === 'dark')); } catch (e) {} }, scheme);
  await p2.addInitScript(({ DATA, OPEN }) => {
    const real = window.fetch;
    window.fetch = async (u, o) => {
      const s = String(u);
      const J = (x) => new Response(JSON.stringify(x), { status: 200, headers: { 'content-type': 'application/json' } });
      if (s.includes('auth-me')) return J({ authenticated: true, email: 'a@b.com', name: 'Admin', role: 'admin', stores: null, pages: {}, businesses: ['bl'] });
      if (s.includes('history_d1=true')) return J(DATA[new URL(s).searchParams.get('store')] || {});
      const q = s.includes('?') ? new URL(s).searchParams : null;
      if (q && q.get('since') && q.get('store')) {
        const st = q.get('store').toUpperCase();
        if (!OPEN.includes(st)) return J({});
        const row = DATA[st][Object.keys(DATA[st])[0]];
        return J({ aggregate: { total: row.total, retail: row.total, bin: 0, avgCart: 20, avgItems: 2, orderCount: 5, avgTxnSec: 60, avgASP: 10 } });
      }
      return real(u, o);
    };
  }, { DATA, OPEN });
  await p2.goto('http://localhost:8097/', { waitUntil: 'domcontentloaded' });
  await p2.waitForFunction(() => {
    const e = document.getElementById('c-budget');
    return e && e.textContent && e.textContent !== '—';
  }, { timeout: 30000 });
  await p2.waitForTimeout(800);
  await p2.evaluate(() => window.showAllStoresDetail());
  await p2.waitForTimeout(400);

  const m = await p2.evaluate(() => {
    const isDark = document.documentElement.classList.contains('dark')
                || document.body.classList.contains('dark');
    const row = [...document.querySelectorAll('#as-content-stores > div[onclick]')]
      .find(n => /Holland/.test(n.textContent));
    if (!row) return { isDark, found: false };
    const badge = [...row.querySelectorAll('span')].find(s => /^Closed$/i.test(s.textContent.trim()));
    if (!badge) return { isDark, found: false };
    const opaque = (el) => {
      for (let n = el; n; n = n.parentElement) {
        const bg = getComputedStyle(n).backgroundColor;
        const p = bg.match(/[\d.]+/g);
        if (p && (p.length < 4 || Number(p[3]) === 1)) return bg;
      }
      return 'rgb(255,255,255)';
    };
    const r = badge.getBoundingClientRect();
    return { isDark, found: true, visible: r.width > 0 && r.height > 0,
             fg: getComputedStyle(badge).color, bg: opaque(badge) };
  });

  const rgb = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  const lum = (c) => { const a = rgb(c).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
                       return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]; };
  const ratio = m.found ? ((Math.max(lum(m.fg), lum(m.bg)) + 0.05) / (Math.min(lum(m.fg), lum(m.bg)) + 0.05)) : 0;

  ok(m.found, `${scheme}: the Closed badge renders on Holland's row`);
  ok(m.isDark === (scheme === 'dark'), `${scheme}: the theme actually applied (dark class ${m.isDark})`);
  ok(!!m.visible, `${scheme}: the badge has a box, not zero-size`);
  ok(ratio >= 4.5, `${scheme}: badge contrast ${ratio.toFixed(2)}:1 >= 4.5:1 (${m.fg} on ${m.bg})`);
  ok(e2.length === 0, `${scheme}: no page errors: ` + e2.join(' | '));
  console.log(`   ${scheme}: contrast ${ratio.toFixed(2)}:1  ${m.fg} on ${m.bg}`);
  await c2.close();
}

await b.close(); srv.close();
console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
