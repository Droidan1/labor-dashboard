// An opportunity buy's own manifest, driven through the real endpoints.
//
// Brian, 2026-09-21: "in the Open a buy card add a feature for admin to unload a CSV
// manifest with product barcode (upc), description, quantity, are price, and street price
// (MRSP). And use this manifest for users when they scan a product from this PO this is
// where data will come from."
//
// Four things here fail SILENTLY if they fail, which is why this suite exists:
//
//   1. "OUR PRICE" MEANS OPPOSITE THINGS on the two kinds of sheet. On a vendor's manifest
//      it is what THEY charge — a cost. On a buy sheet it is what WE ring it up for. One
//      hint table cannot hold both, and reading either as the other inverts every margin
//      the Scorer computes or prints a wholesale figure on a label. Nothing errors.
//   2. THE TWO SIDES SPELL A BARCODE DIFFERENTLY. Manifest identifiers are kept as the
//      vendor wrote them; every scan is canonicalised at the door. So a UPC-A written as
//      an EAN-13 does not compare equal, and the scan answers "not on this manifest" —
//      the wrong answer wearing the right words.
//   3. A FAILED UPLOAD MUST NOT COST THE BUY ITS WORKING SHEET. One live manifest per PO
//      is enforced by the database, so a new row that wins that slot and then fails to
//      fill retires the old one and answers nothing.
//   4. THREE DIFFERENT PROBLEMS LOOK ALIKE from the floor: no manifest on the buy, a
//      manifest that lacks this barcode, and a line with a blank price cell. They are
//      fixed in three different places and must not collapse into one empty answer.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, applyMigrationAlters, ctx, req } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const worker = await loadWorker(repo);
const { db, env } = makeEnv(repo);
// 043 creates manifests/manifest_lines, 056 sticker_prints, 070 ob_buys, 073 the OB
// columns' indexes — applyMigrationAlters replays ALTERs only, so the UNIQUE partial index
// that makes "one live manifest per PO" a database fact has to come from the file itself.
for (const m of ['migration-041.sql', 'migration-042.sql', 'migration-043.sql',
                 'migration-056.sql', 'migration-064.sql', 'migration-070.sql',
                 'migration-072.sql', 'migration-073.sql'])
  db.exec(fs.readFileSync(path.join(repo, m), 'utf8'));
applyMigrationAlters(db, repo);

// No scan in this suite may reach the network: every barcode below is either on a sheet or
// deliberately unknown, and a real lookup would make the result depend on the internet.
let searchCalls = 0;
globalThis.fetch = async (u) => {
  const url = String(u);
  if (url.startsWith('https://api.search.tinyfish.ai')) { searchCalls++; return new Response(JSON.stringify({ results: [] }), { status: 200 }); }
  if (url.startsWith('https://api.fetch.tinyfish.ai')) return new Response(JSON.stringify({ results: [] }), { status: 200 });
  if (url.includes('api.anthropic.com')) return new Response(JSON.stringify({ content: [{ type: 'text', text: '{"rows":[],"items":[],"prices":[]}' }] }), { status: 200 });
  throw new Error('unexpected egress: ' + url.slice(0, 70));
};
env.ANTHROPIC_API_KEY = 'sk-test';
env.TINYFISH_API_KEY = 'tf-test';

const call = async (url, opts) => {
  const r = await worker.fetch(req(url, opts), env, ctx);
  const t = await r.text();
  let body; try { body = JSON.parse(t); } catch { body = { _raw: t.slice(0, 300) }; }
  return { status: r.status, body };
};
const post = (action, body, user = 'u-su') => call(`/?action=${action}`, { user, method: 'POST', body });
const get  = (action, user = 'u-su') => call(`/?action=${action}`, { user });

const openBuy = (po, extra = {}) => post('ob-buy-open', { po, ...extra });
const upload  = (body, user = 'u-su') => post('manifest-upload', body, user);
const scan    = (body, user = 'u-su') => post('merch-scan', body);

