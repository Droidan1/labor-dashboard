// The dashboard across the fiscal-year boundary, driven in a REAL BROWSER.
//
// 🛑 NOT PART OF `scripts/test.sh` — the runner globs `test-*`, and this needs
// playwright-core and a Chromium, neither of which is a repo dependency. Run by hand:
//
//   npm install --no-save playwright-core
//   bash scripts/build.sh && node scripts/browser-year-safe-weeks.mjs
//   (on a Mac: PLAYWRIGHT_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
//
// 🔑 WHY IT EXISTS. The budget Sheet numbers fiscal weeks 1..52 and starts again at 1 every
// year: FY2026 week 1 is 2025-12-28..2026-01-03, FY2027 week 1 starts Sun 2026-12-27. The page
// loads history from 2025-01-01, so both years' week 1 are in memory at once, and it grouped
// rows by the bare number (`r.week === selectedWeek`). On 2026-12-27 the weekly card would
// have summed last year's week 1 into this one. Separately, the history request asked for
// `to=2026-12-31`, hard-coded, so from 2027-01-01 no current day was loaded at all.
//
// 🔑 THE MOCK HONOURS from/to, exactly as the worker's ?history_d1 does. A mock that hands
// back every row whatever was asked would hide the cut-off completely.
//
// 🔑 THE BUDGETS NAME THE YEAR. FY2026 days carry WEIGHT x $1,000, FY2027 days WEIGHT x $1.
// So a merged week reads ~$441,441 instead of $441 — it does not just fail, it says which
// year leaked in.
let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch (e) {
  console.error('\nThis check needs playwright-core, which is not a dependency of this repo.\n\n'
    + '  npm install --no-save playwright-core\n'
    + '  bash scripts/build.sh\n'
    + '  node scripts/browser-year-safe-weeks.mjs\n');
  process.exit(2);
}
const CHROME = process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium';

import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
// DIST_DIR runs it against another build, e.g. main's, to watch it fail there.
const root = process.env.DIST_DIR || path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'dist');
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
await new Promise(r => srv.listen(8098, r));

const TZ = 'America/New_York';
const WEIGHT = { BL1: 1, BL2: 2, BL4: 4, BL14: 8, BL16: 16, BL8: 32 };
const OPEN = ['BL1', 'BL2', 'BL4', 'BL14', 'BL16'];
const ALL = [...OPEN, 'BL8'];
const CHAIN = ALL.reduce((n, s) => n + WEIGHT[s], 0);   // 63

const noon = (s) => new Date(s + 'T12:00:00Z');
const ymd = (d) => d.toISOString().slice(0, 10);
const shift = (s, n) => ymd(new Date(noon(s).getTime() + n * 86400000));
const daysBetween = (a, b) => Math.round((noon(b) - noon(a)) / 86400000);

// The real fiscal calendar: FY2026 starts Sun 2025-12-28 (52 weeks), FY2027 Sun 2026-12-27.
const FY26 = '2025-12-28', FY27 = '2026-12-27';
const fiscal = (d) => d >= FY27
  ? { fy: 2027, week: Math.floor(daysBetween(FY27, d) / 7) + 1 }
  : { fy: 2026, week: Math.floor(daysBetween(FY26, d) / 7) + 1 };

// Rows the way prod holds them: 2025 (before FY2026) has NO week number; plan rows run ahead.
const START = '2025-11-01', END = '2027-02-28';
const DATES = [];
for (let d = START; d <= END; d = shift(d, 1)) DATES.push(d);

function buildData(today) {
  const DATA = {};
  for (const st of ALL) {
    DATA[st] = {};
    for (const d of DATES) {
      const inFy = d >= FY26;
      const f = inFy ? fiscal(d) : null;
      const budget = !inFy ? WEIGHT[st] * 1000 : (f.fy === 2027 ? WEIGHT[st] : WEIGHT[st] * 1000);
      const past = d < today;
      const total = past ? (st === 'BL8' ? 0 : WEIGHT[st] * 100) : null;   // future = plan row only
      DATA[st][d] = { week: f ? f.week : null, budget, total, retail: total, bin: past ? 0 : null,
                      auction: past ? 0 : null, laborPct: past ? 10 : null };
    }
  }
  return DATA;
}

const money = (n) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL ' + m); } };

const b = await chromium.launch({ executablePath: CHROME });

// Each case: an Eastern wall-clock instant, the fiscal week it falls in, and what the cards must show.
const CASES = [
  { at: '2026-12-29T15:00:00Z', today: '2026-12-29', label: 'FY2027 week 1 (Tue Dec 29, 2026)' },
  { at: '2027-01-05T15:00:00Z', today: '2027-01-05', label: 'FY2027 week 2 (Tue Jan 5, 2027)' },
  { at: '2026-11-19T15:00:00Z', today: '2026-11-19', label: 'FY2026 week 47 (today, unchanged)' },
];

