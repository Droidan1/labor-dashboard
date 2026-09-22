// Harness migration-073 against real sqlite, on the real manifests schema: migration-043's
// two CREATE TABLEs plus every ALTER that has landed on them since.
//
// Three failures this is built to catch, in descending order of how quietly they happen:
//
//   1. A PO with TWO live manifests. Both rows look fine on their own; the scan picks one
//      and hands a user a price off a spreadsheet that was replaced last week. Nothing
//      errors, nothing logs. The partial UNIQUE index is what makes it unrepresentable,
//      so the test that matters is the INSERT that must be REFUSED.
//   2. A canonicalisation miss. Manifest identifiers are stored as the vendor spelled them
//      and scanned codes go through merchCanonicalUpc, so `0085239098745` on the sheet and
//      `085239098745` off the scanner are one can of beans that does not compare equal.
//      A miss reports "not on this manifest" — the wrong answer wearing the right words.
//   3. A migration that is not additive. This runs on tables holding every manifest ever
//      scored, so the test diffs each pre-existing row field by field, not just the count.
//
// `node:sqlite` is experimental and announces itself on stderr; test.sh folds stderr into
// the suite's output, so the notice is silenced rather than printed above every run.
process.removeAllListeners("warning");
process.on("warning", () => {});

const { DatabaseSync } = await import("node:sqlite");
const fs = await import("node:fs");
const path = await import("node:path");

const REPO = process.argv[2] || ".";
const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8");

let pass = 0, fail = 0;
const ok  = (m) => { pass++; console.log("  ok   " + m); };
const bad = (m) => { fail++; console.log("  FAIL " + m); };
const is  = (a, b, m) => (a === b ? ok(m) : bad(`${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`));
const throws = (fn, re, m) => {
  try { fn(); bad(`${m} — no error thrown`); }
  catch (e) { re.test(e.message) ? ok(m) : bad(`${m} — wrong error: ${e.message}`); }
};

const db = new DatabaseSync(":memory:");

