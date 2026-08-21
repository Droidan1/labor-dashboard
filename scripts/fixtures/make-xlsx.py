#!/usr/bin/env python3
"""Rebuild manifest-sample.xlsx — the .xlsx ingest fixture.

Written with stdlib zipfile rather than openpyxl so it runs anywhere, and so the fixture
is a REAL deflated ZIP rather than something shaped like one. Every trap the reader has to
survive is in this one file on purpose:

  * a two-line vendor preamble above the header  (manifestFindHeader must step over it)
  * shared strings                               (most sheet text is an index, not inline)
  * a row that SKIPS column B                    (index by r="C4", never by encounter order)
  * a blank row                                  (dropped, matching csvParse)
  * an inline string split across two <t> runs   (must be rejoined, not truncated)
  * a decoy sheet FIRST on disk but SECOND in workbook order (pick by order, not filename)

Run:  python3 scripts/fixtures/make-xlsx.py
"""
import zipfile
import pathlib

def c(ref, t, v):
    return f'<c r="{ref}"' + (f' t="{t}"' if t else '') + f'><v>{v}</v></c>'

shared = ["ALLIANCE WHOLESALE", "Load #99", "UPC", "Item Description", "Qty", "Unit Cost",
          "Bar soap 3 oz", "Shampoo 12 oz", "IGNORE ME"]
si = "".join(f"<si><t>{x}</t></si>" for x in shared)
sst = ('<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
       f'count="{len(shared)}" uniqueCount="{len(shared)}">{si}</sst>')

rows = [
    '<row r="1">' + c("A1", "s", 0) + '</row>',
    '<row r="2">' + c("A2", "s", 1) + '</row>',
    '<row r="3">' + c("A3", "s", 2) + c("B3", "s", 3) + c("C3", "s", 4) + c("D3", "s", 5) + '</row>',
    '<row r="4">' + c("A4", None, "012345678990") + c("C4", None, "100") + c("D4", None, "1.5") + '</row>',
    '<row r="5">' + c("A5", None, "012345678991") + c("B5", "s", 7) + c("C5", None, "50") + c("D5", None, "2.25") + '</row>',
    '<row r="6"></row>',
    '<row r="7">' + c("A7", None, "012345678992")
        + '<c r="B7" t="inlineStr"><is><t>Inline </t><t>String Item</t></is></c>'
        + c("C7", None, "7") + c("D7", None, "3") + '</row>',
]
NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
sheet_real = f'<?xml version="1.0"?><worksheet {NS}><sheetData>' + "".join(rows) + '</sheetData></worksheet>'
sheet_decoy = (f'<?xml version="1.0"?><worksheet {NS}><sheetData><row r="1">'
               + c("A1", "s", 8) + '</row></sheetData></worksheet>')

wb = ('<?xml version="1.0"?><workbook ' + NS + ' '
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
      '<sheet name="Manifest" sheetId="2" r:id="rId9"/>'
      '<sheet name="Notes" sheetId="1" r:id="rId1"/>'
      '</sheets></workbook>')
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"
rels = ('<?xml version="1.0"?><Relationships '
        'xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        f'<Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="{REL}"/>'
        f'<Relationship Id="rId9" Target="worksheets/sheet2.xml" Type="{REL}"/>'
        '</Relationships>')
ct = ('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      '<Default Extension="xml" ContentType="application/xml"/></Types>')

out = pathlib.Path(__file__).parent / "manifest-sample.xlsx"
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("[Content_Types].xml", ct)
    z.writestr("xl/workbook.xml", wb)
    z.writestr("xl/_rels/workbook.xml.rels", rels)
    z.writestr("xl/sharedStrings.xml", sst)
    z.writestr("xl/worksheets/sheet1.xml", sheet_decoy)
    z.writestr("xl/worksheets/sheet2.xml", sheet_real)
print(f"wrote {out} ({out.stat().st_size} bytes)")
