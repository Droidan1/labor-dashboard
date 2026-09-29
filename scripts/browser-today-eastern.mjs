// "Today" is the stores' Eastern day in a REAL BROWSER, whatever zone the browser is set to.
//
// 🛑 NOT PART OF `npm test`: the runner globs `test-*`, and this needs playwright-core and a
// Chromium, neither of which is a repo dependency. Run by hand:
//
//   npm install --no-save playwright-core
//   bash scripts/build.sh && node scripts/browser-today-eastern.mjs
//
// scripts/test-today-eastern.mjs runs the sliced functions under several zones in Node. This
// boots the whole page instead, with the browser's zone set (timezoneId) and its clock fixed,
// so the parts that test does not slice run too: renderDashboard's closed-store budget, the
// boot path into loadAll, and the rendered tabs a manager actually reads.
//
// 🔑 THE BUDGETS NAME THEIR DAY. Each is the store's weight x $1,000 plus the day's index, so a
// figure built from another day's rows is off by exactly the days between them, once per store.
let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch (e) {
  console.error('\nThis check needs playwright-core, which is not a dependency of this repo.\n\n'
    + '  npm install --no-save playwright-core\n'
    + '  bash scripts/build.sh\n'
    + '  node scripts/browser-today-eastern.mjs\n\n'
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
const PORT = Number(process.env.TE_PORT) || 8101;
await new Promise(r => srv.listen(PORT, r));
const ORIGIN = `http://127.0.0.1:${PORT}`;

const ET = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });
const ymd = (t) => ET.format(new Date(t));
// Midnight Eastern, found here independently: the first minute whose Eastern date is `d`.
function truth(d) {
  let lo = Date.parse(d + 'T03:00:00Z'), hi = Date.parse(d + 'T06:00:00Z');
  while (hi - lo > 60000) { const mid = lo + Math.floor((hi - lo) / 120000) * 60000; if (ymd(mid) === d) hi = mid; else lo = mid; }
  return hi;
}
const noon = (s) => new Date(s + 'T12:00:00Z');
const shift = (s, n) => ymd(noon(s).getTime() + n * 86400000);
const money = (n) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const WEIGHT = { BL1: 1, BL2: 2, BL4: 4, BL14: 8, BL16: 16, BL8: 32 };
const OPEN = ['BL1', 'BL2', 'BL4', 'BL14', 'BL16'];
const ALL = [...OPEN, 'BL8'];

// The page's D1 history for one Eastern today: three weeks back, two forward, weeks rolling on
// Sundays. Earlier days carry a stored total; today carries a stale snapshot (5) that the
// loader must drop for the live figure; later days carry only a budget.
function fixture(today) {
  const DATES = []; for (let i = -21; i <= 14; i++) DATES.push(shift(today, i));
  const WEEK = {}; let w = 200;
  for (const d of DATES) { if (noon(d).getUTCDay() === 0 && d !== DATES[0]) w++; WEEK[d] = w; }
  const budget = (st, d) => WEIGHT[st] * 1000 + DATES.indexOf(d);
  const stored = (st, d) => st === 'BL8' ? 0 : WEIGHT[st] * 100 + DATES.indexOf(d);
  const live = (st) => WEIGHT[st] * 10 + 3;
  const DATA = {};
  for (const st of ALL) {
    DATA[st] = {};
    for (const d of DATES) {
      const total = d < today ? stored(st, d) : d === today ? 5 : null;
      DATA[st][d] = { week: WEEK[d], budget: budget(st, d), total, retail: total, bin: total == null ? null : 0,
                      auction: 0, laborPct: total == null ? null : 10, orderCount: total == null ? null : 5 };
    }
  }
  const LIVE = Object.fromEntries(OPEN.map(st => [st, live(st)]));
  const weekDays = DATES.filter(d => WEEK[d] === WEEK[today]);
  return { DATES, WEEK, DATA, LIVE, budget, stored, live, weekDays, past: weekDays.filter(d => d < today) };
}

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL ' + m); } };

// Every day row of a Daily table: its day number, today chip, Live tag, sales and budget.
const readRows = (page, sel) => page.$$eval(`${sel} > div.grid`, ns => ns.map(n => {
  const t = n.textContent.replace(/\s+/g, ' ');
  const lead = t.split(' vs ')[0];
  return {
    day: (n.querySelector('span.font-extrabold.leading-none') || {}).textContent?.trim() || null,
    todayChip: !!n.querySelector('.bg-accent-green.border-accent-green'),
    // By element: textContent runs the figure into the tag ("$13.00Live"), so no \b in text.
    live: [...n.querySelectorAll('span')].some(s => s.textContent.trim() === 'Live'),
    sales: (lead.match(/\$([\d,]+\.\d\d)/) || [])[0] || null,
    budget: (t.split(' vs ')[1]?.match(/\$([\d,]+\.\d\d)/) || [])[0] || null,
    text: t,
  };
}));

