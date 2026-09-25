// Sign Studio: the files a sign is made from, and the renderer that makes it.
//
// A printed sign is judged from across a store in about three seconds, so the rules that keep
// it readable (letters never under 0.6 in, the price the biggest thing on it) have to hold on
// PAPER, not only in the preview. Three things draw the same sign: the browser (the preview
// and Print), jsPDF (the PDF) and the fit engine's own measurements. They agree only if they
// read the same font bytes and none of them kerns or substitutes glyphs. So this pins the
// files as well as the code.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
const read = f => fs.readFileSync(path.join(repo, f));

// ── 1. The files ─────────────────────────────────────────────────────────────
console.log('Sign Studio assets');

// jsPDF is vendored byte for byte from the npm tarball (registry integrity checked when it was
// added), the same 2.5.1 the WRS export loads from cdnjs. A different build would measure and
// embed differently, so any change to it is a decision, made here.
const jspdf = read('jspdf-2.5.1.umd.min.js');
eq(jspdf.length, 364463, 'jspdf-2.5.1.umd.min.js is the npm 2.5.1 build (size)');
eq(crypto.createHash('sha256').update(jspdf).digest('hex'),
   '98ccf17aa10c20bb1301762618fcc9b6ab3a4e7f26b6071d64d0b41154df3875',
   'jspdf-2.5.1.umd.min.js is the npm 2.5.1 build (sha256)');

// The fonts carry no layout tables. With GPOS or kern the browser would kern the preview and
// jsPDF would not kern the PDF, so the two would disagree by a few points on every price.
const tablesOf = buf => {
  const n = buf.readUInt16BE(4), out = [];
  for (let i = 0; i < n; i++) out.push(buf.toString('latin1', 12 + 16 * i, 16 + 16 * i));
  return out;
};
const FONT_FILES = ['poppins-700.ttf', 'poppins-900.ttf', 'poppins-900-italic.ttf', 'luckiest-guy-400.ttf'];
for (const f of FONT_FILES) {
  const buf = read('fonts/' + f), tables = tablesOf(buf);
  eq(buf.readUInt32BE(0), 0x00010000, `${f} is a TrueType font`);
  for (const t of ['cmap', 'glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp', 'name', 'post'])
    ok(tables.includes(t), `${f} has its ${t} table`);
  const extra = tables.filter(t => ['GSUB', 'GPOS', 'GDEF', 'kern', 'morx', 'kerx', 'fpgm', 'prep', 'cvt '].includes(t));
  eq(extra.join(','), '', `${f} has no layout or hinting tables`);
}
for (const [f, head] of [['fonts/OFL.txt', 'SIL OPEN FONT LICENSE Version 1.1'], ['fonts/LICENSE-2.0.txt', 'Apache License']])
  ok(read(f).toString('utf8').includes(head), `${f} is the licence the fonts ship under`);

// The logo is 8-bit RGB with no transparency and no interlacing. jsPDF decodes a PNG with an
// alpha channel in JavaScript, pixel by pixel, and adds a soft mask: 490–710 ms for this image
// against 2–6 ms once flattened (Node, measured 25 Sep). The source was opaque anyway.
const png = read('sign-logo.png');
eq(png.toString('latin1', 0, 8), '\x89PNG\r\n\x1a\n', 'sign-logo.png is a PNG');
eq(png.toString('latin1', 12, 16), 'IHDR', 'sign-logo.png starts with its header');
eq([png.readUInt32BE(16), png.readUInt32BE(20)].join('x'), '1711x497', 'sign-logo.png is the 1711 × 497 lockup');
eq(png[24], 8, 'sign-logo.png is 8 bits per channel');
eq(png[25], 2, 'sign-logo.png is RGB, with no alpha channel');
eq(png[28], 0, 'sign-logo.png is not interlaced');
const chunks = [];
for (let i = 8; i < png.length; ) { const len = png.readUInt32BE(i); chunks.push(png.toString('latin1', i + 4, i + 8)); i += 12 + len; }
ok(!chunks.includes('tRNS'), 'sign-logo.png has no transparency chunk');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