// Brian's own sheet. Deliberately spells the refried beans as a 13-digit EAN and the
// Pringles as a bare 12 — one file carrying both spellings is the real case.
const OB_CSV = [
  'UPC,Description,Qty,Our Price,Street Price',
  '0085239098745,Refried Beans 16oz,48,1.00,1.29',
  '038000138416,Pringles Original 5.2oz,24,1.50,2.49',
  '0*7*,Broken Barcode Item,5,2.00,3.00',
  '070330731608,No Price Item,12,,4.99',
].join('\n');

console.log('OB manifest');

// ── Who may attach a sheet to a buy ──────────────────────────────────────────
{
  const o = await openBuy('OB-1');
  eq(o.status, 200, 'a superuser opens buy OB-1');

  // 🛑 A manager passes requireAdminAccess's page reading and every page grant there is.
  // Attaching a manifest decides what the floor charges, so it is the same gate as opening
  // the buy — explicitly, not by hoping the surrounding check is strict enough.
  const mgr = await upload({ load_id: 'OB-1', csv: OB_CSV }, 'u-mgr1');
  eq(mgr.status, 403, '🛑 a manager may not attach a manifest to a buy');
  const staff = await upload({ load_id: 'OB-1', csv: OB_CSV }, 'u-staff');
  eq(staff.status, 403, '…nor may staff');
  const adm = await upload({ load_id: 'OB-1', csv: OB_CSV, filename: 'ob1.csv' }, 'u-admin');
  eq(adm.status, 200, 'an admin may');
}

// ── The PO has to name a buy that is open ────────────────────────────────────
{
  const none = await upload({ load_id: 'OB-NOPE', csv: OB_CSV });
  eq(none.status, 404, 'a PO with no buy behind it is refused');
  eq(none.body.code, 'NO_BUY', '…by name, so the page can say "open it first"');
  eq(db.prepare("SELECT COUNT(*) c FROM ob_buys WHERE po = 'OB-NOPE'").get().c, 0,
     '🛑 …and the buy is NOT created as a side effect of a typo');

  await openBuy('OB-SHUT');
  await post('ob-buy-close', { po: 'OB-SHUT' });
  const shut = await upload({ load_id: 'OB-SHUT', csv: OB_CSV });
  eq(shut.status, 409, 'a closed buy will not take a new manifest');
  eq(shut.body.code, 'BUY_CLOSED', '…and says so, rather than reporting a missing buy');

  // 🛑 The dangerous failure: dropping an unreadable PO and filing the sheet as an ordinary
  // vendor manifest. That returns 200, answers no scan, and nobody ever learns.
  const bad = await upload({ load_id: 'not a po!', csv: OB_CSV });
  eq(bad.status, 400, '🛑 a PO that will not normalise FAILS');
  eq(bad.body.code, 'BAD_PO', '…it never silently becomes a Scorer upload');
  eq(db.prepare("SELECT COUNT(*) c FROM manifests WHERE load_id IS NULL AND vendor LIKE 'PO %'").get().c, 0,
     '…and nothing was written');
}

// ── What a good sheet produces ───────────────────────────────────────────────
{
  const rows = db.prepare(`
    SELECT l.identifier, l.ob_upc, l.ob_price, l.msrp, l.qty, l.description, l.flags
      FROM manifest_lines l JOIN manifests m ON m.id = l.manifest_id
     WHERE m.load_id = 'OB-1' AND m.superseded_at IS NULL ORDER BY l.row_no`).all();
  eq(rows.length, 4, 'every line on the sheet is written, including the unusable ones');

  eq(rows[0].identifier, '0085239098745', "the sheet's own spelling is kept verbatim");
  eq(rows[0].ob_upc, '085239098745', '🔑 …alongside the canonical form a scan can match');
  eq(rows[0].ob_price, 1.0, '"Our Price" is read as OUR price');
  eq(rows[0].msrp, 1.29, '…and "Street Price" as the street price');
  eq(rows[0].qty, 48, '…with how many of it the buy expects');

  eq(rows[1].ob_upc, '038000138416', 'a bare 12-digit UPC canonicalises to itself');

  // Two ways a line can be on the sheet and unreachable, each named on the line.
  eq(rows[2].ob_upc, null, 'an identifier that is not a barcode gets no ob_upc');
  ok(/not a barcode/.test(rows[2].flags), '…and the line says why it can never be scanned');
  eq(rows[3].ob_price, null, 'a blank price cell stays NULL, never 0.00');
  ok(/no our-price/.test(rows[3].flags), '…and the line says that too');

  const r = await upload({ load_id: 'OB-1', csv: OB_CSV, filename: 'again.csv' });
  eq(r.body.rows, 4, 'the upload reports what it read');
  eq(r.body.ob_matchable, 2, '🔑 …and, separately, how many lines a scan can actually reach');
  eq(r.body.ob_priced, 3, '…and how many carry a price');
  eq(r.body.ob_units, 89, '…and the units the sheet accounts for');
  ok(/cannot be reached by a scan/.test(r.body.note || ''),
     '…with the shortfall spelled out rather than left to be noticed');
}

