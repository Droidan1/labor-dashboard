// The Hour x-axis on the Categories tab.
//
// Every other granularity re-cuts a payload that is ALREADY IN MEMORY — day, week and
// month are three ways of grouping the same `category-series` response, which is why
// switching between them costs nothing. Hours are not: they come from a different
// endpoint (`category-hours`), keyed per `YYYY-MM-DDTHH` instead of per date, and behind
// that a live Clover read for any day not yet banked.
//
// That makes three invariants load-bearing, and all three are asserted here:
//
//   1. The bucket primitive must be a list of SLOT KEYS, not a date range to re-walk.
//      ctCuts used to emit {key, days:[…]} and ctDayValue re-derived the list by stepping
//      one CT_DAY_MS at a time, which is exactly what made anything finer than a day
//      inexpressible. Reverting that reintroduces the ceiling.
//   2. The grain must be part of ctDailyKey — or selecting Hour reuses the day payload
//      and silently draws day numbers on an hour axis.
//   3. But the grain setter must NOT clear ctDailyKey, or every Day↔Week↔Month switch
//      becomes a round trip. Both halves matter; I shipped the second one broken once and
//      a request-counting browser check caught it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };

const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
// Some of these are `async function`, so match both spellings rather than
// silently slicing an empty string and reporting every assertion as a failure.
const at = (name, from = 0) => {
  const i = html.indexOf(`  function ${name}(`, from);
  const j = html.indexOf(`  async function ${name}(`, from);
  return i >= 0 && (j < 0 || i < j) ? i : j;
};
const fnSrc = (name, next) => {
  const from = at(name);
  const to = at(next, from + 1);
  ok(from > 0 && to > from, `found ${name} in index.html`);
  return html.slice(from, to);
};

console.log('\n── Categories · Hour x-axis ──');

const cuts = fnSrc('ctCuts', 'ctBucketRows');
const win  = fnSrc('ctVsWindow', 'ctSlotValue');
const val  = fnSrc('ctSlotValue', 'ctFetchRange');
const load = fnSrc('loadCatTrend', 'renderCatTrend');

// 1. The bucket primitive is a slot list.
ok(/cur = \{ key, slots: \[\] \}/.test(cuts), 'ctCuts emits buckets carrying `slots`, not `days`');
ok(!/\bdays: \[\]/.test(cuts), 'and the old date-list field is gone');
ok(/g === 'hour'/.test(cuts), 'ctCuts understands an hour grain');
ok(/for \(let h = 0; h < 24; h\+\+\)/.test(cuts),
  'it emits ALL 24 hours — A and B are matched by index, so a missing hour misaligns them');
ok(/ds \+ 'T' \+ String\(h\)\.padStart\(2, '0'\)/.test(cuts), 'slot keys are YYYY-MM-DDTHH');
ok(/\(g === 'day' \|\| g === 'hour'\) \? false/.test(cuts), 'an hour is never a partial bucket');

// 2. Nothing re-derives a range by stepping.
ok(/for \(const d of slots\)/.test(val), 'ctSlotValue sums the bucket’s own slot keys');
ok(!/CT_DAY_MS/.test(val), 'and contains NO day arithmetic — that was the ceiling');
ok(/cur: c\.slots/.test(win) && /prv: m \? m\.slots : null/.test(win),
  'window points carry the slot lists themselves, not their endpoints');
ok(!/ctDayValue/.test(html.slice(html.indexOf('function ctBucketRows'), html.indexOf('function ctDrawStatus'))),
  'no caller of the old ctDayValue survives');

// 3. The cache key carries the grain; the setter does not clear it.
ok(/const hourly = ctGranFor\(a\) === 'hour';/.test(load), 'loadCatTrend decides the grain up front');
ok(/\$\{ctState\.store\}\|\$\{hourly \? 'hour' : 'day'\}/.test(load),
  'ctDailyKey includes the grain, so Hour cannot reuse the day payload');
ok(/ctFetchRange\(a, hourly\), ctFetchRange\(b, hourly\)/.test(load), 'and both ranges are fetched at that grain');
const granSetter = html.slice(html.indexOf("ctPillGroup(el('ct-gran')"), html.indexOf("ctPillGroup(el('ct-measure')"));
ok(/\['hour', 'Hour', hourWhy\]/.test(granSetter), 'the Hour pill carries a reason when it is unavailable');
ok(!/ctDailyKey = ''/.test(granSetter),
  'the grain setter does NOT clear ctDailyKey — that would make Day/Week/Month refetch');

// 4. Two endpoints, one payload shape.
const fetchR = fnSrc('ctFetchRange', 'ctMergeSeries');
ok(/hourly \? 'category-hours' : 'category-series'/.test(fetchR), 'the grain picks the endpoint');
ok(/Hour by hour is capped at \$\{j\.limit\} days/.test(fetchR), 'a 413 from the hour endpoint reads as an hour refusal');

// 5. The cap is mirrored from the worker, and refused before asking.
const worker = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
const wCap = (worker.match(/const CATEGORY_HOURS_MAX_DAYS = (\d+);/) || [])[1];
const fCap = (html.match(/const CT_MAX_HOUR_DAYS = (\d+);/) || [])[1];
ok(wCap && fCap && wCap === fCap, `the two halves agree on the cap (worker ${wCap}, frontend ${fCap})`);
ok(/ctDays\(r\.from, r\.to\) > CT_MAX_HOUR_DAYS/.test(load), 'the hour range is refused BEFORE a request goes out');
ok(/which, hour: true, days:/.test(load), 'and the refusal is tagged so it can say WHICH ceiling was hit');

// 6. Auto reaches for hours on a single day, and ONLY there.
//
// This is a deliberate reversal: hours cost a live Clover read per store-day, so auto
// originally refused to spend that unasked. But a one-day range cut by 'day' is a
// one-point chart, which is no chart at all, and that is the one case where hours are
// unambiguously the better default.
//
// Comments stripped before matching: the reasoning is written in one, and matching the
// prose instead of the code is how an assertion passes while the code rots.
const granFor = fnSrc('ctGranFor', 'ctStoreDays').replace(/\/\/[^\n]*/g, '');
const autoBranch = granFor.split("if (ctState.gran !== 'auto') return ctState.gran;")[1] || '';
ok(/if \(n === 1 && ctDays\(b\.from, b\.to\) === 1\) return 'hour';/.test(autoBranch),
  'auto picks hour for a single day');
ok(/const b = ctRangeB\(\);/.test(autoBranch),
  'and weighs the COMPARISON range too — a pinned B need not match A\u2019s length');
ok((autoBranch.match(/'hour'/g) || []).length === 1,
  'hour appears exactly once in the auto branch — it is the single-day case, nothing wider');
ok(/return n <= 31 \? 'day' : n <= 182 \? 'week' : 'month';/.test(autoBranch),
  'every other range still picks day/week/month exactly as before');
// The guard is the whole point: auto must never land in a state the loader refuses.
ok(autoBranch.indexOf('ctRangeB()') < autoBranch.indexOf("return 'hour'"),
  'B is measured BEFORE hour is returned, so a pinned long B cannot be auto-selected into a refusal');

// 7. The one-day plural, which an hour axis makes the common case.
ok(/const ctPlural = \(n, noun\)/.test(html), 'there is a plural helper');
ok(!/' days of the previous period'/.test(html), 'the status no longer hardcodes "days"');
ok(!/\+ ' days, previous period'/.test(html), 'nor does the derived range label');

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
