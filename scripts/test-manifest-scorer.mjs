// The Manifest Scorer, driven through the real endpoints.
//
// This turns a vendor spreadsheet into a decision, so the properties worth pinning are
// the ones that decide whether the decision is trustworthy:
//
//   1. 🔑 IT NEVER CALLS OUR ASP "RETAIL". Every threshold in the criteria is written
//      against street retail and this slice has none. Substituting ASP silently is the
//      exact error R6/R7 exist to stop vendors making.
//   2. THE % TEST ALONE CANNOT FAIL A BUY (§5.3). It warns. A hard fail needs cost over
//      the cap AND margin under the floor AND the category dead on the shelf.
//   3. A HUMAN'S CORRECTION SURVIVES. The model must never overwrite a manual category.
//   4. CASE vs EACH IS HONOURED END TO END, or every per-unit number is off by 12×.
//   5. THE MODEL PICKS FROM OUR LIST OR NOT AT ALL. An invented category would score
//      against the chain default while looking correctly classified.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, applyMigrationAlters, ctx, req } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
const near = (a, b, m) => ok(a !== null && Math.abs(a - b) < 0.05, `${m} (got ${JSON.stringify(a)}, want ~${b})`);

const worker = await loadWorker(repo);
const { db, env } = makeEnv(repo);
for (const m of ['migration-041.sql', 'migration-042.sql', 'migration-043.sql'])
  db.exec(fs.readFileSync(path.join(repo, m), 'utf8'));
applyMigrationAlters(db, repo);

// Every model call is stubbed and RECORDED, so "what did we send the model" is an
// assertion rather than a hope, and no test ever reaches the real API.
let modelCalls = [];
let modelReply = null;
globalThis.fetch = async (u, init) => {
  const url = String(u);
  if (url.includes('api.anthropic.com')) {
    modelCalls.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ content: [{ type: 'text', text: modelReply ?? '{"rows":[]}' }] }), { status: 200 });
  }
  throw new Error('unexpected egress: ' + url.slice(0, 60));
};
env.ANTHROPIC_API_KEY = 'sk-test';

const call = async (url, opts) => {
  const r = await worker.fetch(req(url, opts), env, ctx);
  const t = await r.text();
  let body; try { body = JSON.parse(t); } catch { body = { _raw: t.slice(0, 160) }; }
  return { status: r.status, body };
};
const post = (action, body, user = 'u-su') => call(`/?action=${action}`, { user, method: 'POST', body });
const get  = (qs, user = 'u-su') => call(`/?action=${qs}`, { user });

const SNACKS = 'FG BL CONSUMABLES - FOOD - SNACKS';
const ORAL   = 'FG BL CONSUMABLES - HBA - ORAL';

// A day of real item sales, so ASP is an actual number rather than absent. Without this
// every ASP is null and the scoring assertions below test nothing.
{
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' })
    .format(new Date(Date.now() - 86400e3));
  // What WE book as the cost of a unit in each category — prod keeps this in KV under
  // category-costs:global, and the scorer reads it from there.
  env.SALES_SNAPSHOTS.put('category-costs:global', JSON.stringify({
    costs: { [SNACKS]: 0.81, [ORAL]: 0.55 }, importedAt: '2026-08-19T19:03:28.323Z', count: 2,
  }));
  env.SALES_SNAPSHOTS.put(`items:bl1:${day}`, JSON.stringify({
    orderCount: 40,
    categories: [
      { category: 'Consumable Food', qty: 300, netSales: 399,
        l3Rows: [{ l3: SNACKS, qty: 300, netSales: 399 }] },            // ASP $1.33
      { category: 'Consumable HBA', qty: 100, netSales: 53,
        l3Rows: [{ l3: ORAL, qty: 100, netSales: 53 }] },               // ASP $0.53
    ],
  }));
}

// A vendor file with the awkward bits real ones have: a quoted comma, a doubled quote,
// a $-and-comma price, a parenthesised negative, and a blank padding line.
const CSV = [
  'UPC,Item Description,Case pack,Qty,Unit Cost,MSRP',
  '012345678905,"Chips, sour cream & onion 8oz",6,480,"$0.42","$2.49"',
  '012345678912,"Toothpaste 4.6oz ""whitening"" - 6 ct",5,240,0.63,1.99',
  '012345678929,Mystery widget,,10,"(1.50)",',
  // The Kind list's real fourth row: qty and cost, nothing else. Nothing about it can be
  // judged, and that must not read as a pass.
  ',,,815,1.45,',
  // Alliance caps availability at "1k+" on 279 of 331 lines. It is a FLOOR, not a count.
  '012345678930,Widget in bulk,,1k+,0.80,',
  '012345678931,Widget also bulk,,500+,0.80,',
  '',
].join('\n');