// ── A price column means the opposite thing on a vendor's sheet ──────────────
{
  // 🛑 THE CONCRETE REGRESSION AN OB-ONLY HINT TABLE PREVENTS. manifestGuessMap claims a
  // header ONCE, so an ob_price pattern living in the shared table would take a bare
  // "Price" before `cost` could — and a vendor sheet whose only money column is "Price"
  // would arrive with no cost at all, refused at upload for a column it plainly has.
  const VENDOR_CSV = [
    'UPC,Description,Qty,Price,Street Price',
    '024100113163,Cheez-It Original 12.4 oz,100,0.81,4.28',
  ].join('\n');
  const v = await upload({ vendor: 'Closeout Co', csv: VENDOR_CSV, filename: 'vendor.csv' });
  eq(v.status, 200, 'an ordinary vendor manifest still uploads');
  eq(v.body.column_map.cost, 'Price', '🛑 …and a bare "Price" is still read as a COST there');
  eq(v.body.column_map.ob_price, undefined, '…never as a shelf price');
  eq(v.body.column_map.msrp, 'Street Price', '…while "Street Price" is now read at all, which it was not');
  const vl = db.prepare(`SELECT cost, msrp, ob_price, ob_upc FROM manifest_lines l
     JOIN manifests m ON m.id = l.manifest_id WHERE m.vendor = 'Closeout Co'`).get();
  eq(vl.cost, 0.81, '…the number lands in cost');
  eq(vl.msrp, 4.28, '…and the street price in msrp');
  eq(vl.ob_price, null, '…ob_price is untouched on a vendor line');
  eq(vl.ob_upc, null, '🔑 …as is ob_upc: no scan can reach a Scorer line, so it stays out of the index');

  // The same header, on a buy sheet, goes the other way.
  await openBuy('OB-BARE-PRICE');
  await upload({ load_id: 'OB-BARE-PRICE', csv: [
    'UPC,Description,Qty,Price,Street Price',
    '024100113163,Cheez-It Original 12.4 oz,100,2.50,4.28',
  ].join('\n') });
  const b = db.prepare(`SELECT cost, ob_price FROM manifest_lines l JOIN manifests m ON m.id = l.manifest_id
     WHERE m.load_id = 'OB-BARE-PRICE' AND m.superseded_at IS NULL`).get();
  eq(b.ob_price, 2.50, '🔑 …on a BUY sheet the identical header is our shelf price');
  eq(b.cost, null, '…and nothing was filed as a cost');

  // And the buy's own vendor names the sheet, so nobody retypes it.
  const filed = db.prepare(`SELECT vendor FROM manifests WHERE load_id = 'OB-BARE-PRICE'`).get();
  eq(filed.vendor, 'PO OB-BARE-PRICE', 'a buy with no vendor files its sheet under the PO, never under ""');
}

