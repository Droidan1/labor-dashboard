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
import vm from 'node:vm';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
const near = (a, b, tol, m) => ok(typeof a === 'number' && Math.abs(a - b) <= tol, `${m} (got ${a}, want ${b} ± ${tol})`);
const read = f => fs.readFileSync(path.join(repo, f));
const sliceOrNull = (src, from, to) => {
  const a = src.indexOf(from);
  if (a < 0) return null;
  const b = to ? src.indexOf(to, a) : -1;
  return src.slice(a, b > a ? b : undefined);
};

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

// ── 2. The block ─────────────────────────────────────────────────────────────
// It shares index.html with a 27,000-line script that declares `const COLORS` and a global
// `el()`. One top-level binding of the same name, and the page stops loading for everyone.
console.log('The renderer block');
const html = read('index.html').toString('utf8');
const OPEN = '<script id="sign-render">';
const block = sliceOrNull(html, OPEN, '</script>');
ok(block && block.length > 20000 && block.length < 80000, `index.html has one sign-render block of a plausible size (${block && block.length})`);
eq(html.split(OPEN).length, 2, 'there is exactly one sign-render block');
const js = block ? block.slice(OPEN.length) : '';
ok(js.includes('window.SignRender = Object.freeze') && !js.includes('<script'), 'the slice ends at the block\'s own </script>');
const body = js.replace(/^\s*\/\*[\s\S]*?\*\/\s*/, '').trimEnd();
ok(body.startsWith('(function () {') && body.endsWith('})();'), 'the block is one IIFE: nothing is declared at the top level');
const code = js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(code), 'the renderer never parses HTML');
ok(!/\bdocument\b/.test(code), 'the renderer never touches the page document: drawSVG draws into the one it is given');

const ctx = vm.createContext({ window: {} });
let loadErr = null;
try { vm.runInContext(js, ctx); } catch (e) { loadErr = e; }
ok(!loadErr, `the block runs with no document at all (${loadErr && loadErr.message})`);
const R = ctx.window.SignRender || {};
ok(Object.isFrozen(R) && typeof R.engine === 'function', 'it exposes a frozen window.SignRender');
eq(Object.keys(ctx).join(','), 'window', 'it adds nothing else to the global object');
// A top-level const/let/class would throw "already declared" on a second run, and the main
// script's own names would throw on the first. Both orders, in one realm, like the page.
for (const [what, before] of [['after the main script\'s globals', 'const COLORS = 1; function el() {} const G = 2; const PT = 3;'], ['twice', '']]) {
  const c2 = vm.createContext({ window: {} });
  let e2 = null;
  try { vm.runInContext(before, c2); vm.runInContext(js, c2); vm.runInContext(js, c2); vm.runInContext('const COLORS2 = 1; function el2() {}', c2); } catch (e) { e2 = e; }
  ok(!e2, `the block loads ${what} with no clash (${e2 && e2.message})`);
}

// The fonts, measured by the block's own reader.
const FACE_KEYS = ['word', 'label', 'small', 'num'];
const fontBytes = {}, fonts = {};
for (const k of FACE_KEYS) { fontBytes[k] = new Uint8Array(read(R.FACES[k].file)); fonts[k] = R.readFont(fontBytes[k]); }
const E = R.engine(fonts);
const logoBytes = new Uint8Array(read(R.LOGO.file));

// ── 3. Parsers ───────────────────────────────────────────────────────────────
console.log('Parsers');
const PRICES = [['2', 200], ['2.5', 250], ['2.50', 250], ['$2', 200], ['$ 2.05', 205], ['1,299.99', 129999], ['9999.99', 999999],
  ['0.99', 99], ['.99', 99], ['10000', 'err'], ['0', 'err'], ['0.00', 'err'], ['-2', 'err'], ['2.505', 'err'], ['abc', 'err'],
  ['', 'err'], ['12,34', 'err'], ['1,2345', 'err'], ['2.', 'err'], ['.', 'err'], ['1e3', 'err'], [' 7 ', 700]];
for (const [s, want] of PRICES) { const r = R.parsePrice(s); eq(r.err ? 'err' : r.cents, want, `parsePrice(${JSON.stringify(s)})`); }
eq(R.parsePrice('2.505').err, 'Use at most two decimal places. Nothing is rounded for you.', 'a third decimal is refused, never rounded');
const PCTS = [['20', 20], ['20%', 20], ['20 %', 20], ['20% off', 20], ['20 % OFF', 20], [' 5 ', 5], ['99', 99], ['1', 1], ['07', 7],
  ['', 'err'], ['0', 'err'], ['100', 'err'], ['12.5', 'err'], ['20.5', 'err'], ['-5', 'err'], ['abc', 'err'], ['%', 'err'], ['2 0', 'err'], ['20%%', 'err']];
