// The Cart / Items / Orders / ASP tiles, on the store cards and the hero's Matrix, driven in a
// REAL BROWSER against the same live payloads the dollar tiles beside them are painted from.
//
// 🛑 NOT PART OF `scripts/test.sh` — the runner globs `test-*`, and this needs
// playwright-core and a Chromium, neither of which is a repo dependency. Run by hand:
//
//   npm install --no-save playwright-core
//   bash scripts/build.sh && node scripts/browser-channel-matrix.mjs
//
// 🔑 WHY IT EXISTS. On Monday 2026-09-28 three store cards, BIN tapped, showed a split whose
// bin net was 1.8 to 3.4 times the BIN dollars beside it, at $11.66 to $12.00 a unit, which is
// Friday's bin price: Friday's live payload, cached under Monday's range key (tasks/todo.md,
// same date). Scenario C's Friday payload is built from South Bend's card, and the old code
// painted those four tiles back exactly after a Monday ↻.
//
// The split was a COPY of the live payload, taken once per date range, so ↻ never refreshed
// it, and a ↻ after a day change copied the previous session's payload before the new one
// landed. Scenarios A to D are the ways that copy went stale; E is a failed read of the stored
// days. Each asserts the four tiles describe the payload the BIN tile describes, and that
// CART × ORDERS comes back to the BIN dollars.
//
// 🔑 THE NUMBERS NAME THEIR SOURCE. Friday's payload prices bin at $12 and Monday's at $2, and
// every phase has its own order counts, so a wrong tile does not just fail, it says which
// payload it came from.
let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch (e) {
  console.error('\nThis check needs playwright-core, which is not a dependency of this repo.\n\n'
    + '  npm install --no-save playwright-core\n'
    + '  bash scripts/build.sh\n'
    + '  node scripts/browser-channel-matrix.mjs\n\n'
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
const PORT = 8098;
await new Promise(r => srv.listen(PORT, r));

// ── The data ────────────────────────────────────────────────────────────────
const TZ = 'America/New_York';
const FRI = '2026-09-25', SUN = '2026-09-27', MON = '2026-09-28';
const at = (ymd, hm) => new Date(`${ymd}T${hm}:00-04:00`);        // EDT on all three dates
const STORES = ['BL1', 'BL2', 'BL4', 'BL14', 'BL16'];
const SCALE = { BL1: 1.5, BL2: 1, BL4: 0.5, BL14: 0.75, BL16: 0.25 };
const r2 = (n) => Math.round(n * 100) / 100;

// One store's split, in the shape ?store= returns as `channels`. Bin net is units × price
// exactly, as it is on a real markdown day, so the ASP tile reads the price back.
function split(st, { binUnits, binOrders, price, retailNet, retailUnits, retailOrders, mixed }) {
  const f = SCALE[st], bu = Math.round(binUnits * f);
  const side = (net, units, orders) => ({
    net, units, orders,
    avgCart: orders > 0 ? r2(net / orders) : 0,
    avgItems: orders > 0 ? Math.round(units / orders * 10) / 10 : 0,
    asp: units > 0 ? r2(net / units) : 0,
  });
  return {
    retail: side(r2(retailNet * f), Math.round(retailUnits * f), Math.round(retailOrders * f)),
    bin: side(r2(bu * price), bu, Math.round(binOrders * f)),
    mixed: Math.round(mixed * f),
  };
}
// BL2's Friday is the screenshot's South Bend card: 413 units at $12 over 97 orders.
const PHASES = {
  FRI:  { binUnits: 413, binOrders: 97,  price: 12, retailNet: 2105.50, retailUnits: 610, retailOrders: 140, mixed: 25 },
  MON1: { binUnits: 500, binOrders: 70,  price: 2,  retailNet: 400.00,  retailUnits: 130, retailOrders: 60,  mixed: 10 },
  MON2: { binUnits: 726, binOrders: 101, price: 2,  retailNet: 630.41,  retailUnits: 192, retailOrders: 80,  mixed: 12 },
  MON3: { binUnits: 900, binOrders: 130, price: 2,  retailNet: 800.10,  retailUnits: 250, retailOrders: 95,  mixed: 15 },
};
const LIVE = {};                                   // phase → store → ?store= payload
const CH = {};                                     // phase → store → channels
for (const [ph, p] of Object.entries(PHASES)) {
  LIVE[ph] = {}; CH[ph] = {};
  for (const st of STORES) {
    const ch = split(st, p);
    CH[ph][st] = ch;
    const orders = ch.retail.orders + ch.bin.orders - ch.mixed;
    LIVE[ph][st] = {
      elements: [], refundCents: 0, binNet: ch.bin.net, retailNet: ch.retail.net, channels: ch,
      // The item pipeline's split IS the dollar split (worker.js ?store= handler). The
      // averages here are the daily_sales ones, retail-weighted — made absurd, so a tile
      // that ever shows them says so.
      aggregate: { total: r2(ch.retail.net + ch.bin.net), retail: ch.retail.net, bin: ch.bin.net,
                   orderCount: orders, avgCart: 77.77, avgItems: 7.7, avgTxnSec: 60, avgASP: 66.66 },
    };
  }
}

// Stored days: D1 history (the dollars) and ?action=channel-range (the split) agree, as the
// nightly job makes them. Bin marks down through the week like the real stores' bins do.
const noon = (s) => new Date(s + 'T12:00:00Z');
const shift = (s, n) => new Date(noon(s).getTime() + n * 86400000).toISOString().slice(0, 10);
const PRICE_BY_DOW = { 5: 12, 6: 6, 0: 4, 1: 2, 2: 1, 3: 0.5, 4: 0 };
const pastSplit = (st, d) => {
  const price = PRICE_BY_DOW[noon(d).getUTCDay()], day = Number(d.slice(8));
  return split(st, { binUnits: price ? 300 + day : 0, binOrders: price ? 60 + day % 7 : 0, price,
                     retailNet: 1500 + day * 3.17, retailUnits: 400 + day, retailOrders: 120 + day % 5,
                     mixed: price ? 8 : 0 });
};
const DATES = [];
for (let i = -40; i <= 40; i++) DATES.push(shift(MON, i));
const HIST = {}, PAST = {};                        // store → date → row / split
for (const st of STORES) {
  HIST[st] = {}; PAST[st] = {};
  let week = 100;
  for (const d of DATES) {
    if (noon(d).getUTCDay() === 0 && d !== DATES[0]) week++;
    const ch = pastSplit(st, d);
    PAST[st][d] = ch;
    const total = r2(ch.retail.net + ch.bin.net);
    HIST[st][d] = { week, budget: r2(5000 * SCALE[st]), total, retail: ch.retail.net, bin: ch.bin.net,
                    auction: 0, laborPct: 10, orderCount: ch.retail.orders + ch.bin.orders - ch.mixed,
                    avgCart: 55.55, avgItems: 5.5, avgTxnSec: 60, avgASP: 44.44 };
  }
}

// ── What the tiles must read ────────────────────────────────────────────────
const money = (n) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const add = (a, b) => ({
  retail: { net: r2(a.retail.net + b.retail.net), units: a.retail.units + b.retail.units, orders: a.retail.orders + b.retail.orders },
  bin:    { net: r2(a.bin.net + b.bin.net),       units: a.bin.units + b.bin.units,       orders: a.bin.orders + b.bin.orders },
  mixed: a.mixed + b.mixed,
});
const ZERO = { retail: { net: 0, units: 0, orders: 0 }, bin: { net: 0, units: 0, orders: 0 }, mixed: 0 };
const sumStores = (per) => STORES.reduce((t, st) => add(t, per[st]), ZERO);
// channel → { net, units, orders }; null = combined retail + bin
const pick = (t, ch) => ch ? t[ch] : {
  net: r2(t.retail.net + t.bin.net), units: t.retail.units + t.bin.units,
  orders: t.retail.orders + t.bin.orders - t.mixed,
};
// Card tiles format with toFixed; the hero's with fmtDollar. Both exactly as index.html does.
const cardWant = (x) => ({
  cart: '$' + (x.net / x.orders).toFixed(2), items: (x.units / x.orders).toFixed(1),
  orders: x.orders.toLocaleString('en-US'), asp: '$' + (x.net / x.units).toFixed(2),
});
const heroWant = (x) => ({
  cart: money(x.net / x.orders), items: (x.units / x.orders).toFixed(1),
  orders: x.orders.toLocaleString('en-US'), asp: money(x.net / x.units),
});

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL ' + m); } };

// ── Page helpers ────────────────────────────────────────────────────────────
function stub({ HIST, LIVE, PAST, dark, live, hold }) {
  try {
    localStorage.setItem('darkMode', String(dark));
    localStorage.setItem('dashHeroExpanded', '1');       // the hero's Matrix is on screen
    localStorage.setItem('coachTipsDisabled', '1');      // no coach marks over the tiles
  } catch (e) {}
  const api = window.__api = { live, hold: !!hold, failRange: false, held: [], log: [] };
  const J = (x) => new Response(JSON.stringify(x), { status: 200, headers: { 'content-type': 'application/json' } });
  const sumRange = (st, from, to) => {
    const o = { retail: { net: 0, units: 0, orders: 0 }, bin: { net: 0, units: 0, orders: 0 },
                mixed: 0, combinedOrders: 0, daysWithData: 0, daysEstimated: 0 };
    for (const [d, ch] of Object.entries(PAST[st] || {})) {
      if (d < from || d > to) continue;
      for (const k of ['retail', 'bin']) for (const f of ['net', 'units', 'orders']) o[k][f] += ch[k][f];
      o.mixed += ch.mixed; o.combinedOrders += ch.retail.orders + ch.bin.orders - ch.mixed; o.daysWithData++;
    }
    o.retail.net = Math.round(o.retail.net * 100) / 100; o.bin.net = Math.round(o.bin.net * 100) / 100;
    return o;
  };
  window.fetch = async (u) => {
    const s = String(u);
    const q = new URL(s, location.href).searchParams;
    const st = (q.get('store') || '').toUpperCase();
    api.log.push(s);
    if (s.includes('auth-me')) {
      return J({ authenticated: true, email: 'a@b.com', name: 'Admin', role: 'admin',
                 stores: null, pages: {}, businesses: ['bl'] });
    }
    if (q.get('history_d1') === 'true') return J(HIST[st] || {});
    if (q.get('action') === 'channel-range') {
      if (api.failRange) return new Response('{"error":"boom"}', { status: 500, headers: { 'content-type': 'application/json' } });
      return J(sumRange(st, q.get('from'), q.get('to')));
    }
    // The old client's fallback for today's split. Answers what the worker would, so a
    // client still calling it is caught by the request log, not by a wrong number.
    if (q.get('action') === 'items') return J({ store: st, channels: LIVE[api.live][st]?.channels || null });
    if (!q.get('action') && q.get('since') && st) {
      const body = LIVE[api.live][st] || {};
      if (!api.hold) return J(body);
      return new Promise(res => api.held.push(() => res(J(body))));
    }
    return J({});
  };
}

async function openDash(b, { scheme, time, live, hold = false }) {
  const ctx = await b.newContext({ timezoneId: TZ, viewport: { width: 1400, height: 1400 }, colorScheme: scheme });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.clock.setFixedTime(time);
  await page.addInitScript(stub, { HIST, LIVE, PAST, dark: scheme === 'dark', live, hold });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
  return { ctx, page, errs };
}

const card = (st) => `#store-cards [data-store-code="${st}"]`;
const readCard = (page, st) => page.evaluate((sel) => {
  const c = document.querySelector(sel);
  if (!c) return null;
  const t = (q) => (c.querySelector(q)?.textContent || '').trim();
  return {
    bin: t('[data-ch="bin"] > div:nth-child(2)'), retail: t('[data-ch="retail"] > div:nth-child(2)'),
    binOn: !!c.querySelector('[data-ch="bin"]')?.classList.contains('ring-1'),
    cart: t('[data-mx="cart"]'), items: t('[data-mx="items"]'), orders: t('[data-mx="orders"]'), asp: t('[data-mx="asp"]'),
  };
}, card(st));
const readHero = (page) => page.evaluate(() => {
  const t = (id) => (document.getElementById(id)?.textContent || '').trim();
  return { label: t('dash-matrix-label'), bin: t('cm-bin-val'),
           cart: t('mx-cart'), items: t('mx-items'), orders: t('mx-orders'), asp: t('mx-asp') };
});
async function until(page, fn, arg, what, timeout = 8000) {
  try { await page.waitForFunction(fn, arg, { timeout }); return true; }
  catch { ok(false, `timed out waiting for ${what}`); return false; }
}
const cardShows = (page, st, binText) => until(page, ({ sel, binText }) => {
  const e = document.querySelector(sel + ' [data-ch="bin"] > div:nth-child(2)');
  return e && e.textContent.trim() === binText;
}, { sel: card(st), binText }, `${st}'s BIN tile to read ${binText}`);
// Tap a card's BIN tile until it is in the wanted state. A real click, not the handler: the
// tile has to be on screen and on top to count.
async function setCardBin(page, st, on) {
  for (let i = 0; i < 2; i++) {
    if ((await readCard(page, st)).binOn === on) return;
    await page.click(card(st) + ' [data-ch="bin"]');
  }
  ok((await readCard(page, st)).binOn === on, `${st}'s BIN tile is ${on ? '' : 'not '}selected`);
}
async function setHeroBin(page, on) {
  for (let i = 0; i < 2; i++) {
    if ((await readHero(page)).label.endsWith('· BIN') === on) return;
    await page.click('#cm-bin-col');
  }
  ok((await readHero(page)).label.endsWith('· BIN') === on, `the hero's BIN is ${on ? '' : 'not '}selected`);
}
const same = (got, want) => ['cart', 'items', 'orders', 'asp'].every(k => got[k] === want[k]);
const fmt4 = (x) => `CART ${x.cart}  ITEMS ${x.items}  ORDERS ${x.orders}  ASP ${x.asp}`;
// 🔑 The invariant the screenshot broke, checked from the RENDERED text alone: the matrix
// multiplies back to the dollars beside it. Rounding CART to the cent moves the product by at
// most half a cent an order.
const tiesBack = (c) => {
  const cart = Number(c.cart.replace(/[$,]/g, '')), orders = Number(c.orders.replace(/,/g, ''));
  const bin = Number(c.bin.replace(/[$,]/g, ''));
  return Math.abs(cart * orders - bin) <= orders * 0.005 + 1e-9;
};
const itemsRequested = (page) => page.evaluate(() => window.__api.log.filter(u => /[?&]action=items(&|$)/.test(u)).length);
const rangeRequests = (page) => page.evaluate(() => window.__api.log.filter(u => /action=channel-range/.test(u)).length);
const refresh = async (page) => {
  await page.click('#dash-refresh-btn');
  await page.waitForSelector(card('BL2'), { timeout: 8000 });   // D1 rows landed, cards rebuilt
};
const release = (page) => page.evaluate(() => { window.__api.hold = false; window.__api.held.splice(0).forEach(f => f()); });

const b = await chromium.launch({ executablePath: CHROME });

for (const scheme of ['light', 'dark']) {
  console.log(`\n── ${scheme} ──`);

  // ── A. A cold load: the split waits for the live payload the dollars wait for ──
  {
    // Clover held from the first request: the D1 rows paint the cards before it answers.
    const { ctx, page, errs } = await openDash(b, { scheme, time: at(MON, '11:00'), live: 'MON1', hold: true });
    await page.waitForSelector(card('BL2'), { timeout: 30000 });
    ok(await page.evaluate(() => window.__api.held.length) === STORES.length,
       `A: all ${STORES.length} live fetches are being held (${await page.evaluate(() => window.__api.held.length)})`);
    ok(await page.evaluate(() => document.documentElement.classList.contains('dark')) === (scheme === 'dark'),
       `A: the ${scheme} theme applied`);
    await setCardBin(page, 'BL2', true);
    const pending = await readCard(page, 'BL2');
    ok(pending.cart === '…' && pending.orders === '…',
       `A: with the live fetch still out, BL2's BIN tiles wait ("…"), got ${fmt4(pending)}`);
    await release(page);
    await cardShows(page, 'BL2', money(CH.MON1.BL2.bin.net));
    const c = await readCard(page, 'BL2');
    const want = cardWant(CH.MON1.BL2.bin);
    ok(same(c, want), `A: BL2 BIN is the payload's bin split — want ${fmt4(want)}, got ${fmt4(c)}`);
    ok(tiesBack(c), `A: CART × ORDERS comes back to the BIN tile (${c.cart} × ${c.orders} vs ${c.bin})`);
    await setCardBin(page, 'BL2', false);
    const u = await readCard(page, 'BL2');
    const wantU = cardWant(pick(CH.MON1.BL2, null));
    ok(same(u, wantU), `A: BL2 unfiltered is retail + bin as one population — want ${fmt4(wantU)}, got ${fmt4(u)}`);
    await setHeroBin(page, true);
    const h = await readHero(page);
    const wantH = heroWant(sumStores(CH.MON1).bin);
    ok(same(h, wantH), `A: the hero's BIN is the five payloads' bin, summed — want ${fmt4(wantH)}, got ${fmt4(h)}`);
    ok(await itemsRequested(page) === 0,
       `A: ?action=items is never requested — today's split rides on the live fetch (${await itemsRequested(page)} requests)`);
    ok(errs.length === 0, 'A: no page errors: ' + errs.join(' | '));

    // ── B. ↻ later the same day: the tiles follow the dollars ─────────────────
    await setCardBin(page, 'BL2', true);
    await page.evaluate(() => { window.__api.live = 'MON2'; });
    await page.clock.setFixedTime(at(MON, '14:12'));
    await refresh(page);
    await cardShows(page, 'BL2', money(CH.MON2.BL2.bin.net));
    const c2 = await readCard(page, 'BL2');
    const want2 = cardWant(CH.MON2.BL2.bin), stale2 = cardWant(CH.MON1.BL2.bin);
    ok(same(c2, want2), `B: after ↻, BL2 BIN is the NEW payload's split — want ${fmt4(want2)}, got ${fmt4(c2)}`
       + (same(c2, stale2) ? '  ← the first load\'s split, still cached' : ''));
    ok(tiesBack(c2), `B: CART × ORDERS comes back to the BIN tile (${c2.cart} × ${c2.orders} vs ${c2.bin})`);
    const h2 = await readHero(page);
    const wantH2 = heroWant(sumStores(CH.MON2).bin);
    ok(same(h2, wantH2), `B: after ↻, the hero's BIN follows too — want ${fmt4(wantH2)}, got ${fmt4(h2)}`);
    ok(errs.length === 0, 'B: no page errors: ' + errs.join(' | '));
    await ctx.close();
  }

  // ── C. Friday's page, ↻ on Monday: the screenshot ─────────────────────────
  {
    const { ctx, page, errs } = await openDash(b, { scheme, time: at(FRI, '13:30'), live: 'FRI' });
    await page.waitForSelector(card('BL2'), { timeout: 30000 });
    await cardShows(page, 'BL2', money(CH.FRI.BL2.bin.net));
    const TAPPED = ['BL1', 'BL2', 'BL4'];            // the screenshot's three cards
    for (const st of TAPPED) await setCardBin(page, st, true);
    const f = await readCard(page, 'BL2');
    ok(same(f, cardWant(CH.FRI.BL2.bin)), `C: on Friday, Friday's split is right — ${fmt4(f)}`);
    await setHeroBin(page, true);

    // Monday. The D1 rows answer at once; Clover is held, as it is slower in production.
    await page.clock.setFixedTime(at(MON, '14:12'));
    await page.evaluate(() => { window.__api.live = 'MON2'; window.__api.hold = true; });
    await refresh(page);
    const mid = await readCard(page, 'BL2');
    ok(mid.bin !== money(CH.FRI.BL2.bin.net),
       `C: with Monday's live fetch still out, BL2's BIN tile does not show Friday's ${money(CH.FRI.BL2.bin.net)}, got ${mid.bin}`);
    ok(mid.cart === '…' && mid.asp === '…',
       `C: …and the BIN matrix waits for Monday's payload instead of Friday's, got ${fmt4(mid)}`);
    const midH = await readHero(page);
    ok(midH.cart === '…' && midH.asp === '…', `C: the hero waits too, got ${fmt4(midH)}`);

    await release(page);
    await cardShows(page, 'BL2', money(CH.MON2.BL2.bin.net));
    const c = await readCard(page, 'BL2');
    const want = cardWant(CH.MON2.BL2.bin), friday = cardWant(CH.FRI.BL2.bin);
    ok(same(c, want), `C: BL2 BIN is Monday's split — want ${fmt4(want)}, got ${fmt4(c)}`
       + (same(c, friday) ? '  ← FRIDAY\'S split: the screenshot' : ''));
    ok(c.asp === '$2.00', `C: a $2 bin day reads ASP $2.00, got ${c.asp}`);
    ok(tiesBack(c), `C: CART × ORDERS comes back to the BIN tile (${c.cart} × ${c.orders} vs ${c.bin})`);
    for (const st of TAPPED) {
      const x = await readCard(page, st);
      ok(x.binOn && same(x, cardWant(CH.MON2[st].bin)) && tiesBack(x),
         `C: ${st}, BIN still on, shows Monday's split — want ${fmt4(cardWant(CH.MON2[st].bin))}, got ${fmt4(x)}`);
    }
    const h = await readHero(page);
    const wantH = heroWant(sumStores(CH.MON2).bin);
    ok(same(h, wantH), `C: the hero's BIN is Monday's, summed — want ${fmt4(wantH)}, got ${fmt4(h)}`);

    // ── D. A range with stored days in it: the past half is fetched once, today's is live ──
    await page.evaluate(() => window.setDateRange('thisWeek'));
    const pastBL2 = PAST.BL2[SUN];
    await cardShows(page, 'BL2', money(r2(pastBL2.bin.net + CH.MON2.BL2.bin.net)));
    const d = await readCard(page, 'BL2');
    const wantD = cardWant(add(pastBL2, CH.MON2.BL2).bin);
    ok(same(d, wantD), `D: This Week's BIN is Sunday's stored split + Monday's live one — want ${fmt4(wantD)}, got ${fmt4(d)}`);
    ok(tiesBack(d), `D: CART × ORDERS comes back to the BIN tile (${d.cart} × ${d.orders} vs ${d.bin})`);
    const hD = await readHero(page);
    const pastAll = sumStores(Object.fromEntries(STORES.map(st => [st, PAST[st][SUN]])));
    const wantHD = heroWant(add(pastAll, sumStores(CH.MON2)).bin);
    ok(same(hD, wantHD), `D: the hero's This Week BIN — want ${fmt4(wantHD)}, got ${fmt4(hD)}`);

    const before = await rangeRequests(page);
    await page.evaluate(() => { window.__api.live = 'MON3'; });
    await page.clock.setFixedTime(at(MON, '16:00'));
    await refresh(page);
    await cardShows(page, 'BL2', money(r2(pastBL2.bin.net + CH.MON3.BL2.bin.net)));
    const d2 = await readCard(page, 'BL2');
    const wantD2 = cardWant(add(pastBL2, CH.MON3.BL2).bin);
    ok(same(d2, wantD2), `D: after ↻, today's half moves and Sunday's stays — want ${fmt4(wantD2)}, got ${fmt4(d2)}`);
    ok(tiesBack(d2), `D: CART × ORDERS comes back to the BIN tile (${d2.cart} × ${d2.orders} vs ${d2.bin})`);
    ok(await rangeRequests(page) === before,
       `D: ↻ does not re-read the stored days (${before} → ${await rangeRequests(page)} channel-range requests)`);
    ok(await itemsRequested(page) === 0, `C/D: ?action=items is never requested (${await itemsRequested(page)})`);
    ok(errs.length === 0, 'C/D: no page errors: ' + errs.join(' | '));
    await ctx.close();
  }

  // ── E. The stored days fail to load: "—", not today's split under This Week's label ──
  {
    const { ctx, page, errs } = await openDash(b, { scheme, time: at(MON, '14:12'), live: 'MON2' });
    await page.waitForSelector(card('BL2'), { timeout: 30000 });
    await cardShows(page, 'BL2', money(CH.MON2.BL2.bin.net));
    await setCardBin(page, 'BL2', true);
    await setHeroBin(page, true);
    await page.evaluate(() => { window.__api.failRange = true; });
    await page.evaluate(() => window.setDateRange('thisWeek'));
    const pastBL2 = PAST.BL2[SUN];
    await cardShows(page, 'BL2', money(r2(pastBL2.bin.net + CH.MON2.BL2.bin.net)));
    await page.waitForTimeout(300);                  // the failed request settles
    const e = await readCard(page, 'BL2');
    const todayOnly = cardWant(CH.MON2.BL2.bin);
    ok(e.cart === '—' && e.items === '—' && e.orders === '—' && e.asp === '—',
       `E: with Sunday unreadable, BL2's This Week BIN reads "—", got ${fmt4(e)}`
       + (same(e, todayOnly) ? '  ← TODAY\'S split under This Week\'s label' : ''));
    const eh = await readHero(page);
    ok(eh.cart === '—' && eh.asp === '—', `E: …and so does the hero's, got ${fmt4(eh)}`);

    // The failure is not cached: once the endpoint answers, ↻ gets the real split.
    await page.evaluate(() => { window.__api.failRange = false; });
    await refresh(page);
    await cardShows(page, 'BL2', money(r2(pastBL2.bin.net + CH.MON2.BL2.bin.net)));
    await until(page, (sel) => (document.querySelector(sel + ' [data-mx="asp"]')?.textContent || '').trim().startsWith('$'),
                card('BL2'), "BL2's ASP to fill after ↻");
    const e2 = await readCard(page, 'BL2');
    const wantE = cardWant(add(pastBL2, CH.MON2.BL2).bin);
    ok(same(e2, wantE), `E: after ↻ the stored days load — want ${fmt4(wantE)}, got ${fmt4(e2)}`);
    ok(tiesBack(e2), `E: CART × ORDERS comes back to the BIN tile (${e2.cart} × ${e2.orders} vs ${e2.bin})`);
    const eh2 = await readHero(page);
    const pastAll = sumStores(Object.fromEntries(STORES.map(st => [st, PAST[st][SUN]])));
    const wantHE = heroWant(add(pastAll, sumStores(CH.MON2)).bin);
    ok(same(eh2, wantHE), `E: and the hero's — want ${fmt4(wantHE)}, got ${fmt4(eh2)}`);
    // The failed request is caught by the loader, not left as an uncaught rejection.
    ok(errs.length === 0, 'E: no page errors: ' + errs.join(' | '));
    await ctx.close();
  }
}

await b.close(); srv.close();
console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
