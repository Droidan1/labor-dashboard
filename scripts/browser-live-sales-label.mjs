// The live-sales channel is labelled "Live Sales", in a REAL BROWSER, in both themes, at a
// phone width and a desktop width.
//
// 🛑 NOT PART OF `scripts/test.sh` — the runner globs `test-*`, and this needs
// playwright-core and a Chromium, neither of which is a repo dependency. Run by hand:
//
//   npm install --no-save playwright-core
//   bash scripts/build.sh && node scripts/browser-live-sales-label.mjs
//   (on a Mac: PLAYWRIGHT_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
//
// 🔑 WHY. daily_sales.auction became live sales in 2026-10 (online auction + Whatnot,
// tasks/todo.md 2026-10-12), so its label moved off "Auction". NOT to plain "Live": the app
// already says LIVE in green for "today, in real time from the till" (store-card badge, the
// Daily tab's today tag), and a violet "Live" tile beside a green LIVE badge reads as the same
// thing. So this asserts three things together: the channel says "Live Sales" wherever it is
// drawn, nothing visible still says "Auction", and the green LIVE badge is untouched. Plus the
// longer label must still fit its tile on a phone.
let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch (e) {
  console.error('\nThis check needs playwright-core, which is not a dependency of this repo.\n\n'
    + '  npm install --no-save playwright-core\n'
    + '  bash scripts/build.sh\n'
    + '  node scripts/browser-live-sales-label.mjs\n');
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

// ── Data: every store trades; Coliseum and Battle Creek have live sales every day. ──
const TZ = 'America/New_York';
const OPEN = ['BL1', 'BL2', 'BL4', 'BL14', 'BL16'];
const LIVE = { BL1: 1200, BL14: 800 };
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
const TODAY = ymd(new Date());
const noon = (s) => new Date(s + 'T12:00:00Z');
const shift = (s, n) => ymd(new Date(noon(s).getTime() + n * 86400000));
const DATES = [];
for (let i = -60; i <= 30; i++) DATES.push(shift(TODAY, i));
const WEEK = {};
{ let w = 100; for (const d of DATES) { if (noon(d).getUTCDay() === 0 && d !== DATES[0]) w++; WEEK[d] = w; } }
const DATA = {};
for (const st of OPEN) {
  DATA[st] = {};
  for (const d of DATES) {
    const past = d <= TODAY;
    DATA[st][d] = { week: WEEK[d], budget: 9000, total: past ? 6000 : 0, retail: past ? 4000 : 0, bin: past ? 2000 : 0,
                    auction: past ? (LIVE[st] || null) : null, laborPct: 10 };
  }
}

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL ' + m); } };

const lum = (rgb) => {
  const [r, g, b] = rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const b = await chromium.launch({ executablePath: CHROME });
for (const scheme of ['light', 'dark']) {
  for (const [wName, viewport] of [['phone', { width: 375, height: 812 }], ['desktop', { width: 1400, height: 1200 }]]) {
    const tag = `[${scheme} ${wName}]`;
    const ctx = await b.newContext({ timezoneId: TZ, viewport, colorScheme: scheme });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.addInitScript((sc) => { try { localStorage.setItem('darkMode', String(sc === 'dark')); } catch (e) {} }, scheme);
    await page.addInitScript(({ DATA, OPEN }) => {
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
          return J({ aggregate: { total: 6000, retail: 4000, bin: 2000, avgCart: 20, avgItems: 2, orderCount: 5, avgTxnSec: 60, avgASP: 10 } });
        }
        return real(u, o);
      };
    }, { DATA, OPEN });
    await page.goto('http://localhost:8098/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelectorAll('#store-cards > *').length > 0
      && /Live Sales|Auction/.test(document.getElementById('store-cards').textContent), { timeout: 30000 });
    await page.waitForTimeout(1200);

    const dash = await page.evaluate(() => {
      const visible = document.body.innerText;
      const labels = [...document.querySelectorAll('#store-cards div')].filter(d => d.children.length === 0 && d.textContent.trim() === 'Live Sales');
      const fits = labels.map(l => { const tile = l.parentElement; return { label: l.scrollWidth <= l.clientWidth + 1, tile: tile.scrollWidth <= tile.clientWidth + 1 }; });
      const hero = document.getElementById('cm-auction-pct');
      const opaque = (el) => { for (let n = el; n; n = n.parentElement) { const bg = getComputedStyle(n).backgroundColor; const p = bg.match(/[\d.]+/g); if (p && (p.length < 4 || Number(p[3]) === 1)) return bg; } return 'rgb(255,255,255)'; };
      const l0 = labels[0];
      return {
        auctionWord: /\bauction\b/i.test(visible),
        labels: labels.length, fits,
        hero: hero ? hero.parentElement.textContent.replace(/\s+/g, ' ').trim() : null,
        badges: [...document.querySelectorAll('#store-cards span')].filter(s => /^(LIVE|OFFLINE)$/.test(s.textContent.trim())).length,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        color: l0 ? getComputedStyle(l0).color : null, bg: l0 ? opaque(l0) : null,
      };
    });
    ok(!dash.auctionWord, `${tag} nothing visible on the dashboard says "Auction"`);
    ok(dash.labels === 5, `${tag} every store card has a "Live Sales" tile (${dash.labels})`);
    ok(dash.fits.every(f => f.label && f.tile), `${tag} "Live Sales" fits its tile without clipping`);
    ok(dash.hero && dash.hero.startsWith('Live Sales ·'), `${tag} the hero channel mix says "Live Sales ·" (got ${JSON.stringify(dash.hero)})`);
    ok(dash.badges === 5, `${tag} the green LIVE/OFFLINE badge is still on every card (${dash.badges})`);
    ok(dash.overflow <= 0, `${tag} no horizontal page scroll (${dash.overflow}px)`);
    const cr = dash.color && contrast(dash.color, dash.bg);
    ok(cr >= 4.5, `${tag} tile label contrast ${cr && cr.toFixed(2)}:1 ≥ 4.5 (${dash.color} on ${dash.bg})`);

    // Store detail: the channel mix and the Daily tab's column caption.
    await page.evaluate(() => document.querySelector('button[onclick^="showStoreDetail"]').click());
    await page.waitForTimeout(1500);
    const sd = await page.evaluate(() => {
      const visible = document.body.innerText;
      const spans = [...document.querySelectorAll('span, div')].filter(e => e.children.length <= 1 && /^Live Sales( ·.*)?$/.test(e.textContent.trim()));
      return { auctionWord: /\bauction\b/i.test(visible), liveSales: spans.length, greenLive: /\bLIVE\b/.test(visible) };
    });
    ok(!sd.auctionWord, `${tag} nothing visible on a store's page says "Auction"`);
    ok(sd.liveSales >= 1, `${tag} the store page labels live sales "Live Sales" (${sd.liveSales})`);
    ok(errs.length === 0, `${tag} no page errors: ${errs.join(' | ')}`);
    await ctx.close();
  }
}
await b.close();
srv.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
