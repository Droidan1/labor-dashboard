// An E-Commerce company's View Details page (Option A, 2026-11-18), in a real browser against
// the built dist/, with ?action=ecom-overview, ?action=ecom-company and ?action=ecom-items stubbed.
//
// WHAT THIS PROTECTS.
//   - Every company card on the Overview has View Details, and it opens that company's page with
//     the Overview's range; changing the range there carries back to the Overview (one E-Commerce
//     range), and "← E-Commerce" goes back.
//   - The page: title and Sellercloud ids, six summary figures with both comparisons, and the
//     Daily · Chart · Orders · Items tabs, each drawing its own content; a one-day range charts hours.
//   - A company the user may not see says so instead of drawing an empty page.
//   - The Overview item stays lit (sidebar and phone bar) while on a company.
//   - Items (2026-11-18) is the product table: top 25 then Show all, sort by sales or units,
//     search that keeps the cursor in the box, returns of 20%+ marked, a refresh reads it again
//     (DESIGN §4.8 trap 8), a note when some orders have no products stored, and margin columns
//     only when 90% of sales carry a cost.
//   - Text clears AA in light and dark on every tab; the page fits a phone.
//
// Run: bash scripts/build.sh && PLAYWRIGHT_CHROMIUM=<chrome> node scripts/browser-ecom-company.mjs
let chromium;
try { ({ chromium } = await import('playwright-core')); } catch (e) {
  console.error('\nThis check needs playwright-core:  npm install --no-save playwright-core\n'); process.exit(2);
}
const CHROME = process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'dist');
if (!fs.existsSync(path.join(root, 'index.html'))) { console.error('\nRun `bash scripts/build.sh` first.\n'); process.exit(2); }
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, s) => {
  const f = path.join(root, q.url === '/' ? 'index.html' : q.url.split('?')[0]);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end('no'); }
  s.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(s);
});
await new Promise(r => srv.listen(8099, r));
const URL_ = 'http://127.0.0.1:8099/index.html';
const results = [];
const check = (c, m) => results.push([!!c, m]);
const b = await chromium.launch({ executablePath: CHROME });

