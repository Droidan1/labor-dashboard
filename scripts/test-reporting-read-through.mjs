// The reporting key reads the Retail Summary and Labor pages' own endpoints.
//
// WHAT THIS PROTECTS. Agents (the retjg CLI and the retjg-mcp connector) need
// what those two pages show. The pages' endpoints sit behind a session, the
// financial gate, the business gate and allowedStores(). The key now opens
// exactly seven of them, read-only, chain-wide, and nothing else.
//
// 🔑 The strongest check is a DIFFERENTIAL: for every action, the key's answer
// must equal a superuser session's answer byte for byte. That proves the key
// reaches the page's real handler with all stores and no other behaviour,
// without this test re-deriving what any handler returns.
//
// 🛑 And the dangerous direction: the key must not open anything else. Every
// write and every other action still demands a session, and a POST with the
// key never reaches a handler.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, ctx, blockNetwork, req } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const KEY = 'test-briefing-key';
const worker = await loadWorker(repo);
const { db, env } = makeEnv(repo);
env.MORNING_BRIEFING_KEY = KEY;
blockNetwork();

// A real fortnight so the answers are not empty — an equality between two empty
// payloads proves nothing. Sun 2026-09-27 … Sat 2026-10-10.
const ins = db.prepare(`INSERT OR REPLACE INTO daily_sales
  (store, date, total, retail, bin, budget, order_count, budget_labor_hours, labor_hours, snapshot_time)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const days = [];
for (let d = new Date('2026-09-27T12:00:00Z'); d <= new Date('2026-10-10T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
  days.push(d.toISOString().slice(0, 10));
}
const STORES = ['BL1', 'BL2', 'BL4', 'BL14', 'BL16'];
STORES.forEach((s, i) => days.forEach((date, j) => {
  const total = 1000 + 100 * i + j;
  ins.run(s, date, total, total - 300, 300, 1100 + 100 * i, 50 + j, 40 + i, 38 + i + (j % 3), date + 'T07:55:00Z');
}));
const bl2Week = days.slice(0, 7).reduce((a, _, j) => a + 1100 + j, 0); // BL2, 09-27 … 10-03

const ACTIONS = {
  'weekly-summary':      '?action=weekly-summary&from=2026-09-27&to=2026-10-03',
  'weekly-store-detail': '?action=weekly-store-detail&store=BL2&from=2026-09-27&to=2026-10-03',
  'weekly-t13':          '?action=weekly-t13&end=2026-10-03',
  'category-series':     '?action=category-series&from=2026-09-27&to=2026-10-03&level=l2',
  'category-hours':      '?action=category-hours&from=2026-10-02&to=2026-10-02&level=l2',
  'labor':               '?action=labor&grain=w&from=2026-09-27&to=2026-10-10',
  'labor-plan':          '?action=labor-plan&week=2026-10-10',
};

const fetchW = (r) => worker.fetch(r, env, ctx);
const withKey = (q, { key = KEY, method = 'GET', where = 'header' } = {}) => new Request(
  'https://api.retjghub.com/' + q + (where === 'query' ? `&key=${encodeURIComponent(key)}` : ''),
  { method, headers: where === 'header' ? { 'X-API-Key': key } : {} });
const bodyOf = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
// Fields stamped at request time, which two calls cannot share.
const stable = (o) => JSON.stringify(o, (k, v) => (['generatedAt', 'asOf', 'fetchedAt'].includes(k) ? undefined : v));

// ── 1. The key reads each page endpoint exactly as a superuser does ────────
for (const [action, q] of Object.entries(ACTIONS)) {
  const k = await fetchW(withKey(q));
  const su = await fetchW(req('/' + q, { user: 'u-su' }));
  const kb = await bodyOf(k), sb = await bodyOf(su);
  eq(k.status, 200, `${action}: the key is answered 200`);
  eq(su.status, 200, `${action}: control — a superuser session is answered 200`);
  ok(stable(kb) === stable(sb), `${action}: the key's answer equals the superuser's, field for field`);
  eq((await fetchW(withKey(q, { where: 'query' }))).status, 200, `${action}: the key also works as ?key=, like the other reporting actions`);
}

// Not vacuous: the payloads carry the seeded figures, for every store.
{
  const ws = await bodyOf(await fetchW(withKey(ACTIONS['weekly-summary'])));
  eq(ws?.stores?.BL2?.totals?.netSales, bl2Week, 'weekly-summary carries BL2\'s seeded week through the key');
  ok(STORES.every(s => ws?.stores?.[s]), 'weekly-summary through the key covers every store, not a scoped subset');
  const lb = await bodyOf(await fetchW(withKey(ACTIONS.labor)));
  ok(lb?.periods?.length >= 2 && STORES.every(s => lb.stores?.includes(s)), 'labor through the key covers every labor store');
  const lp = await bodyOf(await fetchW(withKey(ACTIONS['labor-plan'])));
  ok(lp?.byStore && STORES.every(s => lp.byStore[s]), 'labor-plan through the key covers every store');
}

// ── 2. A wrong, empty or unconfigured key is refused before any handler ────
for (const [action, q] of Object.entries(ACTIONS)) {
  const wrong = await fetchW(withKey(q, { key: 'not-the-key' }));
  eq(wrong.status, 401, `${action}: a wrong key → 401`);
  eq((await bodyOf(wrong))?.code, undefined, `${action}: refused by the KEY gate, not the session gate`);
  eq((await fetchW(withKey(q, { key: '' }))).status, 401, `${action}: an empty X-API-Key → 401, not a fall-through`);
  eq((await fetchW(withKey(q, { key: 'nope', where: 'query' }))).status, 401, `${action}: a wrong ?key= → 401`);
  eq((await fetchW(withKey(q, { method: 'POST' }))).status, 405, `${action}: POST with the key → 405, never a handler`);
}
{
  const saved = env.MORNING_BRIEFING_KEY;
  env.MORNING_BRIEFING_KEY = '';
  eq((await fetchW(withKey(ACTIONS.labor))).status, 503, 'no key configured on the server → 503, never open');
  env.MORNING_BRIEFING_KEY = saved;
}

// ── 3. The key opens NOTHING else ──────────────────────────────────────────
{
  const rowsBefore = db.prepare('SELECT COUNT(*) n, SUM(labor_hours) h FROM daily_sales').get();
  const write = new Request('https://api.retjghub.com/?action=manual-override', {
    method: 'POST', headers: { 'X-API-Key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ markOverride: false, entries: [{ store: 'BL1', date: '2026-10-01', labor_hours: 999 }] }),
  });
  const w = await fetchW(write);
  eq(w.status, 401, 'manual-override with the key → 401 (needs a session)');
  eq((await bodyOf(w))?.code, 'NO_SESSION', 'manual-override is refused by the SESSION gate: the key does not reach it');
  const rowsAfter = db.prepare('SELECT COUNT(*) n, SUM(labor_hours) h FROM daily_sales').get();
  ok(rowsBefore.n === rowsAfter.n && rowsBefore.h === rowsAfter.h, 'and nothing in daily_sales changed');

  for (const action of ['manual-override', 'rebuild-week-summaries', 'item-costs', 'users', 'snapshot', 'hourly', 'channel-range']) {
    const r = await fetchW(withKey(`?action=${action}`));
    eq((await bodyOf(r))?.code, 'NO_SESSION', `GET ${action} with the key still needs a session`);
  }
}

// ── 4. Without the key, the pages behave exactly as before ─────────────────
for (const [action, q] of Object.entries(ACTIONS)) {
  const anon = await fetchW(new Request('https://api.retjghub.com/' + q));
  eq((await bodyOf(anon))?.code, 'NO_SESSION', `${action}: no key and no session → NO_SESSION, as before`);
}
{
  // A manager scoped to BL1 still sees only BL1 — the key's chain-wide read did
  // not widen the session path.
  const mgr = await bodyOf(await fetchW(req('/' + ACTIONS['weekly-summary'], { user: 'u-mgr1' })));
  eq(Object.keys(mgr?.stores || {}).join(), 'BL1', 'a BL1 manager\'s session still sees only BL1');
  const mlab = await bodyOf(await fetchW(req('/' + ACTIONS.labor, { user: 'u-mgr1' })));
  eq((mlab?.stores || []).join(), 'BL1', 'a BL1 manager\'s labor is still BL1 only');
  const staff = await fetchW(req('/' + ACTIONS.labor, { user: 'u-staff' }));
  eq(staff.status, 403, 'staff (no financial access) is still refused');
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
