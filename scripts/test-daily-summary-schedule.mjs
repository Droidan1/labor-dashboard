// The Executive Summary goes at 5 AM Eastern, every day, in both EDT and EST
// (2026-10-19, Brian: "change the time from 8 am to 5 am EST every morning").
//
// Cloudflare crons are UTC, so a fixed UTC time drifts an hour twice a year (the
// old "0 12 * * *" was 8 AM in summer and 7 AM in winter). Instead the send rides
// the existing hourly cron and fires when the Eastern hour is 5, which happens
// exactly once on every day, the two clock-change Sundays included.
//
// Also pinned here: wrangler.toml and the scheduled() handler agree. A cron the
// handler does not name used to FALL THROUGH into the nightly snapshot rollup, so a
// stale wrangler.toml still carrying "0 12 * * *" would have re-run the rollup at
// noon. An unnamed cron now does nothing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS  ' + m); } else { fail++; console.log('  FAIL  ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  calls.push({ url: String(url), body: opts.body });
  if (String(url) === 'https://api.resend.com/emails') return new Response(JSON.stringify({ id: 'msg' }), { status: 200 });
  return new Response('{}', { status: 500 });
};
const summaries = () => calls.filter(c => c.url === 'https://api.resend.com/emails')
  .map(c => JSON.parse(c.body)).filter(m => /Executive Summary/.test(m.subject || ''));

const worker = await loadWorker(repo);
const RealDate = Date;

// Run one cron at one instant, with the clock pinned there (getETYesterday reads it).
async function runAt(iso, cron) {
  globalThis.Date = class extends RealDate {
    constructor(...a) { if (a.length === 0) super(iso); else super(...a); }
    static now() { return RealDate.parse(iso); }
  };
  try {
    const h = makeEnv(repo);
    h.env.RESEND_API_KEY = 'test-key';
    calls.length = 0;
    const waits = [], logs = [];
    const realLog = console.log, realErr = console.error;
    console.log = (...a) => logs.push(a.join(' ')); console.error = () => {};
    try {
      await worker.scheduled({ cron, scheduledTime: RealDate.parse(iso) }, h.env,
        { waitUntil: p => waits.push(Promise.resolve(p).catch(() => {})), passThroughOnException: () => {} });
      await Promise.all(waits);
    } finally { console.log = realLog; console.error = realErr; }
    return { sent: summaries(), urls: calls.map(c => c.url), logs };
  } finally { globalThis.Date = RealDate; }
}
const etHour = (iso) => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new RealDate(iso)));

// ── 1. Exactly once a day, at 5 AM Eastern ──────────────────────────────────
console.log('the hourly cron sends the Executive Summary once a day, at 5 AM ET');
for (const [day, label, wantUtc] of [
  ['2026-10-20', 'EDT', '09'],
  ['2026-12-15', 'EST', '10'],
  ['2026-03-08', 'spring-forward Sunday', '09'],
  ['2026-11-01', 'fall-back Sunday', '10'],
]) {
  const sentAt = [];
  for (let hh = 0; hh < 24; hh++) {
    const iso = `${day}T${String(hh).padStart(2, '0')}:00:00.000Z`;
    const r = await runAt(iso, '0 * * * *');
    if (r.sent.length) sentAt.push(String(hh).padStart(2, '0'));
  }
  eq(sentAt, [wantUtc], `${day} (${label}): one send, at ${wantUtc}:00 UTC`);
  ok(etHour(`${day}T${wantUtc}:00:00Z`) === 5, `...which is 5 AM Eastern`);
}
{
  const r = await runAt('2026-10-20T09:00:00.000Z', '0 * * * *');
  ok(r.sent.length > 1, `the 5 AM run sends the whole list (${r.sent.length} emails), chain-wide and scoped`);
  ok(r.sent.length > 0 && r.sent.every(m => m.subject.endsWith('— Tue, Oct 20')), 'and reports on yesterday (dated today, data through Mon)');
}

// ── 2. The old 8 AM cron, or any cron the handler does not name, does nothing ─
console.log('\nan unnamed cron does nothing (no send, no snapshot rollup)');
for (const cron of ['0 12 * * *', '15 4 * * *']) {
  const r = await runAt('2026-10-20T12:00:00.000Z', cron);
  eq([r.sent.length, r.urls.length], [0, 0], `"${cron}": no email and no outbound call`);
  ok(!r.logs.some(l => l.includes('Daily snapshot results')), `"${cron}": the nightly rollup did not run`);
  ok(r.logs.some(l => l.includes('cron_unhandled') && l.includes(cron)), `"${cron}": logged as unhandled`);
}
{
  // The guard must not catch the one cron that IS meant to fall through.
  const r = await runAt('2026-10-20T03:55:00.000Z', '55 3 * * *');
  ok(!r.logs.some(l => l.includes('cron_unhandled')), '"55 3 * * *" still runs the nightly rollup');
  ok(r.logs.some(l => l.includes('Daily snapshot results')), '...and the rollup actually ran');
}

// ── 3. wrangler.toml and the handler agree ──────────────────────────────────
{
  const toml = fs.readFileSync(path.join(repo, 'wrangler.toml'), 'utf8');
  const top = toml.slice(toml.indexOf('[triggers]'));
  const crons = JSON.parse(/crons\s*=\s*(\[[^\]]*\])/.exec(top)[1]);
  ok(crons.includes('0 * * * *'), 'production crons include the hourly "0 * * * *"');
  ok(!crons.includes('0 12 * * *'), 'production crons no longer include "0 12 * * *"');
  const src = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
  const named = new Set([...src.matchAll(/event\.cron === "([^"]+)"/g)].map(m => m[1]));
  const orphan = crons.filter(c => !named.has(c));
  eq(orphan, ['55 3 * * *'], 'every production cron is named by scheduled(), except the nightly rollup');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