for (const cs of CASES) {
  const DATA = buildData(cs.today);
  const f = fiscal(cs.today);
  const weekDates = DATES.filter(d => d >= FY26 && fiscal(d).fy === f.fy && fiscal(d).week === f.week);
  const wantWeekBudget = ALL.reduce((n, st) => n + weekDates.reduce((m, d) => m + DATA[st][d].budget, 0), 0);
  // The week before, by DATE — across the year boundary for FY2027 week 1.
  const lwStart = shift(weekDates[0], -7);
  const lwDates = DATES.filter(d => d >= lwStart && d < weekDates[0]);
  const wantBL1LastWeek = lwDates.reduce((m, d) => m + (DATA.BL1[d].total || 0), 0);

  const ctx = await b.newContext({ timezoneId: TZ, viewport: { width: 1400, height: 1200 } });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date(cs.at));
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript(({ DATA, OPEN }) => {
    try { localStorage.setItem('darkMode', 'false'); localStorage.setItem('bioPromptDismissed', '1'); } catch (e) {}
    window.__histUrls = [];
    const real = window.fetch;
    window.fetch = async (u, o) => {
      const s = String(u);
      const J = (x) => new Response(JSON.stringify(x), { status: 200, headers: { 'content-type': 'application/json' } });
      if (s.includes('auth-me')) {
        return J({ authenticated: true, email: 'a@b.com', name: 'Admin', role: 'admin',
                   stores: null, pages: {}, businesses: ['bl'] });
      }
      if (s.includes('history_d1=true')) {
        window.__histUrls.push(s);
        const q = new URL(s).searchParams;
        const rows = DATA[q.get('store')] || {};
        const from = q.get('from'), to = q.get('to');
        const out = {};
        for (const [d, r] of Object.entries(rows)) if (d >= from && d <= to) out[d] = r;   // as the worker does
        return J(out);
      }
      const q = s.includes('?') ? new URL(s).searchParams : null;
      if (q && q.get('since') && q.get('store')) {
        const st = q.get('store').toUpperCase();
        if (!OPEN.includes(st)) return J({});
        return J({ aggregate: { total: 0, retail: 0, bin: 0, avgCart: 0, avgItems: 0,
                                orderCount: 0, avgTxnSec: null, avgASP: null } });
      }
      return real(u, o);
    };
  }, { DATA, OPEN });

  await page.goto('http://localhost:8098/', { waitUntil: 'domcontentloaded' });
  let booted = true;
  try {
    await page.waitForFunction(() => {
      const e = document.getElementById('c-budget');
      return e && e.textContent && e.textContent !== '—';
    }, { timeout: 30000 });
  } catch (e) { booted = false; }
  await page.waitForTimeout(1000);
  console.log(`\n── ${cs.label} ──`);
  ok(booted, `${cs.label}: the weekly budget card rendered`);

  const weekBudget = booted ? await page.$eval('#c-budget', e => e.textContent.trim()) : null;
  const urls = await page.evaluate(() => window.__histUrls);
  const qs = urls.map(u => new URL(u).searchParams);
  const etYear = Number(cs.today.slice(0, 4));
  console.log(`   weekly budget ${weekBudget} (want ${money(wantWeekBudget)})`);
  console.log(`   history range ${qs[0] && qs[0].get('from')} → ${qs[0] && qs[0].get('to')}`);

  ok(weekBudget === money(wantWeekBudget),
    `${cs.label}: 🔑 weekly budget is THIS fiscal week only — got ${weekBudget}, want ${money(wantWeekBudget)}`);
  ok(qs.length === 6, `${cs.label}: six stores' history read (${qs.length})`);
  ok(qs.every(q => q.get('from') === '2025-01-01'), `${cs.label}: history still starts 2025-01-01`);
  ok(qs.every(q => q.get('to') === `${etYear + 1}-12-31`),
    `${cs.label}: 🔑 history runs to Dec 31 of NEXT year, from today — got ${qs[0] && qs[0].get('to')}, want ${etYear + 1}-12-31`);

  // Store detail: the label shows the fiscal week NUMBER, and last week is the previous
  // week by date — FY2026 week 52 when this is FY2027 week 1.
  await page.evaluate(() => window.showStoreDetail('BL1/BL6 Coliseum'));
  await page.waitForTimeout(600);
  const sub = await page.$eval('#store-detail-subtitle', e => e.textContent.trim()).catch(() => null);
  ok(sub === `Week ${f.week} · Daily Breakdown`, `${cs.label}: store detail says "Week ${f.week} · Daily Breakdown" (got "${sub}")`);
  await page.click('#sd-tab-chart').catch(() => {});   // the chart renders only on its own tab
  await page.waitForTimeout(500);
  const chart = await page.$eval('#sd-chart-card', e => e.textContent.replace(/\s+/g, ' ')).catch(() => '');
  const lw = (chart.match(/LW\s*(\$[\d,]+\.\d\d)/) || [])[1] || null;
  ok(lw === money(wantBL1LastWeek),
    `${cs.label}: 🔑 BL1 last week is the 7 days before this week (${lwDates[0]}..${lwDates[lwDates.length - 1]}) — got ${lw}, want ${money(wantBL1LastWeek)}`);
  ok(!/Week 20\d\d\d\d/.test(chart + ' ' + sub), `${cs.label}: no internal week key leaks into a label`);

  // The week picker on the store detail page offers week numbers, not keys.
  const opts = await page.$$eval('#sd-week-select option', ns => ns.map(n => n.textContent.trim())).catch(() => []);
  ok(opts.length > 0 && opts.every(t => /^Week \d{1,2}$/.test(t)), `${cs.label}: week picker labels are "Week N" (${opts.join(', ')})`);

  ok(errs.length === 0, `${cs.label}: no page errors: ` + errs.join(' | '));
  await ctx.close();
}

await b.close(); srv.close();
console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
