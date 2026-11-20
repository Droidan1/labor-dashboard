// The sale scheduler, driven through the REAL entry points: worker.scheduled() for the
// every-minute cron and worker.fetch() for ?action=schedule-sale / cancel-sale-schedule.
// Only Clover is faked, as an in-memory catalogue per store behind globalThis.fetch.
//
// 🔑 WHY. The 2026-10-14 furniture flash sale left 17 BL1 items at 30% off, renamed
// "SALE … (was $X Flash Sale)", for 36 days (restored 2026-11-19):
//   • up to 50 rows fired at Clover at once, so Clover answered 429;
//   • any error was terminal (status 'error'): no retry, no alert, so a failed REVERT
//     left the markdown on the register for good;
//   • a 503 that Clover applied anyway recorded no original price;
//   • the multi-store schedule sent BL1's item ids to every store, so the other five 404'd.
// Each case below reproduces one of those against the shipped worker.js.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, applyMigrationAlters, req } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const worker = await loadWorker(repo);
const STORES = ['BL1', 'BL2', 'BL4', 'BL14', 'BL16'];

// ── Fake Clover ─────────────────────────────────────────────────────────────
// catalogue[store] = Map<id, {id, name, code, price (cents), hidden}>
function makeClover() {
  const c = {
    catalogue: Object.fromEntries(STORES.map(s => [s, new Map()])),
    inFlight: 0, maxInFlight: 0, posts: [], gets: 0,
    limitConcurrent: Infinity,      // > this many at once → 429, like a rate limit
    down: false,                    // every call 503s
    postAppliedThen503: new Set(),  // `${store}/${id}`: apply the POST, then answer 503
    beforePostReturn: null,         // async (store, id, body) — hook for overlapping ticks
    catalogueFails: new Set(),      // stores whose catalogue read 503s
  };
  const storeOf = (mId) => mId.replace(/^M/, '');
  const J = (status, x) => new Response(JSON.stringify(x), { status, headers: { 'content-type': 'application/json' } });
  c.fetch = async (u, opts = {}) => {
    const url = new URL(String(u));
    if (url.hostname !== 'api.clover.com') throw new Error('outbound fetch blocked in test: ' + url.href.slice(0, 80));
    const m = url.pathname.match(/^\/v3\/merchants\/([^/]+)\/items(?:\/([^/]+))?$/);
    if (!m) throw new Error('unexpected Clover call ' + url.pathname);
    const store = storeOf(m[1]), id = m[2], cat = c.catalogue[store];
    c.inFlight++; c.maxInFlight = Math.max(c.maxInFlight, c.inFlight);
    try {
      await new Promise(r => setTimeout(r, 2));
      if (c.inFlight > c.limitConcurrent) return J(429, { message: '429 Too Many Requests' });
      if (c.down) return J(503, { message: 'unavailable' });
      if (!id) {                                    // catalogue page
        if (c.catalogueFails.has(store)) return J(503, { message: 'unavailable' });
        const off = Number(url.searchParams.get('offset') || 0), lim = Number(url.searchParams.get('limit') || 100);
        return J(200, { elements: [...cat.values()].slice(off, off + lim) });
      }
      const it = cat.get(id);
      if (!it) return J(404, { message: 'Not found' });
      if ((opts.method || 'GET') === 'POST') {
        const body = JSON.parse(opts.body || '{}');
        Object.assign(it, body);
        c.posts.push({ store, id, ...body });
        if (c.beforePostReturn) await c.beforePostReturn(store, id, body);
        if (c.postAppliedThen503.has(`${store}/${id}`)) { c.postAppliedThen503.delete(`${store}/${id}`); return J(503, { message: 'unavailable' }); }
        return J(200, it);
      }
      c.gets++;
      return J(200, it);
    } finally { c.inFlight--; }
  };
  return c;
}

function setup() {
  const { db, env } = makeEnv(repo);
  db.exec(fs.readFileSync(path.join(repo, 'migration-002.sql'), 'utf8'));
  applyMigrationAlters(db, repo);
  for (const s of STORES) { env[`${s}_MERCHANT_ID`] = `M${s}`; env[`${s}_API_TOKEN`] = `T${s}`; }
  const clover = makeClover();
  globalThis.fetch = clover.fetch;
  return { db, env, clover };
}

