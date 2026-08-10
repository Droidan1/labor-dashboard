// Request-level tests: real Request objects through the REAL worker.fetch().
//
// WHY THIS EXISTS. Every other harness in scripts/ tests a pure function pulled
// out with a regex, or greps source text. An independent audit mutation-tested
// that suite: ~25% kill rate, and 17 of 17 store-scoping call sites survived
// being individually disarmed. Deleting the financial gate from the request
// path outright left every harness green. The reason is structural — nothing
// ever built a Request or called worker.fetch, so the WIRING was untested, and
// the wiring is what enforces. Two endpoints reached production serving every
// store's figures to a single-store manager while the suite stayed green.
//
// Assertions here are about RESPONSES, not source text. For a denied case the
// bar is a 403. For an allowed case the bar is "not 403" — several endpoints
// then fail at the blocked network call, which is fine and still proves the
// guard let them through.
import {
  loadWorker, makeEnv, ctx, blockNetwork, req, storesIn, STORES,
} from './lib/worker-harness.mjs';

const REPO = process.argv[2] || '.';
blockNetwork();
const worker = await loadWorker(REPO);

let fail = 0;
const ok = (n, c, d = '') => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); if (!c) fail++; };

const call = async (url, opts) => {
  const { env } = makeEnv(REPO);
  const res = await worker.fetch(req(url, opts), env, ctx);
  let text = ''; try { text = await res.text(); } catch (_) {}
  return { status: res.status, text };
};
const today = new Date().toISOString().slice(0, 10);

// ── 1 · the financial gate is actually wired into the request path ──────────
// Deleting the gate from worker.fetch left the entire old suite green. This is
// the assertion that makes that impossible.
console.log('financial gate is WIRED IN (not just implemented):');
for (const a of ['weekly-summary', 'store-scores', 'ly-sales', 'items', 'monthly-totals', 'channel-range']) {
  const r = await call(`/?action=${a}&from=2025-07-01&to=2025-07-07&date=${today}`, { user: 'u-staff' });
  ok(`staff gets 403 on ${a}`, r.status === 403, `${r.status} ${r.text.slice(0, 60)}`);
}
{
  const r = await call('/?action=auth-me', { user: 'u-staff' });
  ok('staff can still reach an allowlisted action (gate is not blanket)', r.status === 200, String(r.status));
}

// ── 2 · anonymous requests are refused ──────────────────────────────────────
console.log('\nunauthenticated access:');
for (const a of ['weekly-summary', 'store-scores']) {
  const r = await call(`/?action=${a}`, {});
  ok(`no session -> 401 on ${a}`, r.status === 401, String(r.status));
}
{
  const r = await call(`/?store=BL8`, {});
  ok('no session -> 401 on the fall-through ?store= route', r.status === 401, String(r.status));
}

// ── 3 · response bodies contain only the caller's stores ────────────────────
// This is the property both live leaks violated. Source-text tests cannot see it.
console.log('\nresponse bodies are store-scoped (the property both leaks violated):');
{
  const r = await call(`/?action=store-scores&asOf=${today}`, { user: 'u-mgr1' });
  const s = storesIn(r.text);
  ok('store-scores: BL1 manager sees only BL1', r.status === 200 && s.join() === 'BL1', `${r.status} ${s.join()}`);
}
{
  const r = await call(`/?action=store-scores&asOf=${today}`, { user: 'u-mgr2' });
  const s = storesIn(r.text);
  ok('store-scores: BL1+BL4 manager sees exactly those', r.status === 200 && s.join() === 'BL1,BL4', `${r.status} ${s.join()}`);
}
{
  const r = await call(`/?action=store-scores&asOf=${today}`, { user: 'u-admin' });
  const s = storesIn(r.text);
  ok('store-scores: admin sees every store', r.status === 200 && s.length === STORES.length, `${r.status} ${s.join()}`);
}
{
  const r = await call('/?action=ly-sales&from=2025-06-01&to=2025-08-01', { user: 'u-mgr1' });
  const s = storesIn(r.text);
  ok('ly-sales: BL1 manager sees only BL1', r.status === 200 && s.join() === 'BL1', `${r.status} ${s.join()}`);
}
{
  const r = await call('/?action=ly-sales&from=2025-06-01&to=2025-08-01', { user: 'u-admin' });
  ok('ly-sales: admin sees every store', storesIn(r.text).length === STORES.length, storesIn(r.text).join());
}

// ── 4 · per-store routes refuse a store outside the grant ───────────────────
console.log('\nper-store routes refuse an out-of-scope store:');
for (const s of ['BL2', 'BL4', 'BL8', 'BL14', 'BL16']) {
  const r = await call(`/?store=${s}&since=0`, { user: 'u-mgr1' });
  ok(`fall-through ?store=${s} refused for a BL1 manager`, r.status === 403, String(r.status));
}
{
  const r = await call('/?store=BL1&since=0', { user: 'u-mgr1' });
  ok('fall-through ?store=BL1 NOT refused (guard is not blanket)', r.status !== 403, String(r.status));
}
for (const s of ['BL2', 'BL8']) {
  const r = await call(`/?action=hourly&store=${s}`, { user: 'u-mgr1' });
  ok(`hourly?store=${s} refused for a BL1 manager`, r.status === 403, String(r.status));
}
{
  const r = await call('/?action=hourly&store=BL1', { user: 'u-mgr1' });
  ok('hourly?store=BL1 NOT refused', r.status !== 403, String(r.status));
}
for (const s of ['BL2', 'BL8']) {
  const r = await call(`/?action=channel-range&store=${s}&from=2026-08-01&to=2026-08-02`, { user: 'u-mgr1' });
  ok(`channel-range?store=${s} refused for a BL1 manager`, r.status === 403, String(r.status));
}
{
  const r = await call('/?action=channel-range&store=BL1&from=2026-08-01&to=2026-08-02', { user: 'u-mgr1' });
  ok('channel-range?store=BL1 NOT refused', r.status !== 403, String(r.status));
}

// ── 5 · privilege escalation through update-user ────────────────────────────
console.log('\nupdate-user cannot escalate:');
{
  const r = await call('/?action=update-user', { user: 'u-admin', method: 'POST', body: { id: 'u-mgr1', role: 'superuser' } });
  ok('admin cannot assign superuser', r.status === 403, `${r.status} ${r.text.slice(0, 50)}`);
}
{
  const r = await call('/?action=update-user', { user: 'u-admin', method: 'POST', body: { id: 'u-admin', role: 'superuser' } });
  ok('admin cannot self-promote', r.status === 403, String(r.status));
}
{
  const r = await call('/?action=update-user', { user: 'u-admin', method: 'POST', body: { id: 'u-su', status: 'suspended' } });
  ok('admin cannot touch the superuser', r.status === 403, String(r.status));
}
{
  const r = await call('/?action=update-user', { user: 'u-admin', method: 'POST', body: { id: 'u-mgr1', role: 'manager' } });
  ok('admin CAN still make an ordinary edit', r.status === 200, `${r.status} ${r.text.slice(0, 50)}`);
}
{
  const r = await call('/?action=update-user', { user: 'u-mgr1', method: 'POST', body: { id: 'u-mgr2', role: 'manager' } });
  ok('a manager cannot use update-user at all', r.status === 403, String(r.status));
}

console.log(fail ? `\n${fail} FAILED` : '\nall assertions passed');
process.exit(fail ? 1 : 0);
