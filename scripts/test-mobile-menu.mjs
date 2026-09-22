// The phone's Menu page is built from the sidebar. This pins the two things about that
// which a text read of index.html CAN prove.
//
// ⚠️ A static source test, with this repo's usual caveat: it cannot see wiring. What the
// Menu actually lists per role, and that every row opens its page, is driven in a real
// browser by scripts/browser-mobile-menu.mjs — run that after touching the sidebar or bar.
//
//   1. Every top-level sidebar page names its Menu section (data-menu-section). An
//      unnamed one still reaches the phone, under a catch-all "More", which is the safety
//      net, not the design — this makes adding a page a decision about where it goes.
//   2. The hand-kept copy is gone and stays gone. The More sheet was 18 buttons plus a
//      gate() line each; the copy drifted until eight pages had no phone route.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };

const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
const sidebar = html.slice(html.indexOf('<!-- Nav Items -->'), html.indexOf('<!-- Bottom Section -->'));
ok(sidebar.length > 1000, 'found the sidebar nav list');

// ── 1. Top-level items name their section; grouped items must not ────────────
// A top-level item is a .nav-item that is not a .nav-subitem and carries a data-page.
const tags = [...sidebar.matchAll(/<div\b[^>]*\bclass="[^"]*\bnav-item\b[^"]*"[^>]*>/g)].map(m => m[0]);
const top = tags.filter(t => /data-page="/.test(t) && !/\bnav-subitem\b/.test(t));
const sub = tags.filter(t => /\bnav-subitem\b/.test(t));
ok(top.length >= 7, `found the top-level sidebar pages (${top.length})`);
const unnamed = top.filter(t => !/data-menu-section="[^"]+"/.test(t)).map(t => t.match(/data-page="([^"]+)"/)[1]);
ok(unnamed.length === 0, `every top-level sidebar page names its Menu section; unnamed: [${unnamed}]`);
// A grouped item takes its group's header as its section; an attribute there would be
// silently ignored, which reads as working while doing nothing.
const stray = sub.filter(t => /data-menu-section=/.test(t)).map(t => (t.match(/id="([^"]+)"/) || [])[1]);
ok(stray.length === 0, `no grouped item carries data-menu-section (it would be ignored); [${stray}]`);

// ── 2. The hand-kept copy is gone ───────────────────────────────────────────
ok(!/id="more-sheet"/.test(html) && !/id="more-scrim"/.test(html), 'the More sheet is gone');
ok(!/gate\('more-/.test(html), 'no gate() line for a More-sheet row survives');
ok(!/morePages/.test(html.replace(/\/\/[^\n]*/g, '')), 'no morePages list in code (the active tab is derived)');

// ── 3. The pieces the Menu is made of exist ─────────────────────────────────
ok(/<div id="page-menu"/.test(html), 'the Menu page exists (showOnlyPage finds it by its page- prefix)');
ok(/<div id="menu-list"><\/div>/.test(html), '#menu-list is an empty render target — it holds only what renderMenuPage owns');
ok(/id="bn-menu" data-tab="menu"/.test(html), 'the bar has a Menu tab whose data-tab is the page id');
// An associate is gated by page grant; the Menu is navigation, not a grantable page.
ok(/isAssociate\(currentUser\) && page !== 'no-access' && page !== 'menu'/.test(html),
   '🛑 navigateToPage lets an associate open the Menu, or their phone has no way to its rows');
ok(/function menuSections\(\)[\s\S]{0,400}#sidebar nav/.test(html), 'the Menu is built by walking #sidebar nav');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
