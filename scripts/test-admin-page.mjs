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
//   6. Backfill Last 13 Weeks is retired: no button, no status box, no function.
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
ok(rows.length === 8 && rows.every(r => tools.includes(r)), `every rail row (${rows.join(', ')}) has its tool`);
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
ok(/loadRepairBackups\(\);\n\s+adEnter\(\);/.test(html), 'opening the page runs the shell after the old entry hooks');

// 6. Retired
ok(!/runBackfillSales13w|backfill-sales-status|_backfillFailed|Backfill Last 13 Weeks/.test(html), 'Backfill Last 13 Weeks is gone: button, status box, function and its retry list');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
