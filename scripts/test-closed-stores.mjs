// Which stores the dashboard DRAWS, versus which it COUNTS.
//
// Holland (BL8) closed 2026-07-25 and Wyoming (BL12) 2026-06-15. They are handled
// differently on purpose, and the difference is easy to erase by accident:
//
//   BL12 shares its Clover merchant with BL16 — the register was physically moved.
//   It is out of the worker's ALL_STORES because polling it would fetch Indy East's
//   register and write it under 'BL12', silently doubling Indy. Its date gate
//   (wrsGateDates) splits the shared history between the two codes.
//
//   BL8 has its own merchant that simply returns nothing. It stays IN ALL_STORES
//   because its BUDGET is deliberately still carried — see the note in
//   STORE_CLOSED_FROM: the company plan was never revised for the closure, so the
//   shortfall is a real miss the chain is meant to feel. That was Brian's call on
//   2026-08-11 and the comment says in terms not to undo it without asking.
//
// So the frontend roster answers "draw a card and poll it", and ALL_STORES answers
// "count it". This test pins that separation, because the tempting one-line "tidy
// up" — dropping BL8 from ALL_STORES — would quietly move chain budget attainment
// by 13 points (measured: August 77.9% -> 91.3%).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };

const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
const worker = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');

console.log('\n── Closed stores · drawn vs counted ──');

// ── The worker still COUNTS Holland. This is the load-bearing half.
const allStores = (worker.match(/const ALL_STORES = \[([^\]]+)\]/) || [])[1] || '';
ok(/"BL8"/.test(allStores),
  '🔑 BL8 is STILL in the worker’s ALL_STORES — its budget is carried on purpose');
ok(!/"BL12"/.test(allStores), 'BL12 is not, because polling it would double-count Indy East');
ok(/BL8: '2026-07-25'/.test(worker), 'BL8 has its closure date in STORE_CLOSED_FROM');
ok(/BL12: '2026-06-15'/.test(worker), 'and so does BL12');
ok(/ITS BUDGET IS DELIBERATELY LEFT IN PLACE/.test(worker),
  'the reason the budget stays is still written down where the next person will look');

// ── The frontend no longer DRAWS it.
const roster = (html.match(/const STORES = \[([\s\S]*?)\];/) || [])[1] || '';
ok(roster.length > 0, 'found the dashboard roster');
ok(!/BL8/.test(roster), 'BL8 is out of the dashboard roster — no card, no per-store fetch');
ok(!/BL12/.test(roster), 'BL12 was already out');
const stores = (roster.match(/"/g) || []).length / 2;
const colors = ((html.match(/const COLORS = \[([^\]]+)\]/) || [])[1] || '').split(',').length;
ok(stores === 5, `five trading stores remain (${stores})`);
ok(colors === stores,
  `COLORS stays index-parallel to STORES (${colors} vs ${stores}) — a mismatch silently mis-colours cards`);

// ── But it still SHOWS the history.
const wrsKeys = (html.match(/const WRS_STORE_KEYS\s*=\s*\[([^\]]+)\]/) || [])[1] || '';
ok(/BL8/.test(wrsKeys) && /BL12/.test(wrsKeys),
  'both closed stores stay in WRS_STORE_KEYS, so the numbers they earned stay readable');
ok(/BL8:'Holland'/.test(html.replace(/\s/g, '')), 'and Holland keeps its name');

// ── The badge is derived, not hardcoded to one store.
ok(/const CLOSED_STORES = \{[^}]*BL8[^}]*BL12[^}]*\}/.test(html),
  'CLOSED_STORES lists both, mirroring the worker');
ok(/CLOSED_STORES\[storeKey\] \?/.test(html),
  'the "Closed · historical" badge is derived from it');
ok(!/storeKey === 'BL12' \?/.test(html),
  'and no longer hardcoded to BL12 — the next closure is one line, not a code change');

// ── Guardrails that must not move.
const psList = ((html.match(/const PS_STORES\s*=\s*\[([^\]]+)\]/) || [])[1] || '').replace(/[\s']/g, '');
ok(psList === 'BL1,BL2,BL4,BL8,BL14,BL16',
  `PS_STORES is untouched (${psList}) — scripts/test-price-scan.mjs pins it to ALL_STORES, order included`);
ok(/BL8/.test((html.match(/const SR_ALL\s*=\s*\[([^\]]+)\]/) || [])[1] || ''),
  'SR_ALL keeps BL8 — it drives the supply-request table columns, and dropping it would hide historical requests');

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
