// The Executive Summary's NUMBERS, rendered through the real worker.fetch
// (GET ?action=preview-daily-summary, which builds the exact body the 8 AM cron
// sends). test-scoped-daily-summary.mjs pins WHO gets which stores; this pins
// what the figures are.
//
// The dataset is small enough to work out by hand, and every expected string
// below was worked out by hand, not read back from the code:
//   five open stores + Holland (closed: budget, no sales); plan 100/store/day;
//   Sep 27-Oct 3 sales 100/store/day (last week, for pace); Oct 4-7 sales 90;
//   Coliseum has 20 of live sales on Oct 6 and Oct 7; Indy East's Oct 7 plan
//   is 0. Report covers Wed Oct 7 (sent Thu Oct 8).
// Rows have PROD's shape (measured 2026-10-12): a reported day carries a
// snapshot_time; a day not yet reported exists already, with total 0 (NULL for
// Indy East only) and no snapshot_time. A fixture with NULL totals hid that the
// missing-data warning could never fire. Dupont, South Bend and Battle Creek
// carry cents on Oct 7 so rounding each row shows up in the totals.
process.env.TZ = 'UTC';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, ctx, blockNetwork, req, applyMigrationAlters } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS  ' + m); } else { fail++; console.log('  FAIL  ' + m); } };
const has = (html, s, m) => ok(html.includes(s), `${m} (looking for ${JSON.stringify(s)})`);
const lacks = (html, s, m) => ok(!html.includes(s), `${m} (must not contain ${JSON.stringify(s)})`);

blockNetwork();
const worker = await loadWorker(repo);
const OPEN = ['BL1', 'BL4', 'BL2', 'BL14', 'BL16'];
const day = (d) => new Date(Date.UTC(2026, 8, 27 + d)).toISOString().slice(0, 10);   // d=0 -> 2026-09-27

function setup({ whatnotThrough = null } = {}) {
  const h = makeEnv(repo);
  h.db.exec(fs.readFileSync(path.join(repo, 'migration-015.sql'), 'utf8'));
  applyMigrationAlters(h.db, repo);
  h.db.exec('DELETE FROM daily_sales');          // the harness seeds "today"; this test owns every row
  const ins = h.db.prepare('INSERT INTO daily_sales (store, date, total, auction, budget, snapshot_time) VALUES (?, ?, ?, ?, ?, ?)');
  for (let d = 0; d < 35; d++) {                 // Sep 27 .. Oct 31
    const date = day(d);
    for (const s of [...OPEN, 'BL8']) {
      const reported = date <= '2026-10-07';
      const cents = date === '2026-10-07' && ['BL4', 'BL2', 'BL14'].includes(s) ? 0.4 : 0;
      const total = !reported ? (s === 'BL16' ? null : 0) : s === 'BL8' ? 0 : date <= '2026-10-03' ? 100 : 90 + cents;
      const auction = s === 'BL1' && (date === '2026-10-06' || date === '2026-10-07') ? 20 : null;
      const budget = s === 'BL16' && date === '2026-10-07' ? 0 : 100;
      ins.run(s, date, total, auction, budget, reported ? date + 'T23:55:00Z' : null);
    }
  }
  if (whatnotThrough) {
    const w = h.db.prepare("INSERT INTO channel_sales (channel, store, date, total, ingested_at) VALUES ('whatnot', ?, ?, 0, 'x')");
    for (let d = 4; day(d) <= whatnotThrough; d++) { w.run('BL1', day(d)); w.run('BL14', day(d)); }
  }
  return h;
}
const preview = async (h, qs) => {
  const r = await worker.fetch(req('/?action=preview-daily-summary&' + qs, { user: 'u-su' }), h.env, ctx);
  return { status: r.status, html: await r.text() };
};

