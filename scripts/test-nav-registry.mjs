// Checks that the nav REGISTRIES agree with the nav MARKUP.
//
// ⚠️ Read this before trusting it. This is a static source test — it parses
// index.html as text. Per this repo's own lesson (tests-must-drive-real-
// entrypoints), that kind of test CANNOT see wiring and proves nothing about
// behaviour. It is used here for the one thing it is actually good at: checking
// that two pieces of source which must agree, do agree. It cannot tell you
// whether applyBusinessNav hides the right things — only that every id it will
// look for exists, and every id that exists is classified.
//
// The behavioural coverage gap is real and is NOT closed by this file. There is
// no DOM harness in this repo (no node_modules, and jsdom is not a dependency),
// so applyBusinessNav / applyRoleUI / landingPageFor / enterBusiness are
// verified by driving them in a real browser. What that verification found, and
// what a future harness must keep pinned:
//
//   1. applyBusinessNav only ever ADDED `hidden`, and applyRoleUI — its only
//      un-hider — runs exactly once at boot. Entering E-Commerce and returning
//      to Bargain Lane left BL's entire sidebar hidden until a hard reload.
//   2. The boot router is `if (landing !== 'dashboard') navigateToPage(...)`,
//      so applyBusinessNav never ran at boot for anyone landing on the
//      dashboard — leaking other businesses' nav items into Bargain Lane.
//
// Both were invisible to an earlier check that re-ran applyRoleUI between
// switches, which reset the very state it was measuring. A future DOM test must
// switch businesses WITHOUT re-running applyRoleUI.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };

const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');

// ── Parse NAV_BUSINESS ─────────────────────────────────────────────────────
const navBizBlock = html.match(/const NAV_BUSINESS = \{([\s\S]*?)\n  \};/);
ok(!!navBizBlock, 'NAV_BUSINESS object is present and parseable');
const registry = {};
for (const m of (navBizBlock ? navBizBlock[1] : '').matchAll(/'([\w-]+)'\s*:\s*(?:'([\w-]+)'|null)/g)) {
  registry[m[1]] = m[2] === undefined ? null : m[2];
}
ok(Object.keys(registry).length >= 10,
   `registry parsed (${Object.keys(registry).length} entries)`);

// ── Every nav id in the sidebar must be classified ─────────────────────────
// This is navBusinessAudit()'s rule (index.html exposes it on window), which has
// never had a caller. An unmapped id stays VISIBLE by design, so a miss shows up
// as a stray item in the wrong business rather than as an error.
const sidebar = html.slice(html.indexOf('<!-- Nav Items -->'), html.indexOf('<!-- Bottom Section -->'));
const sidebarIds = [...sidebar.matchAll(/id="(nav-[\w-]+)"/g)].map(m => m[1]);
ok(sidebarIds.length > 0, 'found nav ids in the sidebar markup');
const unmapped = sidebarIds.filter(id => !(id in registry));
ok(unmapped.length === 0, `every sidebar nav id is classified; unmapped: [${unmapped}]`);

// ── ...and every registry key must still exist in the markup ───────────────
// Catches an entry left behind after a nav item is removed. That matters more
// than it looks: dashboardPageFor / businessHasSurface decide a business's front
// door, and a registry naming a business whose item is gone would leave that
// business classified but unreachable.
const allNavIds = new Set([...html.matchAll(/id="(nav-[\w-]+)"/g)].map(m => m[1]));
const orphans = Object.keys(registry).filter(id => !allNavIds.has(id));
ok(orphans.length === 0, `every registry key exists in the markup; orphans: [${orphans}]`);

