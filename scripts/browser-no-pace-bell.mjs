// The header notifications bell is gone, driven in a REAL BROWSER, in both themes.
//
// 🛑 NOT PART OF `scripts/test.sh` — needs playwright-core and a Chromium. Run by hand:
//
//   npm install --no-save playwright-core
//   bash scripts/build.sh && node scripts/browser-no-pace-bell.mjs
//
// scripts/test-no-pace-bell.mjs proves the code is gone. This proves the page still
// works without it: the bell's JS block ended where renderDashboard() begins, and
// renderDashboard() used to call renderNotifications() last, so a bad cut shows up
// here as a page error or a dashboard that never draws its cards.
//
// Every store is at HALF its day budget, which the old bell reported as five
// "pacing 50% of day budget" alerts for an admin after noon.
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
const types = { '.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json','.png':'image/png','.svg':'image/svg+xml' };
const srv = http.createServer((q, s) => {
  const f = path.join(root, q.url === '/' ? 'index.html' : q.url.split('?')[0]);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end('no'); }
  s.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(s);
});
await new Promise(r => srv.listen(8098, r));

const TZ = 'America/New_York';
const OPEN = ['BL1', 'BL2', 'BL4', 'BL14', 'BL16'];
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
const TODAY = ymd(new Date());
const noon = (s) => new Date(s + 'T12:00:00Z');
const shift = (s, n) => ymd(new Date(noon(s).getTime() + n * 86400000));
const DATES = [];
for (let i = -40; i <= 10; i++) DATES.push(shift(TODAY, i));
const WEEK = {};
{ let w = 100; for (const d of DATES) { if (noon(d).getUTCDay() === 0 && d !== DATES[0]) w++; WEEK[d] = w; } }
const DATA = {};
for (const st of OPEN) {
  DATA[st] = {};
  for (const d of DATES) DATA[st][d] = { week: WEEK[d], budget: 4000, total: 2000, retail: 2000, bin: 0, auction: 0, laborPct: 10 };
}

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS  ' + m); } else { fail++; console.log('  FAIL  ' + m); } };

const b = await chromium.launch({ executablePath: CHROME });
const shots = [];
for (const scheme of ['light', 'dark']) {
  const ctx = await b.newContext({ timezoneId: TZ, viewport: { width: 1400, height: 900 }, colorScheme: scheme });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript(({ DATA, OPEN, dark }) => {
    try { localStorage.setItem('darkMode', dark ? 'true' : 'false'); } catch (e) {}
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
        return J({ aggregate: { total: 2000, retail: 2000, bin: 0, avgCart: 20, avgItems: 2, orderCount: 5, avgTxnSec: 60, avgASP: 10 } });
      }
      return real(u, o);
    };
  }, { DATA, OPEN, dark: scheme === 'dark' });

  await page.goto('http://localhost:8098/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('#store-cards > *').length > 0, { timeout: 30000 });
  await page.waitForTimeout(1200);

  console.log(`\n── ${scheme} ──`);
  const cards = await page.$$eval('#store-cards > *', n => n.length);
  ok(cards === 5, `the dashboard draws its five store cards (${cards})`);
  ok(errs.length === 0, `no page errors${errs.length ? ': ' + errs.join(' | ') : ''}`);
  ok(await page.$('#notif-bell-wrap') === null, 'no bell in the header');
  ok(await page.$('button[aria-label="Notifications"]') === null, 'no Notifications button at all');
  const body = await page.evaluate(() => document.body.innerText);
  ok(!/pacing \d+% of day budget|day budget reached/.test(body), 'no pacing / budget-reached alert text anywhere');
  ok(await page.isVisible('#day-chip-trigger'), 'date-range chip still shows');
  ok(await page.isVisible('#dash-refresh-btn'), 'Refresh button still shows');
  const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  ok(isDark === (scheme === 'dark'), `rendered in the ${scheme} theme`);

  const out = path.join(process.env.SHOT_DIR || '/tmp', `no-pace-bell-${scheme}.png`);
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1400, height: 420 } });
  shots.push(out);
  await ctx.close();
}
await b.close();
srv.close();
console.log(`\nscreenshots: ${shots.join(', ')}`);
console.log(fail ? `\n${fail} FAILED` : `\nall ${pass} checks passed`);
process.exit(fail ? 1 : 0);