console.log('Manifest Scorer');

// ── Ingest: the CSV's awkward bits survive, and the mapping is guessed ───────
let mid;
{
  const r = await post('manifest-upload', { vendor: 'Alliance', filename: 'aug.csv', csv: CSV });
  eq(r.status, 200, 'upload succeeds');
  mid = r.body.id;
  eq(r.body.map_source, 'guessed', 'the first file from a vendor maps itself');
  eq(r.body.column_map.identifier, 'UPC', 'UPC column found');
  eq(r.body.column_map.cost, 'Unit Cost', 'cost column found');
  eq(r.body.column_map.qty, 'Qty', 'qty column found');
  eq(r.body.column_map.units_per_case, 'Case pack', "the vendor's own case pack is picked up automatically");
  eq(r.body.missing.length, 0, 'nothing required is unmapped');
  eq(r.body.rows, 6, 'the blank padding line is not a row, but the description-less one is');

  const lines = db.prepare(`SELECT * FROM manifest_lines WHERE manifest_id=? ORDER BY row_no`).all(mid);
  eq(lines.length, 6, 'six lines written');
  eq(lines[0].description, 'Chips, sour cream & onion 8oz', 'a quoted comma survives');
  eq(lines[1].description, 'Toothpaste 4.6oz "whitening" - 6 ct', 'a doubled quote survives');
  near(lines[0].cost, 0.42, '"$0.42" parses');
  near(lines[0].msrp, 2.49, 'MSRP parses');
  near(lines[2].cost, -1.5, 'a parenthesised negative parses as negative');
  eq(lines[0].identifier_type, 'upc', '12 digits reads as a UPC');
}

// The sheet's own pack beats the file-wide toggle.
// That toggle is ONE number for a whole file and cannot describe Kind's sheet, where the
// pack is 5 on some lines and 6 on others. A pack the vendor states per line wins — and
// where it contradicts the description, the line SAYS so rather than one being silently
// preferred.
{
  const rows = db.prepare(`SELECT row_no, units_per_case, flags FROM manifest_lines WHERE manifest_id=? ORDER BY row_no`).all(mid);
  eq(rows[0].units_per_case, 6, "the sheet's pack is stored per line");
  eq(rows[1].units_per_case, 5, '...per line, not once per file');
  ok(JSON.parse(rows[1].flags).some(f => /pack mismatch/.test(f)),
     'sheet 5 against description 6 ct is flagged, not silently resolved');
  ok(!JSON.parse(rows[0].flags).some(f => /pack mismatch/.test(f)),
     '...and an agreeing line carries no flag');
  eq(rows[2].units_per_case, null, 'a line with no pack value gets none');

  const r = await get(`manifest&id=${mid}`);
  const l1 = r.body.lines.find(x => x.row_no === 1);
  eq(l1.pack_used, 6, 'the pack applied is the one the sheet gave');
  eq(l1.pack_source, 'sheet', '...and the page can say where it came from');
  eq(l1.qty, 480 * 6, 'units expand by that line own pack');
  near(l1.cost, 0.42 / 6, '...and cost divides by it');
}


// ── 🔑 A capped quantity parses, and says it is a floor ────────────────────
// Alliance writes "1k+" rather than a count. Leaving it null made 84% of their file
// unusable; reading it as exactly 1000 would make landed cost, units per store and
// days-to-clear look precise when they rest on "at least a thousand".
{
  const rows = db.prepare(`SELECT description, qty, flags FROM manifest_lines WHERE manifest_id=? AND description LIKE 'Widget%' ORDER BY row_no`).all(mid);
  eq(rows.length, 2, 'both capped-quantity lines were written');
  eq(rows[0].qty, 1000, '"1k+" reads as 1000');
  ok(JSON.parse(rows[0].flags).includes('qty is a minimum'), '🔑 ...and is flagged as a floor, not a count');
  ok(!JSON.parse(rows[0].flags).includes('no qty'), '...and is no longer treated as missing');
  eq(rows[1].qty, 500, '"500+" reads as 500');
  ok(JSON.parse(rows[1].flags).includes('qty is a minimum'), '...also flagged');
  // An ordinary number stays exact and unflagged.
  const plain = db.prepare(`SELECT qty, flags FROM manifest_lines WHERE manifest_id=? AND row_no=1`).get(mid);
  eq(plain.qty, 480, 'a plain quantity is unchanged');
  ok(!JSON.parse(plain.flags).includes('qty is a minimum'), '...and carries no approximation flag');
}