// ── Production shape, before 073 ───────────────────────────────────────────────────────
// Sliced verbatim out of migration-043 rather than retyped, so a later column added there
// is carried here automatically instead of this harness testing a schema we stopped having.
const sql043 = read("migration-043.sql");
for (const name of ["manifests", "manifest_lines"]) {
  const m = sql043.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${name} \\([\\s\\S]*?\\n\\);`));
  if (!m) { console.error(`FATAL: could not slice ${name} out of migration-043.sql`); process.exit(1); }
  db.exec(m[0]);
}
// Every ALTER since, in the order it shipped: 045, 046, 047, 048, 049, 050, 054, 055.
db.exec(`
  ALTER TABLE manifests      ADD COLUMN auto_retail       INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE manifests      ADD COLUMN retail_lock_until TEXT;
  ALTER TABLE manifest_lines ADD COLUMN retail_in_store   INTEGER;
  ALTER TABLE manifests      ADD COLUMN freight_cost      REAL NOT NULL DEFAULT 0;
  ALTER TABLE manifests      ADD COLUMN defect_pct        REAL NOT NULL DEFAULT 0;
  ALTER TABLE manifests      ADD COLUMN retail_pct        REAL NOT NULL DEFAULT 0;
  ALTER TABLE manifests      ADD COLUMN lot_cost          REAL NOT NULL DEFAULT 0;
  ALTER TABLE manifest_lines ADD COLUMN condition_raw     TEXT;
  ALTER TABLE manifest_lines ADD COLUMN condition_grade   TEXT;
  ALTER TABLE manifests      ADD COLUMN decision_snapshot TEXT;
  ALTER TABLE manifests      ADD COLUMN cost_basis        TEXT NOT NULL DEFAULT 'unit';
`);

// A scored manifest exactly as one looks today: load_id NULL, because nothing has ever
// written it. One UPC line and one model-numbered line, which is the mix the appliance
// test was full of.
db.exec(`
  INSERT INTO manifests (id, vendor, filename, uploaded_by, uploaded_at, criteria_version, scored_at, status)
  VALUES ('m_old', 'Closeout Co', 'aug.csv', 'brian', '2026-08-19T14:00:00Z', 4, '2026-08-19T14:02:00Z', 'approved');
  INSERT INTO manifest_lines (manifest_id, row_no, identifier, identifier_type, description, qty, cost, msrp, suggested_price)
  VALUES ('m_old', 1, '038000138416', 'upc',   'Pringles Original 5.2oz', 24, 0.91,  2.49,   1.75),
         ('m_old', 2, 'WD-2200-X',    'model', 'Whirlpool dryer',          1, 180.0, 649.0, 299.0);
`);
const before = db.prepare("SELECT * FROM manifest_lines ORDER BY row_no").all();
const beforeManifest = db.prepare("SELECT * FROM manifests").all();

const m073 = read("migration-073.sql");
db.exec(m073);

// ── 1. The columns exist, and every one of them is nullable ────────────────────────────
// Nullability is not incidental. ob_price NULL means "this line has no price" and ob_upc
// NULL means "this identifier is not a barcode"; a NOT NULL with a default would turn both
// of those true statements into a number the scan would read as real.
console.log("columns:");
const colsOf = (t) => Object.fromEntries(
  db.prepare(`SELECT name, type, "notnull" FROM pragma_table_info(?)`).all(t).map((r) => [r.name, r]));
const ml = colsOf("manifest_lines"), mf = colsOf("manifests");
is(ml.ob_price?.type, "REAL", "manifest_lines.ob_price is REAL");
is(ml.ob_upc?.type,   "TEXT", "manifest_lines.ob_upc is TEXT");
is(mf.superseded_at?.type, "TEXT", "manifests.superseded_at is TEXT");
is(ml.ob_price?.notnull, 0, "ob_price is nullable — NULL means this line has no price");
is(ml.ob_upc?.notnull,   0, "ob_upc is nullable — NULL means the identifier is not a UPC");
is(mf.superseded_at?.notnull, 0, "superseded_at is nullable — NULL means live");

// ── 2. Additive only, checked value by value ───────────────────────────────────────────
console.log("\nadditive only:");
const after = db.prepare("SELECT * FROM manifest_lines ORDER BY row_no").all();
is(after.length, before.length, "no line rows added or lost");
let drift = 0;
for (let i = 0; i < before.length; i++)
  for (const k of Object.keys(before[i])) if (before[i][k] !== after[i][k]) drift++;
is(drift, 0, "every pre-existing manifest_lines value is unchanged, field by field");
is(after.every((r) => r.ob_price === null && r.ob_upc === null), true,
   "existing lines read NULL for both new columns");
const afterManifest = db.prepare("SELECT * FROM manifests").all();
is(afterManifest[0].superseded_at, null, "an already-uploaded manifest stays live");
is(afterManifest[0].status, beforeManifest[0].status, "its status is untouched");
is(afterManifest[0].criteria_version, beforeManifest[0].criteria_version,
   "and so is the criteria version its verdict was reached under");

// ── 3. The invariant: one live manifest per PO, enforced by the database ───────────────
console.log("\none live manifest per PO:");
const insert = (id, po, superseded = null) => db.prepare(
  "INSERT INTO manifests (id, vendor, uploaded_at, load_id, superseded_at) VALUES (?, 'OB', ?, ?, ?)"
).run(id, "2026-09-21T10:00:00Z", po, superseded);

insert("m_po1_v1", "OB-4471");
ok("the first manifest for OB-4471 inserts");
throws(() => insert("m_po1_v2", "OB-4471"), /UNIQUE/i,
  "a SECOND live manifest for OB-4471 is refused by the database, not merely by the handler");
db.prepare("UPDATE manifests SET superseded_at = ? WHERE id = ?").run("2026-09-21T11:00:00Z", "m_po1_v1");
insert("m_po1_v2", "OB-4471");
ok("once the first is superseded, the replacement inserts");
is(db.prepare("SELECT COUNT(*) c FROM manifests WHERE load_id = 'OB-4471'").get().c, 2,
   "the superseded manifest is KEPT — a price a user was shown last week stays explicable");
is(db.prepare("SELECT id FROM manifests WHERE load_id = 'OB-4471' AND superseded_at IS NULL").get().id,
   "m_po1_v2", "exactly one row answers 'which manifest is live for this PO'");
insert("m_po2_v1", "OB-4472");
ok("a different PO is unaffected by either of them");
for (const id of ["m_plain_a", "m_plain_b", "m_plain_c"]) insert(id, null);
is(db.prepare("SELECT COUNT(*) c FROM manifests WHERE load_id IS NULL").get().c, 4,
   "load_id-NULL scorer manifests coexist freely — the partial index excludes them");

// ── 4. The scan's hot path is indexed ──────────────────────────────────────────────────
console.log("\nquery plans:");
db.exec(`
  INSERT INTO manifests (id, vendor, uploaded_at, load_id)
  VALUES ('m_scan', 'OB', '2026-09-21T12:00:00Z', 'OB-9000');
  INSERT INTO manifest_lines (manifest_id, row_no, identifier, identifier_type, description, qty, cost, msrp, ob_price, ob_upc)
  VALUES ('m_scan', 1, '0085239098745', 'upc', 'Refried beans 16oz', 48, 0.62, 1.29, 1.00, '085239098745');
`);
const plan = (q) => db.prepare("EXPLAIN QUERY PLAN " + q).all().map((r) => r.detail).join(" | ");
const scanPlan = plan("SELECT ob_price FROM manifest_lines WHERE manifest_id = 'm_scan' AND ob_upc = '085239098745'");
is(/idx_mline_ob_upc/.test(scanPlan), true, "a scan lookup uses idx_mline_ob_upc — " + scanPlan);
const poPlan = plan("SELECT id FROM manifests WHERE load_id = 'OB-9000' AND superseded_at IS NULL");
is(/idx_manifests_live_po/.test(poPlan), true, "resolving a PO to its live manifest is indexed — " + poPlan);
const histPlan = plan("SELECT id FROM manifests WHERE load_id = 'OB-9000' ORDER BY uploaded_at DESC");
is(/idx_manifests_by_po/.test(histPlan) && !/SCAN manifests/.test(histPlan), true,
   "the buy's manifest history is indexed and needs no sort — " + histPlan);

// ── 5. The canonicalisation the whole feature turns on ─────────────────────────────────
// merchCanonicalUpc, mirrored from worker.js. The assertion below is that the RAW
// identifier match — the obvious implementation — misses the very row it is looking at.
console.log("\ncanonical match:");
const merchCanonicalUpc = (raw) => {
  const d = String(raw || "").replace(/\D/g, "");
  if (d.length === 14 && d.startsWith("00")) return d.slice(2);
  if (d.length === 13 && d.startsWith("0"))  return d.slice(1);
  return d;
};
const lookup = (scanned) => db.prepare(
  "SELECT ob_price FROM manifest_lines WHERE manifest_id = 'm_scan' AND ob_upc = ?"
).get(merchCanonicalUpc(scanned))?.ob_price ?? null;
is(lookup("085239098745"),   1.0, "a 12-digit scan matches the 13-digit spelling on the sheet");
is(lookup("0085239098745"),  1.0, "the 13-digit encoding of the same can matches too");
is(lookup("00085239098745"), 1.0, "and so does its GTIN-14");
is(db.prepare("SELECT ob_price FROM manifest_lines WHERE manifest_id = 'm_scan' AND identifier = ?")
     .get("085239098745"), undefined,
   "matching on the RAW identifier MISSES that row — the bug ob_upc exists to prevent");
is(lookup("038000138416"), null,
   "a barcode that is genuinely not on this manifest returns nothing, never another line's price");

// ── 6. The header's re-run warning is true ─────────────────────────────────────────────
console.log("\nre-run:");
throws(() => db.exec(m073), /duplicate column name: ob_price/,
  "a second run errors exactly as migration-073's header says it will");
is(db.prepare("SELECT COUNT(*) c FROM manifest_lines").get().c, 3, "the failed re-run changed no data");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
