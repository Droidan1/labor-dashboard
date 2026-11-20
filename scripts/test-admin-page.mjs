// Admin Settings (#page-admin-settings): the markup and wiring of the rail-and-tools layout
// (2026-11-19). scripts/browser-admin-page.mjs drives it in a real browser; this pins what a later
// edit could quietly break without a browser to notice:
//   1. every element id the tools' code reads is still on the page, exactly once — the layout
//      moved them, and a lost id is a tool that fails silently;
//   2. every handler the page calls exists, and Manual entries' one save button still reaches all
//      four of the old save functions;
//   3. every rail row has its tool and every tool has its row;
//   4. no store list is typed into the page — the pickers are filled from STORES;
//   5. every button that rewrites history is labelled so, and the entry hook opens the shell;
//   6. Backfill Last 13 Weeks is retired: no button, no status box, no function;
//   7. Users and Associates moved in as People (every id they read, once), the dialogs outside
//      every tool, admins let in for People, and the announcement push carries its audience;
//   8. the doors: Admin is out of the Bargain Lane sidebar, the superuser's gear on Landing opens it,
//      and Users stays for admins;
//   9. Users shows in every business, and the Edit dialog never asks for a power the admin lacks.
import fs from 'node:fs'; import path from 'node:path';
const html = fs.readFileSync(path.join(process.argv[2] || '.', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS  ' + m); } else { fail++; console.log('  FAIL  ' + m); } };

const a = html.indexOf('<div id="page-admin-settings"');
const b = html.indexOf('<!-- end #page-admin-settings -->');
ok(a > 0 && b > a, 'the Admin Settings page is in index.html');
const page = html.slice(a, b);

// 1. The ids on the page before the restructure, less the retired backfill's status box.
const IDS = `page-admin-settings ann-title ann-items ann-push-btn ann-status rh-store rh-start rh-end rh-run
  rh-status rh-results rh-summary rh-truncated rh-notes rh-bystore rh-needs-empty rh-repair-bar rh-repair rh-needs
  rh-backups-empty rh-backups-wrap rh-backups st-bar st-file st-fields st-preview st-warn st-status resnapshot-store
  resnapshot-date resnapshot-days resnapshot-status rebuild-weeks-status backfill-orders-status mso-store mso-date
  mso-total mso-retail mso-bin mso-auction mso-bulk mso-status mlh-store mlh-date mlh-hours mlh-bulk mlh-status
  srr-store srr-file srr-csv srr-status srr-results isr-store isr-file isr-csv isr-status isr-results im-file im-status
  im-summary im-editor ie-search ie-list ie-new-no ie-new-cost ie-new-desc ie-status ie-dirty cc-search cc-sales-only
  cc-status cc-summary cc-list overrides-store overrides-start overrides-end overrides-status overrides-table-wrap
  overrides-items-section overrides-tbody overrides-items-empty overrides-fallback-section overrides-fallback-tbody
  overrides-fallback-empty overrides-fallback-note overrides-l3rules-section overrides-l3rules-tbody
  overrides-l3rules-empty overrides-l3-section overrides-l3-tbody overrides-l3-empty`.split(/\s+/);
const count = (id) => (html.match(new RegExp(`id="${id}"`, 'g')) || []).length;
const missing = IDS.filter(id => !page.includes(`id="${id}"`));
const doubled = IDS.filter(id => count(id) !== 1);
ok(!missing.length, `all ${IDS.length} ids the tools read are on the page${missing.length ? ' — missing: ' + missing.join(', ') : ''}`);
ok(!doubled.length, `…each exactly once in index.html${doubled.length ? ' — not once: ' + doubled.join(', ') : ''}`);

// 2. Handlers
const handlers = [...new Set([...page.matchAll(/on(?:click|change)="([A-Za-z_$][\w$]*)\(/g)].map(m => m[1]))];
const defined = (fn) => new RegExp(`(?:function ${fn}\\(|window\\.${fn}\\s*=)`).test(html);
const undef = handlers.filter(fn => !defined(fn));
ok(handlers.length >= 25 && !undef.length, `every one of the page's ${handlers.length} onclick/onchange handlers is defined${undef.length ? ' — not: ' + undef.join(', ') : ''}`);
const save = (html.match(/function adSaveManual\(\) \{[\s\S]*?\n  \}/) || [''])[0];
ok(['runManualSalesBulk', 'runManualSalesSingle', 'runManualLaborBulk', 'runManualLaborSingle'].every(f => save.includes(f + '()')),
  'Save and lock reaches all four of the old manual-entry save functions');
ok(/id="ad-manual-save" onclick="adSaveManual\(\)"/.test(page), '…and is the button that calls it');

// 3. Rail ↔ tools
const rows = [...page.matchAll(/class="ad-item" data-tool="([\w-]+)"/g)].map(m => m[1]);
const tools = [...page.matchAll(/class="ad-tool" data-tool="([\w-]+)"/g)].map(m => m[1]);
ok(rows.length === 10 && rows.every(r => tools.includes(r)), `every rail row (${rows.join(', ')}) has its tool`);
ok(tools.filter(t => t !== 'biz').every(t => rows.includes(t)), 'every tool has its rail row (the empty-business view is reached from the business groups)');
ok(/id="ad-biz-groups"/.test(page) && /userBusinesses\(currentUser\)\.filter\(b => b\.id !== 'bl'\)/.test(html),
  'every other business gets a group from userBusinesses, not from a list in the page');
ok((page.match(/class="ad-back"/g) || []).length === tools.length, 'every tool has its way back to the list on a phone');

// 4. Store pickers
ok(!/<option value="BL\d+"/.test(page), 'no store is typed into the page');
const pickers = [...page.matchAll(/<select id="([\w-]+)" class="ad-sel" data-ad-stores="(all|one)"/g)].map(m => m[1] + ':' + m[2]);
ok(JSON.stringify(pickers.sort()) === JSON.stringify(['isr-store:one', 'mlh-store:one', 'mso-store:one', 'overrides-store:one',
  'resnapshot-store:all', 'rh-store:all', 'srr-store:one']), `the seven store pickers are filled from the list, All Stores where it was before (${pickers.join(', ')})`);
ok(/STORES\.map\(split\)/.test(html) && /BUDGET_ONLY_STORES\.map\(split\)/.test(html), '…from STORES, with BUDGET_ONLY_STORES (closed) after them');

// 5. Labels and the entry hook
const histBtns = (page.match(/<button[^>]*class="ad-btn ad-hist"[^>]*>/g) || []).length;
const tagged = (page.match(/<button[^>]*class="ad-btn ad-hist"[^>]*>[^<]*<\/button><span class="ad-tag ad-hist">Rewrites history<\/span>/g) || []).length;
ok(histBtns >= 6 && histBtns === tagged, `every button that rewrites history says so (${tagged} of ${histBtns})`);
ok(/loadRepairBackups\(\);\n\s+\}\n\s+adEnter\(\);/.test(html), 'opening the page runs the shell after the old entry hooks');

// 6. Retired
ok(!/runBackfillSales13w|backfill-sales-status|_backfillFailed|Backfill Last 13 Weeks/.test(html), 'Backfill Last 13 Weeks is gone: button, status box, function and its retry list');

// 7. Phase 2 (2026-11-19): People, the audience
const PEOPLE_IDS = `users-status users-tbody users-table-wrap assoc-tbody invite-modal invite-email invite-role invite-grants
  invite-access-summary invite-status invite-submit-btn edit-user-modal edit-user-email edit-user-id edit-grants edit-status
  edit-approval edit-approval-pin edit-approval-save edit-approval-clear edit-user-status edit-user-submit-btn assoc-modal
  assoc-m-id assoc-m-name assoc-m-pin assoc-m-store-grid assoc-m-pages assoc-m-summary assoc-m-save assoc-reveal-modal
  assoc-rv-code assoc-rv-no assoc-rv-err`.split(/\s+/);
const lostPeople = PEOPLE_IDS.filter(id => count(id) !== 1 || !page.includes(`id="${id}"`));
ok(!lostPeople.length, `every Users-page id the People code reads moved into Admin, once${lostPeople.length ? ' — not: ' + lostPeople.join(', ') : ''}`);
ok(!/id="page-users"/.test(html), 'the old Users page is gone (the sidebar item reroutes to Admin › People)');
const peopleGroup = (page.match(/<div class="ad-group" data-group="people" data-ad-admin>[\s\S]*?\n          <\/div>/) || [''])[0];
ok(/data-tool="users"/.test(peopleGroup) && /data-tool="associates" data-ad-needs="bl"/.test(peopleGroup),
  'People holds Users and Associates, opens for admins, and Associates needs Bargain Lane');
ok(page.indexOf('data-group="people"') < page.indexOf('data-group="hub"'), 'People is first in the rail');
const lastTool = page.lastIndexOf('class="ad-tool"');
ok(['invite-modal', 'edit-user-modal', 'assoc-modal', 'assoc-reveal-modal'].every(m => page.indexOf(`id="${m}"`) > page.indexOf('</section>', lastTool)),
  'the four dialogs sit outside every tool (a fixed overlay inside a hidden tool never shows)');
ok(/if \(page === 'admin-settings'\) \{\n\s+if \(!currentUser \|\| \(currentUser\.role !== 'superuser' && currentUser\.role !== 'admin'\)\) return;/.test(html),
  'Admin Settings opens for the superuser and admins, nobody else');
ok(/if \(currentUser && currentUser\.role === 'superuser'\) \{\n\s+loadCategoryCosts\(\);/.test(html), "…and only the superuser's visit runs the superuser's loaders");
ok(/id="ann-aud"/.test(page) && /body: JSON\.stringify\(\{ title, items, audience: to\.audience \}\)/.test(html),
  'the announcement push sends who it is for');
ok(/u\.grants\.map\(g => `<span class="ad-grant">/.test(html), 'the Users table draws a chip per business grant');

// 8. Phase 3 (2026-11-19): the doors
ok(!/nav-admin-settings/.test(html), 'Admin Settings is out of the Bargain Lane sidebar: no item, no business mapping, no toggle');
ok(/<button id="lp-admin" type="button" onclick="navigateToPage\('admin-settings'\)"[^>]*\n\s+class="hidden /.test(html),
  'the Landing header has an Admin gear that opens Admin, hidden until revealed');
ok(/el\('lp-admin'\)\.classList\.toggle\('hidden', !isSuperuser\);/.test(html), '…and only the superuser gets it');
ok(/<div id="nav-users"[^>]*onclick="navigateToPage\('users'\)"/.test(html) && /el\('nav-users'\)\.classList\.toggle\('hidden', !isAdmin\);/.test(html),
  'Users stays in the sidebar for admins (and the superuser), and opens Admin › People');
ok(/<h1 class="[^"]*">Admin<\/h1>/.test(page), 'the page is called Admin');

// 9. People from any business (2026-11-19)
ok(/'nav-users': null,/.test(html), 'Users is hub-level: it shows inside every business, for that business\'s admins');
ok(/id="edit-status-note"/.test(page) && /const statusLocked = !!u\.elsewhere && !\(currentUser && currentUser\.role === 'superuser'\);/.test(html),
  "the Edit dialog locks the status of someone with access elsewhere, and says why");
ok(/if \(!u \|\| u\.status !== status\) \{\n\s+const r1 = await fetch\(`\$\{WORKER_BASE\}\?action=update-user`/.test(html),
  'Save sends the status only when it changed');
ok(!/ROLE_DOT/.test(html), 'the unused Role-column colour map is gone');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
