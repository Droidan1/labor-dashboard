// The Weekly Sales Digest's NUMBERS, through the real worker.fetch
// (POST ?action=send-weekly-digest, the same dispatcher the Sunday cron runs),
// read off the email body actually handed to Resend.
//
// Net sales are till + live sales (`total` + `auction`), the figure the budget
// is set against. The digest summed `total` alone, so every live-selling store
// read low: week ending 2026-10-24, Coliseum's digest said 88% of budget
// against a real 112%.
//
// Every expected string below was worked out by hand:
//   week Oct 18-24, prior week Oct 11-17.
//   Coliseum   till 1,000/day + live 300 (Oct 20) + 500 (Oct 24) = 7,800;
//              budget 1,200/day = 8,400 -> 93%. Prior 900/day + 400 live = 6,700 -> +16.4%.
//              (Till only it would read 7,000, 83%, +11.1%.)
//   South Bend till 500/day, no live sales, budget 500/day -> 3,500, 100%, +0.0%.
//   Indy East  till 200/day on six days; Oct 19 has live sales 50 but NO till
//              figure (total NULL) and a 400 budget. A day the till never
//              reported is left out whole, budget included, so the day cannot
//              read as a miss -> 1,200 vs 1,200 = 100%. Prior 200/day = 1,400 -> -14.3%.
//   All Stores 12,500 vs budget 13,100 -> 95%; prior 11,600 -> +7.8%.
process.env.TZ = 'UTC';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, ctx, req } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS  ' + m); } else { fail++; console.log('  FAIL  ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// Capture Resend; refuse anything else on the network.
const sends = [];
globalThis.fetch = async (url, opts = {}) => {
  if (String(url) === 'https://api.resend.com/emails') {
    sends.push(JSON.parse(opts.body));
    return new Response(JSON.stringify({ id: 'msg_test' }), { status: 200 });
  }
  throw new Error(`unexpected network call: ${url}`);
};

const worker = await loadWorker(repo);
const h = makeEnv(repo);
h.env.RESEND_API_KEY = 'test-key';
h.db.exec('CREATE TABLE notification_log (id TEXT PRIMARY KEY, user_id TEXT, type TEXT, event_type TEXT, status TEXT, error TEXT, provider_message_id TEXT, created_at TEXT)');
h.db.exec('DELETE FROM daily_sales');     // the harness seeds "today"; this test owns every row

const ins = h.db.prepare('INSERT INTO daily_sales (store, date, total, auction, budget) VALUES (?, ?, ?, ?, ?)');
const day = (d) => new Date(Date.UTC(2026, 9, 11 + d)).toISOString().slice(0, 10);   // d=0 -> 2026-10-11
const LIVE = { '2026-10-13': 400, '2026-10-20': 300, '2026-10-24': 500 };
for (let d = 0; d < 14; d++) {
  const date = day(d), thisWeek = date >= '2026-10-18';
  ins.run('BL1', date, thisWeek ? 1000 : 900, LIVE[date] ?? null, 1200);
  ins.run('BL2', date, 500, null, 500);
  if (date === '2026-10-19') ins.run('BL16', date, null, 50, 400);
  else ins.run('BL16', date, 200, null, 200);
}

const res = await worker.fetch(
  req('/?action=send-weekly-digest&start=2026-10-18&end=2026-10-24', { user: 'u-su', method: 'POST' }), h.env, ctx);
const body = await res.json();
ok(res.status === 200 && body.ok, `send-weekly-digest succeeds (status ${res.status}, ${JSON.stringify(body).slice(0, 120)})`);
ok(sends.length > 0 && sends.length === body.summary?.email?.sent, `every recipient's email reached Resend (${sends.length})`);

const html = sends[0]?.html || '';
// The row's cells in order: Net Sales, vs LW, vs Budget.
const row = (label) => {
  const m = html.match(new RegExp(`>${label}</td>\\s*<td[^>]*>([^<]*)</td>\\s*<td[^>]*>([^<]*)</td>\\s*<td[^>]*>([^<]*)</td>`));
  return m ? m.slice(1, 4) : null;
};
eq(row('Coliseum'), ['$7,800.00', '+16.4%', '93%'], 'Coliseum counts its live sales, this week and last');
eq(row('South Bend'), ['$3,500.00', '+0.0%', '100%'], 'a store with no live sales is unchanged');
eq(row('Indy East'), ['$1,200.00', '-14.3%', '100%'], 'a day with no till figure is left out whole, budget included');
eq(row('All Stores'), ['$12,500.00', '+7.8%', '95%'], 'All Stores is the sum of the store rows');
ok(sends.every(s => s.html === html), 'every recipient gets the same figures');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
