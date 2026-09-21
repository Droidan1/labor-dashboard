// Opportunity buys — Phase 1: the buy exists, and a print can name it.
//
// 🛑 THE REASON THIS SUITE EXISTS IS ONE PERMISSION FACT THAT LOOKS LIKE THE OPPOSITE OF
// WHAT IT IS. `canUsePage` returns true for anyone `canSeeFinancials` admits, and
// FINANCIAL_ROLES contains "manager". So `requirePage(user, ..., "edit")` — which reads
// exactly like "only people granted edit" — admits EVERY manager, at every level, on every
// page. Brian asked for admin/superuser only on opening and closing a buy. Writing that as
// a page level would have shipped a green diff, a sensible-looking guard, and managers
// quietly closing buys. The explicit role check is the whole point, so it is tested first
// and hardest.
//
// 🔑 The second theme is that a PO is an IDENTITY, not a string. Upper/lower case and
// leading zeros both decide whether two buys are one buy, and getting either wrong splits a
// buy's stock across two rows that nobody reconciles until a total comes out short.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, applyMigrationAlters, ctx, req } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let assertions = 0, failures = 0;
const ok = (c, m) => { assertions++; if (!c) { failures++; console.error('  FAIL ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const worker = await loadWorker(repo);
const { db, env } = makeEnv(repo);
// 056 CREATES sticker_prints and applyMigrationAlters cannot — it replays only ALTERs. 070
// then adds ob_buys and the po column on top of it. Running the ALTERs afterwards picks up
// 057's retail_cents and 069's qty; 070's own ALTER fails there as a duplicate and is
// swallowed, which is the helper's documented behaviour.
for (const m of ['migration-041.sql', 'migration-042.sql', 'migration-043.sql',
                 'migration-056.sql', 'migration-062.sql', 'migration-070.sql',
                 'migration-071.sql'])
  db.exec(fs.readFileSync(path.join(repo, m), 'utf8'));
applyMigrationAlters(db, repo);

const SU = 'u-su', ADMIN = 'u-admin', MGR = 'u-mgr1', EXEC = 'u-exec', STAFF = 'u-staff';
const call = async (url, opts) => {
  const r = await worker.fetch(req(url, opts), env, ctx);
  let j = null;
  try { j = JSON.parse(await r.clone().text()); } catch (_) {}
  return { status: r.status, j };
};
const openBuy = (po, user = SU, extra = {}) =>
  call('/?action=ob-buy-open', { user, method: 'POST', body: { po, ...extra } });

console.log('Opportunity buys');

// ── The permission split, which no page grant can express ────────────────────
{
  const su = await openBuy('SU-1', SU);
  eq(su.status, 200, 'a superuser opens a buy');
  const ad = await openBuy('AD-1', ADMIN);
  eq(ad.status, 200, 'an admin opens a buy');

  // 🛑 THE ONE THAT MATTERS. A manager reaches this endpoint, passes every page check
  // there is, and must still be refused.
  const mgr = await openBuy('MG-1', MGR);
  eq(mgr.status, 403,
     '🛑 A MANAGER CANNOT OPEN A BUY — canUsePage admits every manager at every level, so '
     + 'this can only come from the explicit role check');
  eq(mgr.j?.code, 'NEED_INVENTORY', '…and says which right is missing, not just "Forbidden"');
  const gone = await call('/?action=ob-buy-detail&po=MG-1', { user: SU });
  eq(gone.status, 404, '🔑 …and the refusal wrote NOTHING — the buy does not exist');

  const ex = await openBuy('EX-1', EXEC);
  eq(ex.status, 403, 'nor can an executive, who is also in FINANCIAL_ROLES');

  // But viewing is a normal page grant, and a manager has it.
  const seen = await call('/?action=ob-buy-list', { user: MGR });
  eq(seen.status, 200, '🔑 a manager CAN see the buys — viewing is the page grant, and this '
     + 'split is the whole design');
  eq(seen.j?.can_edit, false, '…and the list tells the client it may not offer Open or Close');

  const admSees = await call('/?action=ob-buy-list', { user: ADMIN });
  eq(admSees.j?.can_edit, true, '…while an admin is told it may');

  // Closing is the same gate as opening. A buy someone else opened is not a manager's to end.
  const close = await call('/?action=ob-buy-close', { user: MGR, method: 'POST', body: { po: 'SU-1' } });
  eq(close.status, 403, '🛑 a manager cannot CLOSE one either');
  const still = await call('/?action=ob-buy-detail&po=SU-1', { user: MGR });
  eq(still.j?.buy?.status, 'open', '…and the buy is untouched by the attempt');
}

// ── A PO is an identity ──────────────────────────────────────────────────────
{
  const a = await openBuy('ob-2026-11', SU);
  eq(a.status, 200, 'a PO may be typed in lower case');
  eq(a.j?.po, 'OB-2026-11', '…and comes back folded to upper case');

  const b = await openBuy('OB-2026-11', SU);
  eq(b.status, 409,
     '🛑 SO THE SAME PO IN ANOTHER CASE IS THE SAME BUY, not a second one holding half the '
     + 'stock');
  eq(b.j?.code, 'PO_EXISTS', '…reported as a duplicate rather than silently replacing it');

  // Leading zeros are part of the number, and an integer parse would eat them.
  const z1 = await openBuy('00412', SU);
  const z2 = await openBuy('412', SU);
  eq(z1.status, 200, '"00412" opens');
  eq(z2.status, 200, '🔑 …and "412" is a DIFFERENT buy — the PO is text, never a number');

  for (const bad of ['', '   ', 'has space', 'semi;colon', '<script>', '-leading', 'x'.repeat(33)]) {
    const r = await openBuy(bad, SU);
    eq(r.status, 400, `a PO of ${JSON.stringify(bad)} is refused`);
  }
  const dated = await openBuy('D-1', SU, { received_on: '11/02/2026' });
  eq(dated.status, 400, 'a received date must read YYYY-MM-DD');
  const units = await openBuy('U-1', SU, { units: -4 });
  eq(units.status, 400, 'units bought cannot be negative');
}

// ── A print names a buy, and the buy counts it ───────────────────────────────
{
  await openBuy('P-1', SU, { label: 'November toys', units: 500 });
  const print = (po, over = {}) => call('/?action=sticker-printed', {
    user: MGR, method: 'POST',
    body: { store: 'BL1', l3: 'FG BL TOYS', price: 2.5, code: 'BL-50008-2_5', title: 'A toy', po, ...over },
  });

  const p1 = await print('P-1', { qty: 4 });
  eq(p1.status, 200, 'a manager prints into an open buy');
  eq(p1.j?.po, 'P-1', '…and the answer confirms which buy it landed in');

  // A second press of the same item at the same store is one line reading ×6, not two lines.
  await print('P-1', { qty: 2 });
  // A different store, so the buy spans two.
  await print('P-1', { store: 'BL4', qty: 3 });
  // And one with NO qty at all — migration-069's "printed before we counted", which reads 1.
  await print('P-1', { store: 'BL2', code: 'BL-50008-10', price: 10 });

  const d = await call('/?action=ob-buy-detail&po=P-1', { user: MGR });
  eq(d.status, 200, 'the buy reads back');
  eq(d.j?.buy?.labels, 10, '🔑 4 + 2 + 3 + (NULL read as 1) = 10 labels — COALESCE(qty,1) is '
     + 'migration-069\'s rule, and summing NULL as 0 would under-report every older row');
  eq(d.j?.buy?.stores, 3, '…across three stores');
  eq(d.j?.buy?.items, 2, '…and two distinct codes');
  eq(d.j?.buy?.units, 500, '…against 500 declared, which is not a print count');

  const bl1 = (d.j?.lines || []).filter(l => l.store === 'BL1');
  eq(bl1.length, 1, '🛑 two presses of one item at one store are ONE line');
  eq(bl1[0]?.labels, 6, '…reading 6 labels');
  eq(bl1[0]?.presses, 2, '…from 2 presses, so the two numbers stay distinguishable');

  // An ordinary print sends no PO and must stay out of every buy.
  const plain = await call('/?action=sticker-printed', {
    user: MGR, method: 'POST',
    body: { store: 'BL1', l3: 'FG BL TOYS', price: 2.5, code: 'BL-50008-2_5', qty: 9 },
  });
  eq(plain.status, 200, 'an ordinary print still works');
  eq(plain.j?.po, null, '…and names no buy');
  const after = await call('/?action=ob-buy-detail&po=P-1', { user: MGR });
  eq(after.j?.buy?.labels, 10, '🔑 …and did not join the buy — NULL is "not part of a buy"');
}

// ── A PO that names no open buy is refused, not stored ───────────────────────
{
  const ghost = await call('/?action=sticker-printed', {
    user: MGR, method: 'POST',
    body: { store: 'BL1', l3: 'FG BL TOYS', price: 2.5, code: 'BL-50008-2_5', po: 'TYPO-9' },
  });
  eq(ghost.status, 409,
     '🛑 A TYPO\'D PO IS REFUSED. Stored, it would be invisible — every buy page starts from '
     + 'ob_buys — so the labels would count against nothing and the real buy would be short');
  eq(ghost.j?.code, 'OB_NOT_OPEN', '…with a code the client can act on');
  const rows = db.prepare("SELECT COUNT(*) AS n FROM sticker_prints WHERE po = 'TYPO-9'").all();
  eq(Number(rows[0].n), 0, '🔑 …and nothing was written');

  await openBuy('C-1', SU);
  await call('/?action=ob-buy-close', { user: SU, method: 'POST', body: { po: 'C-1' } });
  const shut = await call('/?action=sticker-printed', {
    user: MGR, method: 'POST',
    body: { store: 'BL1', l3: 'FG BL TOYS', price: 2.5, code: 'BL-50008-2_5', po: 'C-1' },
  });
  eq(shut.status, 409, '🛑 a CLOSED buy takes no new labels, or "closed" means nothing');
}

// ── Closing is reversible and never touches a print ──────────────────────────
{
  await openBuy('R-1', SU, { label: 'Reopen me' });
  await call('/?action=sticker-printed', {
    user: MGR, method: 'POST',
    body: { store: 'BL1', l3: 'FG BL TOYS', price: 1.5, code: 'BL-50008-1_5', po: 'R-1', qty: 7 },
  });
  const shut = await call('/?action=ob-buy-close', { user: ADMIN, method: 'POST', body: { po: 'R-1' } });
  eq(shut.j?.status, 'closed', 'an admin closes a buy');
  const c = await call('/?action=ob-buy-detail&po=R-1', { user: MGR });
  eq(c.j?.buy?.status, 'closed', '…and it reads closed');
  eq(c.j?.buy?.labels, 7, '🔑 …with every label still counted — closing is not deleting');
  ok(c.j?.buy?.closed_by, '…and records who closed it');

  const back = await call('/?action=ob-buy-close', { user: SU, method: 'POST', body: { po: 'R-1', reopen: true } });
  eq(back.j?.status, 'open', 'and it reopens');
  const r = await call('/?action=ob-buy-detail&po=R-1', { user: MGR });
  eq(r.j?.buy?.closed_by, null, '…clearing who closed it, so the field never describes the past');
  eq(r.j?.buy?.labels, 7, '…prints untouched throughout');
}

// ── A buy with no prints is still a buy ──────────────────────────────────────
{
  await openBuy('EMPTY-1', SU, { label: 'Opened this morning' });
  const list = await call('/?action=ob-buy-list', { user: MGR });
  const row = (list.j?.buys || []).find(b => b.po === 'EMPTY-1');
  ok(row, '🛑 A BUY WITH NOTHING PRICED INTO IT YET STILL APPEARS — that is precisely the '
     + 'row someone is looking for, and an INNER JOIN would hide it');
  eq(row?.labels, 0, '…reading zero labels');
  eq(row?.units, null, '🔑 …and NULL declared units, which is "nobody said" and not zero');
  eq(row?.first_print, null, '…with no first print');
}

// ── A reprint can inherit the buy it came in on ──────────────────────────────
{
  const h = await call('/?action=sticker-history&limit=25', { user: MGR });
  eq(h.status, 200, 'the reprint list reads back');
  const withPo = (h.j?.prints || []).filter(p => p.po);
  ok(withPo.length > 0,
     '🔑 sticker-history CARRIES THE PO, so a reprint can inherit the buy the item came in '
     + 'on rather than landing in whichever buy is selected when a torn label is replaced');
  const plain = (h.j?.prints || []).filter(p => p.po === null);
  ok(plain.length > 0, '…and an ordinary print reports null rather than omitting the field');
}

// ── Staff reach none of it ───────────────────────────────────────────────────
{
  for (const a of ['ob-buy-list', 'ob-buy-detail&po=P-1']) {
    const r = await call(`/?action=${a}`, { user: STAFF });
    eq(r.status, 403, `staff cannot ${a.split('&')[0]} without a page grant`);
  }
  const w = await call('/?action=ob-buy-open', { user: STAFF, method: 'POST', body: { po: 'S-1' } });
  eq(w.status, 403, 'and certainly cannot open a buy');
}

// ── The registries, which a new action silently fails without ────────────────
{
  const src = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
  for (const a of ['ob-buy-list', 'ob-buy-detail', 'ob-buy-open', 'ob-buy-close']) {
    ok(new RegExp(`\\["${a}", "bl"\\]`).test(src),
       `🛑 ${a} is classified in ACTION_BUSINESS — an unclassified action 403s in production`);
  }
  for (const a of ['ob-buy-list', 'ob-buy-detail']) {
    ok(new RegExp(`\\["${a}",\\s*\\["opportunity-buys", "view"\\]\\]`).test(src),
       `${a} is grantable on the opportunity-buys page`);
  }
  ok(!/\["ob-buy-open",\s*\["opportunity-buys"/.test(src),
     '🔑 …and open is NOT in ACTION_PAGE, because a page level cannot express "not managers"');
}


// ── The page renders, twice, and the panel keeps its furniture ───────────────
//
// 🛑 DESIGN.md §4.8 TRAP 8 EXISTS BECAUSE BOTH OF THIS REPO'S SHIPPED TABLE BUGS WERE
// INVISIBLE ON FIRST LOAD. Coverage's status line lived inside the div its render
// overwrites, so it vanished on first paint and every refresh threw on it — the toggle was
// dead on arrival. So this builds the REAL render functions out of index.html and calls
// each of them twice, then checks the things that are NOT the table are still there.
{
  const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  const from = html.indexOf('  function obRenderList(buys, want) {');
  const to = html.indexOf('  function obToggleNew(force) {');
  ok(from > 0 && to > from, 'the buy renderers are where the test expects them');
  const src = html.slice(from, to);

  // A DOM thin enough to build here and real enough for these two functions: they touch
  // #ob-body and #ob-status and nothing else.
  const nodes = {};
  const mk = (id) => (nodes[id] = { id, innerHTML: '', textContent: '', hidden: false });
  ['ob-body', 'ob-status', 'ob-barlbl', 'ob-back', 'ob-filter'].forEach(mk);

  // `window` is in the list because the slice carries the `window.obOpenDetail = ...`
  // exports with it, and those run at BUILD time — without it the whole build throws
  // "window is not defined", the catch below stubs the API, and every assertion after the
  // first few fails describing a render that never ran.
  const ctxNames = ['el', 'escapeHtml', 'obCanEdit', 'obMoney', 'obDay', 'obSay', 'obOpenDetail', 'window'];
  const ctxVals = [
    (id) => nodes[id] || null,
    (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    true,
    (v) => '$' + Number(v || 0).toFixed(2),
    (iso) => (iso ? String(iso).slice(0, 10) : '—'),
    (m) => { nodes['ob-status'].textContent = m; },
    () => {},
    {},
  ];
  let api;
  try {
    api = new Function(...ctxNames, src + '\nreturn { obRenderList, obRenderDetail };')(...ctxVals);
  } catch (e) {
    ok(false, `the buy renderers build in isolation (${e.message})`);
    api = { obRenderList: () => {}, obRenderDetail: () => {} };
  }

  const buys = [
    { po: '99999', label: 'November toys', vendor: 'Acme', status: 'open',
      units: 500, labels: 10, items: 2, stores: 3, received_on: '2026-11-02', opened_at: '2026-11-01T00:00:00Z' },
    { po: 'EMPTY', label: '', vendor: '', status: 'open',
      units: null, labels: 0, items: 0, stores: 0, received_on: null, opened_at: '2026-11-03T00:00:00Z' },
  ];

  api.obRenderList(buys, 'open');
  const first = nodes['ob-body'].innerHTML;
  ok(/99999/.test(first), 'the list renders a buy');
  ok(/none yet/.test(first),
     '🛑 A BUY WITH NOTHING PRINTED SAYS "none yet", NOT 0 — DESIGN.md\'s "no count" rule: '
     + 'zero is a real reading and printing it for an untouched buy claims a buy of nothing');
  ok(/—/.test(first), '…and an undeclared unit count reads as a dash, not as zero');
  ok(/ob-num/.test(first), 'numbers carry the right-aligned tabular class');

  // 🔑 THE SECOND RENDER. Both of the bugs trap 8 describes only appeared here.
  api.obRenderList(buys, 'open');
  eq(nodes['ob-body'].innerHTML, first, '🔑 the SECOND render produces the same markup');
  ok(/label/i.test(nodes['ob-status'].textContent),
     '🛑 …and the status line — which lives OUTSIDE #ob-body, per trap 7 — still speaks');

  // And an empty list, then back to a full one: the render target must recover.
  api.obRenderList([], 'open');
  ok(/No open buys yet/.test(nodes['ob-body'].innerHTML), 'an empty list says so');
  api.obRenderList(buys, 'open');
  eq(nodes['ob-body'].innerHTML, first, '…and rendering a full list after an empty one recovers');

  // The detail view, twice, including the no-lines state.
  const buy = buys[0];
  const lines = [{ store: 'BL1', l3: 'FG BL TOYS', code: 'BL-50008-2_5', title: 'A toy',
                   price: 2.5, retail: null, labels: 6, presses: 2,
                   first_print: '2026-11-02T10:00:00Z', last_print: '2026-11-02T11:00:00Z' }];
  api.obRenderDetail(buy, lines);
  const d1 = nodes['ob-body'].innerHTML;
  ok(/BL-50008-2_5/.test(d1), 'the detail lists the code printed');
  ok(/\$2\.50/.test(d1), '…and our price');
  ok(/—/.test(d1), '🔑 …and a missing street price is a dash, never $0.00 on a shelf report');
  ok(/Close this buy/.test(d1), 'an editor is offered the close control');
  api.obRenderDetail(buy, lines);
  eq(nodes['ob-body'].innerHTML, d1, '🔑 the detail\'s SECOND render matches too');

  api.obRenderDetail({ ...buy, status: 'closed', closed_by: 'a@b.c', closed_at: '2026-12-01T00:00:00Z' }, []);
  ok(/Reopen this buy/.test(nodes['ob-body'].innerHTML), 'a closed buy offers Reopen');
  ok(/priced into this buy yet/.test(nodes['ob-body'].innerHTML),
     '…and a buy with no lines says so rather than drawing an empty table');
}

// ── The page is registered everywhere it has to be ───────────────────────────
//
// 🔑 EACH OF THESE IS A DIFFERENT WAY FOR THE PAGE TO BE INVISIBLE OR TO 403, and none of
// them shows up as an error — the page simply is not there, or the nav item never appears.
{
  const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  const checks = [
    [/\{ id: 'opportunity-buys', label: '[^']+', nav: 'nav-opportunity-buys' \}/,
     'client GRANTABLE_PAGES — without it no admin can tick the page'],
    [/id="nav-opportunity-buys"[^>]*data-page="opportunity-buys"/, 'the sidebar nav item'],
    [/'nav-opportunity-buys': 'bl'/, 'NAV_BUSINESS — unmapped ids show in every business'],
    [/id="more-opportunity-buys"/, 'the More-sheet button'],
    [/gate\('more-opportunity-buys'/, '…and its gate'],
    [/'opportunity-buys': 1/, 'morePages, so the More tab lights on this page'],
    [/id="page-opportunity-buys"/, 'the page container showOnlyPage derives from'],
    [/if \(page === 'opportunity-buys'\)/, 'the router guard and init hook'],
    [/initOppBuys/, 'the init function itself'],
  ];
  for (const [re, what] of checks) ok(re.test(html), `registered: ${what}`);

  // 🛑 AND THE UI NEVER DECIDES THE EDIT RIGHT FOR ITSELF. The page renders its buttons off
  // the worker's can_edit. A role test here would be a second opinion that disagrees with
  // the real gate — and on this feature it would disagree in the permissive direction,
  // because every manager passes canUsePage.
  const page = html.slice(html.indexOf('let obCanEdit'), html.indexOf('window.obSetClosed'));
  ok(/obCanEdit = !!j\.can_edit/.test(page),
     '🛑 the edit controls follow the worker\'s can_edit, not a role check in the browser');
  ok(!/currentUser\.role/.test(page),
     '…and the buys page never reads currentUser.role at all');
}


// ── Phase 2: the PO goes inside the code ─────────────────────────────────────
//
// 🔑 PHASE 1 PUT THE PO IN THE PRINTED TEXT; PHASE 2 PUTS IT IN THE CODE. That is the whole
// difference and it is why this half is expensive: the QR changes, so the Clover item
// changes, so every parser in the repo meets a shape it has never seen. The marker `-P` is
// what stops a PO ever being read as a price — without it `BL-50008-99999` is $99,999.00,
// which mosParseCode has always believed and still does.
{
  // The grammar itself, driven through the real worker rather than re-implemented here.
  const src = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
  const grab = (re, what) => {
    const m = src.match(re);
    ok(m, `${what} is extractable`);
    return m ? m[0] : `function ${what}(){ return null; }`;
  };
  const api = new Function(
    grab(/const OB_PO_MAX = \d+;/, 'OB_PO_MAX') + '\n' +
    grab(/const OB_PO_RE = [^\n]+/, 'OB_PO_RE') + '\n' +
    grab(/function obPo\(raw\) \{[\s\S]*?\n\}/, 'obPo') + '\n' +
    grab(/const stickerPriceCode = \(price\) => \{[\s\S]*?\n\};/, 'stickerPriceCode') + '\n' +
    grab(/const stickerCode = \(categoryCode, price, po\) => \{[\s\S]*?\n\};/, 'stickerCode') + '\n' +
    grab(/function mosNormalizeCode\(raw\) \{[\s\S]*?\n\}/, 'mosNormalizeCode') + '\n' +
    grab(/function mosParseCode\(code\) \{[\s\S]*?\n\}/, 'mosParseCode') + '\n' +
    'return { stickerCode, mosParseCode, mosNormalizeCode, obPo };')();

  // 🛑 EVERY EXISTING SHAPE PARSES IDENTICALLY. This is the property that matters most: a
  // regression here moves prices on shelves that are already out there.
  eq(api.stickerCode(50008, 2.5), 'BL-50008-2_5', 'an ordinary code is unchanged');
  eq(api.stickerCode(50008, 10), 'BL-50008-10', '…including the round-dollar shape with no separator');
  eq(api.mosParseCode('BL-50008-2_5')?.priceCents, 250, 'and still parses to the same price');
  eq(api.mosParseCode('BL-50008-2_5')?.po, null, '…reporting no buy rather than omitting the field');
  eq(api.mosParseCode('BL-10380')?.priceCents, null, 'a priceless sticker is still a sticker');

  // The new shape.
  eq(api.stickerCode(50008, 2.5, '99999'), 'BL-50008-2_5-P99999', 'a buy puts a marked PO on the end');
  const p = api.mosParseCode('BL-50008-2_5-P99999');
  eq(p?.itemNo, '50008', 'which parses back to its category');
  eq(p?.priceCents, 250, '…its price');
  eq(p?.po, '99999', '…and its buy');

  // 🛑 THE MARKER IS THE POINT.
  eq(api.mosParseCode('BL-50008-99999')?.priceCents, 9999900,
     '🛑 an UNMARKED five-digit tail is still $99,999.00 — it always was, which is exactly '
     + 'why the PO had to be marked rather than just appended');
  eq(api.mosParseCode('BL-50008-P99999')?.priceCents, null,
     '🔑 …while the MARKED one carries no price at all');
  eq(api.mosParseCode('BL-50008-P99999')?.po, '99999', '…and names the buy');

  // A PO is an identity here too, and codes are never split on dashes.
  eq(api.stickerCode(50008, 2.5, 'ob-2026-11'), 'BL-50008-2_5-POB-2026-11', 'a PO is folded to upper case');
  eq(api.mosParseCode('BL-50008-2_5-POB-2026-11')?.po, 'OB-2026-11',
     '🔑 …and a PO containing hyphens round-trips, because the parser is one anchored regex '
     + 'and never a split on the dashes');
  eq(api.stickerCode(50008, 2.5, 'has space'), null,
     '🛑 a PO that will not normalise REFUSES the code rather than quietly dropping it — a '
     + 'label that looks right and belongs to no buy is worse than no label');
  eq(api.mosNormalizeCode('bl-50008-2.5-p99999'), 'BL-50008-2_5-P99999',
     'the normaliser folds case and the decimal spelling, PO and all');
}

// ── A scan prices into the buy, end to end ───────────────────────────────────
{
  await openBuy('CODE-1', SU);
  const check = (po, over = {}) => call('/?action=sticker-check', {
    user: MGR, method: 'POST',
    body: { l3: 'FG BL TOYS', price: 2.5, store: 'BL1', po, ...over },
  });

  const bad = await check('NOPE-9');
  eq(bad.status, 200, 'a check against an unknown buy still answers');
  eq(bad.j?.printable, false, '🛑 …but refuses to print');
  eq(bad.j?.reason, 'buy not open', '…naming the buy as the reason, not the category');

  await call('/?action=ob-buy-close', { user: SU, method: 'POST', body: { po: 'CODE-1' } });
  const shut = await check('CODE-1');
  eq(shut.j?.printable, false, '🛑 a CLOSED buy cannot mint new codes either');
  ok(/closed/i.test(shut.j?.detail || ''), '…and says so');
}

// ── A write-off remembers which buy it came out of ───────────────────────────
{
  await openBuy('MOS-1', SU, { label: 'Shrink test' });
  const log = (code) => call('/?action=mos-log', {
    user: MGR, method: 'POST',
    body: { store: 'BL1', code, qty: 2, reason: 'Damaged', description: 'FG BL TOYS' },
  });

  const ob = await log('BL-50008-2_5-PMOS-1');
  eq(ob.status, 200, 'an opportunity-buy sticker can be written off');
  eq(ob.j?.po, 'MOS-1', '🔑 …and the write-off names the buy it came out of');

  const plain = await log('BL-50008-2_5');
  eq(plain.status, 200, 'an ordinary sticker still logs');
  eq(plain.j?.po, null, '…naming no buy, which is the truth for every ordinary write-off');

  const rows = db.prepare("SELECT po, COUNT(*) AS n FROM mos_entries GROUP BY po ORDER BY po").all();
  const byPo = Object.fromEntries(rows.map(r => [String(r.po), Number(r.n)]));
  eq(byPo['MOS-1'], 1, '🛑 the buy is STORED, not re-derived from the code later — the code '
     + 'is rewritten on a reprice and the grammar itself just changed');
  ok(byPo['null'] >= 1, '…and ordinary write-offs stay NULL');

  // 🔑 AND IT IS UNLOGGABLE WITHOUT THE GRAMMAR CHANGE. Before Phase 2 both mos-lookup and
  // mos-log answered 400 BAD_CODE for a four-segment code, so an OB sticker could not be
  // marked out of stock at all. Pinned so a narrowing of the regex shows up here.
  const look = await call('/?action=mos-lookup&store=BL1&code=BL-50008-2_5-PMOS-1', { user: MGR });
  ok(look.status !== 400, '🛑 an OB code is not BAD_CODE — before Phase 2 it was, and an OB '
     + 'item could not be written off at all');
}

// ── The sibling copy prefers an ordinary item ────────────────────────────────
//
// 🛑 THE SIBLING DONATES hidden, taxable AND cost TO A NEW ITEM. An opportunity buy's cost
// is the DEAL cost for one buy, not what the category costs, and a buy's items are exactly
// the ones plausibly left hidden once it is done. siblingRe is `^BL-<cat>-` and unanchored,
// so an OB item matches it — copy from one and an ordinary price point carries a number
// that was never true of it, silently, because it came from a real Clover row.
{
  const src = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
  const fn = src.slice(src.indexOf('async function cloverCodeInUse'),
                       src.indexOf('// ─── Resolve or create a Clover category'));
  ok(/isObCode/.test(fn), 'cloverCodeInUse can tell an OB code from an ordinary one');
  ok(/obFallback/.test(fn),
     '🔑 …and keeps an OB match only as a FALLBACK, so a category holding nothing but OB '
     + 'items can still take a new price point rather than refusing over a cost field');
  ok(fn.indexOf('if (isObCode(c) || isObCode(k))') < fn.indexOf('sibling = take(it);'),
     '🛑 …with the OB test BEFORE the accept, or the first OB row in the page wins anyway');
  for (const ret of ['sibling: sibling || obFallback']) {
    eq((fn.match(new RegExp(ret.replace(/[|]/g, '\\|'), 'g')) || []).length, 2,
       'every return path falls back to the OB sibling rather than returning none');
  }
}

console.log(`\n${assertions - failures} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