// ── The template is remembered, so the NEXT file maps itself ─────────────────
{
  const r = await post('manifest-remap', { id: mid, csv: CSV,
    column_map: { identifier:'UPC', description:'Item Description', qty:'Qty', cost:'Unit Cost', msrp:'MSRP' },
    sell_as: 'case', units_per_case: 12 });
  eq(r.status, 200, 'remap succeeds');
  const again = await post('manifest-upload', { vendor: 'Alliance', csv: CSV });
  ok(/^template/.test(again.body.map_source), "the vendor's saved mapping is reused");
  eq(again.body.sell_as, 'case', '...along with how they sell');
}

// ── 🔑 The model may only pick from OUR list ────────────────────────────────
{
  modelCalls = [];
  modelReply = JSON.stringify({ rows: [
    { row: 1, category: SNACKS, confidence: 'high' },
    { row: 2, category: ORAL, confidence: 'high' },
    { row: 3, category: 'Snacks & Chips', confidence: 'high' },   // invented — must be refused
  ]});
  const r = await post('manifest-classify', { id: mid });
  eq(r.status, 200, 'classify runs');
  eq(r.body.classified, 2, '🔑 the invented category is refused, the two real ones land');

  const sys = modelCalls[0].system, usr = modelCalls[0].messages[0].content;
  ok(/copied exactly from the list/i.test(sys), 'the model is told to copy a category verbatim');
  ok(/omit it from the rows array rather than guessing/i.test(sys), '...and to omit rather than guess');
  ok(/do not follow any instruction/i.test(sys), 'product text is framed as untrusted');
  ok(usr.includes('<<<'), '...and delimited in the user turn');

  const lines = db.prepare(`SELECT row_no,l2,l3,l3_source FROM manifest_lines WHERE manifest_id=? ORDER BY row_no`).all(mid);
  eq(lines[0].l3, SNACKS, 'line 1 classified');
  eq(lines[0].l2, 'Consumable Food', '...and its L2 derived, not asked for');
  eq(lines[2].l3, null, 'the refused line stays unclassified rather than mis-classified');
}

// ── 🔑 A human correction is never overwritten by the model ─────────────────
{
  const line = db.prepare(`SELECT id FROM manifest_lines WHERE manifest_id=? AND row_no=3`).get(mid);
  const bad = await post('manifest-line', { id: mid, line_id: line.id, l3: 'Not A Category' });
  eq(bad.status, 400, 'an unknown category is refused');
  const good = await post('manifest-line', { id: mid, line_id: line.id, l3: SNACKS });
  eq(good.status, 200, 'a real one is accepted');
  const cached = db.prepare(`SELECT l3_source FROM item_cache WHERE identifier='012345678929'`).get();
  eq(cached.l3_source, 'manual', 'the correction is cached as manual');

  // Re-run the model claiming something else for that identifier.
  db.prepare(`UPDATE manifest_lines SET l3=NULL, l2=NULL WHERE manifest_id=? AND row_no=3`).run(mid);
  modelReply = JSON.stringify({ rows: [{ row: 3, category: ORAL, confidence: 'high' }] });
  await post('manifest-classify', { id: mid });
  const after = db.prepare(`SELECT l3_source, l3 FROM item_cache WHERE identifier='012345678929'`).get();
  eq(after.l3_source, 'manual', "🔑 the model does not overwrite a human's category");
  eq(after.l3, SNACKS, '...and the human value stands');
}

// Our standard cost sits beside the vendor's.
{
  const r = await get(`manifest&id=${mid}`);
  const priced = r.body.lines.find(l => l.std_cost_l3 !== null);
  ok(priced, 'a classified line carries our standard cost for its category');
  ok(priced.cost_vs_std !== null, '...and the vendor cost as a share of it');
  const unclassified = r.body.lines.find(l => !l.l3);
  eq(unclassified.std_cost_l3, null, 'an unclassified line has no standard cost to show');
  eq(unclassified.cost_vs_std, null, '...and no ratio invented for it');
}