// ── The Scorer never shows a buy's sheet ─────────────────────────────────────
{
  const list = await get('manifests');
  eq(list.status, 200, 'the Scorer lists its manifests');
  const ids = (list.body.manifests || []).map(m => m.load_id);
  eq(ids.some(x => x), false, '🔑 …and not one of them belongs to a buy');
  ok((list.body.manifests || []).length >= 1, '…the vendor manifest is still there');

  const ob = db.prepare(`SELECT id FROM manifests WHERE load_id = 'OB-1' AND superseded_at IS NULL`).get();
  const del = await post('manifest-delete', { id: ob.id });
  eq(del.status, 409, "🛑 the Scorer's delete cannot reach a buy's sheet");
  eq(del.body.code, 'OB_MANIFEST', '…and says to replace it from the buy instead');
  eq(db.prepare('SELECT COUNT(*) c FROM manifests WHERE id = ?').get(ob.id).c, 1, '…the sheet survives');
}

// ── Re-upload replaces, and the old sheet is kept ────────────────────────────
{
  const live = () => db.prepare(
    `SELECT id, filename FROM manifests WHERE load_id = 'OB-1' AND superseded_at IS NULL`).all();
  eq(live().length, 1, '🔑 exactly one manifest is live for a PO, after three uploads');

  const before = live()[0].id;
  const r = await upload({ load_id: 'OB-1', csv: OB_CSV, filename: 'third.csv' });
  eq(r.status, 200, 'a replacement uploads');
  eq(r.body.replaced?.id, before, '…and names the sheet it displaced');
  eq(r.body.replaced?.lines, 4, '…with what was on it');
  eq(live().length, 1, 'still exactly one live sheet');
  eq(live()[0].filename, 'third.csv', '…and it is the new one');
  eq(db.prepare(`SELECT COUNT(*) c FROM manifests WHERE load_id = 'OB-1' AND superseded_at IS NOT NULL`).get().c, 2,
     '🔑 …while both earlier sheets are KEPT — a price shown last week stays explicable');
  eq(db.prepare(`SELECT COUNT(*) c FROM manifest_lines l JOIN manifests m ON m.id = l.manifest_id
     WHERE m.load_id = 'OB-1'`).get().c, 12, '…lines and all');
}

// ── 🛑 A sheet that cannot be used never costs the buy the one that works ────
{
  const liveBefore = db.prepare(
    `SELECT id, filename FROM manifests WHERE load_id = 'OB-1' AND superseded_at IS NULL`).get();

  // No price column at all. Under the Scorer's rule this would insert the manifest, skip
  // the lines and ask the human to fix the mapping — which here means an EMPTY sheet
  // holding the one-live-per-PO slot while every scan answers nothing.
  const r = await upload({ load_id: 'OB-1', filename: 'broken.csv', csv: [
    'UPC,Description,Qty', '038000138416,Pringles,24',
  ].join('\n') });
  eq(r.status, 400, '🛑 a buy sheet with no price column is refused');
  eq(r.body.code, 'MISSING_COLUMNS', '…by name');
  eq(JSON.stringify(r.body.missing), '["our price"]', "…naming the column in Brian's words");

  const liveAfter = db.prepare(
    `SELECT id, filename FROM manifests WHERE load_id = 'OB-1' AND superseded_at IS NULL`).get();
  eq(liveAfter.id, liveBefore.id, '🔑 …and the buy still has the sheet it had');
  eq(db.prepare(`SELECT COUNT(*) c FROM manifests WHERE filename = 'broken.csv'`).get().c, 0,
     '…nothing was written at all, not even an inert row');
}

