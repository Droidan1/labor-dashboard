# Manifest ingest: xlsx, PDF, and preamble rows

## The shape

All three formats converge on the SAME `rows` array (array of arrays of strings) that
`csvParse` already produces, so everything downstream — column mapping, vendor templates,
normalisation, classification, scoring — is untouched.

    .csv   →  csvParse                  ─┐
    .xlsx  →  xlsxRows()      (new)     ─┼→  rows[][]  →  manifestFindHeader()  →  existing pipeline
    .pdf   →  pdfRows()       (new)     ─┘                      (new)

## 1. Preamble rows — `manifestFindHeader(rows)`

Today: `const headers = rows[0]` — row 1 IS the header, no argument. A vendor letterhead,
a load number and a blank line above the real header do not misparse; they fail totally,
because the header found is `["Alliance Wholesale", "", "", ""]`.

Score each of the first ~15 rows by how many cells match a MANIFEST_HINTS pattern; the best
row wins. Reuses the hints already written, so a format the mapper understands is a format
the header finder understands. Helps CSV immediately, and xlsx/PDF get it free.

- [x] `manifestFindHeader(rows)` → `{ headerRow, score, skipped }`
- [x] Both `rows[0]` call sites use it
- [x] Report `skipped` to the page so a wrong guess is visible, not silent
- [x] Tests: letterhead above the header · blank leading rows · a data row that looks
      header-ish · no plausible header at all (must say so, not pick row 0 anyway)

## 2. xlsx — `xlsxRows(bytes)`

An .xlsx is a ZIP of XML. Workers ship `DecompressionStream("deflate-raw")`, so no
dependency is needed: read the ZIP central directory, inflate `sharedStrings.xml` and the
first sheet, walk `<c r="A1" t="s"><v>0</v></c>`.

**Why not SheetJS:** ~800 KB bundled on top of an already 836 KB worker, against a 1 MB
compressed limit. A reader for the subset we need is ~200 lines and testable.

⚠️ Column letters are sparse — a row may jump A→D. Index by the `r` attribute, never by
encounter order, or every gap shifts the row left and silently misaligns the mapping.

- [x] `xlsxRows()`; transport switches to base64 for non-CSV
- [x] Client `readAsText` → `readAsArrayBuffer` for xlsx/pdf
- [x] `accept` gains `.xlsx`
- [x] Tests: shared vs inline strings · sparse columns · numbers vs text · multiple sheets

## 3. PDF — `pdfRows(env, b64)`

Claude reads PDFs natively (`{type:"document", source:{type:"base64",
media_type:"application/pdf"}}`); the worker already calls the Messages API in three
places, so this is a content-block change, not a new integration. Limits: 32 MB request,
600 pages.

💰 **This one costs money per upload** — unlike everything else in the ingest path. Cap
pages, show the estimate before spending, and never fire it for a format that parses
deterministically.

- [x] `pdfRows()` with a page cap and a structured-output schema
- [x] Cost shown before the call, not after
- [x] Extraction is REVIEWED like a guessed mapping — a model reading a table is a guess
      with good odds, not a parse, and must not be presented as certain
- [x] Tests with a stubbed model call (never the real API)

## Order
1 → 2 → 3. Each ships independently; 1 and 2 are deterministic and fully testable, 3 is not.

---

## Review — Aug 20 2026

**2015 assertions across 48 suites, all passing** (was 1984).

### What each piece actually does
- **Header detection** scores rows by how many DISTINCT manifest fields their cells look
  like, reusing MANIFEST_HINTS — so a layout the mapper understands is, by construction, a
  layout the finder can locate, and the two cannot drift.
- **xlsx** reads the ZIP central directory (not a linear scan: Excel streams archives, and
  streamed local headers carry zero-length fields), inflates via `DecompressionStream`,
  resolves shared strings, and indexes cells by their own `r="C4"` attribute.
- **PDF** goes to Claude as a document block. It is a READING, not a parse — survivable
  only because every upload already passes through the mapping-confirmation screen.

### Bugs this work surfaced
1. **`manifest-remap` reported `rows.length - 1`**, ignoring the preamble it now skips, so
   it over-reported the line count by exactly the number of rows above the header. Found by
   a test asserting upload and remap agree.
2. **`header_row` is an index over PARSED rows, not spreadsheet rows** — `csvParse` drops
   blank lines first, so a preamble containing a blank reports a lower number than the user
   sees in Excel. `header_skipped` is the figure shown to a human.

### Deliberate choices
- **No SheetJS.** ~800 KB bundled on top of an 836 KB worker against a 1 MB compressed
  limit. The subset we need is ~200 lines and directly testable.
- **A tie in header scoring goes to the EARLIER row.** A product called "Pack of 6 Cost
  Cutter" hits two hint patterns; it must not outscore the real header above it.
- **The billed PDF path never fires as a fallback** for a format that parses on its own,
  and there is a test asserting a CSV upload makes zero document-block calls.

### Not done
- Pallet-level lines ("assorted HBA, 400 pcs") remain unrepresentable — a data-model
  question, not a parsing one.
- No lot-level valuation against the vendor's ask.
- PDF page count is not shown before spending; the cap is on file size, not pages.
