// Live sales = online auction (results feed, ?action=ingest) + Whatnot (the Whatnot API's daily rows,
// syncWhatnotDaily), summed into daily_sales.auction by projectLiveSales. The recap feeder is retired:
// its whatnot ingest is refused.
//
// What this is defending (measured in prod 2026-10-12): the column used to be
// LAST-WRITER-WINS. The auction feed overwrote it, the Sheet only filled a NULL,
// so on every day both reported, Battle Creek's Whatnot vanished — 11 days and
// ~$23.9k in Sep-Oct 2026. The column is now the SUM of the live channels,
// recomputed on every write. And the Sheet no longer writes it at all: its
// "Total NS" includes auction, so its total fallback double-counted.
//
// Everything goes through the real worker.fetch; only the platform is stubbed.
// Workers run in UTC; the Sheet's Date(y,m,d) cells are parsed as local time.
process.env.TZ = 'UTC';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, ctx, blockNetwork, req, applyMigrationAlters } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS  ' + m); } else { fail++; console.log('  FAIL  ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

blockNetwork();
const worker = await loadWorker(repo);

function setup() {
  const h = makeEnv(repo);
  h.db.exec(fs.readFileSync(path.join(repo, 'migration-015.sql'), 'utf8'));
  applyMigrationAlters(h.db, repo);
  h.env.SNAPSHOT_SECRET = 'feeder-secret';
  return h;
}
const ingest = (h, body) => worker.fetch(req('/?action=ingest', { method: 'POST', body, secret: 'feeder-secret' }), h.env, ctx);
const auctionOf = (h, store, date) => (h.db.prepare('SELECT auction FROM daily_sales WHERE store = ? AND date = ?').get(store, date) || {}).auction;

// ── 1. Two channels, same store-day: summed ─────────────────────────────────
// Whatnot's row is written by the Whatnot sync (syncWhatnotDaily, test-whatnot.mjs); here it is
// seeded as the sync leaves it, and the auction feed must ADD to it.
const seedWn = (h, store, date, total) => h.db.prepare(
  "INSERT INTO channel_sales (channel, store, date, total, count, source_file, ingested_at) VALUES ('whatnot', ?, ?, ?, 1, 'Whatnot API', 't')"
).run(store, date, total);
{
  const h = setup();
  seedWn(h, 'BL14', '2026-11-02', 3658);
  let r = await ingest(h, { channel: 'auction', rows: [{ store: 'BL14', date: '2026-11-02', total: 329.79 }] });
  eq(r.status, 200, 'auction ingest accepted');
  eq(auctionOf(h, 'BL14', '2026-11-02'), 3987.79, 'the auction feed ADDS to Whatnot instead of overwriting it');
  await ingest(h, { channel: 'auction', rows: [{ store: 'BL14', date: '2026-11-02', total: 329.79 }] });
  eq(auctionOf(h, 'BL14', '2026-11-02'), 3987.79, 're-sending the auction does not double-count');
  await ingest(h, { channel: 'auction', rows: [{ store: 'BL14', date: '2026-11-02', total: 271.79 }] });
  eq(auctionOf(h, 'BL14', '2026-11-02'), 3929.79, 'a corrected auction file replaces its own channel, keeps Whatnot');
}

// ── 1b. Whatnot comes from the Whatnot API alone: the recap feeder is refused ─
{
  const h = setup();
  seedWn(h, 'BL14', '2026-11-02', 3658);
  const before = JSON.stringify([h.db.prepare('SELECT * FROM channel_sales ORDER BY id').all(), h.db.prepare('SELECT * FROM daily_sales').all()]);
  const r = await ingest(h, { channel: 'whatnot', rows: [{ store: 'BL14', date: '2026-11-02', total: 9999 }],
    reconcile: { through: '2026-11-02', totals: { BL14: 9999 } } });
  const j = await r.json();
  eq(r.status, 410, 'a whatnot ingest (the retired recap feeder) is refused');
  eq(j.code, 'WHATNOT_FROM_API', 'and says why');
  eq(JSON.stringify([h.db.prepare('SELECT * FROM channel_sales ORDER BY id').all(), h.db.prepare('SELECT * FROM daily_sales').all()]), before, 'and writes nothing');
  const up = await ingest(h, { channel: ' WhatNot ', rows: [{ store: 'BL14', date: '2026-11-02', total: 1 }] });
  eq(up.status, 410, 'whatever its spelling');
}

