// The Live Sales business, phase 1 (migration-085 + ?action=live-sales).
//
// WHAT THIS PROTECTS. Brian (2026-10-30): live sales — the online auction AND Whatnot — become a
// business of their own; phase 1 ADDS it and moves no money. So:
//   - migration-085 seeds one business, four stores (with their own unit ids, store code in `code`)
//     and an admin grant per active admin, and re-running it writes nothing;
//   - only superuser and Live Sales grant holders reach it (no managers in phase 1);
//   - the read returns the live channels for live stores ONLY, scoped by the caller's units, with
//     `&store=` a filter inside that scope and never a way out of it;
//   - lost orders (cancelled + failed) are counted per show, and "no orders loaded" stays null;
//   - it writes nothing, and says "not set up" before the migration.
// Everything is the real worker over an in-memory D1. The figures are made up: this repo is public.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, ctx, blockNetwork, applyMigrationAlters, req } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const worker = await loadWorker(repo);
blockNetwork();
const sql = (m) => fs.readFileSync(path.join(repo, `migration-${m}.sql`), 'utf8');
const call = async (env, qs, user) => {
  const r = await worker.fetch(req('/?action=live-sales' + qs, { user }), env, ctx);
  let body = null; try { body = await r.json(); } catch (_) {}
  return { status: r.status, body };
};
const Q = '&from=2026-10-01&to=2026-10-31';

function freshEnv({ live = true } = {}) {
  const { db, env } = makeEnv(repo);
  for (const m of ['015', '031', '033', '084']) db.exec(sql(m));
  applyMigrationAlters(db, repo);
  if (live) db.exec(sql('085'));
  // The live channels across the four live stores, plus two rows that must never come back:
  // BL4 Dupont (not a live store) and a non-live channel at a live store.
  const ins = db.prepare('INSERT INTO channel_sales (channel,store,date,total,count,meta,source_file,ingested_at) VALUES (?,?,?,?,?,?,?,?)');
  ins.run('whatnot', 'BL1', '2026-10-29', 4100, 3, JSON.stringify({ items: 350, shipments: 120, new_buyers: 24 }), 'recap', '2026-10-30T10:00:00Z');
  ins.run('whatnot', 'BL14', '2026-10-29', 1200, 1, JSON.stringify({ items: 140, shipments: 55, new_buyers: 8 }), 'recap', '2026-10-30T10:00:00Z');
  ins.run('auction', 'BL14', '2026-10-29', 540.25, 70, null, 'zip', '2026-10-30T09:00:00Z');
  ins.run('auction', 'BL2', '2026-10-29', 210.5, 45, null, 'zip', '2026-10-30T09:00:00Z');
  ins.run('auction', 'BL16', '2026-10-21', null, 0, null, 'zip', '2026-10-27T09:00:00Z');   // a null total stays null
  ins.run('auction', 'BL4', '2026-10-29', 99, 9, null, 'zip', '2026-10-30T09:00:00Z');
  ins.run('eon', 'BL1', '2026-10-29', 77, 1, null, 'x', '2026-10-30T09:00:00Z');
  ins.run('whatnot', 'BL1', '2026-09-30', 3000, 3, '{"items":300}', 'recap', '2026-10-01T10:00:00Z');   // outside the range
  db.prepare('INSERT INTO daily_sales (store,date,total,auction,is_manual_override) VALUES (?,?,?,?,?)').run('BL14', '2026-10-29', 3000, 1740.25, 0);
  db.prepare('INSERT INTO daily_sales (store,date,total,auction,is_manual_override) VALUES (?,?,?,?,?)').run('BL1', '2026-10-29', 5000, 4000, 1);
  // Whatnot: sh-1 has analytics and orders (3 completed, 1 cancelled $5, 1 failed $3); sh-2 has neither.
  const sh = db.prepare('INSERT INTO whatnot_shows (id,title,status,scheduled_start_at,started_at,show_date,store,synced_at) VALUES (?,?,?,?,?,?,?,?)');
  sh.run('sh-1', '$1 Starts : Womens Fashion Finds', 'ended', '2026-10-29T12:30:00Z', '2026-10-29T12:31:00Z', '2026-10-29', 'BL1', 'x');
  sh.run('sh-2', '$5 Starts : Bag Deals', 'ended', '2026-10-29T21:00:00Z', null, '2026-10-29', 'BL14', 'x');
  sh.run('sh-3', 'Next week', 'scheduled', '2026-11-04T17:00:00Z', null, '2026-11-04', 'BL1', 'x');
  db.prepare('INSERT INTO whatnot_show_analytics (show_id,calculation_status,sales,orders_count,buyers,first_time_buyers,distinct_viewers,fetched_at) VALUES (?,?,?,?,?,?,?,?)')
    .run('sh-1', 'GENERATED', 1000, 130, 40, 12, 320, 'x');
  const or = db.prepare('INSERT INTO whatnot_orders (id,show_id,status,created_at,subtotal,items_synced,synced_at) VALUES (?,?,?,?,?,?,?)');
  [['o1', 'completed', 10], ['o2', 'completed', 20], ['o3', 'pending_fulfillment', 30], ['o4', 'cancelled', 5], ['o5', 'failed', 3]]
    .forEach(([id, st, amt]) => or.run(id, 'sh-1', st, '2026-10-29T13:00:00Z', amt, 1, 'x'));
  return { db, env };
}
const counts = (db) => ['channel_sales', 'daily_sales', 'whatnot_shows', 'whatnot_orders', 'user_grants', 'businesses', 'business_units']
  .map(t => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n);