const CASES = [
  { zone: 'Asia/Tokyo',          iso: '2026-09-29T01:30:00Z', why: 'Mon 21:30 ET, and Tokyo is on Tuesday morning' },
  { zone: 'America/Los_Angeles', iso: '2026-09-29T04:30:00Z', why: 'Tue 00:30 ET, and Los Angeles is on Monday evening' },
  { zone: 'America/New_York',    iso: '2026-09-27T13:00:00Z', why: 'Sun 09:00 ET on an Eastern device, the first morning of the week' },
  { zone: 'America/New_York',    iso: '2026-09-29T01:30:00Z', why: 'Mon 21:30 ET on an Eastern device, which nothing here may change' },
];

const b = await chromium.launch({ executablePath: CHROME });

async function boot({ zone, iso, scheme = 'light' }) {
  const today = ymd(Date.parse(iso));
  const fx = fixture(today);
  const ctx = await b.newContext({ timezoneId: zone, viewport: { width: 1400, height: 1200 }, colorScheme: scheme });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.clock.setFixedTime(new Date(iso));
  await page.route(u => !u.href.startsWith(ORIGIN), r => r.abort());
  await page.addInitScript(({ DATA, LIVE, scheme }) => {
    try { localStorage.setItem('darkMode', String(scheme === 'dark')); } catch (e) {}
    window.__live = [];
    window.fetch = async (u) => {
      const s = String(u);
      const J = (x) => new Response(JSON.stringify(x), { status: 200, headers: { 'content-type': 'application/json' } });
      if (s.includes('auth-me')) {
        return J({ authenticated: true, email: 'a@b.com', name: 'Admin', role: 'admin', stores: null, pages: {}, businesses: ['bl'] });
      }
      const q = s.includes('?') ? new URL(s).searchParams : null;
      if (q && q.get('history_d1')) return J(DATA[q.get('store')] || {});
      if (q && q.get('store') && q.has('since') && !q.get('action')) {
        const st = q.get('store').toUpperCase();
        window.__live.push({ st, since: q.get('since') });
        if (!(st in LIVE)) return J({});
        return J({ aggregate: { total: LIVE[st], retail: LIVE[st], bin: 0, avgCart: 20, avgItems: 2, orderCount: 5, avgTxnSec: 60, avgASP: 10 } });
      }
      return J({});
    };
  }, { DATA: fx.DATA, LIVE: fx.LIVE, scheme });
  await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const e = document.getElementById('c-today-budget');
    return e && e.textContent && e.textContent.trim() !== '—' && window.__live.length >= 5;
  }, { timeout: 30000 });
  await page.waitForTimeout(1200);   // the live fan-out re-renders when it lands
  return { ctx, page, errs, today, fx };
}