for (const [s, want] of PCTS) { const r = R.parsePct(s); eq(r.err ? 'err' : r.n, want, `parsePct(${JSON.stringify(s)})`); }
eq(JSON.stringify(R.priceParts(99)), '{"lead":"","dollars":"99","cents":"","tail":"¢"}', 'under a dollar: 99 and a raised ¢');
eq(JSON.stringify(R.priceParts(129999)), '{"lead":"$","dollars":"1,299","cents":"99","tail":""}', '$1,299.99: thousands comma, raised 99');
eq(R.priceParts(205).cents, '05', '$2.05 raises 05, not 5');
eq(R.priceParts(200).cents, '', '$2 has no cents');
eq(R.priceText(999999), '$9,999.99', 'priceText');
eq(R.discountPct(10000, 3000), 70, '$100 → $30 is 70% off');
eq(R.discountPct(5999, 1999), 66, '66.68% is 66%: rounded down');
eq(R.discountPct(300, 100), 66, '66.67% is 66%, never 67%');
eq(R.discountPct(100, 100), null, 'no discount when you pay what they charge');
eq(R.discountPct(100, 120), null, 'no discount when you pay more');

// ── 4. The model and the field rules ─────────────────────────────────────────
console.log('Field rules');
const sign = o => R.normalizeSign(Object.assign(R.blankSign(), o));
const V = (o, e = E) => R.validate(R.signModel(sign(o)), e);
const both = v => `${v.blocked.landscape},${v.blocked.portrait}`;
const OKSIGN = { sale: 'flash', groups: [{ name: 'All cereal', price: '2' }] };
let v = V(OKSIGN);
eq(both(v) + JSON.stringify(v.msgs), 'false,false{}', 'a good sign prints both ways with nothing to fix');
ok(v.layouts.landscape && v.layouts.portrait, 'validate hands back the two layouts it measured, for drawing');
v = V(OKSIGN, null);
eq(both(v) + JSON.stringify(v.msgs), 'true,true{}', 'with no fonts loaded nothing prints, and nothing is reported as too long');
const field = (o, key, re, what) => { const r = V(o); ok(re.test(r.msgs[key] || '') && both(r) === 'true,true', `${what}: ${key} says so and both orientations are blocked (${JSON.stringify(r.msgs)})`); };
field({ groups: [{ name: '', price: '2' }] }, 'name-0', /required/, 'no name');
field({ groups: [{ name: 'All cereal', price: '2.505' }] }, 'price-0', /two decimal/, 'a bad price');
field({ template: 'pct', groups: [{ name: 'All coats', pct: '0' }] }, 'pct-0', /1 to 99/, '0% off');
eq(JSON.stringify(V({ groups: [{ name: 'Mens athletic sneakers', price: '24.99' }] }).msgs), '{}', 'a 22-character name is allowed');
field({ groups: [{ name: 'Mens athletic sneakers!', price: '24.99' }] }, 'name-0', /22 characters at most/, 'a 23-character name');
field({ groups: [{ name: 'A thirty character product nm', price: '2' }] }, 'name-0', /22 characters at most/, 'a stored 30-character name (the input stops at 22; a draft does not)');
// The limit counts what was typed, as the input's maxlength does: not the capitals (ß prints
// as SS, one longer) and not the spaces the sign collapses.
ok(!/characters at most/.test(V({ groups: [{ name: 'Straßenschuhe für alle', price: '2' }] }).msgs['name-0'] || ''), 'a 22-character name with ß is allowed, though its capitals are 23');
ok(!/characters at most/.test(V({ groups: [{ name: ' All' + ' '.repeat(30) + 'cereal ', price: '2' }] }).msgs['name-0'] || ''), 'spaces the sign collapses do not count');
field({ sale: 'custom', custom: '', groups: [{ name: 'Tea', price: '2' }] }, 'custom', /Type the label/, 'an empty custom label');
eq(JSON.stringify(V({ sale: 'custom', custom: 'Weekend deal', groups: [{ name: 'Tea', price: '2' }] }).msgs), '{}', 'a 12-character label is allowed');
field({ sale: 'custom', custom: 'Weekend deals', groups: [{ name: 'Tea', price: '2' }] }, 'custom', /12 characters at most/, 'a 13-character label');
field({ groups: [{ name: 'Tea', price: '2', qual: 'x'.repeat(33) }] }, 'qual-0', /32 characters at most/, 'a 33-character note');
field({ groups: [{ name: 'Tea', price: '2', dot: true }] }, 'qual-0', /what the dot means/, 'a dot with no note');
field({ template: 'uvt', them: '', groups: [{ name: 'Table', price: '30' }] }, 'them', /Enter their price/, 'Us vs Them with no price of theirs');
field({ template: 'uvt', them: '100', groups: [{ name: 'Table', price: '100' }] }, 'price-0', /lower than their price/, 'you pay what they charge');
field({ template: 'uvt', them: '100', groups: [{ name: 'Table', price: '99.50' }] }, 'price-0', /under 1%/, 'a 0.5% saving');
// Characters the font can't print. Judged in capitals: µ is fine in lower case and a Greek
// capital the file doesn't have once uppercased. A bidi override would reverse the line on paper.
field({ groups: [{ name: 'Café µ', price: '2' }] }, 'name-0', /can't print “µ”/, 'µ, which uppercases out of the font');
field({ groups: [{ name: 'Shoes 👟', price: '2' }] }, 'name-0', /can't print “👟”/, 'an emoji');
field({ groups: [{ name: 'Shoes \u202Eoff', price: '2' }] }, 'name-0', /can't print U\+202E/, 'a bidi override, named by its code so the message cannot be reversed by it');
field({ groups: [{ name: 'Tea', price: '2', qual: 'Soft\u00ADhyphen' }] }, 'qual-0', /U\+00AD/, 'a soft hyphen in the note');
field({ sale: 'custom', custom: 'Ω deal', groups: [{ name: 'Tea', price: '2' }] }, 'custom', /“Ω”/, 'a Greek letter in the label');
const decomposed = R.signModel(sign({ groups: [{ name: 'Cafe\u0301', price: '2' }] }));
eq(decomposed.groups[0].name, 'CAF\u00C9', 'a decomposed é is composed first, and prints as É');
eq(JSON.stringify(R.validate(decomposed, E).msgs), '{}', '…so it is not refused');
eq(R.signModel(sign({ groups: [{ name: '  all   cereal\t', price: '2' }] })).groups[0].name, 'ALL CEREAL', 'names are trimmed, spaces collapsed, capitals');
ok(R.unsupportedChars('Straße ÿ Œuvre “Deal” – 50% ™ €').length === 0, 'ß, ÿ, Œ, curly quotes, dashes, ™ and € all print');

// normalizeSign: whatever a saved draft holds becomes a well-formed sign.
const junk = R.normalizeSign({ template: 'poster', sale: 'mega', two: 'yes', them: 5, custom: null,
  groups: [{ name: 7, price: {}, unit: 'dozen', dot: 'true' }, 'x'], extra: '<img src=x>' });
eq(JSON.stringify(junk), JSON.stringify({ template: 'price', sale: 'none', custom: '', two: false, them: '5',
  groups: [{ name: '7', price: '', pct: '', unit: '', qual: '', dot: false }, { name: '', price: '', pct: '', unit: '', qual: '', dot: false }] }),
  'normalizeSign keeps known ids and strings only, and drops unknown fields');
eq(JSON.stringify(R.normalizeSign(null)), JSON.stringify(R.blankSign()), 'normalizeSign(null) is a blank sign');
eq(R.normalizeSign({ template: 'uvt', two: true }).two, false, 'Us vs Them is always one product');
const dots = R.normalizeSign({ two: true, groups: [{ dot: true }, { dot: true }] });
eq(`${dots.groups[0].dot},${dots.groups[1].dot}`, 'true,false', 'one dot, one group');
eq(R.normalizeSign({ groups: [{ name: 'x'.repeat(5000) }] }).groups[0].name.length, 200, 'a planted 5,000-character name is cut to 200, so the fit loop stays short');

// ── 5. Known outcomes, with the real fonts ───────────────────────────────────
console.log('Known outcomes');
v = V({ sale: 'manager', groups: [{ name: 'Mens athletic sneakers', price: '24.99', unit: 'each' }] });
eq(both(v) + JSON.stringify(v.msgs), 'false,false{}', 'MENS ATHLETIC SNEAKERS, the 22-character limit, prints both ways');
v = V({ sale: 'blowout', two: true, groups: [{ name: 'Work boots', price: '20', unit: 'pair' }, { name: 'Premium work boots', price: '35', unit: 'pair' }] });
eq(both(v), 'true,false', 'Work boots / Premium work boots: portrait only');
eq(v.msgs['name-1'], 'Too long for the landscape sign: letters would be 0.46 in tall, and the minimum is 0.6 in. Cut about 3 characters.',
   '…and the message names the longer name, the sign, the height and the cut');
eq(Object.keys(v.msgs).join(), 'name-1', '…and only the longer name is told to change');
v = V({ sale: 'sale', two: true, groups: [{ name: 'Sofa', price: '499' }, { name: 'Sectional', price: '899' }] });
eq(both(v), 'true,false', 'Sofa / Sectional: a 9-letter word can\'t wrap in half a landscape sign, so portrait only');
v = V({ sale: 'sale', two: true, groups: [{ name: 'Sofa', price: '9999.99' }, { name: 'Loveseat', price: '9999.99' }] });
eq(both(v) + JSON.stringify(v.msgs), 'false,false{}', '$9,999.99 in two groups, the widest price, fits both ways');
v = V({ template: 'uvt', them: '100', groups: [{ name: 'Lt. blue end table', price: '30' }] });
eq(both(v), 'false,false', 'Us vs Them: the store\'s own sign fits both ways');
eq(v.layouts.portrait.items.filter(i => i.role === 'disc' || i.role === 'disc-off').map(i => i.text).join(' '), '70% OFF', '…with the discount worked out: 70% OFF');
v = V({ template: 'pct', sale: 'sale', groups: [{ name: 'All winter coats', pct: '20' }] });
eq(both(v), 'false,false', '% Off: 20% on all winter coats fits both ways');
eq(v.layouts.landscape.items.filter(i => ['price', 'pct', 'off'].includes(i.role)).map(i => i.text).join(' '), '20 % OFF', '…the percentage is the hero, % raised, OFF under it');
v = V({ sale: 'none', groups: [{ name: 'All candy', price: '0.99' }] });
eq(v.layouts.portrait.items.filter(i => i.role === 'price' || i.role === 'cents').map(i => i.text).join('|'), '99|¢', 'under a dollar prints 99 with a raised ¢');
eq(v.layouts.portrait.items.filter(i => i.role === 'label').length, 0, 'no label: the corner stays empty');

// ── 6. Invariants over a grid of signs ───────────────────────────────────────
// Every sign that is allowed to print, in every orientation it is allowed in, keeps the rules
// the design was approved on. Ink boxes come from the glyphs themselves (readFont).
console.log('Layout invariants');
const inkOf = it => {
  const f = fonts[it.font], chars = [...it.text];
  return { x0: it.x + it.size * f.inkLeft(chars[0]), x1: it.x + it.w + it.size * f.inkRight(chars[chars.length - 1]),
           y0: it.y - it.size * Math.max(0, ...chars.map(f.up)), y1: it.y + it.size * Math.max(0, ...chars.map(f.down)) };
};
const boxOf = it => it.t === 'text' ? inkOf(it) : it.t === 'logo' ? { x0: it.x, x1: it.x + it.w, y0: it.y, y1: it.y + it.h }
  : it.t === 'dot' ? { x0: it.cx - it.r, x1: it.cx + it.r, y0: it.cy - it.r, y1: it.cy + it.r } : null;
const NAMES = ['Tea', 'All cereal', 'Bath towels', 'Mens athletic sneakers', 'Kitchen storage bins', 'Sectional', 'Lt. blue end table',
  'WWWWWWWWWWWWWWWWWWWWWW', 'Iiiiii iiiiii iiiiii i'];
const OFFERS = ['0.99', '2', '4.99', '24.99', '1,299', '9999.99'];
const PCT_OFFERS = ['5', '20', '99'];
const LABELS = [{ sale: 'none' }, { sale: 'flash' }, { sale: 'manager' }, { sale: 'custom', custom: 'Weekend deal' }];
const EXTRAS = [{}, { unit: 'each' }, { unit: 'pair', qual: 'Yellow dot on bottom', dot: true }];
const grid = [];
for (const L of LABELS) for (const X of EXTRAS) for (const [a, name] of NAMES.entries()) {
  const p = OFFERS[a % OFFERS.length], q = OFFERS[(a + 3) % OFFERS.length], pc = PCT_OFFERS[a % 3];
  grid.push(Object.assign({}, L, { groups: [Object.assign({ name, price: p }, X)] }));
  grid.push(Object.assign({}, L, { two: true, groups: [Object.assign({ name, price: p }, X), { name: NAMES[(a + 4) % NAMES.length], price: q }] }));
  grid.push(Object.assign({}, L, { template: 'pct', groups: [Object.assign({ name, pct: pc }, X)] }));
  grid.push(Object.assign({}, L, { template: 'pct', two: true, groups: [{ name, pct: pc }, Object.assign({ name: NAMES[(a + 2) % NAMES.length], pct: '40' }, X)] }));
  grid.push(Object.assign({}, L, { template: 'uvt', them: ['1.49', '100', '9999.99'][a % 3], groups: [Object.assign({ name, price: ['0.99', '30', '1,299'][a % 3] }, X)] }));
}
const faults = {};
const fault = (k, s) => { (faults[k] = faults[k] || []).push(s); };
let printable = 0, blockedCount = 0;
const t0 = Date.now();
for (const s of grid) {
  const model = R.signModel(sign(s)), r = R.validate(model, E), tag = JSON.stringify(s);
  for (const o of R.ORIENTS) {
    if (r.blocked[o]) { blockedCount++; if (!Object.keys(r.msgs).length) fault('blocked with no message', `${o} ${tag}`); continue; }
    printable++;
    const L = r.layouts[o], inner = 18 + 13 + 20;   // the content box: margin, border, pad
    const boxes = L.items.map(it => ({ it, b: boxOf(it) })).filter(x => x.b);
    // Round letters overshoot the cap height and the baseline by about 1% of their size, by
    // design (the O in BLOW, measured: 0.012 em), and the box is budgeted in cap heights. So
    // 1.5% of a text's size is allowed; a letter hanging sideways out of the box is not.
    for (const { it, b } of boxes) {
      const tol = it.t === 'text' ? 0.015 * it.size : 0.01;
      if (b.x0 < inner - tol || b.y0 < inner - tol || b.x1 > L.W - inner + tol || b.y1 > L.H - inner + tol)
        fault('ink outside the content box', `${o} ${it.role || it.t} ${tag} (${[b.x0, b.y0, L.W - b.x1, L.H - b.y1].map(v => v.toFixed(2)).join(',')})`);
    }
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].b, b = boxes[j].b;
      if (a.x0 < b.x1 - 0.01 && b.x0 < a.x1 - 0.01 && a.y0 < b.y1 - 0.01 && b.y0 < a.y1 - 0.01)
        fault('overlap', `${o} ${boxes[i].it.role || boxes[i].it.t} × ${boxes[j].it.role || boxes[j].it.t} ${tag}`);
    }
    const g = L.report.groups.filter(Boolean);
    for (const x of g) {
      if (x.nameCap != null && x.nameCap < R.G.minCap - 0.01) fault('name under 0.6 in', `${o} ${tag}`);
      if (x.nameCap != null && x.priceCap != null && x.priceCap < x.nameCap * R.G.priceFloorRatio - 0.01) fault('price not the biggest text', `${o} ${tag}`);
    }
    if (g.length === 2) {
      const sizes = role => [...new Set(L.items.filter(i => i.role === role).map(i => i.size.toFixed(6)))];
      if (sizes('name').length > 1) fault('two names at two sizes', `${o} ${tag}`);
      if (sizes('price').length > 1) fault('two prices at two sizes', `${o} ${tag}`);
    }
    if (L.report.uvt) {
      const them = L.items.find(i => i.role === 'them'), hero = L.items.find(i => i.role === 'price');
      if (them && hero && them.size > hero.size * 0.4 + 0.01) fault('their price over 40% of the hero', `${o} ${tag}`);
    }
  }
}
const ms = Date.now() - t0;
console.log(`  grid: ${grid.length} signs, ${printable} printable, ${blockedCount} blocked, ${ms} ms`);
ok(grid.length === 540 && printable > 600 && blockedCount > 50, `the grid covers ${grid.length} signs: ${printable} printable orientations, ${blockedCount} blocked (${ms} ms)`);
for (const k of ['blocked with no message', 'ink outside the content box', 'overlap', 'name under 0.6 in', 'price not the biggest text',
                 'two names at two sizes', 'two prices at two sizes', 'their price over 40% of the hero'])
  ok(!faults[k], `no printable sign has: ${k}${faults[k] ? ` (${faults[k].length}, e.g. ${faults[k][0]})` : ''}`);
// The sale label's ink ends AT the content box's right edge, not near it. An italic letter
// leans past its own advance (T by 0.065 em, V and Y by 0.075), so each line is pulled in by
// its own last letter's lean, read from the font: flush when the letter leans out, never
// across the edge, and short of it only when the letter itself stops short (L, D).
{
  const flush = [], across = [];
  for (const lab of [{ sale: 'flash' }, { sale: 'manager' }, { sale: 'blowout' }, { sale: 'sale' },
                     { sale: 'custom', custom: 'Hot buy' }, { sale: 'custom', custom: 'Last day' }, { sale: 'custom', custom: 'Wow' }])
    for (const o of R.ORIENTS) {
      const L = E.layoutSign(R.signModel(sign(Object.assign({ groups: [{ name: 'Tea', price: '2' }] }, lab))), o), edge = L.W - 51;
      for (const it of L.items.filter(i => i.role === 'label')) {
        const x1 = inkOf(it).x1, leans = fonts.label.inkRight([...it.text].pop()) > 0;
        if (x1 > edge + 0.01) across.push(`${it.text} ${o} +${(x1 - edge).toFixed(2)} pt`);
        if (leans && Math.abs(x1 - edge) > 0.01) flush.push(`${it.text} ${o} ${(x1 - edge).toFixed(2)} pt`);
      }
    }
  eq(across.join('; '), '', 'no sale label line crosses the content box');
  eq(flush.join('; '), '', 'a label line that ends in a leaning letter ends its ink exactly at the edge (FLASH, SALE, OUT, HOT BUY…)');
}
// The checks above must be able to fail: the same measure applied to a sign moved 30 pt.
{
  const L = V(OKSIGN).layouts.landscape, shifted = L.items.map(it => it.t === 'text' ? Object.assign({}, it, { x: it.x + 30 }) : it);
  ok(shifted.some(it => { const b = boxOf(it); return b && b.x1 > L.W - 51 + 0.01; }), 'the content-box check catches a sign pushed 30 pt');
}

// ── 7. The two drawers draw the same thing ───────────────────────────────────
// The preview and Print draw the SVG; the PDF is drawn by jsPDF. Both are fed the same items,
// and here both are recorded as primitives and compared: same kind, order, place, size, font,
// colour and letter spacing. Neither may centre text itself.
console.log('SVG and PDF agree');
const fakeDoc = { createElementNS(ns, tag) {
  return { ns, tag, attrs: {}, kids: [], text: null, setAttribute(k, val) { this.attrs[k] = String(val); },
           appendChild(c) { this.kids.push(c); return c; }, set textContent(t) { this.text = t; } };
} };
const r2 = x => Math.round(+x * 100) / 100;
const svgPrims = svg => svg.kids.slice(1).map(n => {   // kids[0] is the white paper; a PDF page already is
  const a = n.attrs;
  if (n.tag === 'rect') return ['rect', r2(a.x), r2(a.y), r2(a.width), r2(a.height), a.stroke.toLowerCase(), r2(a['stroke-width'])];
  if (n.tag === 'image') return ['image', r2(a.x), r2(a.y), r2(a.width), r2(a.height)];
  if (n.tag === 'line') return ['line', r2(a.x1), r2(a.y1), r2(a.x2), r2(a.y2), a.stroke.toLowerCase(), r2(a['stroke-width'])];
  if (n.tag === 'circle') return ['circle', r2(a.cx), r2(a.cy), r2(a.r), a.fill.toLowerCase(), a.stroke.toLowerCase()];
  if (n.tag === 'text') return ['text', n.text, r2(a.x), r2(a.y), r2(a['font-size']), a['font-family'], a.fill.toLowerCase(), r2(a['letter-spacing'] || 0), a['text-anchor'] || null];
  return ['?', n.tag];
});
const pdfRecorder = () => {
  const st = { draw: null, fill: null, text: null, lw: null, font: null, size: null }, prims = [], calls = [];
  const rec = { prims, calls,
    setDrawColor(c) { st.draw = String(c).toLowerCase(); }, setFillColor(c) { st.fill = String(c).toLowerCase(); },
    setTextColor(c) { st.text = String(c).toLowerCase(); }, setLineWidth(w) { st.lw = w; }, setLineCap() {}, setCharSpace() {},
    setFont(f) { st.font = f; }, getFont() { return { fontName: st.font }; }, setFontSize(s) { st.size = s; },
    rect(x, y, w, h, style) { prims.push(['rect', r2(x), r2(y), r2(w), r2(h), st.draw, r2(st.lw)]); calls.push(style); },
    addImage(d, fmt, x, y, w, h) { prims.push(['image', r2(x), r2(y), r2(w), r2(h)]); calls.push(fmt); },
    line(x1, y1, x2, y2) { prims.push(['line', r2(x1), r2(y1), r2(x2), r2(y2), st.draw, r2(st.lw)]); },
    circle(x, y, r, style) { prims.push(['circle', r2(x), r2(y), r2(r), st.fill, st.draw]); calls.push(style); },
    text(t, x, y, o) { prims.push(['text', t, r2(x), r2(y), r2(st.size), st.font, st.text, r2(o && o.charSpace || 0), (o && o.align) || null]);
                       calls.push((o && 'charSpace' in o) ? 'cs' : 'no-cs'); },
  };
  return rec;
};
const SAMPLES = [OKSIGN, { sale: 'blowout', two: true, groups: [{ name: 'Shoes', price: '10', unit: 'pair' }, { name: 'Premium shoes', price: '15', unit: 'pair', qual: 'Yellow dot on bottom', dot: true }] },
  { template: 'uvt', sale: 'flash', them: '59.99', groups: [{ name: 'Stand mixer', price: '19.99', unit: 'each' }] },
  { template: 'pct', sale: 'custom', custom: 'Weekend deal', two: true, groups: [{ name: 'Shoes', pct: '20' }, { name: 'Premium shoes', pct: '40' }] },
  { sale: 'none', groups: [{ name: 'All candy', price: '0.99' }] }];
for (const s of SAMPLES) for (const o of R.ORIENTS) {
  const model = R.signModel(sign(s)), L = E.layoutSign(model, o), tag = `${o} ${s.template || 'price'}${s.two ? ' ×2' : ''}`;
  const svg = R.drawSVG(L, fakeDoc, { label: R.describe(model), logoHref: 'blob:logo' });
  const rec = pdfRecorder();
  R.drawPDF(L, rec, { logo: logoBytes });
  const a = JSON.stringify(svgPrims(svg)), b = JSON.stringify(rec.prims);
  ok(a === b, `${tag}: the SVG and the PDF draw the same primitives${a === b ? '' : `\n        svg ${a.slice(0, 300)}\n        pdf ${b.slice(0, 300)}`}`);
  eq(svgPrims(svg).length, L.items.length, `${tag}: one primitive per item`);
  ok(rec.calls.filter(c => c === 'no-cs').length === 0, `${tag}: every PDF text passes its letter spacing, even 0`);
  ok(svgPrims(svg).every(p => p[0] !== 'text' || p[8] === null), `${tag}: no SVG text is anchored; each is drawn from its left edge`);
}
{
  const L = E.layoutSign(R.signModel(sign(OKSIGN)), 'landscape');
  const svg = R.drawSVG(L, fakeDoc, { print: true, label: 'x' });
  eq(`${svg.attrs.width} ${svg.attrs.height} ${svg.attrs.viewBox}`, '11in 8.5in 0 0 792 612', 'for print the SVG is sized to the paper');
  ok(/font-kerning:none/.test(svg.attrs.style) && /font-synthesis:none/.test(svg.attrs.style), 'the SVG turns kerning and synthesis off, as a backstop to the fonts');
  const hostile = R.signModel(sign({ groups: [{ name: '<img src=x onerror=1>', price: '2' }] }));
  const hs = R.drawSVG(E.layoutSign(hostile, 'portrait'), fakeDoc, { label: R.describe(hostile) });
  const nameText = hs.kids.filter(k => k.attrs['data-role'] === 'name').map(k => k.text).join(' ');
  eq(nameText, '<IMG SRC=X ONERROR=1>', 'hostile text is drawn as text, in capitals');
  ok(hs.kids.every(k => Object.keys(k.attrs).every(a => !/^on/i.test(a))), '…and no element gets an on* attribute from it');
}
{
  // The unit is letter-spaced. Its left edge leaves room for the spacing BETWEEN letters only.
  const L = E.layoutSign(R.signModel(sign({ groups: [{ name: 'Towels', price: '4.99', unit: 'each' }] })), 'portrait');
  const u = L.items.find(i => i.role === 'unit');
  near(u.ls, u.size * 0.08, 1e-9, 'EACH is letter-spaced 0.08 em');
  near(u.w, fonts.small.w100('EACH') * u.size / 100 + 3 * u.ls, 1e-9, '…and its width counts the three gaps, not four');
  near(u.x + u.w / 2, L.W / 2, 0.01, '…so it is centred on the sign');
}

// ── 8. Real jsPDF ────────────────────────────────────────────────────────────
console.log('Real jsPDF');
const { jsPDF } = createRequire(import.meta.url)(path.join(repo, 'jspdf-2.5.1.umd.min.js'));
const newPdf = (W, H) => new jsPDF({ unit: 'pt', format: [W, H], orientation: W > H ? 'landscape' : 'portrait', compress: false, putOnlyUsedFonts: true });
// The reader's widths are jsPDF's widths, character by character, for everything each face prints.
const TEXT_SET = [];
for (const [a, b] of [[0x20, 0x7E], [0xA0, 0xFF], [0x152, 0x153], [0x178, 0x178], [0x2013, 0x2014], [0x2018, 0x2019], [0x201C, 0x201D], [0x2022, 0x2022], [0x2026, 0x2026], [0x20AC, 0x20AC], [0x2122, 0x2122]])
  for (let c = a; c <= b; c++) TEXT_SET.push(String.fromCodePoint(c));
const NUM_SET = [...' $%,.0123456789¢'];
{
  const doc = newPdf(792, 612);
  R.loadFontsInto(doc, fontBytes);
  for (const k of FACE_KEYS) {
    const set = k === 'num' ? NUM_SET : TEXT_SET;
    eq(fonts[k].codepoints().sort((a, b) => a - b).join(), set.map(c => c.codePointAt(0)).sort((a, b) => a - b).join(), `${k}: the font holds exactly the characters fonts/README.md lists`);
    doc.setFont(R.FACES[k].fam, 'normal'); doc.setFontSize(100);
    eq(doc.getFont().fontName, R.FACES[k].fam, `${k}: jsPDF has ${R.FACES[k].fam}`);
    const off = set.filter(c => Math.abs(doc.getTextWidth(c) - fonts[k].w100(c)) > 1e-9);
    eq(off.join(''), '', `${k}: every character is exactly as wide to the reader as to jsPDF`);
    const str = k === 'num' ? '$1,299 99¢ 70%' : 'MENS ATHLETIC SNEAKERS — CAFÉ “Œ” 50% ™';
    near(doc.getTextWidth(str), fonts[k].w100(str), 1e-9, `${k}: and so is a whole line`);
  }
  // The alphabet the validator allows is the alphabet the fonts hold.
  eq(TEXT_SET.filter(c => R.unsupportedChars(c).length).map(c => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')).join(),
     'U+00AD,U+00B5', 'every character in the fonts is allowed except the soft hyphen (invisible) and µ (its capital is Greek)');
  eq(R.unsupportedChars('\u00AD\u200B\u202E\u0301').length, 4, 'soft hyphen, zero-width space, bidi override and a lone accent are refused');
}
const objStream = (pdf, num) => { const m = pdf.match(new RegExp(`\\n${num} 0 obj\\n<<[^]*?>>\\nstream\\n([^]*?)\\nendstream`)); return m ? m[1] : null; };
for (const s of SAMPLES) for (const o of R.ORIENTS) {
  const model = R.signModel(sign(s)), L = E.layoutSign(model, o), tag = `${o} ${s.template || 'price'}${s.two ? ' ×2' : ''}`;
  const doc = newPdf(L.W, L.H);
  R.loadFontsInto(doc, fontBytes);
  R.drawPDF(L, doc, { logo: logoBytes });
  const pdf = Buffer.from(doc.output('arraybuffer')).toString('latin1');
  eq((pdf.match(/\/Type \/Page[^s]/g) || []).length, 1, `${tag}: one page`);
  eq(((pdf.match(/\/MediaBox \[([^\]]+)\]/) || [])[1] || '').trim().split(/\s+/).map(Number).join(' '), `0 0 ${L.W} ${L.H}`, `${tag}: the page is US Letter, ${o}`);
  const bases = [...new Set([...pdf.matchAll(/\/BaseFont \/(\S+)/g)].map(m => m[1].replace(/#([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))))];
  const used = [...new Set(L.items.filter(i => i.t === 'text').map(i => R.FACES[i.font].fam))];
  eq(bases.sort().join('|'), used.sort().join('|'), `${tag}: the PDF holds the sign's fonts and no other (no Times, no Helvetica)`);
  ok((pdf.match(/\/FontFile2/g) || []).length === used.length, `${tag}: every font is embedded`);
  eq((pdf.match(/\/Subtype \/Image/g) || []).length, 1, `${tag}: one image, the logo`);
  ok(/\/ColorSpace \/DeviceRGB/.test(pdf) && !/\/SMask/.test(pdf), `${tag}: the logo is RGB with no soft mask`);
  const contents = objStream(pdf, (pdf.match(/\/Contents (\d+) 0 R/) || [])[1]);
  const texts = L.items.filter(i => i.t === 'text');
  const bts = contents ? [...contents.matchAll(/BT\n([^]*?)ET/g)].map(m => m[1]) : [];
  eq(bts.length, texts.length, `${tag}: one text object per text item`);
  const bad = [];
  bts.forEach((bt, i) => {
    const it = texts[i] || {}, tf = bt.match(/\/F\d+ (\S+) Tf/), td = bt.match(/(\S+) (\S+) Td/), tc = bt.match(/(\S+) Tc/);
    if (!tf || Math.abs(+tf[1] - it.size) > 1e-6) bad.push(`${it.role} size ${tf && tf[1]} vs ${it.size}`);
    if (!td || Math.abs(+td[1] - it.x) > 1e-6 || Math.abs(+td[2] - (L.H - it.y)) > 1e-6) bad.push(`${it.role} at ${td && td.slice(1).join(',')} vs ${it.x},${L.H - it.y}`);
    if (!tc || Math.abs(+tc[1] - it.ls) > 1e-6) bad.push(`${it.role} Tc ${tc && tc[1]} vs ${it.ls}`);
    if (/ Tz| Tw|Tm\n/.test(bt)) bad.push(`${it.role} scaled or word-spaced`);
  });
  eq(bad.join('; '), '', `${tag}: every text is set at the layout's size, left edge, baseline and spacing`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