// ── 2. A $0 auction day replaces a Sheet-era value; other stores are untouched ─
{
  const h = setup();
  h.db.prepare("INSERT INTO daily_sales (store, date, total, auction) VALUES ('BL1', '2026-10-05', 9281.42, 1776)").run();
  h.db.prepare("INSERT INTO daily_sales (store, date, total, auction) VALUES ('BL2', '2026-10-05', 5176.58, 412.5)").run();
  await ingest(h, { channel: 'auction', rows: [{ store: 'BL1', date: '2026-10-05', total: 0 }] });
  eq(auctionOf(h, 'BL1', '2026-10-05'), 0, 'a $0 day sets the store-day to its channels (0), not the old Sheet figure');
  eq(auctionOf(h, 'BL2', '2026-10-05'), 412.5, 'a store the file does not name keeps its value');
  eq(h.db.prepare("SELECT total FROM daily_sales WHERE store='BL1' AND date='2026-10-05'").get().total, 9281.42, 'POS total is never touched by the projection');
}

// ── 3. Manual-override rows are immutable ───────────────────────────────────
{
  const h = setup();
  h.db.prepare("INSERT INTO daily_sales (store, date, auction, is_manual_override) VALUES ('BL14', '2026-10-06', 500, 1)").run();
  await ingest(h, { channel: 'auction', rows: [{ store: 'BL14', date: '2026-10-06', total: 1200 }] });
  eq(auctionOf(h, 'BL14', '2026-10-06'), 500, 'a manual override survives a live-channel ingest');
}

// ── 4. Only live channels project; the gate still holds ─────────────────────
{
  const h = setup();
  const r = await ingest(h, { channel: 'eon', rows: [{ store: 'BL1', date: '2026-10-07', total: 99 }] });
  eq((await r.json()).projected, 0, 'a non-live channel is stored but not projected');
  eq(auctionOf(h, 'BL1', '2026-10-07'), undefined, 'and creates no daily_sales row');
  const bad = await worker.fetch(req('/?action=ingest', { method: 'POST', body: { channel: 'whatnot', rows: [] } }), h.env, ctx);
  eq(bad.status, 401, 'ingest without the feeder secret is refused');
}

// ── 5. The recap's reconcile is gone with the recap ─────────────────────────
{
  const h = setup();
  const r = await ingest(h, { channel: 'auction', rows: [{ store: 'BL2', date: '2026-10-02', total: 10 }],
    reconcile: { through: '2026-10-02', totals: { BL2: 999 } } });
  const j = await r.json();
  ok(r.status === 200 && !('reconcile' in j), `reconcile is ignored (got ${r.status}, ${JSON.stringify(j.reconcile)})`);
}

// ── 6. The Sheet import no longer writes live sales, and never counts them twice ─
{
  const h = setup();
  // A day with no Clover snapshot: total NULL, so the Sheet fills it.
  h.db.prepare("INSERT INTO daily_sales (store, date) VALUES ('BL1', '2026-09-02')").run();
  const cell = (v) => ({ v });
  const row = [];
  row[2] = cell(36); row[3] = cell('Date(2026,8,2)'); row[8] = cell(8546);
  row[17] = cell(6000); row[18] = cell(1119); row[19] = cell(941); row[20] = cell(8060);
  const gviz = { status: 'ok', table: { rows: [{ c: row }] } };
  globalThis.fetch = async (u) => {
    if (String(u).includes('docs.google.com')) return new Response('google.visualization.Query.setResponse(' + JSON.stringify(gviz) + ');');
    throw new Error('outbound fetch blocked in harness: ' + String(u).slice(0, 80));
  };
  const r = await worker.fetch(req('/?action=backfill&store=BL1', { method: 'POST', user: 'u-su' }), h.env, ctx);
  eq(r.status, 200, 'Sheet import ran');
  const d = h.db.prepare("SELECT total, auction, budget FROM daily_sales WHERE store='BL1' AND date='2026-09-02'").get();
  eq(d.budget, 8546, 'the Sheet still supplies the plan');
  eq(d.auction, null, "the Sheet's Auction NS is no longer imported");
  eq(d.total, 7119, 'the total fallback is retail + bins, not Total NS (which includes auction)');
  blockNetwork();
}

// ── 7. A row that was not stored, or has no total, never touches the column ─
{
  const h = setup();
  h.db.prepare("INSERT INTO daily_sales (store, date, total, auction) VALUES ('BL1', '2026-10-05', 9281.42, 1776)").run();
  await ingest(h, { channel: 'auction', rows: [{ store: 'BL1', date: '2026-10-05', total: 'abc' }, { store: 'BL14', date: '2026-10-05', total: 10 }] });
  eq(auctionOf(h, 'BL1', '2026-10-05'), 1776, 'a rejected row does not recompute (and wipe) the store-day');
  await ingest(h, { channel: 'auction', rows: [{ store: 'BL1', date: '2026-10-05', total: null }] });
  eq(auctionOf(h, 'BL1', '2026-10-05'), 1776, 'a row with no total does not wipe the store-day');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