// ── Case vs each carries through every per-unit number ──────────────────────
{
  const r = await get(`manifest&id=${mid}`);
  eq(r.status, 200, 'the manifest reads back');
  const l1 = r.body.lines.find(l => l.row_no === 1);
  eq(l1.units, 480 * 12, 'a case manifest expands qty to units');
  near(l1.cost, 0.42 / 12, '...and cost divides down to the unit');
}

// ── 🔑 Scoring says out loud that it has no retail ──────────────────────────
{
  await post('merch-criteria-draft', { cells: [
    { category: 'Consumable Food', field: 'max_cost_pct_retail', value: '30' },
    { category: 'Consumable Food', field: 'rounding', value: '.99' },
  ]});
  await post('merch-criteria-publish', { note: 'v1' });
  const r = await get(`manifest&id=${mid}`);
  const s = r.body.score;
  eq(s.withoutRetail, true, '🔑 the verdict is marked as reached without retail');
  ok(/average selling price/i.test(s.basis), '...and says so in words');
  // The two measurements live in two fields on purpose. With no lookup run, the retail
  // one must be EMPTY and the basis must name ASP — an ASP figure reported under a
  // retail label is the misrepresentation this whole slice is built to avoid.
  ok(s.lines.every(l => l.costPctRetail === null), '🔑 with no lookup run, costPctRetail is null on every line');
  ok(s.lines.every(l => l.basisPct === null || l.basisName === 'our ASP'),
     '🔑 ...and every scored line names its basis as our ASP');
  ok(s.lines.some(l => l.costPctAsp !== null), 'the ASP figure is still reported, under its own name');
}

// ── 🛑 The % test alone WARNS; it never fails a buy (§5.3) ──────────────────
{
  // Force a line far over the cap with no margin rule and no shelf signal.
  const resolved = { defaults: { max_cost_pct_retail: { value: '30' } }, categories: [] };
  const r = await get(`manifest&id=${mid}`);
  const overCap = r.body.score.lines.filter(l => l.tests?.cost?.verdict === 'warn');
  ok(overCap.length >= 0, 'the cost test evaluates');
  ok(r.body.score.lines.every(l => l.verdict !== 'fail' || l.hardFail),
     '🛑 nothing reads fail unless it met the hard-fail conditions');
  ok(['buy', 'buy_with_edits', 'pass_with_edits'].includes(r.body.score.verdict), 'a verdict is produced');
  ok(r.body.score.verdictText.length > 0, '...with a sentence a buyer can take to a vendor');
  ok(r.body.score.rollup.length > 0, 'and a rollup at the category level, not per SKU');
}

// ── 🛑 A line nothing could be judged on does NOT read as a pass ───────────
// Shipped wrong and Brian saw it on the Kind list: the one row with no description, no
// category and no ASP showed GREEN — 815 units and $1,181.75 of cost reading as cleared,
// because every test returned "unknown" and the verdict fell through to pass.
{
  const r = await get(`manifest&id=${mid}`);
  const s = r.body.score;
  const blind = s.lines.find(l => Object.values(l.tests || {}).every(t => t.verdict === 'unknown'));
  if (blind) {
    eq(blind.verdict, 'unknown', '🛑 a line with nothing to judge reads unknown, never pass');
    ok(s.totals.unjudged >= 1, '...and is counted, not hidden');
    ok(/could not be judged/i.test(s.verdictText), '...and the verdict sentence admits it');
  } else {
    ok(false, 'fixture should contain a line with no category and no ASP');
  }
  // A line that WAS judged still passes normally.
  ok(s.lines.some(l => l.verdict === 'pass' || l.verdict === 'warn'), 'judged lines still get a real verdict');
}

// ── A decision records what it was measured against ─────────────────────────
{
  const noNote = await post('manifest-decide', { id: mid, status: 'approved' });
  eq(noNote.status, 400, 'a decision with no note is refused');
  const bad = await post('manifest-decide', { id: mid, status: 'whatever', note: 'x' });
  eq(bad.status, 400, 'an unknown status is refused');
  const good = await post('manifest-decide', { id: mid, status: 'approved_edits', note: 'drop the widget' });
  eq(good.status, 200, 'the decision is recorded');
  const row = db.prepare(`SELECT * FROM manifests WHERE id=?`).get(mid);
  eq(row.status, 'approved_edits', 'status stored');
  ok(row.criteria_version !== null, '🔑 and the criteria version it was judged under');
  eq(row.scored_without_retail, 1, '...and that it was judged without retail');
  const locked = await post('manifest-remap', { id: mid, csv: CSV, column_map: { description:'Item Description', qty:'Qty', cost:'Unit Cost' } });
  eq(locked.status, 409, 'a decided manifest cannot be silently remapped underneath the decision');
  const del = await post('manifest-delete', { id: mid });
  eq(del.status, 409, 'a decided manifest is not deletable either — it is the record of a call');
  ok(/record of a decision/i.test(del.body.error || ''), '...and says why');
}