const iso = (msFromNow) => new Date(Date.now() + msFromNow).toISOString();
function addRow(db, { store = 'BL1', id, name = 'Item', kind = 'percent', value = 30, label = 'Flash Sale',
                     startsAt = iso(-60e3), endsAt = iso(3600e3), status = 'pending', group = 'g1',
                     originalPrice = null, salePrice = null, originalName = null }) {
  db.prepare(`INSERT INTO sale_schedules (schedule_group,store,item_id,item_name,discount_kind,discount_value,sale_label,
              starts_at,ends_at,status,original_price,sale_price,original_name,created_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(group, store, id, name, kind, value, label, startsAt, endsAt, status, originalPrice, salePrice, originalName, iso(-120e3));
}
const rowOf = (db, store, id) => db.prepare('SELECT * FROM sale_schedules WHERE store=? AND item_id=?').get(store, id);

// One cron tick through the real handler. Every waitUntil is awaited, so the tick is done.
async function tick(env) {
  const ps = [];
  await worker.scheduled({ cron: '* * * * *', scheduledTime: Date.now() }, env, { waitUntil: p => ps.push(p), passThroughOnException() {} });
  await Promise.allSettled(ps);
}

// The scheduler's alert line, read off console.error.
const alerts = [];
const realErr = console.error;
console.error = (...a) => { const s = a.map(String).join(' '); if (s.includes('sale_scheduler_alert')) alerts.push(s); };
const realLog = console.log;
const quiet = (on) => { console.log = on ? (...a) => { const s = a.join(' '); if (s.startsWith('  FAIL')) realLog(...a); } : realLog; };

// ── 1. A burst stays inside Clover's rate limit ─────────────────────────────
{
  realLog('── A 40-item sale starts without a burst of 429s ──');
  const { db, env, clover } = setup();
  clover.limitConcurrent = 3;
  for (let i = 0; i < 40; i++) {
    const id = `ITEM${String(i).padStart(3, '0')}`;
    clover.catalogue.BL1.set(id, { id, name: `Chair ${i}`, code: `BL-50252-${100 + i}`, price: 10000, hidden: false });
    addRow(db, { id, name: `Chair ${i}` });
  }
  quiet(true); await tick(env); quiet(false);
  const rows = db.prepare('SELECT status, COUNT(*) n FROM sale_schedules GROUP BY status').all();
  eq(rows.map(r => `${r.status}:${r.n}`).join(','), 'active:40', 'all 40 rows are active after one tick');
  ok(clover.maxInFlight <= 2, `🔑 at most 2 Clover calls in flight at once (saw ${clover.maxInFlight})`);
  ok([...clover.catalogue.BL1.values()].every(it => it.price === 7000), 'every item is at 30% off, once');
}

// ── 2. A revert that fails is retried, not abandoned ────────────────────────
{
  realLog('── A revert that hits a Clover outage is retried next minute ──');
  const { db, env, clover } = setup();
  clover.catalogue.BL1.set('R1', { id: 'R1', name: 'SALE Sofa (was $400.00 Flash Sale)', code: 'BL-50417-400', price: 28000, hidden: false });
  addRow(db, { id: 'R1', name: 'Sofa', status: 'active', startsAt: iso(-7200e3), endsAt: iso(-30e3),
               originalPrice: 40000, salePrice: 28000, originalName: 'Sofa' });
  clover.down = true;
  quiet(true); await tick(env); quiet(false);
  eq(rowOf(db, 'BL1', 'R1').status, 'active', '🔑 after a failed revert the row is still waiting to revert, not "error"');
  clover.down = false;
  quiet(true); await tick(env); quiet(false);
  const it = clover.catalogue.BL1.get('R1');
  eq(rowOf(db, 'BL1', 'R1').status, 'completed', 'the next tick completes it');
  eq(it.price, 40000, 'and the price is back to $400');
  eq(it.name, 'Sofa', 'and the SALE name is gone');
}

// ── 3. A 503 that Clover applied anyway is not a lost sale ─────────────────
{
  realLog('── A start that Clover applied but answered 503 ──');
  const { db, env, clover } = setup();
  clover.catalogue.BL1.set('P1', { id: 'P1', name: 'Table', code: 'BL-50251-39', price: 3999, hidden: false });
  addRow(db, { id: 'P1', name: 'Table', endsAt: iso(120e3) });
  clover.postAppliedThen503.add('BL1/P1');
  quiet(true); await tick(env); quiet(false);
  const r1 = rowOf(db, 'BL1', 'P1');
  eq(r1.original_price, 3999, '🔑 the original price is on record even though the write answered 503');
  ok(r1.status === 'pending' || r1.status === 'active', `the row is not abandoned as "error" (status ${r1.status})`);
  quiet(true); await tick(env); quiet(false);
  eq(rowOf(db, 'BL1', 'P1').status, 'active', 'the next tick sees the sale price on the register and marks it active');
  eq(clover.catalogue.BL1.get('P1').price, 2799, '🔑 30% off ONCE — not taken again off the already-discounted price');
  db.prepare("UPDATE sale_schedules SET ends_at=? WHERE item_id='P1'").run(iso(-1000));
  quiet(true); await tick(env); quiet(false);
  eq(clover.catalogue.BL1.get('P1').price, 3999, 'and at the end it goes back to $39.99');
  eq(clover.catalogue.BL1.get('P1').name, 'Table', 'with its own name');
}

// ── 4. Two ticks at once cannot discount twice ──────────────────────────────
{
  realLog('── Two overlapping ticks ──');
  const { db, env, clover } = setup();
  clover.catalogue.BL1.set('O1', { id: 'O1', name: 'Lamp', code: 'BL-1-100', price: 10000, hidden: false });
  addRow(db, { id: 'O1', name: 'Lamp' });
  let second = null;
  // The moment the first tick's write lands, a second tick runs start to finish
  // before the first one has marked the row active.
  clover.beforePostReturn = async () => {
    if (second) return;
    second = tick(env);
    await second;
  };
  quiet(true); await tick(env); quiet(false);
  clover.beforePostReturn = null;
  eq(clover.catalogue.BL1.get('O1').price, 7000, '🔑 the lamp is $70, not $49');
  const r = rowOf(db, 'BL1', 'O1');
  eq(`${r.original_price}/${r.sale_price}`, '10000/7000', 'the row records $100 → $70');
}

// ── 5. A price changed mid-sale is left alone, and someone is told ──────────
{
  realLog('── A price someone changed during the sale ──');
  const { db, env, clover } = setup();
  clover.catalogue.BL1.set('D1', { id: 'D1', name: 'SALE Desk (was $100.00 Flash Sale)', code: 'BL-1-1', price: 5500, hidden: false });
  addRow(db, { id: 'D1', name: 'Desk', status: 'active', startsAt: iso(-7200e3), endsAt: iso(-30e3),
               originalPrice: 10000, salePrice: 7000, originalName: 'Desk' });
  alerts.length = 0;
  quiet(true); await tick(env); quiet(false);
  eq(rowOf(db, 'BL1', 'D1').status, 'error', 'the row is flagged');
  eq(clover.catalogue.BL1.get('D1').price, 5500, 'the price someone set is not overwritten');
  ok(alerts.length === 1 && /D1|Desk/.test(alerts[0]), `🔑 superusers are alerted, naming the item (${alerts.length} alert(s))`);
  addRow(db, { id: 'D2', name: 'Desk 2', status: 'active', startsAt: iso(-7200e3), endsAt: iso(-30e3),
               originalPrice: 10000, salePrice: 7000, originalName: 'Desk 2', group: 'g2' });
  clover.catalogue.BL1.set('D2', { id: 'D2', name: 'Desk 2', code: 'BL-1-2', price: 5000, hidden: false });
  quiet(true); await tick(env); quiet(false);
  eq(alerts.length, 1, 'a second problem within the hour does not alert again');
}

// ── 6. A window that ended before the sale could start ──────────────────────
{
  realLog('── A sale whose window passed before it could start ──');
  const { db, env, clover } = setup();
  clover.catalogue.BL1.set('W1', { id: 'W1', name: 'Rug', code: 'BL-1-3', price: 5000, hidden: false });
  addRow(db, { id: 'W1', name: 'Rug', startsAt: iso(-7200e3), endsAt: iso(-60e3) });
  quiet(true); await tick(env); quiet(false);
  eq(clover.posts.length, 0, 'nothing is written to Clover');
  eq(clover.catalogue.BL1.get('W1').price, 5000, 'the price is untouched');
  ok(/ended/i.test(rowOf(db, 'BL1', 'W1').error_msg || ''), `the row says the window ended (${rowOf(db, 'BL1', 'W1').error_msg})`);
}

// ── 7. Cancelling a running sale goes through the same careful revert ───────
{
  realLog('── Cancel during an outage ──');
  const { db, env, clover } = setup();
  clover.catalogue.BL1.set('C1', { id: 'C1', name: 'SALE Bed (was $300.00 Flash Sale)', code: 'BL-1-4', price: 21000, hidden: false });
  addRow(db, { id: 'C1', name: 'Bed', status: 'active', startsAt: iso(-600e3), endsAt: iso(3600e3),
               originalPrice: 30000, salePrice: 21000, originalName: 'Bed', group: 'gc' });
  clover.down = true;
  quiet(true);
  const res = await worker.fetch(req('/?action=cancel-sale-schedule', { user: 'u-admin', method: 'POST', body: { scheduleGroup: 'gc' } }), env, { waitUntil() {}, passThroughOnException() {} });
  quiet(false);
  eq(res.status, 200, 'cancel answers 200');
  ok(rowOf(db, 'BL1', 'C1').status !== 'error', `🔑 a cancel that cannot reach Clover is not left as "error" (${rowOf(db, 'BL1', 'C1').status})`);
  clover.down = false;
  quiet(true); await tick(env); quiet(false);
  eq(clover.catalogue.BL1.get('C1').price, 30000, 'the next tick finishes the cancel: $300');
  eq(rowOf(db, 'BL1', 'C1').status, 'completed', 'and the row is completed');
}

// ── 8. Scheduling across stores: each store's own item, by code + name ───────
{
  realLog('── Scheduling a BL1 pick at BL2 ──');
  const { db, env, clover } = setup();
  const TS = 'FG BL FURNITURE - RTA - TABLES/STANDS';
  clover.catalogue.BL1.set('A1', { id: 'A1', name: TS, code: 'BL-50251-300', price: 30000, hidden: false });
  clover.catalogue.BL1.set('A2', { id: 'A2', name: TS, code: 'BL-50251-30', price: 3000, hidden: false });
  clover.catalogue.BL1.set('A4', { id: 'A4', name: 'FG BL FURNITURE - RTA - CHAIRS', code: 'BL-50252-75', price: 7500, hidden: false });
  clover.catalogue.BL2.set('B1', { id: 'B1', name: TS, code: 'BL-50251-300', price: 30000, hidden: false });
  clover.catalogue.BL2.set('B1H', { id: 'B1H', name: TS, code: 'BL-50251-300', price: 30000, hidden: true });
  clover.catalogue.BL2.set('B2', { id: 'B2', name: TS, code: 'BL-50251-30', price: 3000, hidden: false });
  clover.catalogue.BL2.set('B2X', { id: 'B2X', name: TS, sku: 'BL-50251-30', price: 3000, hidden: false });
  const items = [
    { id: 'A1', name: TS, code: 'BL-50251-300' },
    { id: 'A2', name: TS, code: 'BL-50251-30' },
    { id: 'A4', name: 'FG BL FURNITURE - RTA - CHAIRS', code: 'BL-50252-75' },
  ];
  const body = (store, extra = {}) => ({ store, sourceStore: 'BL1', items, discount: { kind: 'percent', value: 30 },
    saleLabel: 'Flash Sale', startsAt: iso(3600e3), endsAt: iso(7200e3), ...extra });
  const call = async (b) => {
    const r = await worker.fetch(req('/?action=schedule-sale', { user: 'u-admin', method: 'POST', body: b }), env, { waitUntil() {}, passThroughOnException() {} });
    return { status: r.status, j: await r.json().catch(() => ({})) };
  };

  const dry = await call(body('BL2', { dryRun: true }));
  eq(db.prepare('SELECT COUNT(*) n FROM sale_schedules').get().n, 0, '🔑 a dry run schedules nothing');
  eq((dry.j.matched || []).map(m => `${m.sourceId}->${m.id}`).join(','), 'A1->B1', 'the dry run matches BL1\'s A1 to BL2\'s visible B1');
  eq((dry.j.skipped || []).map(s => s.sourceId).sort().join(','), 'A2,A4', 'and says A2 (two matches) and A4 (none) are skipped');

  const real = await call(body('BL2'));
  eq(real.status, 200, 'scheduling BL2 answers 200');
  const ids = db.prepare("SELECT item_id FROM sale_schedules WHERE store='BL2' ORDER BY item_id").all().map(r => r.item_id).join(',');
  eq(ids, 'B1', '🔑 BL2 gets ITS OWN item id (B1), never BL1\'s A1, and nothing for the skipped two');

  const same = await call(body('BL1'));
  eq(db.prepare("SELECT COUNT(*) n FROM sale_schedules WHERE store='BL1'").get().n, 3, 'the store the items came from schedules all three');
  eq(same.j.count, 3, 'count says 3');

  // The page that is live today sends no sourceStore. An id that is not in the target store's
  // catalogue must be refused at scheduling time, not discovered as a 404 when the sale starts.
  const old = await call({ store: 'BL4', items: [{ id: 'A1', name: TS }], discount: { kind: 'percent', value: 30 },
    startsAt: iso(3600e3), endsAt: iso(7200e3) });
  eq(db.prepare("SELECT COUNT(*) n FROM sale_schedules WHERE store='BL4'").get().n, 0, '🔑 the old page\'s BL1 id is not scheduled at BL4');
  ok(old.status >= 400 || (old.j.skipped || []).length === 1, `and the answer says so (${old.status} ${JSON.stringify(old.j).slice(0, 120)})`);

  clover.catalogueFails.add('BL14');
  const blind = await call(body('BL14'));
  eq(db.prepare("SELECT COUNT(*) n FROM sale_schedules WHERE store='BL14'").get().n, 0, '🔑 a store whose catalogue cannot be read schedules nothing');
  ok(blind.status >= 400 && /catalog|read/i.test(blind.j.error || ''), `and says it could not read it (${blind.status} ${blind.j.error})`);
}

console.error = realErr;
realLog(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