// ── The scan: the sheet outranks the ladder ──────────────────────────────────
{
  // 🔑 THE ASSERTION THIS WHOLE FEATURE TURNS ON. The sheet spells it 0085239098745; the
  // scanner reads 085239098745. Matching on the raw identifier would miss — cleanly,
  // reporting "not on this manifest" — and nobody would ever see an error.
  const r = await scan({ identifier: '085239098745', po: 'OB-1' });
  eq(r.status, 200, 'a scan against a buy answers');
  eq(r.body.price, 1.0, "🔑 …at the sheet's price");
  eq(r.body.price_basis, "the buy's manifest", '…and says where that came from');
  eq(r.body.manifest.matched, true, '…having matched the line');
  eq(r.body.manifest.description, 'Refried Beans 16oz', '…carrying the description');
  eq(r.body.manifest.qty, 48, '…the quantity the buy expects');
  eq(r.body.manifest.street_price, 1.29, '…and the street price off the sheet');
  eq(r.body.manifest.sheet_identifier, '0085239098745',
     '🔑 …with the sheet\'s OWN spelling, which is the thing that did not match');
  eq(r.body.title, 'Refried Beans 16oz', 'an item nothing else can name takes its name from the sheet');
  eq(r.body.ceiling_bound, false, 'the ladder did not run, so none of the ladder is reported as true');
  eq(r.body.thin_deal, false, '…including its verdicts');

  // 🛑 The street price is REPORTED and never PRICED FROM. migration-043 is explicit that a
  // manifest MSRP identifies the item and is not trusted as retail; one upload must not be
  // able to rewrite the observed street price every other surface reads.
  eq(r.body.retail, null, '🛑 the sheet\'s street price never becomes our retail');
  const cache = db.prepare(`SELECT retail_price FROM item_cache WHERE identifier = '085239098745'`).get();
  ok(!cache || cache.retail_price === null, '…and never reaches item_cache');

  const g13 = await scan({ identifier: '0085239098745', po: 'OB-1' });
  eq(g13.body.price, 1.0, 'the 13-digit spelling of the same can matches too');
  const g14 = await scan({ identifier: '00085239098745', po: 'OB-1' });
  eq(g14.body.price, 1.0, '…and so does its GTIN-14');
}

// ── Three different problems that must not look alike ────────────────────────
{
  const flags = r => (r.body.flags || []).join(' | ');

  // 1. The barcode is genuinely not on the sheet.
  const miss = await scan({ identifier: '024100113163', po: 'OB-1' });
  eq(miss.status, 200, 'a barcode the sheet does not carry still answers');
  eq(miss.body.manifest.has_manifest, true, '…knowing the buy HAS a manifest');
  eq(miss.body.manifest.matched, false, '…that this line is not on');
  ok(/not on buy OB-1's manifest/.test(flags(miss)), '🔑 …and says so out loud');
  ok(miss.body.price_basis !== "the buy's manifest", '…pricing from the ladder instead, not from nothing');

  // 2. The buy has no manifest at all — a different problem with a different fix.
  await openBuy('OB-BARE');
  const bare = await scan({ identifier: '085239098745', po: 'OB-BARE' });
  eq(bare.body.manifest.has_manifest, false, 'a buy with no sheet says that');
  ok(/buy OB-BARE has no manifest/.test(flags(bare)), '🛑 …and never "not on this manifest"');

  // 3. The line is there and its price cell was blank.
  const blank = await scan({ identifier: '070330731608', po: 'OB-1' });
  eq(blank.body.manifest.matched, true, 'a line with no price still matches');
  eq(blank.body.manifest.price, null, '…reporting no price rather than 0.00');
  ok(/carries no price for this line/.test(flags(blank)), '…and says which of the three problems it is');
  ok(blank.body.price_basis !== "the buy's manifest", '…and does not claim the sheet priced it');

  // 4. A PO that cannot be read is an error, never a quiet ordinary scan.
  const badPo = await scan({ identifier: '085239098745', po: 'not a po!' });
  eq(badPo.status, 400, '🛑 an unreadable PO fails the scan');
  eq(badPo.body.code, 'BAD_PO', '…rather than pricing off the ladder and reporting success');
}

// ── A scan with no PO is exactly what it was ─────────────────────────────────
{
  const r = await scan({ identifier: '085239098745' });
  eq(r.status, 200, 'an ordinary scan still answers');
  eq(r.body.manifest, undefined, '🔑 …with no manifest block at all');
  ok(r.body.price_basis !== "the buy's manifest", '…and never claims a sheet priced it');
}

// ── The buy page can see its sheet ───────────────────────────────────────────
{
  const d = await get('ob-buy-detail&po=OB-1');
  eq(d.status, 200, 'the buy detail answers');
  eq(d.body.manifest.lines, 4, 'it reports the sheet');
  eq(d.body.manifest.priced, 3, '…how many lines carry a price');
  eq(d.body.manifest.matchable, 2, '🔑 …and how many a scan can actually reach');
  eq(d.body.manifest.units, 89, '…and the units the sheet accounts for');
  eq(d.body.manifest.filename, 'third.csv', '…naming the live file');
  eq(d.body.manifest_history, 2, '…with the replaced sheets counted, not hidden');

  const bare = await get('ob-buy-detail&po=OB-BARE');
  eq(bare.body.manifest, null, '🛑 a buy with no sheet reads null — never a sheet of zero lines');
  eq(bare.body.manifest_history, 0, '…and has no history either');
}

// ── The INSERT's arity, which nothing would throw about ──────────────────────
{
  // 🛑 A column list and a placeholder list that drift by one bind every later value to the
  // wrong field. sqlite accepts it, D1 accepts it, and the data is wrong from then on.
  const src = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
  const ins = src.slice(src.indexOf('INSERT INTO manifest_lines (manifest_id, row_no'));
  const cols = ins.slice(ins.indexOf('(') + 1, ins.indexOf(')')).split(',').length;
  const marks = (ins.match(/VALUES \(([^)]*)\)/) || [, ''])[1].split(',').length;
  eq(cols, 19, 'manifest_lines INSERT names 19 columns');
  eq(marks, 19, '…and binds 19 placeholders');
  ok(/ob_price, ob_upc/.test(ins), '…the two new ones among them');
}