async function open(theme, width = 1280, isMobile = false) {
  const ctx = await b.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block', isMobile, hasTouch: isMobile });
  const page = await ctx.newPage();
  const errs = [], asked = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR_/.test(m.text())) errs.push('console: ' + m.text()); });
  await page.exposeFunction('__asked', (u) => asked.push(u));
  await page.addInitScript((theme) => {
    try { localStorage.setItem('darkMode', String(theme !== 'light')); localStorage.setItem('darkFlavor', 'dark');
      sessionStorage.setItem('retjg.activeBusiness', 'ecom'); localStorage.setItem('bioPromptDismissed', '1'); } catch (e) {}
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
    const add = (d, n) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
    const agg = (sales, orders) => ({ sales, shipping: Math.round(sales * 12) / 100, refunded: orders > 3 ? 24.99 : 0, orders, units: orders + 1, returns: orders > 3 ? 1 : 0, ebay: sales, poshmark: 0, other: 0 });
    window.fetch = async (u) => {
      const s = String(u);
      const J = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
      if (s.includes('auth-me')) return J({ authenticated: true, email: 'x@example.com', name: 'X', role: 'superuser', pages: {},
        businesses: [{ id: 'bl', name: 'Bargain Lane', connected: true, unitCount: 5, unitNoun: 'store' }, { id: 'ecom', name: 'E-Commerce', connected: false, unitCount: 0, unitNoun: 'storefront' }] });
      const to = (s.match(/[?&]to=(\d{4}-\d{2}-\d{2})/) || [])[1] || today, from = (s.match(/[?&]from=(\d{4}-\d{2}-\d{2})/) || [])[1] || to;
      const days = Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1;
      if (s.includes('action=ecom-overview')) {
        const a = agg(500 * days, 5 * days);
        return J({ ok: true, date: to, weekStart: to, monthStart: to.slice(0, 8) + '01', range: { from, to, days },
          budget: { monthly: 57000, today: 1900, week: 13300, month: 57000, period: 1900 * days }, today: a, week: a, month: a, period: a, reporting: 5, reportingPeriod: 5,
          companies: [[163, 'Shoes and Fashions', [163, 169]], [164, 'Harrison Avenue', [164]], [165, 'Bass River', [165]], [166, 'Detail Pro', [166]], [167, 'Dymoda', [167]]]
            .map(([id, name, ids]) => ({ id, name, companyIds: ids, today: a, week: a, month: a, period: a, hours: new Array(24).fill(0) })),
          sync: { at: new Date().toISOString(), ok: true } });
      }
      if (s.includes('action=ecom-company')) {
        window.__asked(s);
        const id = Number((s.match(/company=(\d+)/) || [])[1]);
        if (id === 165) return J({ error: 'Forbidden', code: 'NO_UNIT_ACCESS' }, 403);
        const daily = []; for (let d = from; d <= to; d = add(d, 1)) { const n = (Number(d.slice(8)) % 4) + 1; daily.push({ date: d, ...agg(n * 61.5, n) }); }
        const sum = (k) => daily.reduce((n, x) => n + x[k], 0);
        const totals = { sales: Math.round(sum('sales') * 100) / 100, shipping: Math.round(sum('shipping') * 100) / 100, refunded: Math.round(sum('refunded') * 100) / 100,
          orders: sum('orders'), units: sum('units'), returns: sum('returns'), ebay: Math.round(sum('sales') * 100) / 100, poshmark: 0, other: 0 };
        const hours = from === to ? Array.from({ length: 24 }, (_, h) => h >= 9 && h <= 15 ? 40 + h : 0) : null;
        return J({ ok: true, company: { id, name: id === 163 ? 'Shoes and Fashions' : 'Co ' + id, companyIds: id === 163 ? [163, 169] : [id] },
          range: { from, to, days }, totals,
          previous: { from: add(from, -days), to: add(from, -1), ...agg(totals.sales * 0.8, Math.round(totals.orders * 0.8)) },
          lastYear: { from: from.replace(/^\d{4}/, y => y - 1), to: to.replace(/^\d{4}/, y => y - 1), ...agg(totals.sales * 1.5, totals.orders * 2) },
          daily, status: [{ status: 3, name: 'Completed', orders: totals.orders, amount: totals.sales }, { status: -1, name: 'Canceled', orders: 1, amount: 12 }],
          hours, ordersInRange: 3,
          orders: [{ id: 5029027, time: to + 'T10:08:05', status: 2, statusName: 'InProcess', channel: 'eBay', units: 1, total: 47.38, shipping: 9.99, refunded: 0, returned: 0 },
                   { id: 5029020, time: to + 'T09:00:31', status: 3, statusName: 'Completed', channel: 'eBay', units: 2, total: 77.98, shipping: 9.99, refunded: 0, returned: 0 },
                   { id: 5029011, time: to + 'T08:01:00', status: -1, statusName: 'Canceled', channel: 'Poshmark', units: 1, total: 12, shipping: 0, refunded: 12, returned: 0 }] });
      }
      if (s.includes('action=ecom-items')) {
        window.__asked(s);
        await new Promise(r => setTimeout(r, 150));   // a real read takes a moment: a render meanwhile must not ask twice
        const sort = (s.match(/[?&]sort=(\w+)/) || [])[1] || 'sales';
        const q = decodeURIComponent((s.match(/[?&]q=([^&]*)/) || [])[1] || '').toLowerCase();
        const cost = !!window.__itemsCost;
        const all = Array.from({ length: 30 }, (_, i) => ({ sku: 'JG-' + (7800000 + i), name: (i % 3 === 0 ? 'Red Wing Boots ' : 'johnnie-O Shirt ') + i,
          units: (i % 4) + 1, sales: 300 - i * 7, orders: (i % 4) + 1, returned: i === 2 ? 1 : 0, refunded: i === 2 ? 50 : 0, lastSold: to,
          costedSales: cost ? 300 - i * 7 : 0, cost: cost ? Math.round((300 - i * 7) * 40) / 100 : 0 }));
        const tot = (a) => { const t = { products: a.length, lines: a.length }; for (const k of ['units', 'sales', 'returned', 'refunded', 'costedSales', 'cost']) t[k] = a.reduce((n, x) => n + x[k], 0); t.coverage = cost ? 1 : 0; return t; };
        const rows = all.filter(x => !q || x.name.toLowerCase().includes(q) || x.sku.toLowerCase().includes(q))
          .sort(sort === 'units' ? (a, b) => b.units - a.units || b.sales - a.sales : (a, b) => b.sales - a.sales);
        return J({ ok: true, company: { id: 163, name: 'Shoes and Fashions' }, range: { from, to, days }, sort, q, totals: tot(all), matched: q ? tot(rows) : null,
          items: rows, limit: 500, truncated: false, orders: { sold: 40, withLines: window.__itemsGap ? 30 : 40 } });
      }
      return J({ ok: true });
    };
  }, theme);
  await page.goto(URL_, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.getElementById('app')?.classList.contains('hidden'), { timeout: 15000 });
  await page.waitForTimeout(1500);
  return { ctx, page, errs, asked };
}
const visible = (page) => page.$$eval('[id^="page-"]', ps => ps.filter(p => !p.classList.contains('hidden')).map(p => p.id));
const aa = (page) => page.evaluate(() => {
  const lum = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); };
  const ratio = (a, b) => { const [h, l] = lum(a) > lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)]; return (h + .05) / (l + .05); };
  const parse = s => { const m = s && s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return { rgb: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 }; };
  const over = (fg, a, bg) => fg.map((c, i) => c * a + bg[i] * (1 - a));
  const bgOf = node => { const st = []; let e = node; while (e && e !== document.documentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { st.push(c); if (c.a === 1) break; } e = e.parentElement; }
    const rb = parse(getComputedStyle(document.body).backgroundColor) || { rgb: [255, 255, 255], a: 1 }; let base = st.length && st[st.length - 1].a === 1 ? st.pop().rgb : rb.rgb; for (let i = st.length - 1; i >= 0; i--) base = over(st[i].rgb, st[i].a, base); return base; };
  const out = [], seen = new Set(), root = document.getElementById('page-ecom-company');
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n;
  while ((n = w.nextNode())) {
    if (!n.textContent.trim()) continue;
    const e = n.parentElement, cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden' || !e.getClientRects().length || e.closest('[disabled], .skel')) continue;
    const isSvg = e instanceof SVGElement;
    const fg = parse(isSvg ? cs.fill : cs.color); if (!fg) continue;
    const bg = bgOf(isSvg ? e.closest('div') : e), eff = fg.a < 1 ? over(fg.rgb, fg.a, bg) : fg.rgb, px = parseFloat(cs.fontSize);
    const min = (px >= 24 || (px >= 18.66 && parseInt(cs.fontWeight) >= 700)) ? 3 : 4.5;
    const key = (isSvg ? cs.fill : cs.color) + '|' + bg.map(Math.round).join() + '|' + min; if (seen.has(key)) continue; seen.add(key);
    const r = ratio(eff, bg); if (r < min) out.push(`${r.toFixed(2)}:1 (min ${min}) "${n.textContent.trim().slice(0, 30)}"`);
  }
  return out;
});

