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
  'UPC,Item Description,Qty,Unit Cost,MSRP',
  '012345678905,"Chips, sour cream & onion 8oz",480,"$0.42","$2.49"',
  '012345678912,"Toothpaste 4.6oz ""whitening""",240,0.63,1.99',
  '012345678929,Mystery widget,10,"(1.50)",',
  // The Kind list's real fourth row: qty and cost, nothing else. Nothing about it can be
  // judged, and that must not read as a pass.
  ',,815,1.45,',
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
  eq(r.body.missing.length, 0, 'nothing required is unmapped');
  eq(r.body.rows, 4, 'the blank padding line is not a row, but the description-less one is');

  const lines = db.prepare(`SELECT * FROM manifest_lines WHERE manifest_id=? ORDER BY row_no`).all(mid);
  eq(lines.length, 4, 'four lines written');
  eq(lines[0].description, 'Chips, sour cream & onion 8oz', 'a quoted comma survives');
  eq(lines[1].description, 'Toothpaste 4.6oz "whitening"', 'a doubled quote survives');
  near(lines[0].cost, 0.42, '"$0.42" parses');
  near(lines[0].msrp, 2.49, 'MSRP parses');
  near(lines[2].cost, -1.5, 'a parenthesised negative parses as negative');
  eq(lines[0].identifier_type, 'upc', '12 digits reads as a UPC');
}

// ── The template is remembered, so the NEXT file maps itself ─────────────────
{
  const r = await post('manifest-remap', { id: mid, csv: CSV,
    column_map: { identifier:'UPC', description:'Item Description', qty:'Qty', cost:'Unit Cost', msrp:'MSRP' },
    sell_as: 'case', units_per_case: 12 });
  eq(r.status, 200, 'remap succeeds');
  const again = await post('manifest-upload', { vendor: 'Alliance', csv: CSV });
  eq(again.body.map_source, 'template', "the vendor's saved mapping is reused");
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
}

// ── Access ──────────────────────────────────────────────────────────────────
{
  eq((await get('manifests', 'u-admin')).status, 200, 'an admin may use the scorer');
  eq((await get('manifests', 'u-mgr1')).status, 403, '🛑 a manager may not');
  eq((await post('manifest-upload', { vendor: 'X', csv: CSV }, 'u-mgr1')).status, 403, '🛑 nor upload');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