// ── 1. Before migration-085: superuser is told "not set up"; an admin holds no grant yet ───
{
  const { env } = freshEnv({ live: false });
  const su = await call(env, Q, 'u-su');
  eq(su.status, 503, 'superuser before 085 → 503');
  ok(/not set up/.test(su.body?.error || ''), 'the 503 says Live Sales is not set up');
  const ad = await call(env, Q, 'u-admin');
  eq(ad.status, 403, 'admin before 085 → 403 (no Live Sales grant yet)');
  eq(ad.body?.code, 'NO_BUSINESS_ACCESS', 'the 403 is the business gate');
}

// ── 2. migration-085: rows, names, ids, idempotence ───────────────────────────
{
  const { db } = freshEnv();
  const biz = db.prepare("SELECT id,name,unit_noun,source,active FROM businesses WHERE id='live'").all();
  eq(biz.map(b => [b.id, b.name, b.unit_noun, b.source, b.active]), [['live', 'Live Sales', 'store', 'whatnot+auction', 1]], 'one Live Sales business');
  const units = db.prepare("SELECT id,code,name FROM business_units WHERE business_id='live' ORDER BY code").all();
  eq(units.map(u => [u.id, u.code, u.name]), [['live-BL1', 'BL1', 'Coliseum'], ['live-BL14', 'BL14', 'Battle Creek'], ['live-BL16', 'BL16', 'Indy East'], ['live-BL2', 'BL2', 'South Bend']],
    'four live stores, own ids, store code in code (BL2 is South Bend)');
  ok(db.prepare("SELECT COUNT(*) AS n FROM business_units WHERE business_id='bl'").get().n === 6, "Bargain Lane's units are untouched");
  const grants = db.prepare("SELECT user_id,role,units FROM user_grants WHERE business_id='live' ORDER BY user_id").all();
  eq(grants.map(g => [g.user_id, g.role, g.units]), [['u-admin', 'admin', null]], 'only active admins get a Live Sales grant (no managers)');
  const before = counts(db);
  db.exec(sql('085'));
  eq(counts(db), before, 're-running migration-085 writes nothing');
}

// ── 3. Who sees Live Sales (auth-me) ────────────────────────────────────────
{
  const { env } = freshEnv();
  const ids = async (user) => ((await (await worker.fetch(req('/?action=auth-me', { user }), env, ctx)).json()).businesses || []).map(b => b.id).sort();
  eq(await ids('u-su'), ['bl', 'ecom', 'live'], 'superuser sees bl, ecom, live');
  eq(await ids('u-admin'), ['bl', 'ecom', 'live'], 'admin sees bl, ecom, live');
  eq(await ids('u-mgr1'), ['bl'], 'a manager does not see Live Sales in phase 1');
  const me = await (await worker.fetch(req('/?action=auth-me', { user: 'u-su' }), env, ctx)).json();
  const live = me.businesses.find(b => b.id === 'live');
  ok(live && live.name === 'Live Sales' && live.unitCount === 4 && live.connected === true, `Live Sales card: 4 stores, connected — got ${JSON.stringify(live)}`);
}

// ── 4. Gates and validation ──────────────────────────────────────────────────
{
  const { env } = freshEnv();
  for (const [u, code] of [['u-mgr1', 'NO_BUSINESS_ACCESS'], ['u-exec', 'NO_BUSINESS_ACCESS'], ['u-staff', null]]) {
    const r = await call(env, Q, u);
    eq(r.status, 403, `${u} is refused`);
    if (code) eq(r.body?.code, code, `${u} is refused by the business gate`);
  }
  for (const [qs, why] of [['', 'no dates'], ['&from=2026-10-01', 'no to'], ['&from=2026-02-30&to=2026-03-01', 'Feb 30'],
    ['&from=2026-10-31&to=2026-10-01', 'to before from'], ['&from=2026-01-01&to=2026-06-30', 'over 92 days'], ['&from=10/1/2026&to=2026-10-31', 'not ISO']]) {
    eq((await call(env, qs, 'u-su')).status, 400, `400 for ${why}`);
  }
  const anon = await worker.fetch(req('/?action=live-sales' + Q), env, ctx);
  eq(anon.status, 401, 'no session → 401');
}