// ── Business ids must be real ──────────────────────────────────────────────
// A typo'd business id ('ecomm') would make that whole business's nav silently
// vanish — applyBusinessNav would hide the item for every real business.
const seeded = new Set();
for (const f of fs.readdirSync(repo).filter(f => /^migration-\d+\.sql$/.test(f))) {
  const sql = fs.readFileSync(path.join(repo, f), 'utf8');
  for (const m of sql.matchAll(/INSERT OR IGNORE INTO businesses[\s\S]*?VALUES\s*\('([\w-]+)'/g)) {
    seeded.add(m[1]);
  }
}
ok(seeded.has('bl') && seeded.has('ecom'), `migrations seed bl and ecom; got [${[...seeded]}]`);
const badBiz = [...new Set(Object.values(registry))].filter(v => v !== null && !seeded.has(v));
ok(badBiz.length === 0, `every registry business id is seeded by a migration; unknown: [${badBiz}]`);

// ── E-Commerce must own at least one nav item ──────────────────────────────
// Otherwise entering it shows a business with no navigation at all — which is
// exactly the state before this change.
const ecomItems = Object.entries(registry).filter(([, v]) => v === 'ecom').map(([k]) => k);
ok(ecomItems.length >= 1, `E-Commerce owns at least one nav item; got [${ecomItems}]`);

// ── The mobile More sheet must mirror the sidebar, not diverge from it ─────
// Every bottom-nav gate is written as gate('more-x', vis('nav-y')); if nav-y does
// not exist, vis() is false forever and the row is dead with no error anywhere.
const gates = [...html.matchAll(/gate\('([\w-]+)',\s*[^)]*?vis\('(nav-[\w-]+)'\)/g)]
  .map(m => ({ target: m[1], navId: m[2] }));
ok(gates.length > 0, `found bottom-nav gate() mirrors (${gates.length})`);
const deadGates = gates.filter(g => !allNavIds.has(g.navId));
ok(deadGates.length === 0,
   `every gate() mirrors a real nav id; dead: [${deadGates.map(g => g.target + '→' + g.navId)}]`);
// ...and each gated target must itself exist in the markup.
const missingTargets = gates.filter(g => !new RegExp(`id="${g.target}"`).test(html));
ok(missingTargets.length === 0,
   `every gate() target exists in the markup; missing: [${missingTargets.map(g => g.target)}]`);

// ── Every page a business can be sent to must exist ────────────────────────
// dashboardPageFor is the front door; showOnlyPage is what actually un-hides a
// div. That used to be a hardcoded `pages` array and a front door missing from it
// would enter, hide every other page, and show a blank shell — which is exactly
// what Marketing > Comments shipped as. The switcher is now DOM-derived, so the
// membership check below reduces to "the section exists"; the block at the end of
// this file pins that it STAYS derived.
const dpf = html.match(/function dashboardPageFor\(businessId\) \{([\s\S]*?)\n  \}/);
ok(!!dpf, 'dashboardPageFor is present');
const frontDoors = [...(dpf ? dpf[1] : '').matchAll(/return '([\w-]+)'/g)].map(m => m[1])
  .filter(p => p !== 'landing');
ok(frontDoors.length >= 2, `front doors found: [${frontDoors}]`);
for (const p of frontDoors) {
  ok(new RegExp(`id="page-${p}"`).test(html),
     `front door '${p}' is reachable by the DOM-derived switcher (a #page-${p} section exists)`);
  ok(new RegExp(`id="page-${p}"`).test(html), `front door '${p}' has a #page-${p} element`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

// ── Page switcher reachability ────────────────────────────────────────
// Added after Marketing > Comments shipped as a BLANK SCREEN: navigateToPage
// held a hardcoded list of page ids, 'comments' was not in it, so the new
// section never un-hid AND every other section got hidden. The nav item lit up
// correctly, which made it look like a rendering bug rather than a registry one.
//
// The fix was to derive the list from the DOM. This pins that it stays derived —
// a future hardcoded list would reintroduce exactly the same failure.
{
  const src = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');

  const domPages = [...new Set([...src.matchAll(/id="page-([a-z-]+)"/g)].map(m => m[1]))].sort();
  ok(domPages.length > 10, `found ${domPages.length} page sections in the DOM`);

  // Every page section must be reachable through the shared switcher.
  ok(/function showOnlyPage\(name\)/.test(src), 'showOnlyPage() exists as the single page switcher');
  ok(/document\.querySelectorAll\('\[id\^="page-"\]'\)/.test(src),
     'showOnlyPage derives its list from the DOM, not a hardcoded array');

  // No caller may go back to hand-rolling the list.
  const hardcoded = [...src.matchAll(/const pages = \[[^\]]*'dashboard'[^\]]*\]/g)];
  ok(hardcoded.length === 0,
     `no hardcoded page-id array remains (found ${hardcoded.length}) — that is what blanked the screen`);

  // Both switch points must call it.
  const calls = (src.match(/showOnlyPage\(/g) || []).length;
  ok(calls >= 3, `showOnlyPage is defined and called at every switch point (${calls} references)`);

  // And the page the nav points at must actually exist as a section.
  const navPages = [...new Set([...src.matchAll(/data-page="([a-z-]+)"/g)].map(m => m[1]))];
  const missing = navPages.filter(p => !domPages.includes(p));
  ok(missing.length === 0, `every nav data-page has a matching page- section (missing: ${missing.join(', ') || 'none'})`);
}