// ── Chain-wide, through Wed Oct 7 ───────────────────────────────────────────
{
  const h = setup({ whatnotThrough: '2026-10-07' });
  const { status, html } = await preview(h, 'date=2026-10-07');
  ok(status === 200, 'preview renders');
  has(html, 'Thursday, October 8, 2026', 'report date is the send day');
  has(html, 'Data through Wed, Oct 7', 'data-through is the covered day');
  // Headline. WTD = Oct 4-7: 4 x 90 x 5 + 40 live = 1,840; plan 4 x 100 x 5 - 100 (Indy's 0 day) = 1,900.
  has(html, '>$1,840</div>', 'Total WTD sales (POS + live, five stores)');
  has(html, '>$1,900</div>', 'WTD plan to date counts only the days so far');
  has(html, '>96.8%</div>', '% to plan is attainment: 1,840 / 1,900');
  // Pace: 1,840 + last week's Thu-Sat (3 x 100 x 5 = 1,500) = 3,340 vs week plan 3,500 - 100 = 3,400.
  has(html, 'Projected <strong>$3,340</strong> vs full-week plan <strong>$3,400</strong>', 'pace uses last week for the remaining days');
  has(html, 'OFF TRACK', 'below the full-week plan reads OFF TRACK');
  // WTD table footer and Coliseum row.
  has(html, '>$1,840</td>', 'WTD All Stores sales');
  has(html, '−3.2%', 'WTD variance = 1,840 / 1,900 - 1');
  ok(/Coliseum<sup[^>]*>\*<\/sup><\/td>\s*<td[^>]*>\$400<\/td>\s*<td[^>]*>\$400<\/td>/.test(html), 'Coliseum WTD row: $400 sales (incl. 40 live, starred) vs $400 plan');
  // Yesterday: 4 x 90 + 110 = 470 vs plan 400 (Indy's 0 excluded by its own zero).
  // Three rows are 90.40 and DISPLAY $90; the total is the sum of what is shown.
  has(html, '>$470</td>', 'Yesterday All Stores sales equals the rows as displayed (not $471)');
  has(html, '+17.5%', 'Yesterday variance = 470 / 400 - 1');
  has(html, '>N/A</td>', 'a store with a zero plan reads N/A, not a percent');
  // Month: Oct 1-3 at 100 + Oct 4-7 at 90 = 660/store + 40 live = 3,340; plan = 31 x 100 x 5 - 100 = 15,400.
  has(html, '>$3,340</td>', 'MTD sales');
  has(html, '>$15,400</td>', 'Monthly plan is the WHOLE month, not month-to-date');
  has(html, '>21.7%</td>', '% of monthly plan = 3,340 / 15,400');
  // Live-sales notes, one per table, with each store's own share.
  has(html, 'Coliseum $40 (10.0% of Coliseum WTD sales)', 'WTD live note: 40 / 400');
  has(html, 'Coliseum $20 (18.2% of Coliseum yesterday sales)', 'Yesterday live note: 20 / 110');
  has(html, 'Coliseum $40 (5.7% of Coliseum MTD sales)', 'MTD live note: 40 / 700');
  // Closed store and settled data.
  lacks(html, 'Holland', 'Holland is not reported');
  lacks(html, 'No sales data yet', 'no missing-data warning when every store reported');
  lacks(html, 'Whatnot recap', 'no Whatnot warning when the recap arrived');
  has(html, '>All Stores &nbsp;·&nbsp;', 'scope line names All Stores');
}

// ── One store: pace exactly AT plan is on track ─────────────────────────────
{
  const h = setup({ whatnotThrough: '2026-10-07' });
  const { html } = await preview(h, 'date=2026-10-07&stores=BL1');
  // Coliseum: WTD 400 + last week's Thu-Sat 300 = 700 vs week plan 700.
  has(html, 'Projected <strong>$700</strong> vs full-week plan <strong>$700</strong>', 'single-store pace');
  has(html, 'ON TRACK', 'projected equal to plan reads ON TRACK');
  has(html, '>Total</td>', 'single-store footer says Total');
  lacks(html, 'Dupont', 'a scoped preview shows no other store');
}

// ── A Whatnot recap that has not arrived, and a store with no data ──────────
{
  const h = setup({ whatnotThrough: '2026-10-06' });
  // What a failed nightly snapshot leaves in prod: the pre-made row, untouched.
  h.db.prepare("UPDATE daily_sales SET total = 0, snapshot_time = NULL WHERE store = 'BL4' AND date = '2026-10-07'").run();
  const { html } = await preview(h, 'date=2026-10-07');
  has(html, 'The Whatnot recap for Wed, Oct 7 has not arrived', 'a missing recap is said, not silently $0');
  has(html, 'No sales data yet for Dupont on Wed, Oct 7', 'a store with no figure is named');
  const { html: dupont } = await preview(h, 'date=2026-10-07&stores=BL4');
  lacks(dupont, 'Whatnot recap', 'a store Whatnot never covers gets no Whatnot warning');
}

// ── No plan at all (a week past the last budget row) is not "on track" ──────
{
  const h = setup();
  const { html } = await preview(h, 'date=2026-11-04');
  lacks(html, 'ON TRACK', 'a zero full-week plan never reads ON TRACK');
  lacks(html, 'OFF TRACK', '...nor OFF TRACK');
  has(html, '>NO PLAN</span>', 'it says there is no plan');
}

// ── A refund-only day: live share never prints Infinity or NaN ──────────────
{
  const h = setup({ whatnotThrough: '2026-10-07' });
  h.db.prepare("UPDATE daily_sales SET total = -50 WHERE store = 'BL1' AND date = '2026-10-07'").run();
  const { html } = await preview(h, 'date=2026-10-07&stores=BL1');
  lacks(html, 'Infinity', 'no Infinity%');
  lacks(html, 'NaN', 'no NaN');
  has(html, 'Coliseum $20.', 'the live amount is still stated, without a share of negative sales');
}

// ── A manager whose stores include closed Holland ───────────────────────────
{
  const h = setup({ whatnotThrough: '2026-10-07' });
  const { html } = await preview(h, 'date=2026-10-07&stores=BL1,BL8');
  has(html, '>Total</td>', 'one reported store reads as a single-store body (footer "Total")');
  lacks(html, 'My Stores', 'not "My Stores" for one visible store');
  lacks(html, 'Holland', 'Holland is not named anywhere');
}

// ── A scope with no open store ──────────────────────────────────────────────
{
  const h = setup();
  const { status } = await preview(h, 'date=2026-10-07&stores=BL8');
  ok(status === 400, `Holland alone has nothing to report (got ${status})`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