// ── 5. What comes back: live channels, live stores, parsed meta, nulls, shows, lost orders ──
{
  const { db, env } = freshEnv();
  const before = counts(db);
  const r = await call(env, Q, 'u-su');
  eq(r.status, 200, 'superuser → 200');
  const b = r.body;
  eq(b.units.map(u => u.code), ['BL1', 'BL14', 'BL16', 'BL2'], 'every live store for the superuser');
  eq([...new Set(b.channels.map(c => c.channel))].sort(), ['auction', 'whatnot'], 'only the live channels');
  ok(b.channels.every(c => ['BL1', 'BL2', 'BL14', 'BL16'].includes(c.store)), 'no Dupont (BL4) or any other non-live store');
  ok(b.channels.every(c => c.date >= '2026-10-01' && c.date <= '2026-10-31'), 'only rows inside the range');
  eq(b.channels.length, 5, 'five live rows in October');
  const bl1 = b.channels.find(c => c.channel === 'whatnot' && c.store === 'BL1');
  eq(bl1.meta, { items: 350, shipments: 120, new_buyers: 24 }, 'the recap meta comes back parsed');
  const empty = b.channels.find(c => c.store === 'BL16');
  ok(empty && empty.total === null && empty.meta === null, 'a null total and null meta stay null, never 0');
  eq(b.coverage.map(c => [c.channel, c.first, c.last]).sort(), [['auction', '2026-10-21', '2026-10-29'], ['whatnot', '2026-09-30', '2026-10-29']],
    'coverage per channel over all time, live stores only (BL4 does not stretch it)');
  eq(b.bl.map(x => [x.store, x.auction, x.manualOverride]), [['BL1', 4000, true], ['BL14', 1740.25, false]], "Bargain Lane's own auction column, with the override flag");
  const s1 = b.shows.find(s => s.showId === 'sh-1'), s2 = b.shows.find(s => s.showId === 'sh-2');
  eq(b.shows.map(s => s.showId), ['sh-1', 'sh-2'], 'ended shows in range only (no scheduled show)');
  eq([s1.sales, s1.orders, s1.newBuyers, s1.viewers], [1000, 130, 12, 320], 'show analytics');
  eq(s1.lost, { orders: 2, subtotal: 8, of: 5 }, 'lost = cancelled + failed, with the order count it is out of');
  ok(s2.sales === null && s2.lost === null, 'no analytics and no orders loaded stay null, not 0');
  eq(counts(db), before, 'the read writes nothing');
}

// ── 6. Scoping: a Live Sales grant limited to one store ──────────────────────
{
  const { db, env } = freshEnv();
  db.prepare("INSERT INTO user_grants (user_id,business_id,role,units) VALUES ('u-mgr1','live','manager','[\"BL14\"]')").run();
  const r = await call(env, Q, 'u-mgr1');
  eq(r.status, 200, 'a manager granted Live Sales gets in');
  eq(r.body.units.map(u => u.code), ['BL14'], 'only their store');
  ok(r.body.channels.every(c => c.store === 'BL14') && r.body.channels.length === 2, 'only their rows (auction + whatnot at BL14)');
  ok(r.body.shows.every(s => s.store === 'BL14'), 'only their shows');
  ok(r.body.bl.every(x => x.store === 'BL14'), "only their store's Bargain Lane column");
  eq((await call(env, Q + '&store=BL1', 'u-mgr1')).status, 403, '&store= cannot reach outside the grant');
  eq((await call(env, Q + '&store=BL4', 'u-mgr1')).status, 400, 'a store that is not a live store is a 400');
  const one = await call(env, Q + '&store=BL14', 'u-mgr1');
  eq(one.body.units.map(u => u.code), ['BL14'], '&store= inside the grant works');
  db.prepare("UPDATE user_grants SET units='[]' WHERE user_id='u-mgr1' AND business_id='live'").run();
  const none = await call(env, Q, 'u-mgr1');
  ok(none.status === 200 && none.body.units.length === 0 && none.body.channels.length === 0 && none.body.shows.length === 0,
    'a grant with no stores answers with nothing, never everything');
  const su = await call(env, Q + '&store=BL2', 'u-su');
  ok(su.body.channels.length === 1 && su.body.channels[0].total === 210.5, 'superuser &store=BL2 → South Bend only');
}

console.log(`test-live-sales: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