for (const cs of CASES) {
  console.log(`\n── ${cs.zone}: ${cs.why} ──`);
  const at = `${cs.zone} @ ${cs.iso}`;
  const { ctx, page, errs, today, fx } = await boot(cs);
  const zoneSeen = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const clockSeen = await page.evaluate(() => new Date().toISOString());
  ok(zoneSeen === cs.zone && clockSeen === new Date(cs.iso).toISOString(), `${at}: the browser runs in ${zoneSeen} at ${clockSeen}`);

  // The live window: midnight Eastern for every till.
  const live = await page.evaluate(() => window.__live);
  const sinces = [...new Set(live.map(x => Number(x.since)))];
  ok(live.length >= 5 && sinces.length === 1 && sinces[0] === truth(today),
    `${at}: the live requests ask from midnight Eastern ${new Date(truth(today)).toISOString()} (got ${sinces.map(v => new Date(v).toISOString()).join(', ')})`);

  // The dashboard hero: today's budget is the Eastern day's, Holland's included.
  const heroBudget = (await page.$eval('#c-today-budget', e => e.textContent)).trim();
  const wantHero = ALL.reduce((n, st) => n + fx.budget(st, today), 0);
  ok(heroBudget === money(wantHero), `${at}: the hero's today budget is ${today}'s, all six stores (got ${heroBudget}, want ${money(wantHero)})`);

  // The Store Detail Daily tab.
  await page.evaluate(() => window.showStoreDetail('BL1/BL6 Coliseum'));
  await page.waitForTimeout(400);
  {
    const rows = await readRows(page, '#sd-content-weekly');
    const days = rows.filter(r => r.day);
    const t = days.find(r => r.budget === money(fx.budget('BL1', today)));
    ok(days.length === 7 && !!t, `${at}: Store Detail Daily draws the week, ${today} among it (${days.length} days)`);
    ok(!!t && t.todayChip && t.live && t.sales === money(fx.live('BL1')),
      `${at}: Store Detail Daily puts the live ${money(fx.live('BL1'))} and the today chip on ${today} (${t ? t.text.slice(0, 80) : 'no row'})`);
    ok(days.filter(r => r.todayChip || r.live).length === 1, `${at}: and on no other day (${days.filter(r => r.todayChip || r.live).map(r => r.day).join(', ')})`);
    const total = rows.find(r => !r.day);
    ok(!!total && total.text.includes(`${fx.past.length + 1} of 7 days reported`),
      `${at}: its week counts ${fx.past.length + 1} days reported (${total ? (total.text.match(/\d+ of \d+ days reported/) || ['none'])[0] : 'no total row'})`);
  }

  // The All Stores page: its hero and its Daily table.
  await page.evaluate(() => window.showAllStoresDetail());
  await page.waitForTimeout(400);
  {
    const hero = await page.$eval('#as-metrics', e => e.textContent.replace(/\s+/g, ' '));
    const wkSales = OPEN.reduce((n, st) => n + fx.past.reduce((m, d) => m + fx.stored(st, d), 0) + fx.live(st), 0);
    ok(hero.includes(money(wkSales)), `${at}: the All Stores hero's week is the stored days plus live, ${money(wkSales)}`);
    await page.evaluate(() => window.switchAllStoresTab('weekly'));
    await page.waitForTimeout(300);
    const rows = await readRows(page, '#as-content-weekly');
    const days = rows.filter(r => r.day);
    const t = days.find(r => r.budget === money(ALL.reduce((n, st) => n + fx.budget(st, today), 0)));
    const liveSum = OPEN.reduce((n, st) => n + fx.live(st), 0);
    ok(!!t && t.todayChip && t.live && t.sales === money(liveSum),
      `${at}: All Stores Daily puts the live ${money(liveSum)} and the today chip on ${today} (${t ? t.text.slice(0, 80) : 'no row'})`);
    ok(days.filter(r => r.todayChip || r.live).length === 1, `${at}: and on no other day (${days.filter(r => r.todayChip || r.live).map(r => r.day).join(', ')})`);
  }

  ok(errs.length === 0, `${at}: no page errors: ${errs.join(' | ')}`);
  await ctx.close();
}

// ── The today chip, in both themes, measured on the row it now lands on ──────
// No colour changed here, but the chip is now drawn on a different row for part of the day
// on a device outside Eastern time, so it is measured rather than assumed. The theme is a
// `.dark` class from localStorage, asserted rather than trusted.
for (const scheme of ['light', 'dark']) {
  const { ctx, page, errs, today } = await boot({ ...CASES[0], scheme });
  await page.evaluate(() => window.showStoreDetail('BL1/BL6 Coliseum'));
  await page.waitForTimeout(400);
  const m = await page.evaluate(() => {
    const isDark = document.documentElement.classList.contains('dark') || document.body.classList.contains('dark');
    const chip = document.querySelector('#sd-content-weekly .bg-accent-green.border-accent-green');
    const num = chip && chip.querySelector('span.font-extrabold.leading-none');
    const wd = chip && chip.querySelector('span');
    if (!chip || !num) return { isDark, found: false };
    const bg = getComputedStyle(chip).backgroundColor;
    return { isDark, found: true, day: num.textContent.trim(), bg, num: getComputedStyle(num).color, wd: getComputedStyle(wd).color };
  });
  const rgb = (s) => (s.match(/[\d.]+/g) || []).map(Number);
  const lum = (c) => { const a = c.slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
                       return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]; };
  // Alpha text over an opaque chip: composite it first, or the ratio flatters it.
  const over = (fg, bg) => { const f = rgb(fg), k = rgb(bg), a = f.length > 3 ? f[3] : 1; return [0, 1, 2].map(i => f[i] * a + k[i] * (1 - a)); };
  const ratio = (fg, bg) => { const x = lum(over(fg, bg)), y = lum(rgb(bg)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  ok(m.found && m.day === String(Number(today.slice(8))), `${scheme}: the today chip is on day ${Number(today.slice(8))} (got ${m.day})`);
  ok(m.isDark === (scheme === 'dark'), `${scheme}: the theme actually applied (dark class ${m.isDark})`);
  if (m.found) {
    const rn = ratio(m.num, m.bg), rw = ratio(m.wd, m.bg);
    ok(rn >= 4.5, `${scheme}: the day number reads ${rn.toFixed(2)}:1 on the chip (${m.num} on ${m.bg})`);
    ok(rw >= 4.5, `${scheme}: the weekday reads ${rw.toFixed(2)}:1 on the chip (${m.wd} on ${m.bg})`);
    console.log(`   ${scheme}: day ${rn.toFixed(2)}:1, weekday ${rw.toFixed(2)}:1 on ${m.bg}`);
  }
  ok(errs.length === 0, `${scheme}: no page errors: ${errs.join(' | ')}`);
  await ctx.close();
}

await b.close(); srv.close();
console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