for (const theme of ['dark', 'light']) {
  const { ctx, page, errs, asked } = await open(theme);
  check(JSON.stringify(await visible(page)) === '["page-ecom-overview"]', `${theme}: E-Commerce opens on the Overview`);
  const btns = await page.$$eval('#eo-cards [data-eo-company] button', bs => bs.filter(x => x.textContent.includes('View Details')).length);
  check(btns === 5, `${theme}: every company card has View Details (${btns})`);
  // Put the Overview on This Week first: the detail page opens on it.
  await page.click('#eo-range .rp-trigger');
  await page.evaluate(() => [...document.querySelectorAll('#eo-range .rp-list button')].find(x => x.textContent.trim() === 'This Week').click());
  await page.waitForTimeout(400);
  asked.length = 0;
  await page.evaluate(() => [...document.querySelectorAll('[data-eo-company="163"] button')].find(x => x.textContent.includes('View Details')).click());
  await page.waitForTimeout(700);
  check(JSON.stringify(await visible(page)) === '["page-ecom-company"]', `${theme}: View Details opens the company page`);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const sun = (() => { const d = new Date(today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return d.toISOString().slice(0, 10); })();
  check(asked.some(u => u.includes('company=163') && u.includes(`from=${sun}`) && u.includes(`to=${today}`)), `${theme}: …for company 163 and the Overview's range (This Week)`);
  const head = await page.evaluate(() => ({ title: document.getElementById('ec-title').textContent, sub: document.getElementById('ec-sub').textContent,
    chip: document.querySelector('#ec-range .rp-label').textContent, kpis: document.getElementById('ec-kpis').innerText,
    tabs: [...document.querySelectorAll('#ec-tabs button')].map(x => x.textContent.trim()),
    navLit: document.querySelector('.nav-item.active')?.dataset.page }));
  check(head.title === 'Shoes and Fashions' && head.sub.includes('163 + 169 · eBay + Poshmark') && head.chip === 'This Week', `${theme}: title, Sellercloud ids, and the range chip (${head.chip})`);
  check(['Sales', 'Orders', 'Avg order', 'Units', 'Shipping', 'Refunded'].every(x => head.kpis.includes(x)) && /\+25% vs prior \d+ days?/.test(head.kpis) && /−33% vs same days last year/.test(head.kpis),
    `${theme}: six summary figures, compared with the prior period and last year`);
  check(head.tabs[0] === 'Daily' && head.tabs[1] === 'Chart' && head.tabs[2] === 'Orders · 3' && head.tabs[3].startsWith('Items'), `${theme}: Daily · Chart · Orders · Items tabs (${head.tabs.join(' / ')})`);
  check(head.navLit === 'ecom-overview', `${theme}: the Overview item stays lit (${head.navLit})`);
  const daily = await page.evaluate(() => ({ rows: document.querySelectorAll('#ec-body tbody tr').length, foot: document.querySelector('#ec-body tfoot')?.innerText || '' }));
  const days = Math.round((Date.parse(today) - Date.parse(sun)) / 864e5) + 1;
  check(daily.rows === days && daily.foot.includes(`${days} day`), `${theme}: Daily has one row per day of the range and a total (${daily.rows})`);
  const align = await page.evaluate(() => { const td = document.querySelector('#ec-body tbody tr td'), th = document.querySelector('#ec-body thead th'), num = document.querySelector('#ec-body tbody tr td:nth-child(4)');
    return [getComputedStyle(th).textAlign, getComputedStyle(td).textAlign, getComputedStyle(num).textAlign]; });
  check(align.join() === 'left,left,right', `${theme}: the Day column reads left, the figures right (${align.join()})`);
  let bad = await aa(page);
  await page.evaluate(() => window.ecPickTab('chart')); await page.waitForTimeout(150);
  const bars = await page.$$eval('#ec-body svg rect', r => r.length);
  check(bars === days, `${theme}: Chart draws a bar a day (${bars})`);
  bad = bad.concat(await aa(page));
  await page.evaluate(() => window.ecPickTab('orders')); await page.waitForTimeout(150);
  const orders = await page.evaluate(() => document.getElementById('ec-body').innerText);
  check(orders.includes('#5029027') && orders.includes('In process') && orders.includes('Cancelled') && !orders.includes('InProcess') && orders.includes('Poshmark') && orders.includes('cancelled ones included'),
    `${theme}: Orders lists each order with its status, channel and a note`);
  const oAlign = await page.evaluate(() => [1, 3, 4, 6].map(n => getComputedStyle(document.querySelector(`#ec-body tbody tr td:nth-child(${n})`)).textAlign));
  check(oAlign.join() === 'left,left,left,right', `${theme}: Orders' time, status and channel read left, the total right (${oAlign.join()})`);
  bad = bad.concat(await aa(page));
  // ── Items: the product table ──
  asked.length = 0;
  await page.evaluate(() => window.ecPickTab('items')); await page.waitForTimeout(400);
  const itemsAsk = () => asked.filter(u => u.includes('action=ecom-items'));
  check(itemsAsk().length === 1 && itemsAsk()[0].includes('company=163') && itemsAsk()[0].includes(`from=${sun}`) && itemsAsk()[0].includes('sort=sales'),
    `${theme}: Items reads ecom-items once, for the company, the range and By sales (${itemsAsk().length})`);
  const it = () => page.evaluate(() => ({ rows: [...document.querySelectorAll('#ec-items-list tbody tr')].map(r => r.children[1].innerText.split('\n')[0]),
    head: [...document.querySelectorAll('#ec-items-list thead th')].map(t => t.textContent.trim()), text: document.getElementById('ec-items-list').innerText }));
  let I = await it();
  check(I.rows.length === 25 && I.rows[0] === 'Red Wing Boots 0' && /The top 25 of 30/.test(I.text) && /Show all 30/.test(I.text), `${theme}: the top 25 of 30, best seller first (${I.rows.length}, ${I.rows[0]})`);
  check(I.head.join('|') === '#|Product|Units|Sales|Share|Avg price|Orders|Returned|Last sold', `${theme}: Option A's columns, no margin without cost (${I.head.join('|')})`);
  check(/Margin shows once Sellercloud sends product cost/.test(I.text) && /shipping not included/.test(I.text), `${theme}: it says why there is no margin, and that shipping is not in the sales`);
  const iAlign = await page.evaluate(() => [2, 3, 4, 9].map(n => getComputedStyle(document.querySelector(`#ec-items-list tbody tr td:nth-child(${n})`)).textAlign));
  check(iAlign.join() === 'left,right,right,left', `${theme}: product and last sold read left, figures right (${iAlign.join()})`);
  const marked = await page.evaluate(() => { const r = [...document.querySelectorAll('#ec-items-list tbody tr')].find(x => x.innerText.includes('johnnie-O Shirt 2')); const sp = r && r.children[7].querySelector('span[style]'); return sp ? sp.style.color : null; });
  check(marked === 'var(--v1-bad)', `${theme}: a 33% return rate is marked (${marked})`);
  bad = bad.concat(await aa(page));
  await page.evaluate(() => [...document.querySelectorAll('#ec-items-list button')].find(x => x.textContent.startsWith('Show all')).click()); await page.waitForTimeout(150);
  check((await it()).rows.length === 30, `${theme}: Show all draws every product`);
  await page.click('#ec-items-sort button[data-sort="units"]'); await page.waitForTimeout(400);
  I = await it();
  const pressed = await page.$$eval('#ec-items-sort button', bs => bs.map(x => x.getAttribute('aria-pressed')).join());
  check(itemsAsk().some(u => u.includes('sort=units')) && I.rows[0] === 'Red Wing Boots 3' && pressed === 'false,true' && I.rows.length === 25,
    `${theme}: By units re-reads, puts the most units first and goes back to the top 25 (${I.rows[0]}, ${pressed})`);
  await page.click('#ec-items-q'); await page.keyboard.type('red'); await page.waitForTimeout(700);
  I = await it();
  const focus = await page.evaluate(() => ({ id: document.activeElement && document.activeElement.id, v: document.getElementById('ec-items-q').value }));
  check(itemsAsk().some(u => u.includes('q=red')) && I.rows.length === 10 && I.rows.every(r => r.startsWith('Red Wing')) && /10 match “red”/.test(I.text),
    `${theme}: search re-reads and shows only the matches (${I.rows.length})`);
  check(focus.id === 'ec-items-q' && focus.v === 'red', `${theme}: the cursor stays in the search box while results change (${JSON.stringify(focus)})`);
  // The SECOND render (trap 8): Refresh reads the products again and the controls still work.
  const n0 = itemsAsk().length;
  await page.evaluate(() => { window.__itemsGap = true; window.__itemsCost = true; });
  await page.click('#ec-refresh'); await page.waitForTimeout(900);
  I = await it();
  check(itemsAsk().length === n0 + 1 && itemsAsk().at(-1).includes('q=red') && itemsAsk().at(-1).includes('sort=units'), `${theme}: Refresh reads the products once more, keeping search and sort`);
  check(/stored for 30 of the 40 orders/.test(I.text), `${theme}: it says when some orders have no products stored`);
  check(I.head.includes('Margin') && I.head.includes('Margin %') && /\b60%/.test(I.text), `${theme}: with cost on 90%+ of sales, margin columns appear (${I.head.slice(-2).join('|')})`);
  bad = bad.concat(await aa(page));
  await page.fill('#ec-items-q', ''); await page.waitForTimeout(700);
  check((await it()).rows.length === 25, `${theme}: clearing the search brings the full list back`);
  await page.evaluate(() => { window.__itemsGap = false; window.__itemsCost = false; });
  check(bad.length === 0, `${theme}: every tab clears AA` + (bad.length ? '\n     ' + [...new Set(bad)].join('\n     ') : ''));
  // A one-day range charts hours; the range carries back to the Overview.
  await page.click('#ec-range .rp-trigger');
  await page.evaluate(() => [...document.querySelectorAll('#ec-range .rp-list button')].find(x => x.textContent.trim() === 'Today').click());
  await page.waitForTimeout(500);
  await page.evaluate(() => window.ecPickTab('chart')); await page.waitForTimeout(150);
  const hourChart = await page.evaluate(() => ({ label: document.querySelector('#ec-body .text-\\[12px\\]')?.textContent || document.getElementById('ec-body').innerText, bars: document.querySelectorAll('#ec-body svg rect').length }));
  check(hourChart.bars === 7 && /hour/.test(hourChart.label), `${theme}: a one-day range charts its hours (${hourChart.bars} bars)`);
  await page.evaluate(() => [...document.querySelectorAll('#page-ecom-company button')].find(x => x.textContent.includes('E-Commerce')).click());
  await page.waitForTimeout(500);
  const back = await page.evaluate(() => ({ chip: document.querySelector('#eo-range .rp-label')?.textContent }));
  check(JSON.stringify(await visible(page)) === '["page-ecom-overview"]' && back.chip === 'Today', `${theme}: ← E-Commerce goes back, and the Overview is on the range picked there (${back.chip})`);
  // A company this user may not see.
  await page.evaluate(() => window.ecomOpenCompany(165)); await page.waitForTimeout(600);
  const denied = await page.evaluate(() => document.getElementById('ec-status').innerText);
  check(/do not have access/.test(denied), `${theme}: a company the user may not see says so (${denied.slice(0, 50)})`);
  check(errs.length === 0, `${theme}: no JS errors` + (errs.length ? ' — ' + errs.slice(0, 3).join(' | ') : ''));
  await ctx.close();
}

// ── Phone ─────────────────────────────────────────────────────────────────
{
  const { ctx, page } = await open('dark', 390, true);
  await page.evaluate(() => window.ecomOpenCompany(163)); await page.waitForTimeout(700);
  const fit = await page.evaluate(() => { const r = document.getElementById('ec-refresh').getBoundingClientRect();
    const lit = [...document.querySelectorAll('#bottom-nav .bn-tab')].filter(t => t.offsetParent && t.classList.contains('text-accent-green')).map(t => t.id);
    return { refreshRight: Math.round(r.right), width: innerWidth, sideways: document.documentElement.scrollWidth > innerWidth, lit }; });
  check(fit.refreshRight <= fit.width && !fit.sideways, `phone: the header fits and nothing scrolls sideways (${JSON.stringify(fit)})`);
  check(fit.lit.length === 1 && fit.lit[0] === 'bn-ecom-overview', `phone: the Overview tab is the lit one (${fit.lit})`);
  await page.evaluate(() => window.ecPickTab('items')); await page.waitForTimeout(500);
  const ifit = await page.evaluate(() => { const q = document.getElementById('ec-items-q').getBoundingClientRect(), s = document.getElementById('ec-items-sort').getBoundingClientRect();
    return { sideways: document.documentElement.scrollWidth > innerWidth, q: Math.round(q.right), s: Math.round(s.right), w: innerWidth, rows: document.querySelectorAll('#ec-items-list tbody tr').length }; });
  check(!ifit.sideways && ifit.q <= ifit.w && ifit.s <= ifit.w && ifit.rows === 25, `phone: Items fits, the table scrolls inside its box (${JSON.stringify(ifit)})`);
  await ctx.close();
}

await b.close(); srv.close();
let fails = 0;
for (const [ok, m] of results) { console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${m}`); if (!ok) fails++; }
console.log(`\n${results.length - fails} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
