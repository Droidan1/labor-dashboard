// Harness migration-074 against real sqlite, on the real item_cache schema.
//
// item_cache is the scan library — every barcode anyone has ever resolved, with the street
// prices and the hand-set overrides that took real money and real attention to fill. This
// migration adds one nullable column to it, so the only thing worth proving is that it
// touches nothing, checked value by value rather than by row count.
//
// The column's BEHAVIOUR — that a name read off a spreadsheet can never overwrite one a
// lookup resolved — is exercised end to end through the real endpoint in
// scripts/test-ob-manifest.mjs, which is a stronger test than restating the CASE here.
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

const db = new DatabaseSync(":memory:");

// Production shape: migration-043's CREATE TABLE, sliced verbatim, plus 051's overrides.
const sql043 = read("migration-043.sql");
const m = sql043.match(/CREATE TABLE IF NOT EXISTS item_cache \([\s\S]*?\n\);/);
if (!m) { console.error("FATAL: could not slice item_cache out of migration-043.sql"); process.exit(1); }
db.exec(m[0]);
db.exec(`
  ALTER TABLE item_cache ADD COLUMN retail_price_override REAL;
  ALTER TABLE item_cache ADD COLUMN retail_override_by    TEXT;
  ALTER TABLE item_cache ADD COLUMN retail_override_at    TEXT;
`);

// Three rows of the kind this table actually holds: one resolved by a lookup, one a person
// corrected by hand, one classified by hand. All three are expensive to have obtained.
db.exec(`
  INSERT INTO item_cache (identifier, identifier_type, brand, title, size, l2, l3, l3_source,
                          retail_price, retail_source, retail_confidence, fetched_at, updated_at)
  VALUES ('024100113163','upc','Cheez-It','Cheez-It Original 12.4 oz','12.4 oz',
          'Consumable Food','FG BL CONSUMABLES - FOOD - SNACKS','claude',
          4.28,'walmart.com','high','2026-09-01T00:00:00Z','2026-09-01T00:00:00Z');
  INSERT INTO item_cache (identifier, identifier_type, title, l3, l3_source,
                          retail_price_override, retail_override_by, updated_at)
  VALUES ('085239098745','upc','Good & Gather Refried Beans 16oz',
          'FG BL CONSUMABLES - FOOD - CANNED GOODS','manual',
          1.29,'bhoward@bargainlane.com','2026-09-05T00:00:00Z');
  INSERT INTO item_cache (identifier, identifier_type, title, updated_at)
  VALUES ('WD-2200-X','model','Whirlpool dryer','2026-09-07T00:00:00Z');
`);
const before = db.prepare("SELECT * FROM item_cache ORDER BY identifier").all();

db.exec(read("migration-074.sql"));

console.log("column:");
const cols = Object.fromEntries(
  db.prepare(`SELECT name, type, "notnull" FROM pragma_table_info('item_cache')`).all().map(r => [r.name, r]));
is(cols.title_source?.type, "TEXT", "item_cache.title_source is TEXT");
is(cols.title_source?.notnull, 0,
   "…and nullable — NULL is every row that predates this, and reads as 'lookup'");

console.log("\nadditive only:");
const after = db.prepare("SELECT * FROM item_cache ORDER BY identifier").all();
is(after.length, before.length, "no rows added or lost");
let drift = 0, checked = 0;
for (let i = 0; i < before.length; i++)
  for (const k of Object.keys(before[i])) { checked++; if (before[i][k] !== after[i][k]) drift++; }
is(drift, 0, `every pre-existing value is unchanged, field by field (${checked} checked)`);
is(after.every(r => r.title_source === null), true, "every existing row reads NULL for the new column");

// 🛑 The three things in this table that cost the most to obtain, named individually —
// a row count says nothing about whether a price or an override survived.
is(after[0].retail_price, 4.28, "a looked-up street price is untouched");
is(after[1].retail_price_override, 1.29, "🛑 a HAND-SET override is untouched");
is(after[1].l3_source, "manual", "…as is the marker saying a person set its category");
is(after[2].title, "Whirlpool dryer", "a model-numbered row is untouched");

console.log("\nre-run:");
try {
  db.exec(read("migration-074.sql"));
  bad("a second run errors as the header says — no error thrown");
} catch (e) {
  /duplicate column name: title_source/.test(e.message)
    ? ok("a second run errors exactly as migration-074's header says it will")
    : bad("wrong error on re-run: " + e.message);
}
is(db.prepare("SELECT COUNT(*) c FROM item_cache").get().c, 3, "the failed re-run changed no data");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