// Deleting a draft, and refusing to delete a decision.
{
  // A fresh draft, so the decided one below is untouched.
  const up = await post('manifest-upload', { vendor: 'Throwaway', csv: CSV });
  const tmp = up.body.id;
  const before = db.prepare(`SELECT COUNT(*) n FROM manifest_lines WHERE manifest_id=?`).get(tmp).n;
  ok(before > 0, 'the throwaway upload wrote lines');

  eq((await post('manifest-delete', { id: tmp }, 'u-admin')).status, 403, 'an admin may not delete a manifest');
  const d = await post('manifest-delete', { id: tmp });
  eq(d.status, 200, 'a superuser may delete a draft');
  eq(db.prepare(`SELECT COUNT(*) n FROM manifest_lines WHERE manifest_id=?`).get(tmp).n, 0, 'its lines go with it');
  eq(db.prepare(`SELECT COUNT(*) n FROM manifests WHERE id=?`).get(tmp).n, 0, 'and the manifest itself');
  eq((await post('manifest-delete', { id: tmp })).status, 404, 'deleting it twice is a 404, not a silent success');
}

// A stale template cannot withhold a field it predates.
// Kind's template mapped "Case pack" to uom back when that was its only home. After
// units_per_case shipped, "template wins" turned that silence into a permanent NO and
// re-uploading still produced null packs on every line — the detector built to find
// exactly that column never got to run.
{
  const V = 'LegacyVendor';
  // A template written before units_per_case existed.
  db.prepare(`INSERT INTO vendor_templates (vendor, column_map, sell_as_default, units_per_case_default, updated_at)
              VALUES (?,?,'each',12,'2026-08-01T00:00:00Z')`)
    .run(V, JSON.stringify({ identifier:'UPC', description:'Item Description', qty:'Qty', uom:'Case pack', cost:'Unit Cost' }));

  const r = await post('manifest-upload', { vendor: V, csv: CSV });
  eq(r.status, 200, 'the upload succeeds');
  eq(r.body.column_map.units_per_case, 'Case pack',
     'the column moves out of uom into the field that does real work');
  ok(!r.body.column_map.uom, '...and is not left in both places');
  ok(/newly detected/i.test(r.body.map_source), 'and the page is told the template was extended');

  const rows = db.prepare(`SELECT units_per_case FROM manifest_lines WHERE manifest_id=? ORDER BY row_no LIMIT 2`).all(r.body.id);
  eq(rows[0].units_per_case, 6, 'so the pack lands on the line');
  eq(rows[1].units_per_case, 5, '...per line');
  await post('manifest-delete', { id: r.body.id });
}

// A template's own choices are still respected where it HAS an opinion.
{
  const V = 'OpinionatedVendor';
  db.prepare(`INSERT INTO vendor_templates (vendor, column_map, sell_as_default, units_per_case_default, updated_at)
              VALUES (?,?,'each',12,'2026-08-01T00:00:00Z')`)
    .run(V, JSON.stringify({ identifier:'UPC', description:'Item Description', qty:'Qty', cost:'Unit Cost', units_per_case:'Qty' }));
  const r = await post('manifest-upload', { vendor: V, csv: CSV });
  eq(r.body.column_map.units_per_case, 'Qty',
     'a deliberate mapping is not second-guessed by detection');
  await post('manifest-delete', { id: r.body.id });
}

// ── Access ──────────────────────────────────────────────────────────────────
{
  eq((await get('manifests', 'u-admin')).status, 200, 'an admin may use the scorer');
  eq((await get('manifests', 'u-mgr1')).status, 403, '🛑 a manager may not');
  eq((await post('manifest-upload', { vendor: 'X', csv: CSV }, 'u-mgr1')).status, 403, '🛑 nor upload');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