// ── 💰 Naming a PO costs nothing ─────────────────────────────────────────────
//
// 🔑 Asserted as a COMPARISON, not as zero. An item no source can name is looked up on
// every scan and cached on none — the cache write is guarded on having learned SOMETHING,
// and a lookup that found nothing has not. That is pre-existing behaviour for any
// unnameable item, and closeout goods are disproportionately unnameable. What this
// feature must not do is make it worse, so the test is that a PO changes the spend by
// exactly nothing: the sheet answers the price without the lookup being involved either way.
{
  const a = searchCalls;
  await scan({ identifier: '070330731608' });
  const withoutPo = searchCalls - a;
  const b = searchCalls;
  await scan({ identifier: '070330731608', po: 'OB-1' });
  const withPo = searchCalls - b;
  eq(withPo, withoutPo, '💰 a scan against a buy costs exactly what the same scan costs without one');

  // And the matched, priced case does not depend on the lookup having found anything:
  // every search above returned an empty result set and the sheet still priced it.
  const r = await scan({ identifier: '085239098745', po: 'OB-1' });
  eq(r.body.price, 1.0, '🔑 …and the price holds with every lookup coming back empty');
  eq(r.body.retail, null, '…because the sheet, not a lookup, is what answered');
}
// ── The screen, from the shipped index.html ──────────────────────────────────
//
// 🔑 psManifestStrip is LIFTED AND RUN, not grepped. A grep proves a word is present; the
// four outcomes below differ by which branch answers, and only executing it can tell them
// apart. Built with a stub for its two helpers, so nothing else of the page is needed.
{
  const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  const a = html.indexOf('  function psManifestStrip(j) {');
  const b = html.indexOf('\n  function psRender(j) {', a);
  ok(a > 0 && b > a, 'psManifestStrip is still in index.html');
  let strip = () => 'psManifestStrip DID NOT SLICE';
  try {
    strip = new Function('psEsc', 'psMoney',
      html.slice(a, b) + '\n; return psManifestStrip;')(
      (s) => String(s == null ? '' : s), (v) => '$' + Number(v || 0).toFixed(2));
  } catch (e) { ok(false, 'psManifestStrip builds: ' + e.message); }

  const M = (o) => strip({ identifier: '085239098745', manifest: Object.assign(
    { po: 'OB-1', has_manifest: true, matched: true, price: 1, description: 'Refried Beans 16oz',
      qty: 48, street_price: 1.29, sheet_identifier: '085239098745', row_no: 1, duplicates: 0,
      lines: 4 }, o) });

  eq(strip({ identifier: 'x' }), '', 'a scan with no PO renders no strip at all');

  const good = M({});
  ok(/From PO OB-1's manifest/.test(good), 'a matched, priced line says the sheet answered');
  ok(!/warn/.test(good), '…without the warning treatment');
  ok(/48 bought/.test(good) && /street \$1\.29/.test(good), '…carrying the quantity and the street price');
  ok(!/sheet reads/.test(good), '…and says nothing about spelling when both sides agree');

  // 🛑 The four outcomes, each with its own fix. Any two reading alike sends someone to the
  // wrong place: a missing sheet is an upload, a missing line is a buying question, and a
  // blank price cell is a spreadsheet edit.
  const none = M({ has_manifest: false, matched: false, price: null });
  const missL = M({ matched: false, price: null });
  const noPx = M({ price: null });
  ok(/has no manifest/.test(none), 'no sheet on the buy says exactly that');
  ok(/not on PO OB-1's manifest/.test(missL), 'a barcode the sheet lacks says that instead');
  ok(/no price on the sheet/.test(noPx), 'a blank price cell says THAT instead');
  // 🛑 A TYPED DESCRIPTION IS NOT A BARCODE THAT MISSED. The sheet is indexed by UPC, so
  // nothing was ever going to match — telling someone their barcode is not on the manifest
  // sends them to check a sheet that is perfectly fine.
  const typed = strip({ identifier: null, manifest: { po: 'OB-1', has_manifest: true,
    matched: false, price: null, lines: 4 } });
  ok(/indexed by barcode/.test(typed), 'a typed description says the sheet cannot match it at all');
  ok(!/is not on PO/.test(typed), '…never that the barcode missed');
  eq(new Set([good, none, missL, noPx, typed]).size, 5, '🔑 …and all five outcomes render differently');
  ok([none, missL, noPx, typed].every(s => /class="ps-ob-strip warn"/.test(s)),
     'every outcome that could not answer is marked as a warning');
  ok([none, missL, noPx].every(s => /priced the usual way/.test(s)),
     '…and each of the three barcode cases says the ladder priced it instead');

  // 🔑 The sheet's own spelling appears ONLY when it differs — that difference is the one
  // thing nobody can see, and it is exactly what makes a good sheet answer nothing.
  ok(/sheet reads 0085239098745/.test(M({ sheet_identifier: '0085239098745' })),
     'a barcode the sheet spells differently is shown, so the mismatch is visible');
  ok(/listed 3 times/.test(M({ duplicates: 3 })), 'a UPC listed twice on one sheet is never resolved quietly');
}

// ── The scan names its buy, and the buy survives a bad sheet ─────────────────
{
  const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  // A negative assertion over a region containing English tests the English: the comment
  // explaining that nothing rolls the buy back contains the words it looks for.
  const decomment = (t) => t.replace(/^\s*\/\/.*$/gm, '');

  const psScan = decomment(html.slice(html.indexOf('  async function psScan() {'),
                                      html.indexOf('  function psRender(j) {')));
  ok(/payload\.po = scanPo/.test(psScan), '🔑 psScan sends the selected buy with the scan');
  ok(/psObActive\(\)/.test(psScan), '…taken from the buy strip, not from a second source of truth');

  const create = decomment(html.slice(html.indexOf('  async function obCreate() {'),
                                      html.indexOf('  window.obCreate = obCreate;')));
  // 🛑 ORDER, AND NO ROLLBACK. The worker refuses a PO that is not an open buy, so the buy
  // must exist first; and a sheet that will not load must not be reported as a buy that
  // would not open, which would send someone hunting for a buy sitting right there.
  ok(create.indexOf('ob-buy-open') < create.indexOf('obUploadCsv'),
     '🛑 obCreate opens the buy BEFORE uploading its sheet');
  ok(/manifestErr/.test(create) && /is open\. The manifest did not load/.test(create),
     '…and a failed sheet is reported against a buy that IS open, never as a failed open');
  ok(!/ob-buy-close/.test(create), '…nothing closes or rolls the buy back');

  const card = decomment(html.slice(html.indexOf('  function obManifestCard(buy) {'),
                                    html.indexOf('  function obToggleNew(force) {')));
  ok(/none yet/.test(card), '🛑 a buy with no sheet reads "none yet"');
  ok(/cannot be found by a scan/.test(card), '…and an incomplete sheet says how many lines are unreachable');
  ok(/buy\.status === 'open'/.test(card), '…while a closed buy is not offered an upload it would be refused');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
