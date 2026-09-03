// Price Scan — one item in a warehouse, priced, driven through the real endpoints.
//
// The warehouse counterpart of the Manifest Scorer. What matters here is not that it
// returns a number, but that:
//
//   1. A HUMAN'S CORRECTION IS PERMANENT. Retail coverage is ~40%; the tool only becomes
//      reliable if every gap an admin fills stays filled. The retail lookup overwrites
//      item_cache.retail_price on every run, so an override MUST live somewhere it cannot
//      reach — the same failure shape as the l3Map override and the stale vendor template.
//   2. THE CACHE ANSWERS FREE. Only a genuinely new item may cost an API call, or the
//      spend scales with how much gets scanned instead of falling as the library grows.
//   3. IT PRICES THE SAME AS THE SCORER. One ladder, or a buyer scores a load at one
//      number and the floor prices it at another.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, applyMigrationAlters, ctx, req, loadLadder } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
const near = (a, b, m) => ok(a !== null && Math.abs(a - b) < 0.05, `${m} (got ${JSON.stringify(a)}, want ~${b})`);

// 🛑 A TEST MUST NAME A REGRESSION, NOT DIE ON IT. Several suites here lift a function out
// of the source by slicing between markers and building it with `new Function`. When the
// source regresses past a marker, indexOf returns -1, the slice is nonsense, and the build
// throws — killing the process and taking every later suite with it, so the very thing
// under test is reported as a stack trace rather than a named failure. That has happened
// three times while writing this file. These two are the one answer to it.
const sliceOrNull = (src, from, to) => {
  const a = src.indexOf(from);
  if (a < 0) return null;
  const b = to ? src.indexOf(to, a) : -1;
  return src.slice(a, b > a ? b : undefined);
};
// Returns the built function, or one that answers a sentinel every assertion will fail on
// by name. `what` appears in that sentinel so the reason is legible from the output alone.
const buildOrStub = (what, body, argNames, argVals, ret) => {
  if (!body) return () => ({ MISSING: what });
  try {
    return new Function(...argNames, body + `\n; return ${ret};`)(...argVals);
  } catch (e) {
    return () => ({ UNBUILDABLE: `${what}: ${e.message}` });
  }
};

const worker = await loadWorker(repo);
const { db, env } = makeEnv(repo);
for (const m of ['migration-041.sql', 'migration-042.sql', 'migration-043.sql'])
  db.exec(fs.readFileSync(path.join(repo, m), 'utf8'));
applyMigrationAlters(db, repo);

// Every outbound call is stubbed and COUNTED — "did this cost anything" is an assertion
// here, not a hope. The response shapes are the REAL ones: the price parser answers
// { prices }, the classifier answers { rows: [{ row, category }] }, and the name expander
// answers { items } — three different contracts behind one endpoint.
let searchCalls = 0, modelCalls = 0;
let searchResults = [];
let snippetPrices = [];
let classifyL3 = null;
globalThis.fetch = async (u, init) => {
  const url = String(u);
  if (url.startsWith('https://api.search.tinyfish.ai')) {
    searchCalls++;
    return new Response(JSON.stringify({ results: searchResults }), { status: 200 });
  }
  if (url.startsWith('https://api.fetch.tinyfish.ai')) {
    return new Response(JSON.stringify({ results: [] }), { status: 200 });
  }
  if (url.startsWith('https://api.firecrawl.dev')) {
    return new Response('{"error":"not in this test"}', { status: 402 });
  }
  if (url.includes('api.anthropic.com')) {
    modelCalls++;
    const body = JSON.parse(init.body);
    const sys = body.system || '';
    if (/expand abbreviated/i.test(sys)) {
      return new Response(JSON.stringify({ content: [{ type: 'text', text: '{"items":[]}' }] }), { status: 200 });
    }
    if (/category/i.test(sys) && /rows/.test(sys)) {
      const rows = classifyL3 ? [{ row: 1, category: classifyL3, confidence: 'high' }] : [];
      return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ rows }) }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ prices: snippetPrices }) }] }), { status: 200 });
  }
  throw new Error('unexpected egress: ' + url.slice(0, 70));
};
env.ANTHROPIC_API_KEY = 'sk-test';
env.TINYFISH_API_KEY = 'tf-test';

const call = async (url, opts) => {
  const r = await worker.fetch(req(url, opts), env, ctx);
  const t = await r.text();
  let body; try { body = JSON.parse(t); } catch { body = { _raw: t.slice(0, 200) }; }
  return { status: r.status, body };
};
const post = (action, body, user = 'u-su') => call(`/?action=${action}`, { user, method: 'POST', body });
const get  = (action, user = 'u-su') => call(`/?action=${action}`, { user });

const SNACKS = 'FG BL CONSUMABLES - FOOD - SNACKS';
const CANNED = 'FG BL CONSUMABLES - FOOD - CANNED GOODS';

// Criteria the scan prices against: half dollars, 50% cap, 30% floor.
await post('merch-criteria-draft', { cells: [
  { category: null, field: 'price_cap_pct_retail', value: '50' },
  { category: null, field: 'min_gross_margin_pct', value: '30' },
  { category: 'Consumable Food', field: 'rounding', value: '$0.50' },
]});
await post('merch-criteria-publish', { note: 'scan test criteria' });
env.SALES_SNAPSHOTS.put('category-costs:global', JSON.stringify({ costs: { [SNACKS]: 0.81 } }));

// Real sales history, so ASP exists. Without it a scan of something no retailer carries
// has genuinely nothing to price from — which is correct behaviour, but not the case
// Bargain Lane is ever in: they have four years of till data for snacks.
{
  const etDay = (back) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' })
    .format(new Date(Date.now() - (back + 1) * 86400e3));
  for (let d = 0; d < 10; d++) {
    for (const st of ['bl1', 'bl2']) {
      env.SALES_SNAPSHOTS.put(`items:${st}:${etDay(d)}`, JSON.stringify({
        orderCount: 100,
        categories: [{ category: 'Consumable Food', qty: 40, netSales: 83.2,
                       l3Rows: [{ l3: SNACKS, qty: 40, netSales: 83.2 }] }],
      }));
    }
  }
}

console.log('Price Scan');

// ── An unknown item is looked up once, then remembered ──────────────────────
{
  searchCalls = 0; modelCalls = 0;
  searchResults = [{ position: 1, url: 'https://www.walmart.com/ip/cheezit', title: 'Cheez-It Original 12.4 oz', snippet: '$4.28' }];
  snippetPrices = [{ url: 'https://www.walmart.com/ip/cheezit', price: 4.28, title: 'Cheez-It Original 12.4 oz', pack: 1, in_stock: true, sold_by: 'Walmart.com' }];
  classifyL3 = SNACKS;

  const r = await post('merch-scan', { identifier: '024100113163', description: 'Cheez-It Original 12.4 oz' });
  eq(r.status, 200, 'a scan answers');
  near(r.body.retail, 4.28, 'street retail is found');
  eq(r.body.l3, SNACKS, '…and a category is suggested');
  near(r.body.cost, 0.81, '…and our cost for that category is attached');
  // $4.28 x 50% = $2.14, rounded UP to the next half dollar.
  near(r.body.price, 2.50, '🔑 priced by the SAME ladder as the Scorer — $2.14 rounds up to $2.50');
  eq(r.body.price_basis, 'street retail', '…and says what the price came from');
  ok(r.body.gp_pct > 60, `…with the GP stated (got ${r.body.gp_pct}%)`);
  eq(r.body.below_gp_floor, false, '…clearing the 30% floor');
  eq(r.body.looked_up, true, 'the first scan of an unknown item does a lookup');
  ok(searchCalls > 0, '…which costs a search');
}

// ── 💰 The same item again costs NOTHING ────────────────────────────────────
{
  const before = { s: searchCalls, m: modelCalls };
  const r = await post('merch-scan', { identifier: '024100113163' });
  eq(r.status, 200, 'a repeat scan answers');
  eq(r.body.from_cache, true, '🔑 …from cache');
  eq(r.body.looked_up, false, '…without looking anything up');
  eq(searchCalls, before.s, '💰 zero further searches');
  eq(modelCalls, before.m, '💰 zero further model calls');
  near(r.body.price, 2.50, '…and prices identically');
  near(r.body.retail, 4.28, '…on the same retail');
  eq(r.body.l3, SNACKS, '…and the same category, with no re-classification');
}

// ── 🛑 A human's retail price SURVIVES a later lookup ───────────────────────
// The failure this whole design exists to prevent: item_cache.retail_price is overwritten
// unconditionally by every retail run, so an override stored there would vanish the next
// time any manifest containing that UPC was priced.
{
  const sv = await post('merch-scan-save', { identifier: '024100113163', retail_price: 6.00 });
  eq(sv.status, 200, 'an admin can correct the retail price');

  const r = await post('merch-scan', { identifier: '024100113163' });
  near(r.body.retail, 6.00, "the correction is what the next scan reads");
  eq(r.body.retail_overridden, true, '…and the screen knows it was set by hand');
  near(r.body.price, 3.00, '🔑 …and the PRICE moves with it — $6.00 x 50% = $3.00');

  // Now run the manifest retail lookup over the same UPC, which is what used to wipe it.
  const CSV = ['UPC,Item Description,Qty,Unit Cost', '024100113163,Cheez-It Original,10,0.50', ''].join('\n');
  const up = await post('manifest-upload', { vendor: 'ClobberCo', csv: CSV });
  await post('manifest-retail', { id: up.body.id });

  const after = await post('merch-scan', { identifier: '024100113163' });
  near(after.body.retail, 6.00, "🛑 the override SURVIVES a full retail run — this is the l3Map bug's shape");
  const row = db.prepare(`SELECT retail_price, retail_price_override, retail_override_by FROM item_cache WHERE identifier='024100113163'`).get();
  near(row.retail_price_override, 6.00, 'the override lives in its own column');
  ok(row.retail_override_by, '…attributed to whoever set it');
  ok(row.retail_price !== null, '…and what the machine found is still kept beside it, not erased');
}

// ── A price override wins over the ladder, and is still judged ──────────────
{
  await post('merch-scan-save', { identifier: '024100113163', suggested_price: 1.00 });
  const r = await post('merch-scan', { identifier: '024100113163' });
  near(r.body.price, 1.00, 'a hand-set price is used verbatim');
  eq(r.body.price_overridden, true, '…and says so');
  // $1.00 against 81c of cost is 19% GP — a person may set it, but it is still reported.
  eq(r.body.below_gp_floor, true, '🔑 …and is STILL measured against the floor, not exempted');
}

// ── Clearing an override hands the item back to the lookup ─────────────────
{
  await post('merch-scan-save', { identifier: '024100113163', retail_price: null, suggested_price: null });
  const r = await post('merch-scan', { identifier: '024100113163' });
  eq(r.body.retail_overridden, false, 'an emptied override is gone');
  eq(r.body.price_overridden, false, '…for the price too');
  near(r.body.retail, 4.28, '…and the looked-up figure is back, because it was never erased');
}

// ── A category set by hand is never re-guessed ──────────────────────────────
{
  const ORAL = 'FG BL CONSUMABLES - HBA - ORAL';
  await post('merch-scan-save', { identifier: '024100113163', l3: ORAL });
  classifyL3 = SNACKS;                       // the model would say something else
  const r = await post('merch-scan', { identifier: '024100113163' });
  eq(r.body.l3, ORAL, "🔑 the human's category stands");
  eq(r.body.l3_source, 'manual', '…and is marked as theirs');
}

// ── Bad input is refused, not stored ────────────────────────────────────────
{
  eq((await post('merch-scan', {})).status, 400, 'a scan with neither barcode nor description is refused');
  eq((await post('merch-scan-save', { retail_price: 5 })).status, 400, 'an override with no barcode is refused');
  eq((await post('merch-scan-save', { identifier: '024100113163', retail_price: -2 })).status, 400,
     'a negative price is refused');
  eq((await post('merch-scan-save', { identifier: '024100113163', l3: 'Not A Category' })).status, 400,
     'an unknown category is refused');
}

// ── Managers may use it; staff may not, yet ─────────────────────────────────
{
  // A real 12-digit barcode: '111' is now refused for being three digits, and this test
  // is about WHO may scan, not about what a barcode looks like.
  eq((await post('merch-scan', { identifier: '024100113163' }, 'u-mgr1')).status, 200, 'a manager may scan');
  eq((await post('merch-scan', { identifier: '024100113163' }, 'u-staff')).status, 403, 'staff may not, yet');
  eq((await post('merch-scan-save', { identifier: '111', retail_price: 5 }, 'u-staff')).status, 403,
     '…and certainly may not override a price');
  // 🔑 Scanning and OVERRIDING are different rights. A manager prices items all day; only
  // an admin may permanently change what an item is worth for every store, forever.
  eq((await post('merch-scan-save', { identifier: '111', retail_price: 5 }, 'u-mgr1')).status, 403,
     '🔑 a manager may scan but may NOT set a permanent override');
  eq((await post('merch-scan-save', { identifier: '024100113163', retail_price: 5 }, 'u-admin')).status, 200,
     '…an admin may');
}

// ── A PHOTO, because iPhones cannot read barcodes in the browser ────────────
// Safari has no BarcodeDetector and 4 of the 6 installed devices are iPhones, so the
// camera path reads the picture with Claude instead. That is strictly better than a
// barcode API: it also works on the FRONT of a pack whose code is damaged or hidden.
{
  let visionReply = { upc: '024100113163', name: 'Cheez-It Original 12.4 oz' };
  const realFetch = globalThis.fetch;
  let sawImage = false;
  globalThis.fetch = async (u, init) => {
    if (String(u).includes('api.anthropic.com')) {
      const b = JSON.parse(init.body);
      const content = b.messages?.[0]?.content;
      if (Array.isArray(content) && content.some(c => c.type === 'image')) {
        sawImage = true;
        return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(visionReply) }] }), { status: 200 });
      }
    }
    return realFetch(u, init);
  };

  const r = await post('merch-scan', { image_b64: btoa('fake-jpeg-bytes'), media_type: 'image/jpeg' });
  eq(r.status, 200, '🔑 a photo alone is enough to price an item');
  eq(sawImage, true, '…and it really was sent as an image block');
  eq(r.body.identifier, '024100113163', 'the barcode read off the photo is used');
  eq(r.body.from_photo, true, '…and the answer says it came from a photo');
  ok(r.body.price !== null, '…and it prices, exactly as a typed barcode would');

  // 🔑 A barcode it cannot read must come back EMPTY, never guessed — a wrong barcode
  // prices a different product entirely, and nothing downstream would catch it.
  visionReply = { upc: '', name: 'Some unbranded jar of something' };
  const r2 = await post('merch-scan', { image_b64: btoa('blurry'), media_type: 'image/jpeg' });
  eq(r2.status, 200, 'an unreadable barcode still works from the product name');
  eq(r2.body.identifier, null, '…with no identifier invented');

  visionReply = { upc: '', name: '' };
  const r3 = await post('merch-scan', { image_b64: btoa('a photo of the floor'), media_type: 'image/jpeg' });
  eq(r3.status, 422, '🛑 a photo with no product in it is refused, not priced');
  ok(/could not make out/i.test(r3.body.error || ''), '…and says what to do about it');

  const big = await post('merch-scan', { image_b64: 'A'.repeat(8_000_001), media_type: 'image/jpeg' });
  eq(big.status, 400, 'an oversized photo is refused before it is sent anywhere');

  globalThis.fetch = realFetch;
}

// ── The barcode decoder that SHIPS, tested as shipped ──────────────────────
// Safari has never supported BarcodeDetector — not through iOS 26 — and these are
// iPhones, so the decoder is hand-written and lives inside index.html. It is extracted
// from that file here rather than from a copy, so the bytes under test are the bytes
// that run.
//
// 🛑 A WRONG BARCODE IS WORSE THAN NO BARCODE. It prices a different product and nothing
// downstream would catch it, so the false-positive count must be exactly zero — not low.
{
  const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  const from = html.indexOf('  const L = [', html.indexOf('EAN-13 / UPC-A decoder'));
  const to = html.indexOf('  // Live scan. Samples several rows');
  ok(from > 0 && to > from, 'the decoder is found in index.html');
  const { decodeEanRow } = new Function(html.slice(from, to) + '; return { decodeEanRow };')();

  // Encode a real EAN-13 the way a printed barcode is laid out, so the test exercises the
  // actual symbology rather than a shape the decoder happens to like.
  const L = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
  const G = L.map(p2 => [...p2].reverse().map(b => b === '1' ? '0' : '1').join(''));
  const R2 = L.map(p2 => [...p2].map(b => b === '1' ? '0' : '1').join(''));
  const PAR = ['000000','001011','001101','001110','010011','011001','011100','010101','010110','011010'];
  const encode = (code, mod = 3) => {
    const d = [...code].map(Number);
    let bits = '101';
    for (let k = 0; k < 6; k++) bits += (PAR[d[0]][k] === '0' ? L : G)[d[k + 1]];
    bits += '01010';
    for (let k = 0; k < 6; k++) bits += R2[d[k + 7]];
    bits += '101';
    const row = new Array(12).fill(225);
    for (const b of bits) for (let k = 0; k < mod; k++) row.push(b === '1' ? 30 : 225);
    for (let k = 0; k < 12; k++) row.push(225);
    return row;
  };

  const codes = ['0038000293122', '0024100113163', '4006381333931', '0012345678905'];
  let failures = 0;
  for (const c of codes) for (const mod of [2, 3, 4, 7]) if (decodeEanRow(encode(c, mod)) !== c) failures++;
  eq(failures, 0, 'every real barcode decodes exactly, at every module width');

  // ── 🔑 UPC-E: THE SMALL PACKAGES, WHICH ARE THE ONES WE SCAN MOST ─────────
  // A single can, a bar of soap, a travel-size shampoo. Anything without room for a
  // 95-module EAN-13 carries the 51-module compressed form, and until now the scanner
  // simply could not read it and gave no reason why.
  const encodeE = (ns, x, check, mod = 3) => {
    const P = ['111000','110100','110010','110001','101100','100110','100011','101010','101001','100101'];
    const pat = ns === 0 ? P[check] : [...P[check]].map(b => b === '1' ? '0' : '1').join('');
    let bits = '101';
    for (let k = 0; k < 6; k++) bits += (pat[k] === '1' ? G : L)[x[k]];
    bits += '010101';
    const row = new Array(14).fill(225);
    for (const b of bits) for (let k = 0; k < mod; k++) row.push(b === '1' ? 30 : 225);
    for (let k = 0; k < 14; k++) row.push(225);
    return row;
  };
  const chk12 = (a) => { let t = 0; for (let k = 0; k < 12; k++) t += a[k] * (k % 2 === 0 ? 1 : 3); return (10 - (t % 10)) % 10; };
  const expand = (ns, x) => {
    const [a, b, c, d, e, f] = x;
    const body = f <= 2 ? [ns, a, b, f, 0, 0, 0, 0, c, d, e]
      : f === 3 ? [ns, a, b, c, 0, 0, 0, 0, 0, d, e]
      : f === 4 ? [ns, a, b, c, d, 0, 0, 0, 0, 0, e]
      : [ns, a, b, c, d, e, 0, 0, 0, 0, f];
    const full = [0, ...body];
    return full.join('') + String(chk12(full));
  };
  // 🔑 EVERY expansion branch. Which zeros come back is chosen by the LAST digit, and
  // getting one branch wrong yields a valid-looking barcode for a different product.
  let eFail = 0, eSeen = 0;
  for (const [ns, x] of [[0,[1,2,3,4,5,0]], [0,[1,2,3,4,5,1]], [0,[1,2,3,4,5,2]],
                         [0,[1,2,3,4,5,3]], [0,[1,2,3,4,5,4]], [0,[1,2,3,4,5,6]],
                         [0,[9,8,7,6,5,9]], [1,[1,2,3,4,5,6]], [1,[0,0,0,0,0,0]]]) {
    const want = expand(ns, x);
    const check = Number(want[12]);
    for (const mod of [2, 3, 4, 7]) { eSeen++; if (decodeEanRow(encodeE(ns, x, check, mod)) !== want) eFail++; }
  }
  eq(eFail, 0, `🔑 every UPC-E expansion branch decodes exactly (${eSeen} encodings)`);
  // The hand-checked reference: UPC-E 01234565 is UPC-A 012345000065.
  eq(decodeEanRow(encodeE(0, [1,2,3,4,5,6], 5)), '0012345000065',
     '🔑 …and matches the published worked example');
  // A UPC-E is barely half the modules of an EAN-13, so it is likelier to appear in
  // noise. It must not.
  let eFalse = 0;
  for (let i = 0; i < 800; i++) {
    eFalse += decodeEanRow(Array.from({ length: 300 }, () => Math.random() < 0.5 ? 30 : 225)) ? 1 : 0;
    eFalse += decodeEanRow(Array.from({ length: 300 }, (_, k) => Math.sin(k / (1 + Math.random() * 6)) > 0 ? 40 : 215)) ? 1 : 0;
  }
  eq(eFalse, 0, '🛑 the shorter symbol does not make false positives — still exactly zero');

  // ── 🛑 BOTH PATHS MUST KEY THE SAME PRODUCT IDENTICALLY ───────────────────
  // Android Chrome has a native BarcodeDetector and Safari does not, so the same can of
  // beans is read by different code on different phones. Verified live in Chromium: the
  // native detector returns a UPC-E as its printed 8 digits ("01234565"), while our own
  // decoder returns the expanded 13 ("0012345000065"). item_cache is keyed on that
  // string — left unnormalised, one product would occupy two rows, be looked up twice,
  // and answer differently depending on who scanned it.
  {
    const glue = html.slice(from, html.indexOf('  async function psBarcode()'));
    const { psNormalizeCode } = new Function(glue + '; return { psNormalizeCode };')();
    // 🛑 TWELVE DIGITS, THE WAY IT IS PRINTED. A UPC-A is encoded as an EAN-13 with a
    // leading zero. Measured live: 085239098745 found the beans and their cached row;
    // 0085239098745 was a cache MISS and returned ZERO search results.
    eq(psNormalizeCode('01234565', 'upc_e'), '012345000065',
       '🔑 a native UPC-E expands and then loses the encoding zero');
    eq(psNormalizeCode('012345000065', 'upc_a'), '012345000065', '…a UPC-A is already canonical');
    eq(psNormalizeCode('0012345000065', 'ean_13'), '012345000065',
       '🔑 …and the 13-digit spelling of the SAME code lands on it too');
    eq(psNormalizeCode('0085239098745', null), '085239098745',
       '🛑 the exact code that found nothing now matches the row that was already there');
    eq(psNormalizeCode('4006381333931', 'ean_13'), '4006381333931',
       '🔑 a TRUE EAN-13 never starts with a zero and is left alone');
    eq(psNormalizeCode('0038000293122', null), '038000293122',
       'what the pixel decoder returns is canonicalised by the same door');
    // 🛑 An 8-digit code that is NOT a UPC-E must never be run through the expansion —
    // it would invent a different product's number. EAN-8 is deliberately not requested.
    eq(psNormalizeCode('12345670', 'ean_8'), '12345670',
       '🛑 an EAN-8 is left alone rather than expanded into someone else\'s UPC');
    eq(psNormalizeCode('', 'upc_e'), null, 'nothing in, nothing out');
  }

  // ── 🔑 A BARCODE ON A CAN ─────────────────────────────────────────────────
  // "It took me a long time to scan that barcode on the can." A label wrapped round a
  // cylinder is foreshortened toward its edges, so the bars there really are narrower.
  // Measured: a symbol spanning 1.2 radians of a can has edge modules at 83% of the
  // centre, and quantising the whole symbol against one width failed outright — which
  // meant turning the can until the code happened to face square-on.
  const curved = (code, modCentre, wrap) => {
    const d = [...code].map(Number);
    let bits = '101';
    for (let k = 0; k < 6; k++) bits += (PAR[d[0]][k] === '0' ? L : G)[d[k + 1]];
    bits += '01010';
    for (let k = 0; k < 6; k++) bits += R2[d[k + 7]];
    bits += '101';
    const row = new Array(16).fill(225);
    let acc = 0;
    for (let i2 = 0; i2 < bits.length; i2++) {
      const t = (i2 / (bits.length - 1)) - 0.5;
      const wd = modCentre * Math.cos(t * wrap);       // foreshortening toward the edges
      acc += wd;
      const px = Math.round(acc) - Math.round(acc - wd);
      for (let k = 0; k < px; k++) row.push(bits[i2] === '1' ? 30 : 225);
    }
    for (let k = 0; k < 16; k++) row.push(225);
    return row;
  };
  let curveFail = 0, curveTried = 0;
  for (const wrap of [0, 0.4, 0.8, 1.0, 1.2, 1.4]) for (const mod of [3, 4, 5, 6, 8]) {
    curveTried++;
    if (curved('0085239098745', mod, wrap).length && decodeEanRow(curved('0085239098745', mod, wrap)) !== '0085239098745') curveFail++;
  }
  eq(curveFail, 0, `🔑 a code wrapped round a can decodes at every curvature (${curveTried} cases, edges to 76% of centre)`);

  // 🛑 THE HARDEST ADVERSARY THIS SYMBOLOGY HAS. Rows built from REAL digit patterns at
  // JUMPING scales, with the check digit forced to pass — so pattern lookup and the
  // checksum are both satisfied and the drift bound is the only thing left standing.
  // Random noise cannot test it: 60,000 noise rows showed no difference at all, which is
  // how a guard ends up shipped and unobserved.
  //
  //     no bound      278 wrong reads / 40k        0.78–1.30    0 wrong reads
  //     0.62–1.62      22 wrong reads / 40k
  {
    let sd = 4242; const rn = () => ((sd = (sd * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const chk12 = (a) => { let t = 0; for (let k = 0; k < 12; k++) t += a[k] * (k % 2 === 0 ? 1 : 3); return (10 - (t % 10)) % 10; };
    let wrong = 0, read = 0;
    for (let n = 0; n < 8000; n++) {
      const d = []; for (let k = 0; k < 13; k++) d.push(Math.floor(rn() * 10));
      d[12] = chk12(d);
      const par = PAR[d[0]];
      const sc = () => [1, 1.5, 2.2, 3, 0.7, 4][Math.floor(rn() * 6)];
      const row = new Array(14).fill(225);
      const put = (bits, mod) => { for (const b of bits) for (let k = 0; k < Math.max(1, Math.round(mod)); k++) row.push(b === '1' ? 30 : 225); };
      put('101', sc());
      for (let k = 0; k < 6; k++) put((par[k] === '0' ? L : G)[d[k + 1]], sc());
      put('01010', sc());
      for (let k = 0; k < 6; k++) put(R2[d[k + 7]], sc());
      put('101', sc());
      for (let k = 0; k < 14; k++) row.push(225);
      const got = decodeEanRow(row);
      if (got) { read++; if (got !== d.join('')) wrong++; }
    }
    eq(wrong, 0, `🛑 a scale that JUMPS between digits never yields a wrong barcode (8,000 adversarial rows, ${read} accepted)`);
  }

  let drift = 0;
  for (let i2 = 0; i2 < 900; i2++) {
    const o = []; let dark = 0, wd = 2 + Math.random() * 3;
    while (o.length < 420) { wd *= 1.004; for (let k = 0; k < Math.round(wd); k++) o.push(dark ? 30 : 225); dark = dark ? 0 : 1; }
    if (decodeEanRow(o.slice(0, 420))) drift++;
    if (decodeEanRow(Array.from({ length: 320 }, (_, k) => (k % 17 < 3 || k % 29 < 2) ? 45 : 220))) drift++;
  }
  eq(drift, 0, '🛑 drifting stripes and text-like patterns still decode to nothing');

  // Camera conditions: sensor noise, soft focus, and a light gradient across the label.
  const jitter = (r, a) => r.map(v => Math.max(0, Math.min(255, v + (Math.random() * 2 - 1) * a)));
  const blur = (r, k) => r.map((_, i) => { let s2 = 0, n = 0; for (let j = -k; j <= k; j++) { const x = r[i + j]; if (x !== undefined) { s2 += x; n++; } } return s2 / n; });
  const grad = (r, a) => r.map((v, i) => Math.max(0, Math.min(255, v + a * (i / r.length - 0.5) * 2)));
  let readable = 0;
  for (let i = 0; i < 120; i++) {
    if (decodeEanRow(jitter(blur(encode('0038000293122', 4), 1), 30)) === '0038000293122') readable++;
    if (decodeEanRow(grad(encode('0038000293122', 3), 90)) === '0038000293122') readable++;
  }
  eq(readable, 240, 'noise, blur and a lighting gradient are all still readable');

  // 🛑 Nothing that is not a barcode may EVER decode.
  let falsePositives = 0;
  for (let i = 0; i < 600; i++) {
    if (decodeEanRow(Array.from({ length: 400 }, () => Math.random() * 255))) falsePositives++;
    if (decodeEanRow(Array.from({ length: 400 }, () => Math.random() < 0.5 ? 30 : 225))) falsePositives++;
  }
  if (decodeEanRow(new Array(400).fill(128))) falsePositives++;
  eq(falsePositives, 0, '🛑 ZERO false positives across 1,200 frames of noise and random stripes');

  // A single flipped module must break the check digit and be refused, not returned wrong.
  const good = encode('0038000293122', 4);
  let corrupted = 0, wrongCode = 0;
  for (let i = 0; i < 60; i++) {
    const bad2 = good.slice();
    const at = 20 + Math.floor(Math.random() * (bad2.length - 40));
    for (let k = 0; k < 4; k++) bad2[at + k] = bad2[at + k] > 128 ? 30 : 225;
    const got = decodeEanRow(bad2);
    if (got === null) corrupted++; else if (got !== '0038000293122') wrongCode++;
  }
  eq(wrongCode, 0, '🛑 a damaged symbol never decodes to a DIFFERENT product');
  ok(corrupted > 0, `…it is refused instead (${corrupted} of 60 rejected outright)`);
}

// ── 🛑 CHEAPEST-WINS HANDS THE ANSWER TO THE WORST PARSE ────────────────────
// Real failure, from the live search results for "Pringles Original 5.5 oz". Among the
// honest listings sits "Pack Of 3 … 12 ct" at $2.00, whose pack was read as 12 — dividing
// it to $0.17 a can. Taking the lowest unit price then made 17 CENTS the street price of
// a can of Pringles, and everything downstream priced off that.
//
// Outliers are now dropped against the MEDIAN first. A median takes more bad parses than
// good ones to move; a minimum takes exactly one.
{
  searchResults = [
    { position: 1, url: 'https://www.walmart.com/ip/pringles-sc/1', title: 'Pringles Sour Cream and Onion 5.5 oz', snippet: '$6.19' },
    { position: 2, url: 'https://www.target.com/p/pringles-sc/-/A-2',  title: 'Pringles Sour Cream & Onion 5.5oz', snippet: '$2.49' },
    { position: 3, url: 'https://www.walmart.com/ip/pringles-bbq/3',   title: 'Pringles BBQ 5.5 oz Canister', snippet: '$2.27' },
    { position: 4, url: 'https://www.walmart.com/ip/pack-of-3/4',      title: 'Pack Of 3 Pringles Snack Stacks, 12 ct Package', snippet: '$2.00' },
  ];
  snippetPrices = [
    { url: 'https://www.walmart.com/ip/pringles-sc/1', price: 6.19, title: 'Pringles Sour Cream and Onion 5.5 oz', pack: 1, in_stock: true, sold_by: 'Walmart.com' },
    { url: 'https://www.target.com/p/pringles-sc/-/A-2', price: 2.49, title: 'Pringles Sour Cream & Onion 5.5oz', pack: 1, in_stock: true, sold_by: 'Target' },
    { url: 'https://www.walmart.com/ip/pringles-bbq/3', price: 2.27, title: 'Pringles BBQ 5.5 oz Canister', pack: 1, in_stock: true, sold_by: 'Walmart.com' },
    // the poisoned one: a $2.00 listing divided by a misread pack of 12
    { url: 'https://www.walmart.com/ip/pack-of-3/4', price: 2.00, title: 'Pack Of 3 Pringles Snack Stacks, 12 ct Package', pack: 12, in_stock: true, sold_by: 'Walmart.com' },
  ];
  classifyL3 = SNACKS;

  const r = await post('merch-scan', { description: 'Pringles Original 5.5 oz' });
  ok(r.body.retail > 1.50,
     `🛑 a can of Pringles is not 17 cents — the misparsed 12-pack no longer wins (got $${r.body.retail})`);
  near(r.body.retail, 2.27, '…the cheapest HONEST first-party price is taken instead');
  ok((r.body.flags || []).includes('outlier prices ignored'),
     '…and the line says an outlier was discarded rather than hiding it');
}

// ── 🔑 A TYPED PRODUCT NAME GETS A CATEGORY TOO ─────────────────────────────
// manifestClassify writes what it learns into item_cache, which is keyed by identifier.
// A scan of a typed name has no barcode, so it had nowhere to read its own answer back
// from and silently showed no category at all — while the same item scanned by barcode
// worked. It now returns the resolved rows rather than only caching them.
{
  classifyL3 = SNACKS;
  const typed = await post('merch-scan', { description: 'Wonderful Pistachios No Shells 5.5oz' });
  eq(typed.body.l3, SNACKS, '🔑 a typed name is categorised');
  eq(typed.body.l3_label, 'Snacks', '…with a readable label');
  ok(typed.body.price !== null, '…and therefore prices, because ASP needs a category');

  const scanned = await post('merch-scan', { identifier: '012345679902', description: 'Some snack bag' });
  eq(scanned.body.l3, SNACKS, '…and a barcode still works exactly as before');
  // The barcode path ALSO caches, so the next scan of it is free; a typed name cannot.
  const row = db.prepare(`SELECT l3 FROM item_cache WHERE identifier='012345679902'`).get();
  eq(row.l3, SNACKS, '…and only the barcode path leaves something behind for next time');
}

// ── 🔑 IDENTIFY FIRST, THEN PRICE ──────────────────────────────────────────
// A barcode is a superb IDENTITY lookup and a terrible PRICE lookup, and it was being
// used for the second. Measured live: searching "038000138416" returns ONE result with
// no price; searching "Pringles Original Potato Crisps 5.2oz" returns ten with prices
// from five retailers. One result means no corroboration and nothing for the outlier
// filter to bite on, which is how a can of Pringles came back at $7.27 off a multipack.
{
  let searchQueries = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, init) => {
    const url = String(u);
    if (url.startsWith('https://api.search.tinyfish.ai')) {
      searchCalls++;
      searchQueries.push(decodeURIComponent(url));
      // The BARE UPC returns one priceless result; the NAME returns a real cluster.
      const isUpc = /038000138416/.test(url);
      return new Response(JSON.stringify({ results: isUpc
        ? [{ position: 1, url: 'https://www.target.com/p/pringles-original/-/A-13053936',
             title: 'Pringles Original Flavored Potato Crisps Chips - 5.2oz', snippet: 'UPC: 038000138416' }]
        : [{ position: 1, url: 'https://www.meijer.com/p/pringles/1', title: 'Pringles Original 5.2oz', snippet: '$2.39' },
           { position: 2, url: 'https://www.target.com/p/pringles/2', title: 'Pringles Original 5.2oz', snippet: '$2.49' },
           { position: 3, url: 'https://www.walmart.com/ip/pringles/3', title: 'Pringles Original 5.2oz', snippet: '$2.27' }],
      }), { status: 200 });
    }
    if (url.includes('api.anthropic.com')) {
      modelCalls++;
      const b = JSON.parse(init.body); const sys = b.system || '';
      if (/expand abbreviated/i.test(sys)) {
        return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({
          items: [{ row: 1, brand: 'Pringles', title: 'Pringles Original Potato Crisps', size: '5.2 oz' }] }) }] }), { status: 200 });
      }
      if (/category/i.test(sys) && /rows/.test(sys)) {
        return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({
          rows: [{ row: 1, category: SNACKS, confidence: 'high' }] }) }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ prices: [
        { url: 'https://www.meijer.com/p/pringles/1', price: 2.39, title: 'Pringles Original 5.2oz', pack: 1, in_stock: true, sold_by: 'Meijer' },
        { url: 'https://www.target.com/p/pringles/2', price: 2.49, title: 'Pringles Original 5.2oz', pack: 1, in_stock: true, sold_by: 'Target' },
        { url: 'https://www.walmart.com/ip/pringles/3', price: 2.27, title: 'Pringles Original 5.2oz', pack: 1, in_stock: true, sold_by: 'Walmart.com' },
      ] }) }] }), { status: 200 });
    }
    return realFetch(u, init);
  };

  const r = await post('merch-scan', { identifier: '038000138416' });
  eq(r.status, 200, 'a bare barcode scan answers');
  eq(r.body.brand, 'Pringles', '🔑 the BRAND is resolved from the barcode');
  eq(r.body.size, '5.2 oz', '🔑 …and the SIZE');
  eq(r.body.title, 'Pringles Original Potato Crisps', '…and a searchable product name');
  near(r.body.retail, 2.27, '🔑 priced from a CLUSTER of real prices, not one uncorroborated listing');
  eq(r.body.l3, SNACKS, '🔑 …and it categorises, which a nameless barcode never could');

  // The price search must have run on the NAME, not the number.
  const priceSearches = searchQueries.filter(q => !/038000138416/.test(q));
  ok(priceSearches.length > 0, '…because a second search ran on the resolved name');
  ok(priceSearches.some(q => /Pringles/i.test(q)), '…carrying the brand into the query');

  // And all of it is remembered, so the next scan of this barcode costs nothing.
  const row = db.prepare(`SELECT brand, size, title, l3 FROM item_cache WHERE identifier='038000138416'`).get();
  eq(row.brand, 'Pringles', 'the brand is kept');
  eq(row.size, '5.2 oz', '…and the size');
  eq(row.l3, SNACKS, '…and the category');

  const before = searchCalls;
  const again = await post('merch-scan', { identifier: '038000138416' });
  eq(searchCalls, before, '💰 a repeat scan resolves nothing and searches nothing');
  eq(again.body.brand, 'Pringles', '…and still knows the brand');

  globalThis.fetch = realFetch;
}

// ── A LIMITED EDITION NO BIG BOX CARRIES ────────────────────────────────────
// UPC 038000293122 is Pringles Everything Bagel 5.5oz. Walmart, Target and Kroger return
// NOTHING for it — and that is not an outage, it is the business: closeout inventory is
// by definition what big box stopped carrying. Identity therefore searches a wider net
// than pricing does, or the products we most need to identify are the ones we cannot.
{
  const realFetch = globalThis.fetch;
  let idQuery = null, priceQuery = null;
  globalThis.fetch = async (u, init) => {
    const url = String(u);
    if (url.startsWith('https://api.search.tinyfish.ai')) {
      searchCalls++;
      const q = decodeURIComponent(url);
      if (/038000293122/.test(q)) {
        idQuery = q;
        // Only a product database knows it. No first-party retailer lists it at all.
        return new Response(JSON.stringify({ results: [
          { position: 1, url: 'https://world.openfoodfacts.org/product/0038000293122/pringles-everything-bagel',
            title: 'Pringles Everything Bagel – 5.5oz', snippet: 'Quantity: 5.5oz Brands: Pringles' },
          { position: 2, url: 'https://www.cub.com/store/cub/products/32917510-pringles',
            title: 'Pringles Everything Bagel Potato Crisps, 5.5 oz', snippet: '$0.54/oz' },
        ] }), { status: 200 });
      }
      priceQuery = q;
      return new Response(JSON.stringify({ results: [] }), { status: 200 });   // nobody sells it
    }
    if (url.includes('api.anthropic.com')) {
      modelCalls++;
      const b = JSON.parse(init.body); const sys = b.system || '';
      if (/expand abbreviated/i.test(sys)) {
        return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({
          items: [{ row: 1, brand: 'Pringles', title: 'Pringles Everything Bagel Potato Crisps', size: '5.5 oz' }] }) }] }), { status: 200 });
      }
      if (/category/i.test(sys) && /rows/.test(sys)) {
        return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({
          rows: [{ row: 1, category: SNACKS, confidence: 'high' }] }) }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ content: [{ type: 'text', text: '{"prices":[]}' }] }), { status: 200 });
    }
    return realFetch(u, init);
  };

  const r = await post('merch-scan', { identifier: '038000293122' });
  eq(r.status, 200, 'a limited-edition item still answers');
  eq(r.body.brand, 'Pringles', '🔑 the brand is found — from a product database, not a shelf');
  eq(r.body.size, '5.5 oz', '…and the size');
  eq(r.body.l3, SNACKS, '🔑 …so it CATEGORISES, which is what unlocks ASP and cost');
  ok(r.body.price !== null, '🔑 …and it gets a price, off our own ASP');
  eq(r.body.retail, null, '…with no street retail, because genuinely nobody sells it');

  // 🛑 The identity sources must never leak into the PRICE. openfoodfacts and cub.com
  // said "$0.54/oz"; that is not a shelf price we compete with and must not be used.
  eq(r.body.retail_source, null, '🛑 no price is taken from an identity-only source');
  ok(/openfoodfacts|cub\.com/.test(idQuery || ''), 'the identity search reached the wider net…');
  ok(priceQuery !== null && !/openfoodfacts/.test(priceQuery),
     '…while the price search stayed on the first-party list');

  globalThis.fetch = realFetch;
}

// ── 🔑 THE SIZE GOES INTO THE PRICE QUERY ───────────────────────────────────
// It was resolved and then dropped: the search asked "Pringles Everything Bagel Potato
// Crisps" with no size, matched a 2-can multipack, and returned $7.33 for a can that
// sells near $2.50. Singles of a discontinued flavour are often not listed at all, so a
// query without a size lands on whatever bundle IS.
{
  const realFetch = globalThis.fetch;
  let priceQuery = null;
  globalThis.fetch = async (u, init) => {
    const url = String(u);
    if (url.startsWith('https://api.search.tinyfish.ai')) {
      searchCalls++;
      const q = decodeURIComponent(url);
      if (/038000293108/.test(q)) {
        return new Response(JSON.stringify({ results: [
          { position: 1, url: 'https://world.openfoodfacts.org/product/038000293108/x', title: 'Pringles Everything Bagel – 5.5oz', snippet: 'Pringles 5.5oz' },
        ] }), { status: 200 });
      }
      priceQuery = q;
      return new Response(JSON.stringify({ results: [
        { position: 1, url: 'https://www.walmart.com/ip/pringles-eb/1', title: 'Pringles Everything Bagel 5.5 oz', snippet: '$2.48' },
      ] }), { status: 200 });
    }
    if (url.includes('api.anthropic.com')) {
      modelCalls++;
      const b = JSON.parse(init.body); const sys = b.system || '';
      if (/expand abbreviated/i.test(sys)) {
        return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({
          items: [{ row: 1, brand: 'Pringles', title: 'Pringles Everything Bagel Potato Crisps', size: '5.5 oz' }] }) }] }), { status: 200 });
      }
      if (/category/i.test(sys) && /rows/.test(sys)) {
        return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({
          rows: [{ row: 1, category: SNACKS, confidence: 'high' }] }) }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ prices: [
        { url: 'https://www.walmart.com/ip/pringles-eb/1', price: 2.48, title: 'Pringles Everything Bagel 5.5 oz', pack: 1, in_stock: true, sold_by: 'Walmart.com' },
      ] }) }] }), { status: 200 });
    }
    return realFetch(u, init);
  };

  const r = await post('merch-scan', { identifier: '038000293108' });
  eq(r.body.size, '5.5 oz', 'the size is resolved');
  ok(/5\.5/.test(priceQuery || ''),
     '🔑 …and it is IN the price query, so a multipack cannot answer for a single can');
  near(r.body.retail, 2.48, '…giving the single-can price, not a bundle');
  globalThis.fetch = realFetch;
}

// ── Food rounds DOWN, and may sit below our own ASP ─────────────────────────
// Brian's call: at ~81c of cost the lower half dollar still earns well, and a price a
// shopper reads instantly is worth more than the few cents given up.
{
  const { manifestRound } = loadLadder(repo);
  near(manifestRound(3.665, '$0.50 down'), 3.50, '$3.665 rounds DOWN to $3.50, not up to $4.00');
  near(manifestRound(2.49, '$0.50 down'), 2.00, '$2.49 rounds down to $2.00');
  near(manifestRound(2.50, '$0.50 down'), 2.50, '🔑 an exact $2.50 STAYS — the epsilon guards the other direction now');
  near(manifestRound(2.5000000001, '$0.50 down'), 2.50, '…including one reached by multiplication');
  near(manifestRound(0.40, '$0.50 down'), 0.50, 'nothing rounds below 50c');
  near(manifestRound(4.99, '$1 down'), 4.00, 'whole-dollar rounding down works too');

  // ── Quarters ──────────────────────────────────────────────────────────────
  near(manifestRound(0.845, '$0.25 down'), 0.75, 'a quarter rung rounds down to $0.75');
  near(manifestRound(1.157, '$0.25'), 1.25, '…and up to $1.25');
  near(manifestRound(2.50, '$0.25 down'), 2.50, '🔑 an exact rung STAYS — the epsilon guards it here too');
  near(manifestRound(2.5000000001, '$0.25 down'), 2.50, '…including one reached by multiplication');
  near(manifestRound(0.10, '$0.25 down'), 0.25, 'nothing rounds below a quarter');
  // 🔑 The ceiling snap reads this map. A rule missing from it does NOT error — it
  // silently snaps a ceiling-bound price to the ceiling exactly, landing off-convention.
  const STEPS = loadLadder(repo).MANIFEST_ROUND_STEP;
  eq(STEPS['$0.25'], 0.25, '🔑 the quarter rule is in the step map, or the ceiling snap goes off-convention');
  eq(STEPS['$0.25 down'], 0.25, '…both directions');
}

// ── 🔑 A FINER RUNG TRACKS THE TARGET IN BOTH DIRECTIONS ────────────────────
// Brian: "my last scan gave a suggested price of $1.50 but the retail is $1.69 so that's
// not a deal for the customer." Good & Gather refried beans, 16oz, $1.69 at Target
// against 81c of category cost. Half of $1.69 is 85c, which loses money, so the floor
// lifts — and on half-dollar rungs the first one that clears is $1.50. Nineteen cents
// off is no reason to drive anywhere.
{
  const { merchPriceLadder } = loadLadder(repo);
  const at = (retail, rounding) => merchPriceLadder({ retail, asp: 2.00, cost: 0.81,
    crit: { priceCapPct: 50, gpFloorPct: 30, ceiling: null, rounding } });

  const beans = at(1.69, '$0.25 down');
  near(beans.price, 1.25, '🔑 $1.69 street prices at $1.25 on quarters, not $1.50');
  ok(!beans.belowFloor, '…still clears the 30% floor');
  ok(((beans.price - 0.81) / beans.price) * 100 > 34, '…at ~35% GP');
  ok((1.69 - beans.price) / 1.69 > 0.20, '🔑 …and it is a real discount — over 20% off the street');
  // 🔑 Asking for half dollars now GETS $1.25 too — the rung is a preference, and the
  // ladder steps down when the round price stops being a deal. $1.50 is 11% off $1.69.
  near(at(1.69, '$0.50 down').price, 1.25, "the half-dollar rule steps DOWN to a quarter when $1.50 is not a deal");
  eq(at(1.69, '$0.50 down').rounding, '$0.25 down', '…and reports the rung it actually used');
  eq(at(2.27, '$0.50 down').rounding, '$0.50 down', '…while a $2.27 street keeps the round price at 34% off');

  // 🔑 NOT just "cheaper". A finer rung lands HIGHER wherever the price is falling to the
  // cap rather than being lifted off it — which is the same fact, not a second rule.
  near(at(3.60, '$0.25 down').price, 1.75, '🔑 a $3.60 street lands HIGHER on quarters — $1.75, not $1.50');
  near(at(7.33, '$0.25 down').price, 3.50, '…and where the cap already sits on a rung, nothing moves');
}

// ── 🛑 THE EXACT SKU IS THE WORST PRICE SOURCE A CLOSEOUT BUYER HAS ─────────
// Pringles Everything Bagel 5.5oz is a limited edition big box no longer stocks, so the
// only listings left for it are resellers': $9.49 a can, $22.00 a three-pack. The
// pipeline read the three-pack, divided by three and returned $7.33 — every rule firing
// correctly on a premise that was wrong. Brand + size is asked as its own question and
// corroborates at $2.27/$2.49/$2.39, which is what a customer's real alternative costs.
{
  const realFetch = globalThis.fetch;
  let skuQuery = null, classQuery = null;
  const SKU_URL = 'https://www.walmart.com/ip/pringles-everything-bagel-3pk/2';
  globalThis.fetch = async (u, init) => {
    const url = String(u);
    if (url.startsWith('https://api.search.tinyfish.ai')) {
      searchCalls++;
      const q = decodeURIComponent(url);
      if (/038000293122/.test(q)) {
        return new Response(JSON.stringify({ results: [
          { position: 1, url: 'https://world.openfoodfacts.org/product/0038000293122/x',
            title: 'Pringles Everything Bagel – 5.5oz', snippet: 'Quantity: 5.5oz Brands: Pringles' },
        ] }), { status: 200 });
      }
      if (/Everything Bagel/.test(q)) {
        skuQuery = q;
        return new Response(JSON.stringify({ results: [
          { position: 1, url: SKU_URL, title: '(3 pack) Pringles Everything Bagel Potato Crisps, 5.5 oz Canister',
            snippet: 'Single. $9.49 ; 2 Pack. $16.00 ; 3 Pack. $22.00' },
        ] }), { status: 200 });
      }
      classQuery = q;
      return new Response(JSON.stringify({ results: [
        { position: 1, url: 'https://www.walmart.com/ip/pringles-sv/3', title: 'Pringles Salt and Vinegar Potato Crisps, 5.5 oz Canister', snippet: '$2.27' },
        { position: 2, url: 'https://www.target.com/p/pringles-cheddar/4', title: 'Pringles Cheddar Cheese Potato Crisps Chips - 5.5oz', snippet: '$2.49' },
        { position: 3, url: 'https://www.meijer.com/shopping/product/pringles-sco/5', title: 'Pringles Potato Crisps Chips Sour Cream, 5.5 oz', snippet: '$2.39' },
      ] }), { status: 200 });
    }
    if (url.includes('api.anthropic.com')) {
      modelCalls++;
      const b = JSON.parse(init.body); const sys = b.system || '';
      if (/expand abbreviated/i.test(sys)) {
        return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({
          items: [{ row: 1, brand: 'Pringles', title: 'Pringles Everything Bagel Potato Crisps', size: '5.5 oz' }] }) }] }), { status: 200 });
      }
      if (/category/i.test(sys) && /rows/.test(sys)) {
        return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({
          rows: [{ row: 1, category: SNACKS, confidence: 'high' }] }) }] }), { status: 200 });
      }
      const asked = JSON.stringify(b.messages || '');
      const prices = /everything-bagel/.test(asked)
        // The reseller's three-pack, read exactly right and divided down exactly right.
        ? [{ url: SKU_URL, price: 22.00, title: '(3 pack) Pringles Everything Bagel Potato Crisps, 5.5 oz Canister', pack: 3, in_stock: true, sold_by: 'Walmart.com' }]
        : [{ url: 'https://www.walmart.com/ip/pringles-sv/3', price: 2.27, title: 'Pringles Salt and Vinegar Potato Crisps, 5.5 oz Canister', pack: 1, in_stock: true, sold_by: 'Walmart.com' },
           { url: 'https://www.target.com/p/pringles-cheddar/4', price: 2.49, title: 'Pringles Cheddar Cheese Potato Crisps Chips - 5.5oz', pack: 1, in_stock: true, sold_by: 'Target' },
           { url: 'https://www.meijer.com/shopping/product/pringles-sco/5', price: 2.39, title: 'Pringles Potato Crisps Chips Sour Cream, 5.5 oz', pack: 1, in_stock: true, sold_by: 'Meijer' }];
      return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ prices }) }] }), { status: 200 });
    }
    return realFetch(u, init);
  };

  const r = await post('merch-scan', { identifier: '0038000293122' });
  near(r.body.retail, 2.27, '🔑 $22.00/3 = $7.33 is rejected for what the shelf equivalent costs');
  ok((r.body.flags || []).includes('priced as brand + size'),
     '🔑 …and it SAYS so — a substituted retail that looks like a found one is a lie');
  ok(classQuery !== null && !/Everything Bagel/.test(classQuery),
     '🔑 the class query drops the variant — the flavour is what makes the SKU unfindable');
  ok(/Pringles/.test(classQuery) && /5\.5/.test(classQuery), '…and keeps the brand and the size');
  ok(/Everything Bagel/.test(skuQuery || ''), 'the SKU query is still asked first');
  ok(r.body.retail_confidence !== 'high',
     'a class price is a weaker claim than a price for this exact can, and reads as one');
  globalThis.fetch = realFetch;
}

// A SKU price close to its class is the ordinary case and must be left ALONE — the
// substitution is for resale inflation, not a general preference for the cheaper number.
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, init) => {
    const url = String(u);
    if (url.startsWith('https://api.search.tinyfish.ai')) {
      searchCalls++;
      const q = decodeURIComponent(url);
      if (/038000293139/.test(q)) {
        return new Response(JSON.stringify({ results: [
          { position: 1, url: 'https://world.openfoodfacts.org/product/038000293139/y', title: 'Pringles Ranch – 5.5oz', snippet: 'Pringles 5.5oz' },
        ] }), { status: 200 });
      }
      return new Response(JSON.stringify({ results: [
        { position: 1, url: /Ranch/.test(q) ? 'https://www.walmart.com/ip/pringles-ranch/6' : 'https://www.walmart.com/ip/pringles-sv/3',
          title: 'Pringles 5.5 oz Canister', snippet: '$2.68' },
      ] }), { status: 200 });
    }
    if (url.includes('api.anthropic.com')) {
      modelCalls++;
      const b = JSON.parse(init.body); const sys = b.system || '';
      if (/expand abbreviated/i.test(sys)) {
        return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({
          items: [{ row: 1, brand: 'Pringles', title: 'Pringles Ranch Potato Crisps', size: '5.5 oz' }] }) }] }), { status: 200 });
      }
      if (/category/i.test(sys) && /rows/.test(sys)) {
        return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({
          rows: [{ row: 1, category: SNACKS, confidence: 'high' }] }) }] }), { status: 200 });
      }
      const ranch = /pringles-ranch/.test(JSON.stringify(b.messages || ''));
      return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ prices: [
        { url: ranch ? 'https://www.walmart.com/ip/pringles-ranch/6' : 'https://www.walmart.com/ip/pringles-sv/3',
          price: ranch ? 2.68 : 2.27, title: 'Pringles 5.5 oz Canister', pack: 1, in_stock: true, sold_by: 'Walmart.com' },
      ] }) }] }), { status: 200 });
    }
    return realFetch(u, init);
  };

  const r = await post('merch-scan', { identifier: '0038000293139' });
  near(r.body.retail, 2.68, '🔑 a normal SKU price stands — $2.68 is not resale inflation');
  ok(!(r.body.flags || []).includes('priced as brand + size'), '…and nothing claims a substitution');
  globalThis.fetch = realFetch;
}

// A cached price already went through all of this. Re-asking on every scan of a known
// item would spend a search to reach the same answer.
{
  const realFetch = globalThis.fetch;
  const before = searchCalls;
  globalThis.fetch = async (u, init) => {
    if (String(u).startsWith('https://api.search.tinyfish.ai')) searchCalls++;
    return realFetch(u, init);
  };
  const r = await post('merch-scan', { identifier: '0038000293122' });
  eq(searchCalls, before, '🔑 a second scan of a priced item spends NOTHING');
  near(r.body.retail, 2.27, '…and answers with what was learned');
  eq(r.body.from_cache, true, '…from the cache');
  globalThis.fetch = realFetch;
}

// The screen used to print "rounded up" unconditionally. Consumables round DOWN since
// criteria v9, so the rule has to travel with the answer or the strip contradicts it.
{
  const r = await post('merch-scan', { identifier: '0038000293122' });
  ok('rounding' in r.body, '🔑 the rounding rule is returned, so the strip cannot guess wrong');
}

// ── 🛑 ROUNDING DOWN MUST NOT ROUND THROUGH THE MARGIN FLOOR ────────────────
// The floor was tested on the BASE, but the ROUNDED price is what ships. Rounding up
// could only ever move margin the right way, so this never had to be checked before.
{
  const { merchPriceLadder } = loadLadder(repo);

  // The live shape: chain cap 50%, chain floor 30%, Consumable Food rounds down,
  // Snacks ASP $2.00 against 81c of category cost.
  const DOWN = { priceCapPct: 50, gpFloorPct: 30, ceiling: null, rounding: '$0.50 down' };
  const at = (retail, crit = DOWN) => merchPriceLadder({ retail, asp: 2.00, cost: 0.81, crit });

  const mid = at(2.49);
  near(mid.price, 1.50, '🔑 a $2.49 can does NOT price at $1.00 — that is 19% against 81c');
  ok(!mid.belowFloor, '…and what ships clears the 30% floor');
  ok(((mid.price - 0.81) / mid.price) * 100 >= 30, '…measured on the shipped price, not the base');

  // 🔑 THE LIFT IS MINIMAL. Stepping up to ASP instead overshot to $2.00 on a $2.27
  // street price — 27c under the street, which is not a discount anyone drives for.
  const lift = at(2.27);
  near(lift.price, 1.50, '🔑 $2.27 street lifts to $1.50, NOT to the $2.00 ASP');
  eq(lift.basis, 'street retail', '…and it is still a street-derived price, not an ASP one');
  ok(lift.floorLifted, '…flagged as lifted, so the screen can say why it beat the cap');
  ok(lift.price < 2.00, '🛑 ASP must never pull a price UP when we have a street price');
  // The smallest increment that clears: 81c / 0.70 = $1.157, so $1.50 and never $2.00.
  const step = 0.5;
  ok(lift.price - step < 0.81 / 0.70, '…and it is the FIRST clearing step, not a later one');

  // A category we have never sold still has to price off something.
  const noAsp = merchPriceLadder({ retail: null, asp: 2.00, cost: 0.81, crit: DOWN });
  eq(noAsp.basis, 'our ASP', 'with no street price, ASP is still the fallback');

  // 🛑 It was not merely low, it was NON-MONOTONIC: a lower retail paid more, because
  // only one of the two reached the rounding step still holding a floor-clearing number.
  const prices = [2.27, 2.39, 2.49, 2.89].map(r => at(r).price);
  ok(prices.every((p, i) => i === 0 || p >= prices[i - 1]),
     '🔑 a HIGHER street retail can never produce a LOWER price');

  // Round-down still does its job wherever the margin allows it.
  near(at(7.33).price, 3.50, 'round-down still applies where it is safe — $3.665 → $3.50');
  eq(at(7.33).basis, 'street retail', '…still priced off the street, not stepped up');

  // Non-consumables round UP and must be untouched by any of this.
  const up = at(7.33, { ...DOWN, rounding: '$1' });
  near(up.price, 4.00, 'the round-UP path is unchanged');
  ok(!up.belowFloor, '…and still clears');

  // 🛑 THE LIFT STOPS BELOW THE STREET PRICE. $2.79 of cost against a $4.00 street needs
  // $3.99 to make 30%, and a $3.99 tag on a $4.00 item is not a discount — it is a bad
  // buy wearing a price. The honest output there is the flag, not a number.
  const badBuy = merchPriceLadder({ retail: 4.00, asp: 2.00, cost: 2.79, crit: DOWN });
  ok(!badBuy.floorLifted, '🔑 the lift is refused when it would reach the street price');
  ok(badBuy.belowFloor, '…and the line SAYS the floor is missed rather than looking fine');
  ok(badBuy.price < 4.00 * 0.9, '…so nothing prints a near-street tag');

  // …but a lift that lands on a real discount is taken. This one clears at $2.50.
  const fine = merchPriceLadder({ retail: 4.00, asp: 2.00, cost: 1.50, crit: DOWN });
  near(fine.price, 2.50, 'a reachable floor still lifts — $2.50 on a $4.00 street');
  ok(fine.floorLifted && !fine.belowFloor, '…and reads as lifted, not as a miss');

  // Every price that clears the floor has to be a real discount, at every retail.
  for (const [retail, cost] of [[7.33, 0.81], [2.89, 0.81], [2.27, 0.81], [1.80, 0.81], [4.00, 1.50]]) {
    const r = merchPriceLadder({ retail, asp: 2.00, cost, crit: DOWN });
    ok(r.price < retail, `$${retail} street never prices at or above the street ($${r.price})`);
  }

  // 🛑 A cliff found by sweeping rather than by reasoning: an earlier bound let $2.00
  // street lift to $1.50 while $1.80 street collapsed to $0.50 — a LOSS on 81c of cost.
  near(at(1.80).price, 1.25, '🔑 $1.80 street steps to a quarter — $1.50 is only 17% off');
  ok(at(1.80).price > 0.81, '…and never a tag below what the thing cost us');

  // A ceiling can make the floor genuinely unreachable. That must be FLAGGED, never
  // quietly printed as if the criteria agreed.
  const stuck = merchPriceLadder({ retail: 2.49, asp: null, cost: 0.81,
                                   crit: { ...DOWN, ceiling: 1.00 } });
  ok(stuck.belowFloor, '🔑 a ceiling below the floor is FLAGGED, not hidden');
  ok(stuck.price <= 1.00, '…and the hard ceiling still holds');
}

// ── 🛑 ONE BARCODE, ONE KEY ─────────────────────────────────────────────────
// Reported from the floor: "I scanned 0085239098745 and no data was found." Everything
// about that item — brand, size, category, a $1.69 street price — was already in
// item_cache under 085239098745, one leading zero away. A UPC-A is printed as twelve
// digits and ENCODED as an EAN-13 with a zero in front, so the decoder returns thirteen
// while the package, the typed entry and every retailer's index say twelve.
{
  const realFetch = globalThis.fetch;
  db.prepare(`INSERT INTO item_cache (identifier, identifier_type, brand, title, size, l2, l3, l3_source,
                retail_price, retail_source, retail_confidence, fetched_at, updated_at)
              VALUES ('085239098745','upc','Good & Gather','Good & Gather Organic Refried Black Beans',
                      '16oz','Consumable Food',?,'claude',1.69,'target.com','medium',?,?)`)
    .run(SNACKS, new Date().toISOString(), new Date().toISOString());

  const before = searchCalls;
  globalThis.fetch = async (u, init) => {
    if (String(u).startsWith('https://api.search.tinyfish.ai')) searchCalls++;
    return realFetch(u, init);
  };
  const r = await post('merch-scan', { identifier: '0085239098745' });
  eq(r.status, 200, 'the 13-digit spelling answers');
  eq(searchCalls, before, '🔑 …from the cache, spending NOTHING — it is the same barcode');
  eq(r.body.title, 'Good & Gather Organic Refried Black Beans', '🔑 …with everything we already knew');
  near(r.body.retail, 1.69, '…including the street price');
  eq(r.body.identifier, '085239098745', '🔑 …and it answers under the printed 12 digits');
  eq(r.body.from_cache, true, 'reported as a cache hit, not a fresh lookup');
  globalThis.fetch = realFetch;
}

// 🔑 A barcode has more than one legal spelling and they do NOT index alike — the
// twelve-digit form found the beans where the thirteen-digit form returned ZERO results.
// Rather than pick a winner and be wrong half the time, ask the other way on a miss.
{
  const realFetch = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (u, init) => {
    const url = String(u);
    if (url.startsWith('https://api.search.tinyfish.ai')) {
      searchCalls++;
      const q = decodeURIComponent(url).split('&')[0];
      asked.push(q);
      // The canonical 12-digit form finds nothing here; the 13-digit one does. Which way
      // round does not matter — what matters is that ONE empty answer is not the end.
      if (/query=012345000065\b/.test(q)) return new Response(JSON.stringify({ results: [] }), { status: 200 });
      if (/0012345000065/.test(q)) {
        return new Response(JSON.stringify({ results: [
          { position: 1, url: 'https://world.openfoodfacts.org/product/0012345000065/z', title: 'Test Beans 16oz', snippet: 'Brands: Testco' },
        ] }), { status: 200 });
      }
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }
    if (url.includes('api.anthropic.com')) {
      modelCalls++;
      const b = JSON.parse(init.body); const sys = b.system || '';
      if (/expand abbreviated/i.test(sys)) {
        return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({
          items: [{ row: 1, brand: 'Testco', title: 'Testco Beans', size: '16 oz' }] }) }] }), { status: 200 });
      }
      if (/category/i.test(sys) && /rows/.test(sys)) {
        return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({
          rows: [{ row: 1, category: SNACKS, confidence: 'high' }] }) }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ content: [{ type: 'text', text: '{"prices":[]}' }] }), { status: 200 });
    }
    return realFetch(u, init);
  };

  const r = await post('merch-scan', { identifier: '0012345000065' });
  eq(r.body.brand, 'Testco', '🔑 an identity miss on one spelling retries the other');
  ok(asked.some(q => /query=012345000065\b/.test(q)), '…the canonical form is asked FIRST');
  ok(asked.some(q => /0012345000065/.test(q)), '…and the other spelling is the fallback, not the default');
  globalThis.fetch = realFetch;
}

// ── 🔑 THE LOOKUP SAYS WHAT IT IS DOING ─────────────────────────────────────
// A cold lookup is six server round trips and about seventeen seconds. The screen used
// to say "Looking it up…" in small grey text for all of it, which on a warehouse floor
// reads as frozen. The steps are real and measured — but they run inside ONE request, so
// the client is following a SCHEDULE, not a feed. These are the properties that keep
// that from becoming a lie.
{
  const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  const from = html.indexOf('  const PS_STAGES = [');
  const to = html.indexOf('  async function psScan()');
  ok(from > 0 && to > from, 'the progress machine is found in index.html');

  // A fake clock and a fake DOM, so the SCHEDULE itself can be inspected.
  const mk = () => {
    const scheduled = [];
    const nodes = {};
    const sandbox = `
      const timers = [];
      const setTimeout = (fn, ms) => { __sched.push({ fn, ms }); return __sched.length; };
      const clearTimeout = () => {};
      const psEsc = (t) => String(t);
      const el = (id) => (__nodes[id] || (__nodes[id] = { id, className: '', innerHTML: '', textContent: '' }));
    ` + html.slice(from, to) + `; return { psStages, psProgressStart, psProgressStop };`;
    const api = new Function('__sched', '__nodes', sandbox)(scheduled, nodes);
    return { api, scheduled, nodes };
  };

  const { api } = mk();
  const names = (k) => api.psStages(k).map(s2 => s2[0]);

  eq(names('barcode').length, 6, 'a barcode lookup shows all six steps');
  eq(names('barcode')[0], 'Reading the barcode', '…starting with the barcode');
  eq(names('barcode')[1], 'Identifying the product', '…then what it is');
  eq(names('barcode')[5], 'Working out our price', '…ending on our own price');
  eq(names('photo')[0], 'Reading the photo', '🔑 a photo says PHOTO, not barcode');
  // 🔑 A typed product name has no barcode to read and nothing to identify from one.
  // Listing steps the worker will not take would be inventing them.
  eq(names('typed').length, 4, '🔑 a typed name shows four — no barcode, no identify');
  ok(!names('typed').some(n => /barcode|Identifying/.test(n)),
     '…and never claims to be reading a barcode that was never scanned');

  // 🔑 The schedule has to keep matching the thing it describes. It was ~17s when every
  // step ran in single file; overlapping the street-price and brand-and-size lookups took
  // a measured cold scan to ~11s, and the schedule was re-timed with it. A list that
  // finishes long before the answer arrives is as misleading as one that never finishes.
  const total = api.psStages('barcode').reduce((n, s2) => n + s2[1], 0);
  ok(total > 9000 && total < 14000,
     `the schedule adds up to the measured ~11s cold scan (${(total / 1000).toFixed(1)}s)`);

  // ── the two honesty properties ──
  {
    const { api: a2, scheduled, nodes } = mk();
    a2.psProgressStart('barcode');
    // 🛑 NOTHING IS DRAWN IMMEDIATELY. A cached item answers in a few hundred
    // milliseconds, and flashing a six-step checklist for a quarter second is worse
    // than showing nothing at all.
    eq(scheduled.length, 1, '🔑 one timer only — the list is not drawn yet');
    ok(scheduled[0].ms >= 300, `…and it waits ${scheduled[0].ms}ms first, so a cache hit never flashes it`);
    eq(nodes['ps-result'], undefined, '…nothing has touched the result area');

    scheduled[0].fn();                       // the lookup has now proved itself slow
    ok(/ps-steps/.test(nodes['ps-result'].innerHTML), 'once slow, the steps are drawn');

    // 🛑 THE LAST STEP NEVER COMPLETES ON A TIMER. All six happen inside one request, so
    // only the response knows when the last one is done. A schedule that ticked every box
    // and then sat there would be claiming something it cannot know.
    const later = scheduled.slice(1);
    later.forEach(t => t.fn());
    const last = nodes['ps-st5'];
    eq(last.className, 'ps-step on', '🛑 the final step is still SPINNING when the schedule runs out');
    ok(later.some(t => t.ms > total), '…and a run that outlasts the schedule says so');
    eq(nodes['ps-se5'].textContent, 'still going', '…in those words');
    // Every earlier step, by contrast, does finish.
    for (let i = 0; i < 5; i++) eq(nodes['ps-st' + i].className, 'ps-step done', `step ${i + 1} completes`);
  }
}

// ── Merchandising › Products ────────────────────────────────────────────────
// item_cache is not a scan log — it is the shared library BOTH the Price Scan screen and
// the Manifest Scorer read and write, which is exactly why it is worth a page you can
// search and correct.
{
  const now = new Date().toISOString();
  const add = (id, title, brand) => db.prepare(
    `INSERT OR REPLACE INTO item_cache (identifier, identifier_type, brand, title, size, l2, l3,
       l3_source, retail_price, retail_source, updated_at)
     VALUES (?,'upc',?,?, '12oz','Consumable Food',?, 'claude', 3.49,'target.com',?)`)
    .run(id, brand, title, SNACKS, now);
  add('090000000018', 'Bench Scanned Crisps', 'Benchco');
  add('090000000025', 'Manifest Only Beans', 'Loadco');
  // The ONLY thing that makes a row "from a manifest" is a manifest line pointing at it.
  db.prepare(`INSERT INTO manifests (id,vendor,uploaded_at,sell_as,units_per_case,status)
              VALUES ('pmf','V','2026-08-20T00:00:00Z','each',1,'draft')`).run();
  db.prepare(`INSERT INTO manifest_lines (manifest_id,row_no,identifier,identifier_type,description,qty,cost,flags)
              VALUES ('pmf',1,'090000000025','upc','MANIFEST BEANS',10,1.0,'[]')`).run();

  // ── who may look ──
  eq((await get('merch-products', 'u-mgr1')).status, 403,
     '🛑 a manager may not browse the library — this is an admin repair surface');
  const asAdmin = await get('merch-products&tab=scanned', 'u-admin');
  eq(asAdmin.status, 200, 'an admin may');

  // ── 🔑 THE TABS, DERIVED WITH NO MIGRATION ──
  // item_cache carries no provenance column. Manifest membership is derivable exactly,
  // and retroactively, from the manifest lines themselves; "scanned" is everything else,
  // which is sound because those two are the only writers.
  const ids = (b) => (b.rows || []).map(r => r.identifier);
  ok(ids(asAdmin.body).includes('090000000018'), '🔑 a bench-scanned item is under Scanned');
  ok(!ids(asAdmin.body).includes('090000000025'), '…and a manifest item is NOT');
  const mf = await get('merch-products&tab=manifest', 'u-admin');
  ok(ids(mf.body).includes('090000000025'), '🔑 …while it IS under Manifests');
  ok(!ids(mf.body).includes('090000000018'), '…and the bench item is not');
  ok(asAdmin.body.counts.scanned > 0 && mf.body.counts.manifest > 0, 'both tabs carry a count');

  // Search reaches the barcode as well as the words, because that is what is on the box.
  ok(ids((await get('merch-products&tab=scanned&q=Benchco', 'u-admin')).body).includes('090000000018'), 'search finds a brand');
  ok(ids((await get('merch-products&tab=scanned&q=090000000018', 'u-admin')).body).includes('090000000018'), '…and a barcode');
  eq(((await get('merch-products&tab=scanned&q=zzzznope', 'u-admin')).body.rows || []).length, 0, '…and finds nothing when there is nothing');

  // ── editing ──
  eq((await post('merch-product-save', { identifier: '090000000018', title: 'X' }, 'u-mgr1')).status, 403,
     '🛑 a manager may not edit');
  const saved = await post('merch-product-save',
    { identifier: '090000000018', title: 'Bench Crisps, Salted', l3: CANNED, retail_price_override: '2.25' }, 'u-admin');
  eq(saved.status, 200, 'an admin may');
  eq(saved.body.row.title, 'Bench Crisps, Salted', 'the name is written');
  eq(saved.body.row.l3, CANNED, 'the category is written');
  near(saved.body.row.retail_price_override, 2.25, 'the override is written');
  ok(saved.body.row.retail_override_by, '…with who set it');

  // 🔑 THE PROPERTY THAT MAKES EDITING WORTH ANYTHING. 'manual' is what stops the next
  // lookup replacing a person's category with the model's — an edit that the next scan
  // silently undid would be worse than no edit at all.
  eq(saved.body.row.l3_source, 'manual', "🔑 …and marked 'manual', so a re-scan cannot overwrite it");

  // ── blank clears, absent leaves alone ──
  // Collapsing those two would make an override impossible to REMOVE once set.
  const cleared = await post('merch-product-save',
    { identifier: '090000000018', retail_price_override: '' }, 'u-admin');
  eq(cleared.body.row.retail_price_override, null, '🔑 a blank price CLEARS the override');
  eq(cleared.body.row.title, 'Bench Crisps, Salted', '…and a field not sent is left alone');
  eq(cleared.body.row.retail_override_by, null, '…and the attribution goes with it');

  // ── refusals ──
  eq((await post('merch-product-save', { identifier: '090000000018', l3: 'NOT A REAL CATEGORY' }, 'u-admin')).status, 400,
     '🛑 a category we do not use is refused, not stored');
  eq((await post('merch-product-save', { identifier: '090000000018', retail_price_override: 'abc' }, 'u-admin')).status, 400,
     '🛑 …and so is a price that is not a number');
  eq((await post('merch-product-save', { identifier: '099999999990', title: 'ghost' }, 'u-admin')).status, 404,
     'editing a product we have never seen is a 404, not a silent insert');

  // 🔑 The 13-digit spelling of a barcode edits the SAME row as the 12 — the canonical
  // form is applied here too, or an edit would create a phantom that nothing reads.
  const viaLong = await post('merch-product-save', { identifier: '0090000000018', size: '14oz' }, 'u-admin');
  eq(viaLong.status, 200, '🔑 a 13-digit spelling reaches the row stored under 12');
  eq(viaLong.body.row.size, '14oz', '…and edits it');
}

// ── 🔑 THE OVERRIDE OPENS AN EDITOR, NOT A QUESTION ABOUT RETAIL ────────────
// Reported: "when trying to override a price it's asking to input the street price
// first." An admin who wanted to fix the CATEGORY had to answer a question about retail
// to get anywhere — and the "Change" link beside the category opened that same retail
// prompt, so it could not change a category at all. Both controls now open one form.
{
  const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  const fn = html.slice(html.indexOf('  function psOverride() {'),
                        html.indexOf('  window.psOverrideSave = psOverrideSave;'));
  ok(fn.length > 200, 'the override editor is found in index.html');
  ok(!/uiPrompt/.test(fn), '🔑 no prompt — the editor opens straight');
  ok(/ps-e-l3/.test(fn) && /ps-e-retail/.test(fn) && /ps-e-price/.test(fn),
     '🔑 category, street retail and our price are all on the one form');
  // 🛑 The three fields merch-scan-save has ALWAYS accepted. The endpoint was never the
  // limit; the client only ever asked for one of them.
  ok(/l3: el\('ps-e-l3'\)/.test(fn) && /retail_price:/.test(fn) && /suggested_price:/.test(fn),
     '…and all three are actually sent');
  ok(/merch-scan-save/.test(fn), '…to the endpoint that already took them');
  // Blank must CLEAR, not mean "unchanged" — otherwise an override cannot be removed.
  ok(/trim\(\) === ''\s*\?\s*null/.test(fn), "🔑 a blank field sends null, so an override can be REMOVED");
  // The screen must show the price the override PRODUCES, not one guessed on the client.
  ok(/await psScan\(\)/.test(fn), '🔑 saving re-scans, so the ladder on the worker decides the price');

  // The scan response has to carry the category list, or the form has nothing to offer.
  const r = await post('merch-scan', { identifier: '0038000293122' });
  ok(Array.isArray(r.body.categories) && r.body.categories.length > 0,
     '🔑 the scan answer carries the category tree, so Change needs no second round trip');
  ok(r.body.categories.some(c => (c.children || []).some(k => k.key === SNACKS)),
     '…with the real L3s under their L2');

  // And the endpoint genuinely takes a category on its own, with no retail alongside.
  const only = await post('merch-scan-save', { identifier: '0038000293122', l3: CANNED }, 'u-admin');
  eq(only.status, 200, '🔑 a category can be changed WITHOUT touching retail');
  const after = await post('merch-scan', { identifier: '0038000293122' });
  eq(after.body.l3, CANNED, '…and it sticks');
  eq(after.body.l3_source, 'manual', "…marked 'manual', so the next lookup cannot undo it");

  // 🛑 THE THIRD DOOR. merch-scan and merch-product-save canonicalise a barcode; this one
  // did not, and it fails in the worst way available: the INSERT below creates a PHANTOM
  // row under the other spelling, the UPDATE reports one change, and the caller is told
  // the override saved while the row everything actually reads is untouched.
  const long = await post('merch-scan-save', { identifier: '0038000293122', retail_price: '3.15' }, 'u-admin');
  eq(long.status, 200, 'a 13-digit spelling saves');
  const back = await post('merch-scan', { identifier: '038000293122' });
  near(back.body.retail, 3.15, '🛑 …to the SAME row the 12-digit form reads, not a phantom');
  const phantom = db.prepare(`SELECT COUNT(*) n FROM item_cache WHERE identifier = '0038000293122'`).get();
  eq(Number(phantom.n), 0, '…and no phantom row is left behind');
}

// ── 🔑 THE THINGS THAT MADE IT SLOW ────────────────────────────────────────
// A cold scan was ~17s of strictly sequential work. Each of these is a step that did not
// need to wait for the one before it.
{
  const realFetch = globalThis.fetch;

  // ── the ASP table is built ONCE, not once per scan ──
  // 28 days x 6 stores = 168 KV reads, ~3.5MB parsed — and it ran on EVERY call,
  // including scans answered entirely from cache that looked nothing up.
  {
    let kvReads = 0;
    const realGet = env.SALES_SNAPSHOTS.get.bind(env.SALES_SNAPSHOTS);
    env.SALES_SNAPSHOTS.get = async (k, t) => { if (String(k).startsWith('items:')) kvReads++; return realGet(k, t); };
    globalThis.fetch = async (u, i2) => realFetch(u, i2);

    await post('merch-scan', { identifier: '0038000293122' });
    await post('merch-scan', { identifier: '073731003282' });
    await post('merch-scan', { identifier: '0038000293122' });
    // 🔑 Without the memo this is 168 snapshot reads PER SCAN — 28 days x 6 stores, ~3.5MB
    // parsed and merged — on every call including ones answered entirely from cache.
    eq(kvReads, 0, `🔑 three scans read ZERO snapshots — the ASP table is built once a day (${kvReads})`);
    // And the answer is durable, not just an isolate-lifetime memo: a cold worker reads
    // one key instead of a hundred and sixty-eight.
    const keys = [...env.SALES_SNAPSHOTS._map.keys()];
    ok(keys.some(k => String(k).startsWith('asp-velocity:')),
       '…and it is written to KV, so a cold isolate pays one read rather than 168');

    env.SALES_SNAPSHOTS.get = realGet;
    globalThis.fetch = realFetch;
  }

  // ── the class price runs ALONGSIDE the SKU chain, not after it ──
  // It depends on nothing the SKU lookup produces, so waiting for it was a whole search
  // plus a parse — four to eight seconds — sitting on the critical path for nothing.
  {
    const started = [];
    let skuAt = null, classAt = null, t0 = 0;
    globalThis.fetch = async (u, init) => {
      const url = String(u);
      if (url.startsWith('https://api.search.tinyfish.ai')) {
        searchCalls++;
        const q = decodeURIComponent(url);
        const at = Date.now() - t0;
        if (/038000299001/.test(q)) {
          return new Response(JSON.stringify({ results: [
            { position: 1, url: 'https://world.openfoodfacts.org/product/038000299001/x', title: 'Testo Beans 16oz', snippet: 'Brands: Testo' }]}), { status: 200 });
        }
        if (/Testo Beans/.test(q)) skuAt = at; else classAt = at;
        started.push(q);
        // Both stall the same amount; if they were sequential the second could not have
        // started before the first came back.
        await new Promise(r => setTimeout(r, 40));
        return new Response(JSON.stringify({ results: [
          { position: 1, url: 'https://www.walmart.com/ip/t/1', title: 'Testo Beans 16oz', snippet: '$2.50' }]}), { status: 200 });
      }
      if (url.includes('api.anthropic.com')) {
        modelCalls++;
        const b = JSON.parse(init.body); const sys = b.system || '';
        if (/expand abbreviated/i.test(sys)) {
          return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({
            items: [{ row: 1, brand: 'Testo', title: 'Testo Beans', size: '16 oz' }] }) }] }), { status: 200 });
        }
        if (/category/i.test(sys) && /rows/.test(sys)) {
          return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({
            rows: [{ row: 1, category: SNACKS, confidence: 'high' }] }) }] }), { status: 200 });
        }
        return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ prices: [
          { url: 'https://www.walmart.com/ip/t/1', price: 2.50, title: 'Testo Beans 16oz', pack: 1, in_stock: true, sold_by: 'Walmart.com' }]}) }] }), { status: 200 });
      }
      return realFetch(u, init);
    };

    t0 = Date.now();
    const r = await post('merch-scan', { identifier: '038000299001' });
    eq(r.status, 200, 'the scan answers');
    ok(skuAt !== null && classAt !== null, 'both the SKU and the class search ran');
    // 🔑 TIMED, not counted. Each search stalls 40ms before answering, so sequential means
    // the class search cannot begin until the SKU search has returned AND its parse has
    // run — at least 40ms later. Overlapping, both are in flight within a tick or two.
    ok(Math.abs(skuAt - classAt) < 25,
       `🔑 both searches are in flight together, not one after the other (${skuAt}ms vs ${classAt}ms)`);
    globalThis.fetch = realFetch;
  }

  // ── the tails are capped ──
  // 🛑 A tinyfish_fetch has been logged at 120 SECONDS and a firecrawl at 55. There is a
  // paid fallback right behind the first, so waiting two minutes for a free fetch to fail
  // is the worst of both outcomes.
  {
    const src = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
    const fetchFn = src.slice(src.indexOf('async function retailFetch('), src.indexOf('\n}', src.indexOf('async function retailFetch(')));
    ok(/AbortSignal\.timeout\(10000\)/.test(fetchFn), '🛑 the free fetch gives up at 10s and lets the escalation run');
    const fc = src.slice(src.indexOf('async function firecrawlScrape('), src.indexOf('\n}', src.indexOf('async function firecrawlScrape(')));
    // 🛑 THE TWO DEADLINES ON A PAID SCRAPE MUST AGREE, AND OURS MUST BE THE LONGER ONE.
    // This used to pin our abort at a bare 20000 while the request body told Firecrawl it
    // had 30s — so a result arriving in between was discarded AND billed. Asserting the
    // relationship rather than either number is what makes that unrepresentable: any
    // future retuning of the budget has to move both ends together.
    //
    // 🔑 THERE ARE NOW TWO CEILINGS, and the relationship has to hold for BOTH. It is
    // expressed structurally — Firecrawl is told `budgetMs`, we abort at `budgetMs` plus
    // transit — so whichever ceiling the path selects, ours cannot be the shorter one.
    const scan  = Number((src.match(/FIRECRAWL_BUDGET_MS\s*=\s*(\d+)/) || [])[1]);
    const batch = Number((src.match(/FIRECRAWL_BUDGET_BATCH_MS\s*=\s*(\d+)/) || [])[1]);
    const head  = Number((fc.match(/AbortSignal\.timeout\(\s*budgetMs\s*\+\s*(\d+)\s*\)/) || [])[1]);
    ok(Number.isFinite(scan) && scan > 0, 'the paid scrape sets a deadline for Firecrawl');
    ok(Number.isFinite(batch) && batch > 0, '…on the manifest drain too');
    ok(/timeout:\s*budgetMs\b/.test(fc) && Number.isFinite(head) && head > 0,
       '🛑 we wait LONGER than we let Firecrawl work — budgetMs for them, budgetMs + transit for us — otherwise a valid result is thrown away and the credit still spent');
    ok(scan + head <= 40000, '…and the SCAN stays bounded, because a manager is holding the item');
    // The drain has nobody waiting on it, but "nobody is waiting" is not "no limit": ten
    // escalations in one batch still have to fit inside a single request.
    ok(batch > scan, '🔑 the drain waits longer than the scan, because nothing is watching it');
    ok(batch + head <= 60000, '…and is still bounded, because a batch may escalate ten times');
  }
}

// ── 🛑 $959.40 FOR A BOTTLE OF COLLAGEN ────────────────────────────────────
// Found in the live cache. A single bottle listed at $15.99, multiplied by sixty,
// because the size field said "60 ct" and retailPackSize read that as a sixty-pack.
// Also live: $1,999.25 for a 55-count box of dishwasher tablets and $392.55 for steel
// wool pads. The parser was not wrong — it was being asked a MANIFEST question on a scan.
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, init) => {
    const url = String(u);
    if (url.startsWith('https://api.search.tinyfish.ai')) {
      searchCalls++;
      const q = decodeURIComponent(url);
      if (/0?12345600005/.test(q)) {
        return new Response(JSON.stringify({ results: [
          { position: 1, url: 'https://world.openfoodfacts.org/product/012345600005/c', title: "Nature's Truth Collagen 60 ct", snippet: "Nature's Truth" }]}), { status: 200 });
      }
      return new Response(JSON.stringify({ results: [
        { position: 1, url: 'https://www.walmart.com/ip/collagen/1', title: "Nature's Truth Collagen Gummies 60 Count", snippet: '$15.99' }]}), { status: 200 });
    }
    if (url.includes('api.anthropic.com')) {
      modelCalls++;
      const b = JSON.parse(init.body); const sys = b.system || '';
      if (/expand abbreviated/i.test(sys)) {
        return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({
          items: [{ row: 1, brand: "Nature's Truth", title: "Nature's Truth Collagen Peptides Type 1 & 3", size: '60 ct' }] }) }] }), { status: 200 });
      }
      if (/category/i.test(sys) && /rows/.test(sys)) {
        return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({
          rows: [{ row: 1, category: SNACKS, confidence: 'high' }] }) }] }), { status: 200 });
      }
      // ONE bottle, at its shelf price, correctly extracted. Everything after this is ours.
      return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ prices: [
        { url: 'https://www.walmart.com/ip/collagen/1', price: 15.99, title: "Nature's Truth Collagen Gummies 60 Count", pack: 1, in_stock: true, sold_by: 'Walmart.com' }]}) }] }), { status: 200 });
    }
    return realFetch(u, init);
  };

  const r = await post('merch-scan', { identifier: '012345600005' });
  eq(r.body.size, '60 ct', 'the size really does say 60 ct');
  near(r.body.retail, 15.99,
     '🛑 a scanned bottle is ONE bottle — its own count is not a multipack');
  ok(r.body.retail < 100, `…and nowhere near $959 (${r.body.retail})`);
  globalThis.fetch = realFetch;
}

// 🔑 THE MANIFEST STILL READS COUNTS AS PACKS, because there it is right: the line's cost
// is per case and "8 CT" says what is being bought. Deleting that reading to fix the scan
// would have broken the surface it was written for.
{
  const src = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
  const dec = src.slice(src.indexOf('function retailDecide('), src.indexOf('\n}', src.indexOf('function retailDecide(')));
  // The SHAPE is what matters, not the exact expression: a scan is pinned to 1, and the
  // manifest branch still reads a pack. It now prefers the sheet's Case pack column and
  // falls back to the (vendor-aware) description parse, so the literal it used to match
  // is gone — the intent it was defending is not.
  ok(/opts\.scan \? 1/.test(dec),
     '🔑 the pack reading is switched by the PATH, not deleted');
  ok(/units_per_case/.test(dec) && /retailPackSize\(line\.description, \{ vendor: true \}\)/.test(dec),
     '…and the manifest branch reads the Case pack column first, the description second');
  const pl = src.slice(src.indexOf('async function retailPriceLine('), src.indexOf('\n}\n', src.indexOf('async function retailPriceLine(')));
  eq((pl.match(/scan: !!ctx\.scan/g) || []).length, 3,
     '…and every retailDecide inside the lookup is told which path it is on');
}

// ── 🛑 A SEARCH PAGE IS NOT A PRODUCT PAGE ─────────────────────────────────
// The host allowlist checked WHO was selling; nothing checked WHAT page was being read.
// Of 116 source URLs in the live cache, 37 were category, brand or search results —
// three different Olay creams all carrying $24.94 off one Walmart keyword page, and the
// same Gillette razor at $13.98 and $5.24 on separate runs off one Target search.
{
  const { retailIsListPage } = (() => {
    const src = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
    const arr = src.slice(src.indexOf('const RETAIL_LIST_PAGE = ['), src.indexOf('];', src.indexOf('const RETAIL_LIST_PAGE = [')) + 2);
    const f = src.slice(src.indexOf('const retailIsListPage ='), src.indexOf(';', src.indexOf('const retailIsListPage =')) + 1);
    return new Function(arr + '\n' + f + '; return { retailIsListPage };')();
  })();

  // 🛑 Every one of these is a REAL product URL out of the cache. None may be rejected —
  // a rule that throws away good prices does more harm than the bug it fixes.
  for (const u of [
    'https://www.walmart.com/ip/Finish-Quantum-14ct-Dishwasher-Detergent/123',
    'https://www.target.com/p/finish-quantum-dishwasher-detergent-tablets/-/A-1',
    'https://www.kroger.com/p/energizer-max-aaa-batteries/0003800013860',
    'https://www.meijer.com/shopping/product/pringles-cheddar/3800013897.html',
    'https://www.cvs.com/shop/gillette-venus-smooth-3-blade-razor-blade-refills-prodid-1010352',
    'https://www.walgreens.com/store/c/olay-smoothing-eye-cream-fragrance-free/ID=300395236-product',
    'https://www.lowes.com/pd/Brita-6-Cup-Water-Filter-Pitcher/5001',
    'https://www.homedepot.com/p/Clorox-Clean-Up-32-oz/10044600312214',
  ]) ok(!retailIsListPage(u), `🛑 a real product page is kept: ${u.slice(8, 62)}`);

  // …and every one of these is a real LIST url out of the same cache.
  for (const u of [
    'https://www.walmart.com/c/kp/regenerist-micro-sculpting-cream',
    'https://www.walmart.com/browse/beauty/st-ives-exfoliators-and-scrubs/st-ives/1',
    'https://www.walmart.com/brand/yardleylondon/20016994',
    'https://www.target.com/s/gillette+blue+3',
    'https://www.target.com/c/deodorant-personal-care',
    'https://www.kroger.com/q/flex+3',
    'https://www.kroger.com/pb/robitussin/children-s-cold-cough-flu/2201400002',
    'https://www.walgreens.com/store/c/productlist/mitchum-for-men/N=361443-2054',
  ]) ok(retailIsListPage(u), `🛑 a listing page is refused: ${u.slice(8, 62)}`);

  // 🔑 The two conditional shapes, which are what make this safe. Walgreens /store/c/ is
  // mostly PRODUCT pages and only /productlist/ is a list; a CVS /shop/ URL is a product
  // exactly when it carries a prodid. Blocking either wholesale loses good prices.
  ok(!retailIsListPage('https://www.walgreens.com/store/c/camay-classic-soap/ID'),
     '🔑 walgreens /store/c/ is not blocked wholesale — most of them are products');
  ok(retailIsListPage('https://www.cvs.com/shop/skin-care-moisturizers'),
     '🔑 a CVS shop page with no prodid is a category');
  ok(!retailIsListPage('https://www.cvs.com/shop/olay-regenerist-prodid-1020135'),
     '🔑 …and the same path WITH one is a product');
}

// And end to end: a price that exists only on a search page is not used, and the screen
// says which of the three "no price" situations this is.
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, init) => {
    const url = String(u);
    if (url.startsWith('https://api.search.tinyfish.ai')) {
      searchCalls++;
      const q = decodeURIComponent(url);
      if (/0?12345600012/.test(q)) {
        return new Response(JSON.stringify({ results: [
          { position: 1, url: 'https://world.openfoodfacts.org/product/012345600012/z', title: 'Listy Soap 4 oz', snippet: 'Brands: Listy' }]}), { status: 200 });
      }
      return new Response(JSON.stringify({ results: [
        { position: 1, url: 'https://www.target.com/s/listy+soap', title: 'Listy Soap search', snippet: '$8.99' }]}), { status: 200 });
    }
    if (url.includes('api.anthropic.com')) {
      modelCalls++;
      const b = JSON.parse(init.body); const sys = b.system || '';
      if (/expand abbreviated/i.test(sys)) {
        return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({
          items: [{ row: 1, brand: 'Listy', title: 'Listy Soap', size: '4 oz' }] }) }] }), { status: 200 });
      }
      if (/category/i.test(sys) && /rows/.test(sys)) {
        return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({
          rows: [{ row: 1, category: SNACKS, confidence: 'high' }] }) }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ prices: [
        { url: 'https://www.target.com/s/listy+soap', price: 8.99, title: 'Listy Soap search', pack: 1, in_stock: true, sold_by: 'Target' }]}) }] }), { status: 200 });
    }
    return realFetch(u, init);
  };
  const r = await post('merch-scan', { identifier: '012345600012' });
  eq(r.body.retail, null, '🛑 a price that exists only on a search page is not used');
  ok((r.body.flags || []).includes('only listing pages'),
     '🔑 …and it says WHICH kind of nothing this is — the item is carried, the page was wrong');
  globalThis.fetch = realFetch;
}

// ── 🛑 CHEAPEST-WINS TOOK THE WRONG FLAVOUR ────────────────────────────────
// Found on a live search. A Pop-Tarts Frosted Strawberry 5ct scan had the exact item at
// $3.47 on an HEB product page and a Frosted BROWNIE two-pack at $4.97 — and $4.97/2 =
// $2.49 beat it, because nothing asked whether a listing was the same PRODUCT.
{
  const { retailDecide, retailTitleRank } = (() => {
    const src = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
    const fn = (sig) => { const i = src.indexOf(sig); return src.slice(i, src.indexOf('\n}', i) + 2); };
    const con = (n, end) => { const i = src.indexOf('const ' + n); return src.slice(i, src.indexOf(end, i) + end.length); };
    const arrow = (n) => { const i = src.indexOf('const ' + n); return src.slice(i, src.indexOf(';', i) + 1); };
    return new Function('const roundCents=(n)=>Math.round(n*100)/100;' +
      con('RETAIL_CPG_DOMAINS', '];') + con('RETAIL_LIST_PAGE', '];') + con('RETAIL_TITLE_STOP', ');') +
      arrow('RETAIL_TITLE_BAND') + arrow('retailIsListPage') + arrow('RETAIL_HOST_BLOCK') +
      arrow('RETAIL_MARKETPLACE') + arrow('RETAIL_BULK_TITLE') + con('retailIsImport', '};') +
      fn('function retailHostAllowed(') + fn('function retailPackSize(') + fn('function retailOunces(') +
      fn('function retailTitleWords(') + fn('function retailStatedCount(') +
      fn('function retailTitleRank(') + fn('function retailDecide(') +
      '; return { retailDecide, retailTitleRank };')();
  })();
  const DOM = ['walmart.com','target.com','walgreens.com','cvs.com','kroger.com','meijer.com','heb.com'];

  const line = { description: 'Pop-Tarts Crunchy Poppers Frosted Strawberry 5 ct', identifier: null };
  const cands = [
    { url:'https://www.heb.com/product-detail/pop-tarts-crunchy-poppers-frosted-strawberry-crunch/11305511',
      title:'Pop-Tarts Crunchy Poppers Frosted Strawberry Crunch, 5 oz, 5 ct', price:3.47, pack:1, in_stock:true, sold_by:'HEB' },
    { url:'https://www.walmart.com/ip/Kelloggs-Pop-Tarts-Frosted-Brownie-Crunchy-Poppers-5-ct-Pack-of-2/16939051065',
      title:'Kelloggs Pop-Tarts Frosted Brownie Crunchy Poppers 5 ct - Pack of 2', price:4.97, pack:2, in_stock:true, sold_by:'Walmart.com' },
  ];
  const d = retailDecide(line, cands, DOM, { resultUrls: cands.map(c => c.url), scan: true });
  near(d.retail_price, 3.47, '🔑 the exact product wins, not the cheaper wrong flavour');
  eq(d.retail_source, 'heb.com', '…from the listing that actually matches');
  ok((d.flags || []).includes('closest match used'), '…and it SAYS a near-miss was set aside');

  // 🛑 A stated count that contradicts is a different pack, not a near miss.
  const collagen = { description: "Nature's Truth Collagen Peptides Type 1 & 3 60 ct", identifier: null };
  const kept = retailTitleRank(collagen, [
    { title: "Nature's Truth Type 1 + 3 Collagen Peptides Gummies - Strawberry 60 ct", unit: 11.38 },
    { title: "Nature's Truth Collagen Peptides Gummies, 120ct", unit: 16.09 },
    { title: "Nature's Truth Womens Multi-Vitamin + Collagen Gummies, 70 ct", unit: 12.00 },
  ]);
  eq(kept.length, 1, '🛑 120ct and 70ct are refused against a 60 ct scan');
  ok(/60 ct/.test(kept[0].title), '…leaving the 60 ct one');

  // 🛑 THE CLASH RULE DOING WORK THE SCORE CANNOT. Identical wording, different pack —
  // every word matches, so the ranking sees two perfect ties and only the stated count
  // tells them apart. Without it the 10ct box is indistinguishable from the 5ct one.
  const samewords = retailTitleRank(
    { description: 'Pop-Tarts Crunchy Poppers Frosted Strawberry Crunch 5 ct' },
    [{ title: 'Pop-Tarts Crunchy Poppers Frosted Strawberry Crunch 5 ct', unit: 3.47 },
     { title: 'Pop-Tarts Crunchy Poppers Frosted Strawberry Crunch 10 ct', unit: 2.10 }]);
  eq(samewords.length, 1, '🛑 a 10 ct box is not a 5 ct box, however identical the words');
  ok(/5 ct/.test(samewords[0].title) && !/10 ct/.test(samewords[0].title), '…the 5 ct one survives');

  // 🔑 AND WHEN EVERY CANDIDATE CLASHES, NOTHING IS THROWN AWAY. Narrowing to nothing
  // would turn a wrong price into NO price, and both are wrong answers — so the rest of
  // the decider gets the full set and applies its own rules instead.
  const allClash = retailTitleRank(
    { description: 'Widget 5 ct' },
    [{ title: 'Widget 10 ct', unit: 2 }, { title: 'Widget 20 ct', unit: 3 }]);
  eq(allClash.length, 2, '🔑 every candidate clashing hands them all back, not none');

  // 🔑 RANKING CANNOT PRODUCE "NO PRICE". The top tier is never empty, which is the whole
  // reason this ranks rather than filters — a threshold that drops every candidate turns
  // a wrong price into no price, and both are wrong answers.
  const nothingMatches = retailTitleRank(
    { description: 'Utterly Unrelated Widget 3 oz' },
    [{ title: 'Something Else Entirely', unit: 5 }, { title: 'A Third Thing', unit: 9 }]);
  ok(nothingMatches.length >= 1, '🔑 even with no good match, a candidate survives');

  // Untitled candidates must not be scored into oblivion.
  const untitled = retailTitleRank({ description: 'Anything At All' },
    [{ title: null, unit: 1 }, { title: '', unit: 2 }]);
  eq(untitled.length, 2, '🔑 with no titles to compare, nothing is narrowed');
}

// ── 🛑 ELEVEN DIGITS IS NOT A BARCODE ──────────────────────────────────────
// A Room Essentials desk was scanned as 196761474706 and a row was saved under
// '19761474706' — one digit short, typed as vendor_sku, a number that cannot exist. The
// correct barcode could never match it again, so everything that row had paid for was
// invisible on the next scan.
{
  for (const [code, why] of [
    ['19761474706', 'eleven digits, one short of a UPC'],
    ['111', 'three digits'],
    ['1234567', 'seven digits'],
    ['123456789012345', 'fifteen digits'],
  ]) {
    const r = await post('merch-scan', { identifier: code }, 'u-mgr1');
    eq(r.status, 400, `🛑 ${why} is refused, not stored`);
    eq(r.body.code, 'BAD_BARCODE', '…with a code the screen can act on');
    ok(/12|13|8/.test(r.body.error), '…and it says what a barcode actually looks like');
  }
  // The real lengths all still work.
  for (const [code, len] of [['01234565', 8], ['024100113163', 12], ['0038000293122', 13]])
    ok((await post('merch-scan', { identifier: code }, 'u-mgr1')).status === 200, `${len} digits is a barcode`);

  // 🔑 And a NAME is not a barcode, so it never meets this rule.
  eq((await post('merch-scan', { description: 'Room Essentials Writing Desk' }, 'u-mgr1')).status, 200,
     '🔑 typing what the item is still works — which is the way out of an unknown code');
  // Nothing was written under the bad number.
  const ghost = db.prepare(`SELECT COUNT(*) n FROM item_cache WHERE identifier='19761474706'`).get();
  eq(Number(ghost.n), 0, '🛑 and no phantom row is left behind');
}

// ── 🔑 "WE CANNOT NAME IT" IS NOT "NOBODY SELLS IT" ────────────────────────
// The desk's barcode returns nothing from ANY of the fifteen sources, product databases
// included, because Target house brands are not publicly indexed. Target sells it
// perfectly well. Telling a manager it is not stocked sends them the wrong way.
{
  const realFetch = globalThis.fetch;
  const before = searchCalls;
  globalThis.fetch = async (u, init) => {
    const url = String(u);
    if (url.startsWith('https://api.search.tinyfish.ai')) {
      searchCalls++;
      return new Response(JSON.stringify({ results: [] }), { status: 200 });   // nothing, anywhere
    }
    if (url.includes('api.anthropic.com')) { modelCalls++; return new Response(JSON.stringify({ content: [{ type: 'text', text: '{}' }] }), { status: 200 }); }
    return realFetch(u, init);
  };
  const r = await post('merch-scan', { identifier: '196761474706' }, 'u-mgr1');
  eq(r.status, 200, 'an unidentifiable barcode still answers');
  ok((r.body.flags || []).includes('barcode not recognised'),
     '🔑 it says the CODE was not recognised, not that the item is unstocked');
  ok(!(r.body.flags || []).includes('not at big box'),
     '🛑 …and does not claim nobody stocks it, which is the opposite conclusion');
  // 🛑 Identity searched a WIDER net than pricing does and found nothing. Running the
  // price search anyway spends a lookup to reach a conclusion already in hand.
  eq(searchCalls - before, 2, '🔑 two identity spellings tried, and no price search after them');
  globalThis.fetch = realFetch;
}

// ── 🛑 A CACHE READ IS NOT A NEW OBSERVATION ───────────────────────────────
// `fetched_at` is the age of the EVIDENCE, and the Manifest Scorer trusts anything under
// 90 days old. The scan used to stamp it with the current time whenever a price was
// present — including when that price had just been read out of the cache, costing
// nothing and proving nothing. A price scanned every couple of months therefore stayed
// "fresh" forever while drifting arbitrarily far from the shelf.
{
  const stale = '2020-01-01T00:00:00.000Z';
  db.prepare(`INSERT INTO item_cache (identifier, identifier_type, title, brand, size, l3,
                retail_price, retail_source, retail_confidence, fetched_at, updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run('076808005202', 'upc', 'Pringles Original', 'Pringles', '5.2 oz',
         'FG BL CONSUMABLES - FOOD - SNACKS', 2.5, 'walmart.com', 'high', stale, stale);

  const before = searchCalls;
  const r = await post('merch-scan', { identifier: '076808005202' }, 'u-mgr1');
  eq(r.status, 200, 'the cached item scans');
  eq(r.body.retail, 2.5, '…and answers from the cache');
  eq(searchCalls - before, 0, '🔑 …having looked nothing up');

  const row = db.prepare(`SELECT * FROM item_cache WHERE identifier='076808005202'`).get();
  eq(row.fetched_at, stale,
     '🛑 the observation time is UNTOUCHED by a read — a free lookup cannot renew the 90-day clock');
  ok(row.updated_at !== stale,
     '🔑 …while updated_at still moves, so "when did we last see this" is still recorded');

  // 🛑 And the scorer must agree: this row is OUTSIDE its 90-day window, so a manifest
  // carrying the same UPC re-prices it rather than inheriting a six-year-old price.
  const cutoff = new Date(Date.now() - 90 * 86400e3).toISOString();
  ok(row.fetched_at < cutoff, '…which is what puts it back outside the scorer’s freshness window');
}

// …and the other half: a price that WAS just observed does stamp the clock.
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, init) => {
    const url = String(u);
    if (url.startsWith('https://api.search.tinyfish.ai')) {
      searchCalls++;
      return new Response(JSON.stringify({ results: [
        { url: 'https://www.walmart.com/ip/Fresh-Item/1', title: 'Fresh Item 12 oz', snippet: '$4.00 · UPC 024100113170' },
      ] }), { status: 200 });
    }
    if (url.includes('api.anthropic.com')) {
      modelCalls++;
      return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({
        title: 'Fresh Item', brand: 'Fresh', size: '12 oz',
        items: [{ row: 1, brand: 'Fresh', title: 'Fresh Item', size: '12 oz' }],
        prices: [{ url: 'https://www.walmart.com/ip/Fresh-Item/1', price: 4.0, in_stock: true, title: 'Fresh Item 12 oz' }],
      }) }] }), { status: 200 });
    }
    return realFetch(u, init);
  };
  const r = await post('merch-scan', { identifier: '024100113170' }, 'u-mgr1');
  eq(r.status, 200, 'a never-seen barcode scans');
  const row = db.prepare(`SELECT * FROM item_cache WHERE identifier='024100113170'`).get();
  if (row && row.retail_price !== null) {
    ok(row.fetched_at && row.fetched_at > '2026-01-01',
       '🔑 a price that really was fetched DOES stamp the observation time');
  } else {
    ok(row === undefined || row.fetched_at === null,
       '🔑 …and a scan that found no price stamps no observation time either');
  }
  globalThis.fetch = realFetch;
}

// ── 🛑 A SCAN IS NOT A BATCH, AND IT MUST NOT WAIT LIKE ONE ────────────────
// Firecrawl's debug console suggested raising `timeout` to 120000 after a Walmart product
// page died on our 20s ceiling. It is right that the ceiling was the cause and wrong that
// one number fits: on this path a manager is stood at the shelf holding the barcode, and a
// two-minute spinner is worse than "no price found", which they can act on. The manifest
// drain, which nobody is watching, takes the longer ceiling instead.
{
  const src = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
  const fc = src.slice(src.indexOf('async function firecrawlScrape('),
                       src.indexOf('\n}', src.indexOf('async function firecrawlScrape(')));
  ok(/ctx\.scan \? FIRECRAWL_BUDGET_MS : FIRECRAWL_BUDGET_BATCH_MS/.test(fc),
     '🔑 the ceiling is picked by the PATH — a person waiting, or a cron job');
}

// ── 🛑 THE SCAN KEEPS THE PROVENANCE, NOT JUST THE NUMBER ──────────────────
// It stored price, source and confidence and dropped basis, in-stock and the URL — so a
// third of every cached row carries a price with no record of HOW it was derived, and a
// manifest line inheriting one gets a confidence grade with nothing behind it. Both paths
// write the same evidence about the same fact now.
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, init) => {
    const url = String(u);
    if (url.startsWith('https://api.search.tinyfish.ai')) {
      searchCalls++;
      return new Response(JSON.stringify({ results: [
        { url: 'https://www.target.com/p/prov-item', title: 'Prov Item 6 ct', snippet: '$12.00 · UPC 086600000015' },
      ] }), { status: 200 });
    }
    if (url.includes('api.anthropic.com')) {
      modelCalls++;
      return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({
        title: 'Prov Item', brand: 'Prov', size: '8 oz',
        items: [{ row: 1, brand: 'Prov', title: 'Prov Item', size: '8 oz' }],
        prices: [{ url: 'https://www.target.com/p/prov-item', price: 12.0, pack: 6,
                   in_stock: true, title: 'Prov Item 6 ct' }],
      }) }] }), { status: 200 });
    }
    return realFetch(u, init);
  };

  const r = await post('merch-scan', { identifier: '086600000015' }, 'u-mgr1');
  eq(r.status, 200, 'the scan answers');
  const row = db.prepare(`SELECT * FROM item_cache WHERE identifier='086600000015'`).get();
  if (row && row.retail_price !== null) {
    ok(row.retail_basis, '🔑 HOW the price was derived is kept, not just the number');
    ok(row.retail_url, '🔑 …and where it came from, so it can be checked later');
    ok(row.retail_in_stock !== null, '🔑 …and whether it was actually purchasable');
    ok(row.retail_confidence, '…alongside the grade, as before');
  } else {
    ok(false, 'the scan should have priced this fixture');
  }
  globalThis.fetch = realFetch;
}

// ── 🛑 THE STICKER CODE IS A LOOKUP KEY, NOT A LABEL ───────────────────────
// The QR on a 1x1 shelf sticker carries `BL-50008-2_5`, and the POS resolves it to a real
// Clover item. Get the encoding wrong and every sticker fails at the register with a
// customer standing there — so the three confirmed real codes are pinned here verbatim.
{
  const src = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
  const fn = src.slice(src.indexOf('const stickerPriceCode ='),
                       src.indexOf('};', src.indexOf('const stickerPriceCode =')) + 2);
  const stickerPriceCode = eval('(' + fn.replace('const stickerPriceCode =', '') .replace(/;$/, '') + ')');

  // Confirmed against real Clover codes.
  eq(stickerPriceCode(2.50), '2_5',  '🔑 $2.50 is 2_5 — the trailing zero goes');
  eq(stickerPriceCode(2.75), '2_75', '🔑 $2.75 is 2_75 — the 5 is significant, it stays');
  eq(stickerPriceCode(10),   '10',   '🛑 $10.00 is 10 — NO separator at all, not 10_0');

  // The whole-dollar case is a different SHAPE, not just a different value. Anything
  // reading these back has to cope with a code that contains no underscore.
  eq(stickerPriceCode(3),     '3',     '…any whole dollar drops the separator');
  eq(stickerPriceCode(20),    '20',    '…including two digits');
  eq(stickerPriceCode(1.10),  '1_1',   'one trailing zero goes');
  eq(stickerPriceCode(1.05),  '1_05',  '…but a LEADING zero in the cents is significant');
  eq(stickerPriceCode(12.25), '12_25', 'quarters survive intact');

  // A sticker for nothing is worse than no sticker.
  eq(stickerPriceCode(0),    null, 'a zero price yields no code');
  eq(stickerPriceCode(-1),   null, '…nor does a negative');
  eq(stickerPriceCode(null), null, '…nor does a missing one');
}

// The category half is per CATEGORY and numeric; anything else is not a code.
{
  const src = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
  ok(/const stickerCode = \(categoryCode, price\)/.test(src),
     'stickerCode joins the category code and the price');
  ok(/\/\^\\d\+\$\/\.test\(c\)/.test(src),
     '🔑 …and refuses a category code that is not digits, so a name never lands in a QR');
}

// 🔑 THE NUMBERS MAY LIVE IN `code` OR IN `sku`, and the Inventory page's own dupKey()
// already treats the two as one field. Reading only `code` when a store keeps its numbers
// in `sku` finds nothing, and the screen then blames the category for having no sticker
// number when the truth is we read the wrong column. Which field won is remembered,
// because the existence check filters on a named field and must ask about the same one.
{
  const src = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
  const fn = src.slice(src.indexOf('async function stickerCategoryCodes('),
                       src.indexOf('async function stickerCodeExists('));
  ok(/it\?\.sku/.test(fn) && /it\?\.code/.test(fn),
     'the map is derived from code OR sku, the way the Inventory page already reads them');
  ok(/return \{ map, field, codes \}/.test(fn),
     '…and the codes fall out of the same pass, so existence needs no second Clover call');
  ok(/seen\.add\(String\(it\[field\]\)\)/.test(fn),
     '🔑 the recorded code is the one from the field that matched, not a guess between two');
}

// 🛑 THE STICKER CODE MAP IS NOT IM_TO_L2, however much they look alike. Both are numeric
// and both use five digits starting 50, and they COLLIDE: 50008 is a sticker code for
// FG BL CONSUMABLES - FOOD - PANTRY and separately an IM# that IM_TO_L2 calls
// Softline - Apparel. Wiring the sticker to IM_TO_L2 would print a pantry price under an
// apparel code — and it would still scan, just ring up the wrong item.
{
  const src = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
  const zone = src.slice(src.indexOf('const stickerPriceCode ='),
                         src.indexOf('function merchTree()'));
  ok(!/IM_TO_L2\s*\[/.test(zone),
     '🔑 nothing in the sticker path reads IM_TO_L2 — different namespace, colliding numbers');
  ok(/IM_TO_L2/.test(zone),
     '…and the collision is written down where the next person will look');
}

// 🛑 REFUSING IS THE FEATURE. Every path that cannot PROVE the code resolves must return
// printable:false — including Clover simply not answering. "We do not know" is not
// permission to print something a customer will be standing in front of.
{
  const src = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
  // 🛑 Search FORWARD from the handler for the end marker. `merch-scan` is mentioned in
  // an earlier comment too, so a bare indexOf picks that one and slices backwards to "".
  const at = src.indexOf('action") === "sticker-check"');
  // 🛑 Bound on the NEXT handler, not a distant one. Adding sticker-printed between this
  // handler and merch-scan swept its Math.round into the slice and tripped the guard that
  // proves nothing here rounds a price to make a label scan. Same shape as the psZpl slice.
  const h = src.slice(at, src.indexOf('action") === "sticker-printed"', at));
  ok(h.length > 500, 'the handler slice actually found the handler');
  for (const [why, re] of [
    ['no category',      /reason: "no category"/],
    ['no price',         /reason: "no price"/],
    ['no category code', /reason: "no category code"/],
    ['clover unreachable', /reason: "clover unreachable"/],
    // This one is a ternary, not a literal `reason:` — the code exists, the item does not.
    ['no clover item',   /"no clover item"/],
  ]) ok(re.test(h), `refusal is named: ${why}`);
  eq((h.match(/printable: false/g) || []).length, 6,
     '🔑 every refusal says printable:false — six sites across the five named reasons');
  ok(/reason: "no store"/.test(h),
     '…the newest being a store that was not named, which used to silently mean BL1');
  // 🔑 "clover unreachable" is TWO sites because there are two Clover round trips: the
  // category-code map and the existence check. Both must refuse; an outage at either one
  // leaves us unable to prove the code resolves, which is the whole bar for printing.
  eq((h.match(/reason: "clover unreachable"/g) || []).length, 2,
     '🛑 BOTH Clover round trips refuse on an outage — the map read and the existence check');
  ok(/exists === null/.test(h) && /Clover did not answer/.test(h),
     '🛑 an unreachable Clover refuses too — unknown is not permission to print');
  ok(/if \(!codeMap\)/.test(h),
     '🛑 …including a map read that THREW, which used to escape as a 500');
  // 🔑 SAME REASON, DIFFERENT SENTENCE. Two round trips refusing with one identical
  // `detail` is the bug the previous commit existed to remove, re-made: an operator
  // reading "Clover did not answer" could not tell a failed inventory sweep (nothing
  // works, and the fix is ours) from a failed single-item lookup (the map is fine and
  // the fix is a retry). Each names the question that went unanswered, and carries a
  // `stage` — the field this file already uses for exactly this, see the create-item
  // and category-assign handlers.
  {
    const details = [...h.matchAll(/detail: [`"]([^`"]*Clover did not answer[^`"]*)/g)].map(m => m[1]);
    eq(details.length, 2, 'both Clover refusals still say Clover did not answer');
    ok(details[0] !== details[1],
       '🛑 …but they do NOT say the same thing — one names the map, the other the lookup');
    ok(/category|number/i.test(details[0]) && /exists|\$\{code\}/.test(details[1]),
       '…and each names the question it could not get answered');
  }
  eq((h.match(/stage: "/g) || []).length, 2,
     'each carries a stage, so the two are distinguishable in the body as well as on screen');
  // The map-read refusal cannot carry a `code`: it failed before there was one to report.
  // That asymmetry is load-bearing — it is what let us tell the two apart in production
  // BEFORE this commit existed, and it must not be papered over with a placeholder.
  ok(/stage: "category map",\n\s*detail:/.test(h),
     '🔑 the map-read refusal reports NO code, because at that point there is none');
  ok(!/nearest|snap|round/i.test(h),
     '🛑 …and nothing anywhere near this snaps the price to make a label scan');
}

// ── The label the printer actually draws ───────────────────────────────────
// ZPL rather than a rendered image, because the printer builds the QR itself at its own
// resolution — nothing to rasterise, nothing for a driver to soften.
{
  const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  // 🛑 Bound this on psZpl's OWN closing brace, not on whatever comes next. Bounding it on
  // `async function psZebraDevice(` swept a const declared between the two into the slice,
  // and eval('(' + fn + ')') died on it — a test breaking because unrelated code moved.
  const psZplAt = html.indexOf('function psZpl(');
  const fn = html.slice(psZplAt, html.indexOf('\n  }\n', psZplAt) + 5);
  const psZpl = eval('(' + fn.slice(fn.indexOf('function psZpl(')).replace(/\n\s*\/\/[^\n]*/g, '') + ')');

  const z = psZpl('BL-50008-2_5', 2.50);
  ok(z.startsWith('^XA') && z.trim().endsWith('^XZ'), 'the label is a framed ZPL job');
  ok(z.includes('^PW203') && z.includes('^LL203'), '🔑 sized 1in x 1in at 203 dpi, not left to the driver');

  // 🛑 BYTE MODE, NOT ALPHANUMERIC. QR's alphanumeric set has no underscore in it, and our
  // codes are full of them. `LA,` forces byte mode; without it the encoder either refuses
  // the string or silently switches, and a QR that encodes something else still scans —
  // it just resolves to the wrong item, or to nothing.
  ok(z.includes('^FDLA,BL-50008-2_5^FS'), '🛑 the QR carries the code in BYTE mode, because of the underscore');

  ok(z.includes('^FDBL-50008-2_5^FS'), '…the code is printed as text too, so a human can read it back');
  ok(z.includes('$2.50'), '…and the price, which is the part a customer looks at');

  // A whole-dollar code has no underscore at all — it must still round-trip.
  const ten = psZpl('BL-50008-10', 10);
  ok(ten.includes('^FDLA,BL-50008-10^FS'), 'a whole-dollar code survives with no separator');
  ok(ten.includes('$10.00'), '…and still prints two decimal places for the shopper');

  for (const [code, price] of [['BL-1-1', 1], ['BL-99999-12_25', 12.25]]) {
    const out = psZpl(code, price);
    ok(!/undefined|NaN/.test(out), `no undefined or NaN reaches the printer (${code})`);
  }
}

// 🛑 THERE IS NO SILENT DEGRADE TO A LABEL WITHOUT A QR. The repo carries no QR encoder,
// so when Browser Print is absent the browser cannot draw one — and a sticker with only
// text on it does not scan, which is the precise failure this feature exists to prevent.
// It says what to install instead. Printing something that fails at the till would be the
// one outcome worse than refusing.
{
  const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  const fn = html.slice(html.indexOf('async function psPrint('), html.indexOf('window.psPrint'));
  ok(/Browser Print is not answering/.test(fn) && /Check it is running/.test(fn),
     'an absent print agent is explained, not worked around');
  ok(!/window\.print|@page|iframe/.test(fn), '🛑 …and no browser-print path quietly emits a QR-less label');
  ok(/psZpl\(/.test(fn), 'the one print path builds ZPL');
}

// The button is a claim that the code resolves, so it stays disabled until the worker says so.
{
  const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  const row = html.slice(html.indexOf('function psStickerRow('), html.indexOf('async function psStickerCheck('));
  ok(/id="ps-print"[^>]*disabled/.test(row), '🔑 Print starts DISABLED — enabled only once Clover confirms the code');
  const chk = html.slice(html.indexOf('async function psStickerCheck('), html.indexOf('function psZpl('));
  ok(/btn\.disabled = !a\.printable/.test(chk), '…and follows printable, never the mere presence of a price');
  ok(/!== psStickerFor\) return/.test(chk),
     '🔑 a late answer for a PREVIOUS item is dropped, so the button never describes the wrong scan');
}

// ── A fault is not a refusal ───────────────────────────────────────────────────
// 🛑 THE BUG THIS PINS COST A LIVE DEBUGGING SESSION. The screen showed "This cannot be
// printed yet." for a LIFEWTR scan, and that sentence was the front-end's generic
// fallback — not one of the four refusals, which all carry a `detail`. Every 403 on this
// worker answers { error, code } and a thrown handler answers { error }: no `detail` on
// either, so an undeployed worker, a missing grant and a Clover outage all rendered as
// the same dead sentence with nothing to tell them apart.
//
// Two independent holes made that possible, and both are fixed here:
//   1. stickerCategoryCodes had no catch, so an unreachable Clover THREW (cloverFetch
//      awaits fetch() directly) and escaped as a 500 rather than the "clover unreachable"
//      refusal the endpoint had already been written to give.
//   2. psStickerCheck never looked at r.ok, so it read any error body as a refusal.
{
  const src = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
  // 🔑 Slice from the KEY HELPER, not from the function. stickerCategoryCodes now resolves
  // the store through stickerStore and scopes the cache through stickerCodesKey, both
  // declared just above it — building it with stubs for those would test something else.
  const fnSrc = sliceOrNull(src, 'const stickerCodesKey = (store)',
                            '// Does this exact code exist in Clover?');
  ok(fnSrc, 'worker.js still scopes the sticker cache key by store');
  const build = (cloverFetch) => buildOrStub('stickerCategoryCodes', fnSrc,
    ['cloverFetch', 'ALL_STORES'], [cloverFetch, ['BL1', 'BL2', 'BL4', 'BL8', 'BL14', 'BL16']],
    'stickerCategoryCodes');

  const kv = (stored) => ({ SALES_SNAPSHOTS: {
    get: async () => stored,
    put: async () => {},
  }, BL1_MERCHANT_ID: 'M1', BL1_API_TOKEN: 't' });

  const throws = build(async () => { throw new TypeError('network error'); });
  // 🔑 CAUGHT, NOT AWAITED BARE. Without the fix these calls REJECT, and an unhandled
  // rejection kills the process — aborting the other 50 suites and reporting the
  // regression as a stack trace instead of a named failure. Which is the same shape as
  // the bug under test: a throw escaping where an answer was owed.
  const answer = async (env) => { try { return await throws(env, 'BL1'); }
                                  catch (e) { return `THREW: ${e.message}`; } };

  // Nothing cached: there is no answer to give, only a fault. null says so.
  eq(await answer(kv(null)), null,
     '🛑 a THROWN Clover read returns null — it no longer escapes as a 500');

  // Something cached but stale: a map from yesterday still answers correctly for every
  // category whose number has not changed, which on any normal day is all of them.
  const stale = { map: { Beverages: '50008' }, field: 'sku',
                  at: new Date(Date.now() - 90 * 86400 * 1000).toISOString() };
  const back = await answer(kv(stale));
  eq(back?.map?.Beverages, '50008', '…but a stale cached map is served rather than nothing');
  eq(back?.field, 'sku', '…and it keeps the field the map was built from');

  // The fresh-cache path must not be reached through the network at all.
  const fresh = { map: { Beverages: '50009' }, field: 'code', at: new Date().toISOString() };
  const boom = build(async () => { throw new Error('must not be called'); });
  eq((await boom(kv(fresh), 'BL1'))?.map?.Beverages, '50009',
     'a fresh cache answers without touching Clover, so an outage is invisible for a day');
}

// The screen must name the fault, because the fixes differ completely: an undeployed
// worker needs a deploy, a missing grant needs an admin, an expired session needs a
// sign-in — and none of those are anything the person holding the scanner can guess.
{
  const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  const chk = html.slice(html.indexOf('async function psStickerCheck('),
                         html.indexOf('function psStickerFault('));
  ok(/if \(!r\.ok \|\| \(!a\.printable && !a\.detail\)\)/.test(chk),
     '🔑 a non-OK response, or a body with no detail, is handled as a FAULT not a refusal');
  ok(/psSticker = null/.test(chk),
     '🛑 …and clears the stored answer, so Print cannot fire on a fault');
  ok(!/This cannot be printed yet/.test(html),
     '🛑 the sentence that hid all of this is gone — a refusal now always shows its own detail');

  ok(html.includes('function psStickerFault('),
     '🔑 psStickerFault exists at all — without it every fault renders as the old blank');
  const fnSrc = html.slice(html.indexOf('function psStickerFault('),
                           html.indexOf('// ZPL, because the printer draws'));
  // Same reasoning as the worker block above: name the regression, do not die on it.
  let psStickerFault;
  try { psStickerFault = new Function(fnSrc + '\n; return psStickerFault;')(); }
  catch (e) { psStickerFault = () => `UNBUILDABLE: ${e.message}`; }

  // The one that matters most: the worker half of the deploy never landed.
  ok(/deploy/i.test(psStickerFault(403, { code: 'UNCLASSIFIED_ACTION' })),
     '🔑 UNCLASSIFIED_ACTION says the WORKER is behind — the fix is a deploy, not a permission');
  ok(/Bargain Lane/.test(psStickerFault(403, { code: 'NO_BUSINESS_ACCESS' })),
     'a missing business grant is named as one');
  ok(/admin/i.test(psStickerFault(403, { code: 'NEED_ADMIN' })),
     'NEED_ADMIN asks for an admin');
  ok(/admin/i.test(psStickerFault(403, { code: 'NEED_SUPERUSER' })),
     '…and so does NEED_SUPERUSER, which the same row can produce');
  ok(/sign in/i.test(psStickerFault(401, {})),
     'a 401 is an expired session, which the person CAN fix themselves');
  ok(/500/.test(psStickerFault(500, { error: 'boom' })) && /boom/.test(psStickerFault(500, { error: 'boom' })),
     '🔑 an unrecognised fault still shows the status and the server text, never a blank');

  // Every branch must say something. A fault that renders empty is the original bug.
  for (const [st, body] of [[403, {}], [500, {}], [0, {}], [502, { error: '' }], [403, { code: 'NOPE' }]])
    ok((psStickerFault(st, body) || '').length > 10,
       `no fault renders blank: ${st} ${JSON.stringify(body)}`);
}

// ── Existence is a set lookup, and a miss re-reads before it refuses ───────────
// 🛑 CLOVER HAS NO `code` FILTER. The old check asked items?filter=code=BL-50002-1_5 and
// got 400 "'code' is not a supported field for this filter" every single time, so it could
// never have succeeded — and it discarded the body, so all it said was "Clover did not
// answer". The sweep already reads every item and extracts every BL- string to build the
// map, so the set of live codes is free and the network call goes away entirely.
{
  const src = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
  const fnSrc = src.slice(src.indexOf('async function stickerCodeExists('),
                          src.indexOf('function merchTree('));
  ok(!/filter=/.test(fnSrc),
     '🔑 nothing here asks Clover to filter — the field that 400s is gone from this path');
  const build = (sweep) => new Function('stickerCategoryCodes', fnSrc + '\n; return stickerCodeExists;')(sweep);

  // A hit answers from the set WITHOUT re-reading. That is the whole point of the change.
  let sweeps = 0;
  const counting = build(async () => { sweeps++; return { codes: [] }; });
  const hit = await counting({}, 'BL1', 'BL-50002-1_5', ['BL-50002-1', 'BL-50002-1_5']);
  eq(hit.exists, true, 'a code in the set exists');
  eq(sweeps, 0, '🔑 …and answering it costs no Clover call at all');

  // 🛑 A MISS MUST RE-READ BEFORE REFUSING. A manager who just created a price point in
  // Clover expects to print it now, not when a 24h cache turns over — and the cached set
  // is exactly as old as the last sweep.
  const created = build(async () => ({ codes: ['BL-50002-2_25'] }));
  const late = await created({}, 'BL1', 'BL-50002-2_25', []);
  eq(late.exists, true, 'a code created since the sweep is found by the forced re-read');
  eq(late.rechecked, true, '…and says it had to look again');

  const absent = await build(async () => ({ codes: [] }))({}, 'BL1', 'BL-50002-9_99', []);
  eq(absent.exists, false,
     '🛑 a genuinely absent code is FALSE, not unknown — never refuse a real miss as an outage');

  // The re-read can itself fail, and unknown is still not permission to print.
  const down = await build(async () => null)({}, 'BL1', 'BL-50002-1_5', []);
  eq(down.exists, null, 'an unreachable Clover on the re-read is unknown');
  ok(/Clover did not answer/.test(down.why || ''), '…and says so');
}

// ── Printing is not overriding ────────────────────────────────────────────────
// \🛑 THE STICKER FEATURE WAS INVISIBLE TO THE PEOPLE WHO USE IT. Every sticker action
// -- check, record, history -- ran through requireAdminAccess, which resolves to
// canAccessInventory: superuser and admin ONLY. And the front end gated the Print button and
// the Reprint tab on psCanOverride, the right to change what an item is worth for every
// store, forever. Two different jobs wearing one right.
//
// \🔑 A SHELF LABEL IS NOT A PRICE OVERRIDE. It carries the code and the retail price that
// merch-scan already computed -- and merch-scan requires canSeeFinancials, with the comment
// "Managers use this on the floor, so it cannot be admin-only." The sticker now matches the
// scan that produces it instead of out-ranking it. Still never staff.
{
  const worker = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
  const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  // Comments below NAME requireAdminAccess to explain what they replaced, so a naive grep
  // matches the explanation and calls it the bug. Strip whole-line comments first.
  const codeOnly = (t) => t.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l.trim() ? l : 'x')).join('\n');

  for (const action of ['sticker-check', 'sticker-printed', 'sticker-history']) {
    const at = worker.indexOf(`url.searchParams.get("action") === "${action}"`);
    ok(at > 0, `${action} has a handler`);
    const gate = codeOnly(worker.slice(at, at + 1400));
    ok(/if \(!isAdminSecret && !canSeeFinancials\(currentUser\)\)/.test(gate),
       `\🔑 ${action} gates on canSeeFinancials -- the gate the scan itself uses`);
    ok(!/requireAdminAccess/.test(gate),
       `\🛑 …and no longer on requireAdminAccess, which is superuser+admin only`);
    ok(/NEED_MANAGER/.test(gate), `…refusing with NEED_MANAGER, which the screen can explain`);
  }

  // Extract the REAL role set rather than restating it: a harness that reimplements the
  // thing it tests will agree with itself while production disagrees.
  const roles = worker.match(/const FINANCIAL_ROLES = new Set\(\[[\s\S]*?\]\);/);
  const fn = worker.match(/function canSeeFinancials\(user\) \{[\s\S]*?\n\}/);
  ok(roles && fn, 'canSeeFinancials is extractable from worker.js');
  const canSee = new Function(`${roles[0]}\n${fn[0]}\n; return canSeeFinancials;`)();
  const U = (role) => ({ email: 'u@x.com', role });

  ok(canSee(U('manager')), '\🔑 a manager can print -- the whole point of the change');
  ok(canSee(U('executive')), '…and an executive');
  ok(canSee(U('admin')) && canSee(U('superuser')), '…and everyone who already could');
  ok(!canSee(U('staff')), '\🛑 …but NOT staff. This widens the gate, it does not remove it');
  ok(!canSee(null), '…and not an unauthenticated caller');

  // The front end must ask the same question, under its own name.
  ok(/function psCanPrint\(\) \{ return canSeeFinancials\(currentUser\); \}/.test(html),
     'the screen mirrors the worker gate rather than inventing a second role list');
  const row = sliceOrNull(html, '  function psStickerRow(j) {', '  function psStickerCheck');
  ok(/if \(!psCanPrint\(\)\) return ''/.test(row || ''),
     'the Print button is offered on the print right');

  // \🛑 The two rights must stay SEPARATE. Collapsing them the other way would hand the
  // price-override control to every manager, which is the actual dangerous direction.
  // 🛑 EXISTING IS NOT ENOUGH -- a mutation that redefined psCanOverride as
  // canSeeFinancials passed this suite. That is the DANGEROUS direction: it would hand the
  // price-override control to every manager. Pin the role list, and prove a manager is
  // refused, rather than checking the function is still spelled the same.
  const ovr = sliceOrNull(html, '  function psCanOverride() {', '\n  }');
  ok(/\['superuser', 'admin'\]\.includes/.test(ovr || ''),
     'psCanOverride is still superuser+admin -- overriding a price did NOT move');
  // A body that reaches for something it was not given throws at CALL time, not build
  // time, so catch it here: a probe that dies is a failed assertion, not a dead suite.
  let managerMayOverride;
  try {
    managerMayOverride = !!buildOrStub('psCanOverride', ovr + '\n  }',
      ['currentUser'], [{ role: 'manager' }], 'psCanOverride')();
  } catch (e) { managerMayOverride = `threw: ${e.message}`; }
  eq(managerMayOverride, false,
     '🛑 …and a manager who can now PRINT still cannot OVERRIDE a price');
  ok(/\$\{psCanOverride\(\) \? '<button class="ps-link" onclick="psOverride\(\)"/.test(html),
     '\🔑 …and still guards the price override, which did NOT move');
  ok(/case 'NEED_MANAGER':/.test(html),
     'a manager-gated refusal is explained, not shown as an unexplained 403');
}


// ── The reprint row shows what it was, and what we priced it at ───────────────
// \🛑 SHIPPED BROKEN AND PHOTOGRAPHED. .ps-btn is width:100% -- it is built for the
// full-width "Scan" and "Look it up" buttons. Dropped into a flex row it demanded the whole
// width, .ps-recent-main collapsed to about three characters, and .ps-recent-title (which is
// white-space:nowrap) got clipped to nothing. The product name looked ABSENT; it was
// squeezed. The wrapping text in the screenshot was the sub-line, which has no nowrap.
{
  const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');

  ok(/\.ps-btn\{[^}]*width:100%/.test(html),
     'the base button is still width:100% -- this is the rule being overridden, not removed');
  ok(/\.ps-recent-row \.ps-btn\{[^}]*width:auto[^}]*flex:none/.test(html),
     '\🛑 …and a button inside a reprint row sizes to its label instead of eating it');
  ok(html.indexOf('.ps-recent-row .ps-btn{') > html.indexOf('.ps-btn{'),
     '…declared after it, so source order agrees with the specificity that already wins');
  ok(/\.ps-recent-row:first-child\{border-top:none\}/.test(html),
     'no rule above the first row -- with the heading gone it was a line under nothing');

  const src = sliceOrNull(html, '  function psRecentRender()', '  const psL3Tail =');
  ok(src, 'psRecentRender is where the test expects it');

  const box = { innerHTML: '', style: {} };
  const reBtn = { style: {} }, n = { textContent: '' };
  const els = { 'ps-recent': box, 'ps-tab-reprint': reBtn, 'ps-tab-reprint-n': n };
  const rows = [
    { code: 'BL-50002-1_5', title: 'LIFEWTR Purified Water 1L', l3: 'FG BL CONSUMABLES - FOOD - BEVERAGES',
      price: 1.5, printed_at: '2026-09-02T15:00:00Z' },
    { code: 'BL-50002-3', title: '', l3: 'FG BL CONSUMABLES - FOOD - BEVERAGES',
      price: 3, printed_at: '2026-09-02T15:00:00Z' },
  ];
  const render = buildOrStub('psRecentRender', src,
    ['el', 'psEsc', 'psL3Tail', 'psMoney', 'psRecentWhen', 'psCanPrint', 'psRecent'],
    [(id) => els[id] || null,
     (v) => String(v == null ? '' : v),
     (l3) => String(l3 || '').split(' - ').pop(),
     (v) => (v === null || v === undefined || v === '') ? '—' : `$${Number(v).toFixed(2)}`,
     () => '5m ago', () => true, rows],
    'psRecentRender');
  render();

  ok(/LIFEWTR Purified Water 1L/.test(box.innerHTML),
     '\🔑 the product name is on the row -- the thing you check against the shelf');
  ok(/ps-recent-price">\$1\.50</.test(box.innerHTML),
     '\🔑 …and OUR price, which sticker-history has returned all along and nobody drew');
  ok(/\$3\.00</.test(box.innerHTML), 'a whole-dollar price still shows its cents');
  ok(/BL-50002-1_5/.test(box.innerHTML), 'the label code is still there, in the sub-line');
  ok(/5m ago/.test(box.innerHTML), '…with when it went out');
  ok(/BEVERAGES/.test(box.innerHTML),
     'a row with no stored name falls back to its category tail, not to the code again');
  eq(n.textContent, '2', 'the tab carries the count');

  // The price must never be the bare number: 1.5 on a shelf label row reads as $1.05 at a
  // glance, and this page already has one formatter for exactly that reason.
  ok(/psMoney\(p\.price\)/.test(src || ''),
     '\🛑 formatted with the page-wide psMoney, not a second formatter that can drift');
}


// ── Reprint is a tab, and one thing decides what the body shows ───────────────
// \🛑 THE HIDING TRAP THIS FILE HAS ALREADY SHIPPED ONCE. `#ps-tabs{display:flex}` is an
// ID selector; `.hidden` is a single class. The ID wins on specificity whatever the source
// order, so toggling `hidden` leaves the tabs on screen -- exactly how the barcode controls
// stayed visible in furniture mode. style.display is the only thing that works here.
//
// \🔑 AND ONE AUTHORITY DECIDES. Furniture mode takes the whole body over, so psApplyTab
// stands down entirely while it is open and the body is handed back on the way out. Two
// writers on one element is the bug, not the symptom.
{
  const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  const src = sliceOrNull(html, "  let psTabName = 'scan';", '  function psRecentRender()');
  ok(src, 'the tab block is where the test expects it');

  ok(!/id="ps-tabs"[^>]*class="[^"]*\bhidden\b/.test(html),
     '\🛑 the tab bar is never hidden with the `hidden` class -- an ID selector outranks it');
  ok(/id="ps-recent" style="display:none"/.test(html),
     '\🛑 …and neither is the reprint panel, for the same reason');
  ok(/id="ps-tab-reprint"[\s\S]{0,160}style="display:none"/.test(html),
     'the reprint tab starts hidden and is revealed only once the right is confirmed');

  const mkEl = () => {
    const ids = ['ps-tab-scan', 'ps-tab-reprint', 'ps-barcode-mode', 'ps-result', 'ps-recent'];
    const map = {};
    for (const id of ids) map[id] = { id, style: {}, className: '' };
    return map;
  };

  const build = (map, fnState, spy) => buildOrStub('psTab', src,
    ['el', 'fn', 'psStopScan', 'psRecentLoad', 'window'],
    [(id) => map[id] || null, fnState, () => { spy.stopped++; }, () => { spy.loaded++; }, {}],
    '{ psApplyTab, psTab }');

  {
    const map = mkEl(), spy = { stopped: 0, loaded: 0 };
    const m = build(map, { open: false }, spy);
    m.psApplyTab();
    eq(map['ps-barcode-mode'].style.display, 'flex', 'Scan shows the barcode controls');
    eq(map['ps-recent'].style.display, 'none', '…and hides the reprint list');
    eq(map['ps-tab-scan'].className, 'ps-tab on', '…with the Scan tab lit');

    m.psTab('reprint');
    eq(map['ps-barcode-mode'].style.display, 'none', 'Reprint hides the barcode controls');
    eq(map['ps-result'].style.display, 'none', '…and the scan result, which belongs to Scan');
    eq(map['ps-recent'].style.display, '', '…and shows the list');
    eq(map['ps-tab-reprint'].className, 'ps-tab on', '…with the Reprint tab lit');
    eq(map['ps-tab-scan'].className, 'ps-tab', '…and Scan no longer lit');
    eq(spy.stopped, 1, '\🛑 leaving Scan stops the camera -- battery and privacy, not cosmetics');
    eq(spy.loaded, 1, '…and the list is refreshed, because other people print too');

    spy.stopped = 0;
    m.psTab('reprint');
    eq(spy.stopped, 0, 'selecting the tab already on does nothing');
  }

  {
    // Furniture owns the body. psApplyTab must not fight it for the same elements.
    const map = mkEl(), spy = { stopped: 0, loaded: 0 };
    const m = build(map, { open: true }, spy);
    m.psApplyTab();
    eq(map['ps-barcode-mode'].style.display, undefined,
       '\🔑 while furniture is open the tab writes NOTHING to the body');
    eq(map['ps-tab-scan'].className, 'ps-tab on', '…though the bar still reflects the selection');
  }
}

// ── The reprint tab is offered only to whoever the list would load for ────────
{
  const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  const load = sliceOrNull(html, '  async function psRecentLoad()', '  function psRecentRender()');
  const render = sliceOrNull(html, '  function psRecentRender()', '  // merchLabel lives in the worker');

  ok(/psCanPrint\(\)/.test(load || ''), 'the fetch still refuses without the right');
  ok(/psRecentRender\(\);\s*return;/.test(load || ''),
     '\🛑 …but it now RENDERS on the way out. A bare return left the tab button on screen');
  ok(/reBtn\.style\.display = psCanPrint\(\)/.test(render || ''),
     'the tab is shown or hidden by the same right that gates the data');
  ok(/ps-recent-empty/.test(render || ''),
     'an empty list gets a sentence -- a clickable tab that renders nothing reads as broken');
  ok(!/ps-recent-h/.test(html),
     'the "Recently printed" heading is gone: the tab is the heading now');
}

// ── Contrast, computed against the real panel, not eyeballed ──────────────────
// \🛑 #8a8371 was 3.77:1 on #ps-card's white. It survived as a footnote under a scan
// result; promoting it to a tab's primary content is what made it worth fixing.
{
  const css = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lum = (h) => {
    const n = parseInt(h.slice(1), 16);
    return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  ok(!/color:#8a8371/.test(css), '\🛑 the 3.77:1 dim is gone from the file');
  ok(/\.ps-recent-sub\{font-size:11\.5px;color:#6b6453/.test(css),
     '…replaced by a dim already in this file, not a new token');
  ok(ratio('#6b6453', '#ffffff') >= 4.5,
     `the reprint sub-line clears 4.5:1 on the light panel (${ratio('#6b6453', '#ffffff').toFixed(2)}:1)`);
  ok(ratio('#7c899e', '#101826') >= 4.5,
     `…and on the dark one (${ratio('#7c899e', '#101826').toFixed(2)}:1)`);
  ok(ratio('#6b6453', '#fafaf6') >= 4.5, 'an idle tab is legible on the light bar');
  ok(ratio('#8893a7', '#16203a') >= 4.5, '…and on the dark bar');
}


// ── The editor names the fault instead of saying "Forbidden" ─────────────────
// 🛑 REPORTED FROM THE SCREEN: "Could not load the template: Forbidden." The response
// carried code: UNCLASSIFIED_ACTION, which does NOT mean "you may not" -- it means the
// worker predates the feature and the fix is a deploy. psStickerFault had said exactly that
// to the person at the scanner since the day it was written; this panel read past it and
// sent someone hunting a permissions problem that did not exist.
{
  const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  const src = sliceOrNull(html, '  const stFault = (status, j) =>', '  const stField =');
  ok(src, 'stFault is where the test expects it');
  const stFault = buildOrStub('stFault', 'const F = ' + (src || '').replace(/^\s*const stFault = /, ''),
    [], [], 'F');

  ok(/wrangler deploy/.test(stFault(403, { error: 'Forbidden', code: 'UNCLASSIFIED_ACTION' })),
     '🛑 an unclassified action names the missing DEPLOY, not a permission');
  ok(/superuser/.test(stFault(403, { error: 'Forbidden', code: 'NEED_SUPERUSER' })),
     'a superuser-only refusal says which right it wants');
  ok(/manager/.test(stFault(403, { error: 'Forbidden', code: 'NEED_MANAGER' })), '…and so does a manager one');
  ok(/session has expired/.test(stFault(401, {})), 'a 401 is a sign-in problem, not a permission one');
  ok(/500/.test(stFault(500, { error: 'boom' })), 'anything unrecognised still carries its status');

  // 🛑 The whole point: a bare `error` string must never be the last word again.
  const codes = ['UNCLASSIFIED_ACTION', 'NEED_SUPERUSER', 'NEED_MANAGER', 'NO_BUSINESS_ACCESS', 'NO_FINANCIAL_ACCESS'];
  const said = codes.map(c => stFault(403, { error: 'Forbidden', code: c }));
  eq(new Set(said).size, codes.length, 'every code gets its OWN sentence — none collapses to another');
  ok(said.every(t => !/^Forbidden/.test(t)), '…and none of them is just the word Forbidden');

  // 🛑 ASSERT THE PROPERTY, NOT THE COUNT. This pinned "exactly 3" and failed the moment
  // the image paths started reporting properly too -- a test that breaks when the code gets
  // BETTER is a test measuring the wrong thing. Every throw in the editor must go through
  // the mapper; how many there are is not the point.
  const block = sliceOrNull(html, '  async function stLoad() {', '  window.stTest = stTest;');
  const throws = (block.match(/throw new Error\(/g) || []).length;
  // …and not literal about variable names either: one call site works on a second response
  // and passes r2/j2. Matching `stFault(r.status, j)` exactly said that path was unmapped
  // when it plainly was. Match the CALL, not the spelling of its arguments.
  const mapped = (block.match(/throw new Error\(stFault\(/g) || []).length;
  ok(throws >= 3, 'the editor has failure paths to report');
  eq(mapped, throws, '🛑 every one of them reports through stFault');
  ok(!/throw new Error\(j\.error \|\| /.test(block || ''),
     '…and none still throws the bare error string');
}


// ── The preview actually runs ────────────────────────────────────────────────
// 🛑 SHIPPED HALF-WORKING. A block rewrite deleted stTextW and stQrDots and left the
// calls behind, so stPreview threw ReferenceError on its first line. stDraw sets the control
// rows' innerHTML BEFORE calling stPreview, so the panel rendered fine and the preview
// simply never appeared -- harder to notice than an outright break, and no grep-shaped
// assertion would have seen it. Run the function.
{
  const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');

  // The cheap general guard for "a rewrite took a helper with it": every st* helper the
  // editor CALLS must be defined somewhere in the file.
  const editor = sliceOrNull(html, '  let stTpl = null, stDefaults = null', '  window.stTest = stTest;');
  ok(editor, 'the editor block is where the test expects it');
  const called = new Set(editor.match(/\bst[A-Z]\w*(?=\()/g) || []);
  const missing = [...called].filter(n =>
    !new RegExp(`(const|let|function)\\s+${n}\\b`).test(html) && !new RegExp(`window\\.${n}\\s*=`).test(html));
  eq(missing.join(', '), '', '🛑 every st* helper the editor calls is actually defined');

  // …and then run the preview for real. Extract only the pieces it needs: slicing the whole
  // editor sweeps in code that touches window and fetch at build time.
  const one = (from, to) => sliceOrNull(html, from, to) || '';
  const src = [
    one('  const stTextW =', '\n'),
    one('  const stQrDots = (f, payload)', '\n'),
    one('  const stField = (k)', '\n'),
    one('  function stPreview() {', '\n  }\n') + '\n  }\n',
    one('  function stMarkPreviewUri(im) {', '\n  }\n') + '\n  }\n',
  ].join('\n');
  ok(/function stPreview\(\)/.test(src) && /const stTextW/.test(src), 'the preview pieces are extractable');

  const host = { innerHTML: '' }, warn = { className: '', innerHTML: '' };
  const els = { 'st-preview': host, 'st-warn': warn };
  const defaults = { fields: {
    qr:     { on: true,  x: 104, y: 10,  mag: 4 },
    mark:   { on: true,  x: 12,  y: 18,  h: 74, w: 74, font: '0', text: '$', mode: 'text' },
    code:   { on: true,  x: 10,  y: 116, h: 20, w: 20, font: '0' },
    price:  { on: true,  x: 10,  y: 142, h: 54, w: 54, font: '0' },
    retail: { on: false, x: 10,  y: 96,  h: 18, w: 18, font: '0', prefix: 'Compare at ' } } };

  const run = (fields, image) => {
    const fn = buildOrStub('stPreview', src,
      ['el', 'psEsc', 'stTpl', 'stDefaults', 'stImage', 'stImgEl', 'stCut'],
      [(id) => els[id] || null, (v) => String(v == null ? '' : v),
       { id: null, name: '', fields }, defaults, image, null, 150],
      'stPreview');
    host.innerHTML = ''; warn.className = ''; warn.innerHTML = '';
    fn();
  };

  run(JSON.parse(JSON.stringify(defaults.fields)), null);
  ok(/^<svg /.test(host.innerHTML), '🛑 the preview renders an SVG rather than throwing');
  ok(/viewBox="0 0 203 203"/.test(host.innerHTML), "…at the label's true 203-dot scale");
  ok(/BL-50008-2_5/.test(host.innerHTML), '…showing the sample code');
  ok(/\$2\.50/.test(host.innerHTML), '…and the sample price');
  eq(warn.className, 'hidden mt-4', 'the stock layout raises no overflow warning');

  const over = JSON.parse(JSON.stringify(defaults.fields));
  over.price.x = 190;
  run(over, null);
  eq(warn.className, 'mt-4 space-y-2', 'a field pushed off the edge shows the warning');
  ok(/Our price/.test(warn.innerHTML), '…and names which field it is');

  // 🛑 3 IS ALLOWED, NOT VOUCHED FOR, AND THE SCREEN IS THE ONLY PLACE THAT CAN SAY SO.
  // The worker now stores magnification 3; nothing about it has been read at a register.
  // The failure lands on a customer at the till, so the editor has to state it where the
  // number is set rather than leaving the size to look as ordinary as 4.
  const small = JSON.parse(JSON.stringify(defaults.fields));
  small.qr.mag = 3;
  run(small, null);
  eq(warn.className, 'mt-4 space-y-2', 'a QR below the proven size raises a note');
  ok(/proven at the register/.test(warn.innerHTML), '…and says it has not been proven at a register');
  run(JSON.parse(JSON.stringify(defaults.fields)), null);
  ok(!/proven at the register/.test(warn.innerHTML), '…while magnification 4 raises nothing');

  const imgFields = JSON.parse(JSON.stringify(defaults.fields));
  imgFields.mark.mode = 'image';
  run(imgFields, null);
  ok(!/<image/.test(host.innerHTML), 'image mode with no image stored draws no <image> element');
  ok(/stroke-dasharray/.test(host.innerHTML), '…it outlines the empty slot instead');
}

// ── The mark can be a bitmap, and the bitmap must be exact ───────────────────
// 🛑 A SHORT PAYLOAD HANGS THE PRINTER. ^GFA declares its own byte count twice; the
// printer then reads exactly that many hex bytes. Give it fewer and it waits for bytes that
// never arrive -- the label does not misdraw, it stops. So the worker re-derives the
// geometry and refuses anything whose hex length disagrees with its own dimensions.
{
  const worker = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
  const grab = (re, what) => { const m = worker.match(re); ok(m, `${what} is extractable`); return m ? m[0] : ''; };
  const decls = [
    grab(/const STICKER_MARK_MAX_SIDE = [\s\S]*?\n/, 'STICKER_MARK_MAX_SIDE'),
    grab(/const STICKER_MARK_MAX_BYTES = [\s\S]*?\n/, 'STICKER_MARK_MAX_BYTES'),
    grab(/const stickerText = [\s\S]*?\n\};/, 'stickerText'),
    grab(/function sanitizeStickerMarkImage\(body\) \{[\s\S]*?\n\}/, 'sanitizeStickerMarkImage'),
  ].join('\n');
  const clean = new Function(`${decls}; return sanitizeStickerMarkImage;`)();
  const hexFor = (w, h) => 'AB'.repeat(Math.ceil(w / 8) * h);

  const good = clean({ w: 74, h: 74, hex: hexFor(74, 74) });
  eq(good.image?.total, 740, 'a 74x74 mark packs to 740 bytes');
  eq(good.image?.bpr, 10, '…at 10 bytes a row');

  ok(/needs exactly/.test(clean({ w: 74, h: 74, hex: hexFor(74, 73) }).error || ''),
     '🛑 hex one row short is REFUSED — that is the payload that hangs the printer');
  ok(/needs exactly/.test(clean({ w: 74, h: 74, hex: hexFor(74, 75) }).error || ''), '…and one row long too');
  ok(/not valid hex/.test(clean({ w: 8, h: 8, hex: 'ZZZZZZZZZZZZZZZZ' }).error || ''), 'non-hex is refused');
  ok(/between 8 and/.test(clean({ w: 4, h: 4, hex: 'ABABABAB' }).error || ''), 'a mark under 8 dots is refused');
  ok(/between 8 and/.test(clean({ w: 400, h: 10, hex: '' }).error || ''), '…and one over the side limit');
  ok(/limit is/.test(clean({ w: 150, h: 150, hex: hexFor(150, 150) }).error || ''),
     'a mark that packs past the byte cap is refused before it reaches KV');
  // Lower case in, upper case stored: ^GFA is not case-sensitive but the stored value should
  // be one thing, so a byte-for-byte comparison of two uploads means something.
  eq(clean({ w: 8, h: 8, hex: 'ab'.repeat(8) }).image?.hex, 'AB'.repeat(8), 'hex is normalised to upper case');
}

// ── The packer is bit-exact, including the ragged last byte ──────────────────
{
  const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  const src = sliceOrNull(html, '  function stPack(canvas) {', '  function stImageChosen(');
  ok(src, 'stPack is where the test expects it');
  const stPack = new Function(src + '; return stPack;')();
  const fake = (w, h, on) => ({ width: w, height: h, getContext: () => ({ getImageData: () => {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) { const v = on(i % w, Math.floor(i / w)) ? 0 : 255;
      d[i*4] = d[i*4+1] = d[i*4+2] = v; d[i*4+3] = 255; }
    return { data: d }; } }) });

  for (const [w, h, on, name] of [
    [8, 8, (x, y) => x === y, 'diagonal, byte-aligned'],
    [74, 74, (x, y) => (x * y) % 7 === 0, 'the real corner-mark size'],
    [11, 5, (x) => x < 3, '🔑 a width that is NOT a multiple of 8'],
  ]) {
    const p = stPack(fake(w, h, on));
    const bpr = Math.ceil(w / 8);
    eq(p.bpr, bpr, `${name}: bytes per row`);
    eq(p.hex.length, bpr * h * 2, `${name}: hex length matches the declared byte count`);
    let wrong = 0, padInk = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < bpr * 8; x++) {
      const byte = parseInt(p.hex.substr((y * bpr + (x >> 3)) * 2, 2), 16);
      const bit = (byte >> (7 - (x & 7))) & 1;
      if (x < w) { if (bit !== (on(x, y) ? 1 : 0)) wrong++; }
      else if (bit) padInk++;
    }
    eq(wrong, 0, `${name}: every dot round-trips`);
    eq(padInk, 0, `${name}: 🛑 the padding bits past the edge are blank, not stray ink`);
  }
}

// ── psZpl draws the bitmap, and degrades safely without one ──────────────────
{
  const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  const at = html.indexOf('function psZpl(');
  const psZpl = eval('(' + html.slice(at, html.indexOf('\n  }\n', at) + 5).replace(/\n\s*\/\/[^\n]*/g, '') + ')');
  const img = { w: 74, h: 74, bpr: 10, total: 740, hex: 'AB'.repeat(740) };
  const tplImg = { markImage: img, fields: { mark: { on: true, mode: 'image', x: 12, y: 18 } } };

  const out = psZpl('BL-1-1', 1, {}, tplImg);
  ok(out.includes(`^FO12,18^GFA,740,740,10,${img.hex}^FS`), '🔑 the mark is emitted as a ^GFA bitmap');
  // 🛑 SHIPPED WITHOUT ITS TERMINATOR AND THE LABEL NEVER PRINTED. ^FS ends a field
  // definition and commits it; ^GFA was the only line on the label emitted without one, so
  // the graphic field stayed open. Text-mode templates printed perfectly right beside it,
  // which is why it read as "test printing is broken" rather than as a missing character.
  // Assert it on the ^GFA line specifically -- a file-wide count of ^FS would not have seen it.
  ok(/\^GFA,[^\n]*\^FS$/m.test(out), '🛑 …and the graphic field is CLOSED with ^FS, or it never prints');
  eq(out.split('\n').filter(l => l.startsWith('^FO')).every(l => l.endsWith('^FS')), true,
     '🛑 every field on the label is terminated, the bitmap included');
  ok(!/\^A0N,74,74\^FD/.test(out), '…and the $ glyph is NOT also drawn — one slot, one filling');

  // 🛑 Image mode with nothing stored must draw NOTHING, not a broken ^GFA. The image
  // lives on its own key and can be removed while a template still asks for it.
  const orphan = psZpl('BL-1-1', 1, {}, { fields: { mark: { on: true, mode: 'image' } } });
  ok(!/GFA/.test(orphan), 'image mode with no image stored emits no ^GFA');
  ok(orphan.startsWith('^XA') && orphan.trim().endsWith('^XZ'), '…and the label is still a valid, framed job');
  ok(!/\^FD\$\^FS/.test(orphan), '…and does not silently fall back to the $ glyph');

  const textMode = psZpl('BL-1-1', 1, {}, { markImage: img, fields: { mark: { on: true, mode: 'text', text: 'BL' } } });
  ok(!/GFA/.test(textMode) && textMode.includes('^FDBL^FS'),
     'a stored image is ignored while the mark is in text mode');
}

// ── Many named templates, one in use ─────────────────────────────────────────
{
  const worker = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');

  // 🛑 THE HELPERS MUST BE TOP LEVEL. I inserted these three INSIDE
  // sanitizeStickerTemplate by mistake. That is legal JavaScript -- node --check passed --
  // but it scopes them to that function, so every template read would have thrown
  // ReferenceError in production. Only the structural extraction below caught it.
  for (const fn of ['loadStickerTemplates', 'activeStickerTemplate', 'sanitizeStickerMarkImage', 'sanitizeStickerTemplate']) {
    ok(new RegExp(`^(async )?function ${fn}\\(`, 'm').test(worker),
       `${fn} is declared at the top level, not nested inside another function`);
  }

  const decls = ['const STICKER_TEMPLATE_KEY = "sticker:template";',
                 'const STICKER_TEMPLATES_KEY = "sticker:templates";',
                 (worker.match(/async function loadStickerTemplates\(env\) \{[\s\S]*?\n\}/) || [''])[0],
                 (worker.match(/function activeStickerTemplate\(coll\) \{[\s\S]*?\n\}/) || [''])[0]].join('\n');
  const m = new Function(`${decls}; return { loadStickerTemplates, activeStickerTemplate };`)();

  const kv = (store) => ({ SALES_SNAPSHOTS: { get: async (k) => store[k] || null } });
  const fields = { price: { x: 1 } };

  // 🛑 A LAYOUT SAVED UNDER THE OLD KEY MUST SURVIVE. Switching keys without carrying it
  // across would quietly discard somebody's work and print the stock label instead.
  const legacy = await m.loadStickerTemplates(kv({ 'sticker:template': { fields, updatedBy: 'brian' } }));
  eq(legacy.items.length, 1, 'a legacy single template is carried across');
  eq(legacy.active, 'legacy', '…and is the one in use');
  eq(legacy.items[0].updatedBy, 'brian', '…keeping who last changed it');

  const fresh = await m.loadStickerTemplates(kv({}));
  eq(fresh.items.length, 0, 'nothing stored means no templates');
  eq(m.activeStickerTemplate(fresh), null, '…and no active one, which means the stock label');

  const coll = { active: 'b', items: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] };
  eq(m.activeStickerTemplate(coll).name, 'B', 'the active one resolves by id');
  eq(m.activeStickerTemplate({ active: 'gone', items: [{ id: 'a' }] }), null,
     'an active id pointing at a deleted template resolves to null, not to a random one');

  const codeOnly = (t) => t.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  const setAt = worker.indexOf('url.searchParams.get("action") === "sticker-template-set"');
  const set = codeOnly(worker.slice(setAt, setAt + 5200));
  ok(/op === "reset"/.test(set) && /op === "activate" \|\| op === "delete"/.test(set),
     'save, activate, delete and reset are all handled');
  ok(/STICKER_MAX_TEMPLATES/.test(set), 'the number of saved templates is capped');
  ok(/Give the template a name/.test(set), 'a template must be named');
  ok(/coll\.active = coll\.items\.length \? coll\.items\[0\]\.id : null/.test(set),
     '🔑 deleting the one in use falls back to another, or to the stock label');
  ok(/\.delete\(STICKER_TEMPLATE_KEY\)/.test(set),
     'reset clears the legacy key too, or the old layout reappears on the next read');

  const imgAt = worker.indexOf('url.searchParams.get("action") === "sticker-mark-image"');
  ok(imgAt > 0, 'the mark-image endpoint exists');
  const imgH = codeOnly(worker.slice(imgAt, imgAt + 2000));
  ok(/currentUser\.role !== "superuser"/.test(imgH), 'replacing the image is superuser only');
  ok(/sanitizeStickerMarkImage/.test(imgH), '…and nothing is stored without validation');
  ok(/body\?\.clear === true/.test(imgH), '…and it can be removed again');
}


// ── The sticker template ─────────────────────────────────────────────────────
// \🛑 THE ONE THAT MATTERS: A NULL TEMPLATE MUST EMIT THE OLD BYTES. Shipping a
// configurable layout must not move a single dot on any shelf in the chain until somebody
// deliberately moves one. Everything else in this block is secondary to that.
{
  const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  const at = html.indexOf('function psZpl(');
  const fn = html.slice(at, html.indexOf('\n  }\n', at) + 5);
  const psZpl = eval('(' + fn.replace(/\n\s*\/\/[^\n]*/g, '') + ')');

  // The hardcoded label, transcribed from what it emitted before the template existed.
  const legacy = (code, price) => {
    const money = '$' + Number(price).toFixed(2);
    return ['^XA', '^PW203', '^LL203', '^MNN', '^LH0,0',
      `^FO104,10^BQN,2,4^FDLA,${code}^FS`, '^FO12,18^A0N,74,74^FD$^FS',
      `^FO10,116^A0N,20,20^FD${code}^FS`, `^FO10,142^A0N,54,54^FD${money}^FS`, '^XZ'].join('\n');
  };
  for (const [c, p] of [['BL-50008-2_5', 2.5], ['BL-50002-10', 10], ['BL-99999-12_25', 12.25]]) {
    eq(psZpl(c, p, {}, null), legacy(c, p),
       `\🛑 a null template prints the OLD label byte for byte (${c})`);
  }
  eq(psZpl('BL-1-1', 1, { retail: 9.99 }, null), legacy('BL-1-1', 1),
     '\🔑 …even with a street price available, because that field ships OFF');

  // \🛑 NO STREET PRICE IS A NORMAL ANSWER. "No street price found" is a real scan outcome
  // and every row printed before the column existed has none. It must vanish, not print
  // "Compare at $0.00" or a bare dash on a shelf.
  const withRetail = { fields: { retail: { on: true, x: 10, y: 96, h: 18, w: 18, font: '0', prefix: 'Compare at ' } } };
  for (const v of [null, undefined, 0, '', NaN, 'x']) {
    const out = psZpl('BL-1-1', 1, { retail: v }, withRetail);
    ok(!/Compare|null|NaN|undefined|\$0\.00/.test(out), `a street price of ${JSON.stringify(v)} draws nothing at all`);
  }
  ok(psZpl('BL-1-1', 1, { retail: 29.99 }, withRetail).includes('^FO10,96^A0N,18,18^FDCompare at $29.99^FS'),
     '…and a real one draws with its prefix');

  // \🛑 ^ AND ~ OPEN ZPL COMMANDS. One inside an admin's prefix would end the field and
  // print garbage, or be obeyed. A saved template is admin-authored, but the product title
  // and the code are not, so this is stripped on the way out regardless.
  const evil = psZpl('BL-1-1', 1, { retail: 5 },
    { fields: { retail: { on: true, x: 10, y: 96, h: 18, w: 18, font: '0', prefix: '^XZ~ ' } } });
  eq((evil.match(/\^XZ/g) || []).length, 1, '\🛑 an injected ^XZ cannot terminate the label early');
  ok(!/~/.test(evil), '…and ~ is stripped too');

  const moved = psZpl('BL-1-1', 1, {}, { fields: {
    qr: { on: true, x: 60, y: 40, mag: 6 }, mark: { on: false }, price: { on: true, x: 4, y: 150, h: 40, w: 24, font: 'B' } } });
  ok(moved.includes('^FO60,40^BQN,2,6^FDLA,BL-1-1^FS'), 'the QR moves and resizes');
  ok(!/\^FD\$\^FS/.test(moved), 'the corner mark can be switched off');
  ok(moved.includes('^FO4,150^ABN,40,24^FD$1.00^FS'), 'a text field takes its own font, height and width');
  ok(moved.includes('^BQN'), '\🛑 the QR is drawn even when a template tries to omit it');
}

// ── The defaults exist twice, and cannot drift ───────────────────────────────
// psZpl carries its own copy so it stays a pure function of its arguments and keeps working
// when the template fetch fails. The worker carries the copy it validates against. Two
// copies is the right call; two copies that disagree is a shelf full of wrong labels.
{
  const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  const worker = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');

  const wDef = worker.match(/const STICKER_TEMPLATE_DEFAULT = Object\.freeze\(\{[\s\S]*?\n\}\);/);
  ok(wDef, 'the worker defaults are extractable');
  const W = new Function(`${wDef[0]}; return STICKER_TEMPLATE_DEFAULT;`)();

  const at = html.indexOf('function psZpl(');
  const body = html.slice(at, html.indexOf('\n  }\n', at) + 5);
  const dSrc = body.match(/const D = \{[\s\S]*?\n    \};/);
  ok(dSrc, "psZpl's defaults are extractable");
  const D = new Function(`${dSrc[0]}; return D;`)();

  eq(JSON.stringify(D), JSON.stringify(W.fields),
     '\🛑 psZpl and the worker agree on every default, field for field');
}

// ── The worker refuses what a bad label is made of ───────────────────────────
{
  const worker = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
  const grab = (re, what) => { const m = worker.match(re); ok(m, `${what} is extractable`); return m ? m[0] : ''; };
  const decls = [
    grab(/const STICKER_LABEL_DOTS = [\s\S]*?\n/, 'STICKER_LABEL_DOTS'),
    grab(/const STICKER_QR_MIN_MAG = [\s\S]*?\n/, 'STICKER_QR_MIN_MAG'),
    grab(/const STICKER_QR_MAX_MAG = [\s\S]*?\n/, 'STICKER_QR_MAX_MAG'),
    grab(/const STICKER_TEXT_MIN = [\s\S]*?\n/, 'STICKER_TEXT_MIN'),
    grab(/const STICKER_TEXT_MAX = [\s\S]*?\n/, 'STICKER_TEXT_MAX'),
    grab(/const STICKER_FONTS = new Set\(\[[\s\S]*?\]\);/, 'STICKER_FONTS'),
    grab(/const STICKER_TEMPLATE_DEFAULT = Object\.freeze\(\{[\s\S]*?\n\}\);/, 'defaults'),
    grab(/const stickerInt = [\s\S]*?\n\};/, 'stickerInt'),
    grab(/const stickerText = [\s\S]*?\n\};/, 'stickerText'),
    grab(/function sanitizeStickerTemplate\(body\) \{[\s\S]*?\n\}/, 'sanitizeStickerTemplate'),
  ].join('\n');
  const clean = new Function(`${decls}; return sanitizeStickerTemplate;`)();

  // \🛑 THE QR IS NOT OPTIONAL. Everything else on the label is for a human; this is the
  // only part the register reads, and a sticker it cannot read is the exact failure the
  // whole feature exists to prevent.
  ok(/cannot be removed/.test(clean({ fields: { qr: { on: false } } }).error || ''),
     '\🛑 a template that turns the QR off is refused, not quietly corrected');
  // 3 is allowed because it was asked for; 4 is the size proven at a register. The floor
  // still binds one step down, and the EDITOR is what says 3 is unproven (asserted below).
  eq(clean({ fields: { qr: { mag: 3 } } }).tpl?.fields.qr.mag, 3, 'magnification 3 is allowed');
  ok(/refused/.test(clean({ fields: { qr: { mag: 2 } } }).error || ''),
     '\🛑 …and 2 is still refused — a module that small reads nowhere');
  eq(clean({ fields: { qr: { mag: 6 } } }).tpl.fields.qr.mag, 6, '…while 6 is fine');
  eq(clean({ fields: { qr: { mag: 99 } } }).tpl.fields.qr.mag, 8, '…and an absurd one clamps rather than failing');

  // Coordinates CLAMP. A slider that overshoots is not worth refusing a save over.
  eq(clean({ fields: { price: { x: 9999, y: -40 } } }).tpl.fields.price.x, 202, 'x clamps to the label');
  eq(clean({ fields: { price: { x: 9999, y: -40 } } }).tpl.fields.price.y, 0, '…and y clamps at zero');
  eq(clean({ fields: { price: { h: 1, w: 900 } } }).tpl.fields.price.h, 8, 'sizes clamp low');
  eq(clean({ fields: { price: { h: 1, w: 900 } } }).tpl.fields.price.w, 150, '…and high');
  eq(clean({ fields: { price: { x: 'abc' } } }).tpl.fields.price.x, 10, 'garbage falls back to the default');
  eq(clean({ fields: { price: { font: 'Q' } } }).tpl.fields.price.font, '0', 'an unknown font falls back, not through');
  eq(clean({ fields: { price: { font: 'B' } } }).tpl.fields.price.font, 'B', '…a real one is kept');

  // \🛑 Same stripping as psZpl, on the way IN as well as out. Belt and braces: the stored
  // value should never contain a ZPL control character in the first place.
  const t = clean({ fields: { mark: { text: '  ^XZ~evil  ' } } }).tpl.fields.mark.text;
  ok(!/[\^~]/.test(t), 'ZPL control characters are stripped before storage');
  eq(clean({ fields: { mark: { text: 'x'.repeat(80) } } }).tpl.fields.mark.text.length, 24, 'text is length-capped');

  // 🛑 .trim() PRINTED "Compare at$29.99" ON A SHELF. psZpl builds the line as
  // `${prefix}$${amount}`, so the prefix's trailing space is the space between the words --
  // the single character a trim is guaranteed to remove. Assert the printed RESULT, not the
  // stored string, because that is where the missing space was visible.
  eq(clean({ fields: { retail: { prefix: 'Compare at ' } } }).tpl.fields.retail.prefix, 'Compare at ',
     '🛑 the retail prefix keeps its trailing space');
  eq(clean({ fields: { retail: { prefix: 'Was  \n at   ' } } }).tpl.fields.retail.prefix, 'Was at ',
     '…runs of whitespace collapse to one, but the ends survive');

  eq(clean({}).tpl.fields.price.x, 10, 'an empty body yields the defaults');
  eq(clean(null).tpl.fields.code.h, 20, '…and so does no body at all');
  eq(clean({ fields: { mark: { on: false } } }).tpl.fields.mark.on, false, 'the corner mark CAN be switched off');
}

// ── Gates, and the street price surviving a reprint ──────────────────────────
{
  const worker = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
  const codeOnly = (t) => t.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  // 🛑 ANCHOR ON THE HANDLER, NOT THE ACTION NAME. Every one of these strings appears
  // FIRST in the ACTION_BUSINESS registry hundreds of lines earlier, so slicing between bare
  // names silently produced empty strings and six assertions "passed" against nothing until
  // the emoji in their labels gave the game away.
  // 🛑 …AND DO NOT SLICE A FIXED NUMBER OF CHARACTERS. This took `at + 1200`, so adding a
  // five-line comment inside a handler pushed the code the assertion was looking for out of
  // the window and failed a test that had nothing to do with the change. Worse, the same
  // trap silently PASSES the other way: a shrinking handler pulls the NEXT one into view.
  // Each handler runs until the next one starts, so take exactly that, then drop comments —
  // in that order, or a comment above the next handler can satisfy an assertion on its own.
  const NEXT = /url\.searchParams\.get\("action"\) === "/g;
  const handler = (action) => {
    const at = worker.indexOf(`url.searchParams.get("action") === "${action}"`);
    ok(at > 0, `${action} has a handler`);
    if (at < 0) return '';
    NEXT.lastIndex = at + 1;
    const m = NEXT.exec(worker);
    return codeOnly(worker.slice(at, m ? m.index : worker.length));
  };

  const get = handler('sticker-template');
  ok(/canSeeFinancials\(currentUser\)/.test(get),
     'reading the template uses the PRINT gate -- everyone who prints needs it');
  const set = handler('sticker-template-set');
  ok(/currentUser\.role !== "superuser"/.test(set),
     '🛑 …but EDITING it is superuser only. Changing every label the chain prints is not printing one.');
  ok(/sanitizeStickerTemplate/.test(set), '…and nothing is stored without going through the validator');
  ok(/\.delete\(STICKER_TEMPLATE_KEY\)/.test(set), 'reset removes the key rather than storing a copy of the defaults');

  const printed = handler('sticker-printed');
  ok(/retail_cents/.test(printed), 'a print records the street price it was made with');
  ok(/INSERT INTO sticker_prints[\s\S]*retail_cents/.test(printed), '…in the INSERT, not just computed and dropped');
  const hist = handler('sticker-history');
  // 🛑 RUN IT, DO NOT GREP IT. Asserting the CONDITION `r.retail_cents === null` passed
  // unchanged when the returned VALUE was mutated from null to 0 -- which would print
  // "Compare at $0.00" on a shelf. The same shape of gap as pinning a function's name and
  // calling it a behaviour. Extract the real expression and give it real rows.
  const mapSrc = hist.match(/retail: r\.retail_cents[\s\S]*?\/ 100,/);
  ok(mapSrc, 'the street-price mapping is extractable');
  const mapRetail = new Function('r', `return (${(mapSrc || [''])[0].replace(/^retail:\s*/, '').replace(/,$/, '')});`);
  eq(mapRetail({ retail_cents: null }), null,
     '🛑 a null street price stays null -- 0.00 would print "Compare at $0.00" on a shelf');
  eq(mapRetail({}), null, '…and a row from before the column existed does too');
  eq(mapRetail({ retail_cents: 299 }), 2.99, '…while a real one comes back in dollars');
  ok(/SELECT[\s\S]*retail_cents/.test(hist), '…and it is actually selected');

  const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  ok(/retail: j\.retail/.test(html), 'the front end sends the street price when recording a print');
  // 🛑 MATCH ON A FLATTENED COPY. These pinned the call's exact source text, so wrapping
  // one argument onto a second line broke three assertions that were describing behaviour
  // that had not changed. Collapsing whitespace first keeps the assertion about WHICH
  // arguments are passed, which is the thing worth pinning, and stops the formatter from
  // being able to fail the build.
  const flat = (t) => String(t || '').replace(/\s+/g, ' ');
  ok(/psZpl\(a\.code, psLast\.price, \{ retail: psLast\.retail, categoryCode: a\.category_code \}, psTpl\)/.test(flat(html)),
     'the print path passes the street price, the category number and the template');
  ok(/let psTpl = null;/.test(html),
     '🔑 the template starts null, so a failed fetch prints the stock label rather than nothing');
}

// ── An empty printer list is not proof there is no printer ────────────────────
// 🛑 REPORTED FROM THE FLOOR, after the feature had already printed successfully and
// with the probe byte-for-byte unchanged: "Browser Print is running, but reports no printer
// attached." The old code took a single {"printer":[]} as settled fact and named the printer
// as the cause — sending someone to the back room to check a cable that was fine.
//
// 🔑 THE SAME SHAPE AS MEMORY.md RULE 4, from a different vendor. Clover degrades by
// returning LESS rather than by erroring, and so does this agent: it starts answering before
// it has finished enumerating USB, so a well-formed empty list means "not yet" at least as
// often as it means "nothing there". Three things follow, and all three are asserted below:
// ask twice, never let the answer be cached, and say what was actually counted.
{
  const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  // Bounded on psPrint, the declaration immediately after — not on a distant marker.
  const src = sliceOrNull(html, '  const PS_ZEBRA_PROBE_MS', '  async function psPrint()');
  ok(src, 'the probe block is where the test expects it');

  ok(/cache: 'no-store'/.test(src || ''),
     '🛑 the probe is uncacheable — one empty answer must not outlive the printer returning');

  let seen = [];
  // Answers are consumed in order; the last one repeats, so a one-element list is a
  // printer that stays absent however many times it is asked.
  const agent = (...answers) => {
    seen = [];
    return async (url, opts) => {
      seen.push({ url, cache: opts?.cache });
      const a = answers[Math.min(seen.length - 1, answers.length - 1)];
      if (a instanceof Error) throw a;
      return { json: async () => a };
    };
  };
  const build = (fetchImpl) => buildOrStub('psZebraDevice', src,
    ['fetch', 'AbortSignal', 'setTimeout'],
    [fetchImpl, { timeout: () => null }, (f) => f()],
    '{ psZebraDevice, psNoPrinter }');

  const ZD410 = { uid: 'ZTC-50J213311631', name: 'ZTC ZD410-203dpi ZPL', connection: 'usb' };

  {
    const m = build(agent({ printer: [ZD410] }));
    const got = await m.psZebraDevice();
    eq(got.dev?.uid, ZD410.uid, 'a listed printer comes straight back');
    eq(seen.length, 1, '…on ONE call — a warm agent is not made to answer twice');
    eq(seen[0].cache, 'no-store', '…and even the first ask refuses the HTTP cache');
  }

  {
    // The whole point. This is the sequence the floor hit.
    const m = build(agent({ printer: [] }, { printer: [ZD410] }));
    const got = await m.psZebraDevice();
    eq(got.dev?.uid, ZD410.uid,
       '🔑 an agent still enumerating USB gets asked again, and the label prints');
    eq(seen.length, 2, '…which took the second ask');
  }

  {
    const m = build(agent({ printer: [], otherDevices: [{ name: 'a scale' }] }));
    const got = await m.psZebraDevice();
    eq(got.dev, undefined, 'twice empty is reported as no device');
    eq(got.saw.printers, 0, '…carrying the printer count the agent gave');
    eq(got.saw.others, 1, '…and the non-printers, which say the agent is enumerating fine');
    eq(seen.length, 2, '…after asking twice, which is what lets the message say so');
    eq(seen[1].cache, 'no-store', '…and the RETRY is uncached too, or it is not a retry');
  }

  {
    // 🛑 A device the agent lists but gives no uid used to be discarded silently, and the
    // screen then claimed no printer was attached. The agent refusing our write is better
    // evidence than our guess about a field we do not own.
    const m = build(agent({ printer: [{ name: 'ZD410', connection: 'usb' }] }));
    const got = await m.psZebraDevice();
    eq(got.dev?.name, 'ZD410', 'a printer without a uid is offered, not thrown away');
  }

  {
    const m = build(agent({ printer: [null] }));
    const got = await m.psZebraDevice();
    eq(got.dev, undefined, 'a junk entry is not offered as a device');
    eq(got.saw.printers, 1, '…but it IS counted, so the message can say listed-yet-unusable');
  }

  {
    const m = build(agent({}, {}));
    const got = await m.psZebraDevice();
    eq(got.saw.printers, 0, 'an answer with no printer key at all does not throw');
  }

  {
    // The probe throwing means the agent is absent or slow, which psPrint reports
    // separately. Folding it in here would rebuild the blanket catch this feature
    // has already been bitten by twice.
    const boom = Object.assign(new Error('signal timed out'), { name: 'TimeoutError' });
    const m = build(agent(boom));
    let threw = null;
    try { await m.psZebraDevice(); } catch (e) { threw = e; }
    eq(threw?.name, 'TimeoutError', '🛑 a probe that throws still throws — it is a different fault');
  }

  {
    const m = build(agent({ printer: [] }));
    const none = m.psNoPrinter({ printers: 0, others: 0 });
    const some = m.psNoPrinter({ printers: 2, others: 0 });
    ok(/answered twice/.test(none),
       '🔑 the refusal says it asked twice — the fact that makes the next report decisive');
    ok(/powered on/.test(none), '…and only THEN suggests looking at the printer');
    ok(/Restart Browser Print/.test(some),
       'a listed-but-unaddressable device points at the agent, not at the hardware');
    ok(/\b2 printer/.test(some), '…quoting the count, rather than asserting a cause');
    ok(none !== some, 'the two causes do not share a sentence');
    ok(!/\(0 non-printer/.test(none), 'a zero count is left out rather than printed as noise');
  }
}

// ── Printing says which thing failed ───────────────────────────────────────────
// 🛑 CONFIRMED AGAINST A REAL ZD410. Browser Print was installed, running, and reporting
// the printer over GET /available — and the screen still said it was not running, because
// one `catch (_)` wrapped the probe, the missing-device throw and the write alike.
//
// 🔑 THE ACTUAL BUG WAS ONE HEADER. GET /available is a CORS-"simple" request and sails
// through. POST /write with Content-Type: application/json is NOT simple, so the browser
// sends an OPTIONS preflight first, and Browser Print does not answer one for this origin
// — the POST died before it was ever sent. text/plain is safelisted, so no preflight goes
// out; the agent parses the body as JSON either way. Verified in production: json failed,
// text/plain printed the label.
{
  const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  const fn = html.slice(html.indexOf('async function psPrint()'), html.indexOf('window.psPrint = psPrint;'));

  ok(/'Content-Type': 'text\/plain'/.test(fn),
     '🔑 the write posts text/plain, so no CORS preflight is triggered');
  // 🔑 Strip whole-line comments first: they NAME the header and the catch they warn
  // against, so a naive grep matches the explanation and calls it the bug.
  const code = fn.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  ok(!/application\/json/.test(code),
     '🛑 …and application/json is gone from this path entirely — it is what broke it');
  ok(/JSON\.stringify\(\{ device: dev, data:/.test(fn.replace(/\s+/g, ' ')),
     '…while the BODY is still JSON, which is what the agent actually parses');
  ok(/preflight/i.test(fn),
     'the reason is written down, because the header looks wrong to anyone who has not hit this');

  // Each failure names itself. The old message was a confident claim that was simply false.
  const claims = fn.match(/did not answer within|is not answering|Could not send|refused the label/g) || [];
  eq(claims.length, 4, '🔑 four distinct failures here, four distinct sentences');
  ok(/return fail\(psNoPrinter\(probe\.saw\)\)/.test(fn),
     '…and the fifth defers to psNoPrinter, which splits again on what the agent counted');

  // 🛑 THE PROBE FAILURE SPLITS IN TWO, and getting this wrong cost a round trip of its own.
  // I bound `e` in the probe catch and then did not use it, so a slow agent and an absent
  // one produced the same sentence — one says try again, the other says go install
  // software you already have. The browser names them apart; the screen must too.
  ok(/e\?\.name === 'TimeoutError'/.test(fn),
     '🔑 a TimeoutError is told apart from a request that never landed');
  ok(/e\?\.message/.test(fn),
     '🛑 …and the non-timeout branch reports what actually threw, rather than assuming');
  ok(/PS_ZEBRA_PROBE_MS \/ 1000/.test(fn),
     '…quoting the real deadline, so the message cannot drift from the constant');
  ok(!/catch \(_\)/.test(code),
     '🛑 no blanket catch — the one that swallowed three failures into one wrong answer');
  ok(/if \(!r\.ok\)/.test(fn),
     '🛑 a refused label is NOT reported as sent — 2xx is the only evidence it was accepted');
  ok(/r\.status/.test(fn),
     '…and the status is shown, so the failure can be looked up rather than guessed at');

  // Only the success line interpolates into innerHTML; every failure goes through
  // textContent, because some of them carry text straight from the agent.
  const successes = fn.match(/note\.innerHTML/g) || [];
  eq(successes.length, 1, 'only the success message builds HTML');
  ok(/note\.textContent = msg/.test(fn),
     '🛑 …every failure renders as text, since some carry wording from the agent itself');
}

// The probe deadline is a named constant with room for a cold agent.
// 1500ms was measured too tight against the real ZD410: TimeoutError every time, while the
// same probe with no deadline answered 200 with one printer. The agent is there, it is just
// slower than that on a cold call.
{
  const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  const ms = Number((html.match(/const PS_ZEBRA_PROBE_MS = (\d+)/) || [])[1]);
  ok(ms >= 5000, `🔑 the probe allows a cold agent time to answer (got ${ms}ms)`);
  ok(/AbortSignal\.timeout\(PS_ZEBRA_PROBE_MS\)/.test(html),
     '…and the probe uses the constant, not a second copy of the number');
}

// The label geometry, now that a real printer has been identified.
// The attached unit reports as "ZTC ZD410-203dpi ZPL", so 203 dots is one inch and a
// 1x1 sticker is exactly ^PW203 / ^LL203. Pinned because a 300dpi unit would need 300,
// and the symptom (a label two thirds the intended size) is easy to misread as a
// media or driver problem rather than as these two numbers.
{
  const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  // 🛑 Bound this on psZpl's OWN closing brace, not on whatever comes next. Bounding it on
  // `async function psZebraDevice(` swept a const declared between the two into the slice,
  // and eval('(' + fn + ')') died on it — a test breaking because unrelated code moved.
  const psZplAt = html.indexOf('function psZpl(');
  const fn = html.slice(psZplAt, html.indexOf('\n  }\n', psZplAt) + 5);
  ok(/\^PW203/.test(fn) && /\^LL203/.test(fn),
     '🔑 203 dots square — one inch on the 203dpi ZD410 this prints to');
}

// ── Sticker numbers are per store ──────────────────────────────────────────────
// 🛑 THE BUG THIS CLOSES SHIPPED AND WAS LIVE. The KV cache key was one string,
// "sticker:category-codes", shared by all six stores — so whichever store swept last owned
// the map and every other store read its numbers. The endpoint compounded it by defaulting
// an absent store to BL1, and the front end never sent one at all. A manager scanning at
// BL4 was therefore answered from BL1's catalogue: it could refuse a code that exists
// locally, or approve one that does not — a sticker that fails at the register in front of
// a customer, which is the single failure this whole feature exists to prevent.
{
  const src = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');

  ok(/const stickerCodesKey = \(store\) => `sticker:category-codes:\$\{store\}`/.test(src),
     '🔑 the cache key carries the store, so one store cannot serve another its map');
  ok(!/get\(STICKER_CODES_KEY/.test(src) && !/put\(STICKER_CODES_KEY/.test(src),
     '…and the shared key is gone from both the read and the write');

  // Resolve-and-validate, executed rather than grepped.
  const vSrc = sliceOrNull(src, 'const stickerStore = (store)',
                           'async function stickerCategoryCodes(');
  ok(vSrc, 'worker.js declares stickerStore — without it there is nothing validating a store');
  const stickerStore = buildOrStub('stickerStore', vSrc,
    ['ALL_STORES'], [['BL1', 'BL2', 'BL4', 'BL8', 'BL14', 'BL16']], 'stickerStore');
  eq(stickerStore('BL4'), 'BL4', 'a real store resolves');
  eq(stickerStore('bl4'), 'BL4', '…case-insensitively');
  eq(stickerStore(' BL4 '), 'BL4', '…and trimmed');
  eq(stickerStore(''), null, '🛑 an ABSENT store is null, never a default');
  eq(stickerStore(undefined), null, '…however it is absent');
  eq(stickerStore('BL99'), null, '🛑 an unknown store is null, not silently accepted');
  eq(stickerStore('BL1; DROP'), null, '…and nothing that is not exactly a store name passes');

  // The endpoint refuses before it does any work on a guess.
  const at = src.indexOf('action") === "sticker-check"');
  // 🛑 Bound on the NEXT handler, not a distant one. Adding sticker-printed between this
  // handler and merch-scan swept its Math.round into the slice and tripped the guard that
  // proves nothing here rounds a price to make a label scan. Same shape as the psZpl slice.
  const h = src.slice(at, src.indexOf('action") === "sticker-printed"', at));
  // Strip whole-line comments first — the comment explaining the fallback necessarily
  // quotes it, so a naive grep matches the explanation and calls it the bug. Third time
  // this has caught me; the rule is match the code, never the prose about the code.
  const hCode = h.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  ok(!/body\?\.store \|\| "BL1"/.test(hCode),
     '🛑 the BL1 fallback is gone — it is what made a BL4 scan read BL1');
  ok(/reason: "no store"/.test(h),
     '…replaced by a named refusal that says to pick one');
  const storeAt = h.indexOf('const store = stickerStore(body?.store)');
  const mapAt = h.indexOf('await stickerCategoryCodes(env, store)');
  ok(storeAt > 0 && mapAt > storeAt,
     '🔑 the store is validated BEFORE the catalogue is read, not after');
}

// 🔑 THE TWO STORE LISTS MUST AGREE, and index.html has drifted from the worker before —
// SC_ALL_STORES a few hundred lines from PS_STORES is still missing BL8. A short list
// refuses a whole store outright; a long one offers a store the worker will reject with
// "no store", which reads as a bug in the picker rather than in the list.
{
  const src = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
  const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  const parse = (m) => m ? m[1].split(',').map(x => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : null;
  const worker = parse(src.match(/const ALL_STORES = \[([^\]]+)\]/));
  const front = parse(html.match(/const PS_STORES = \[([^\]]+)\]/));
  ok(worker && worker.length, 'worker.js declares ALL_STORES');
  ok(front && front.length, 'index.html declares PS_STORES');
  eq((front || []).join(','), (worker || []).join(','),
     '🔑 PS_STORES matches the worker ALL_STORES exactly — order included');
}

// The store is resolved and sent, and never shown.
// 🛑 THERE WAS A PICKER HERE AND A NOTE READING "for BL1". Both were wrong for this
// business: the stores carry the SAME inventory, so which store a check ran against
// changes nothing an associate can act on — while a manager at BL4 reading "BL1"
// reasonably concludes something is misconfigured and goes looking, or "fixes" a system
// that was already right. A detail that cannot be acted on, surfaced in a way that looks
// like a fault, is worse than one not surfaced.
{
  const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  const row = sliceOrNull(html, 'function psStickerStores()', '// 🔑 ASKED AFTER RENDER');
  ok(row, 'index.html resolves a store for the sticker check');

  ok(/allowed\.length === 1/.test(row || ''),
     'a single-store account resolves to its own store');
  ok(/localStorage\.getItem\(PS_STORE_KEY\)/.test(row || '') && /catch \(_\)/.test(row || ''),
     '…a remembered choice still wins, and a private window does not throw');
  ok(/allowed\.includes\(saved\)/.test(row || ''),
     '🛑 a remembered store the account may no longer print for is discarded, not trusted');
  ok(/: allowed\[0\]/.test(row || ''),
     '🔑 and it always resolves to A store — Print is never blocked on an answer we can supply');

  // Nothing about the store reaches the screen.
  ok(!/id="ps-store"/.test(html),
     '🛑 no store picker — it asked a question that changes no answer here');
  ok(!/psStoreChanged/.test(html),
     '…and no handler left behind for a control that no longer exists');
  ok(!/\bfor \$\{psEsc\(a\.store/.test(html),
     '🛑 the note does not name the store — "for BL1" reads as a fault at the other five');
  ok(!/psEsc\(p\.store\)/.test(html),
     '…nor does the reprint list, for the same reason');

  // 🔑 But it is still explicit in the request. This is what fixed the real bug, where one
  // KV entry was shared by all six stores and whichever swept last owned the map — and
  // none of that ever needed a control on screen.
  const chk = sliceOrNull(html, 'async function psStickerCheck(', 'function psStickerFault(');
  ok(/store: psStickerStore\(\)/.test(chk || ''),
     '🔑 the check still SENDS the store — invisible to the user, load-bearing for the cache');
}

// ── Reprinting re-asks the question ────────────────────────────────────────────
// 🔑 THE ROW STORES THE INPUTS, NOT THE ANSWER. sticker_prints keeps store + l3 +
// price_cents — what sticker-check consumes — and `code` only so the list can show what
// came out. A reprint runs the check again from those inputs, so a category renumbered in
// Clover reprints under its NEW number and a code deleted since is refused exactly as a
// fresh scan would be. Replaying the stored code would be one round trip cheaper and would
// eventually put a sticker on a shelf that no longer resolves at the register — the single
// failure this feature exists to prevent, reintroduced by a convenience.
{
  const sql = fs.readFileSync(path.join(repo, 'migration-056.sql'), 'utf8');
  ok(/CREATE TABLE IF NOT EXISTS sticker_prints/.test(sql), 'the migration is additive');
  for (const col of ['store', 'l3', 'price_cents', 'code', 'printed_by', 'printed_at'])
    ok(new RegExp(`\\n  ${col}\\s`).test(sql), `sticker_prints keeps ${col}`);
  ok(/price_cents INTEGER/.test(sql),
     '🛑 cents, not a float — the price is what BOTH $1.50 and the 1_5 in the code come from');
  ok(/CREATE INDEX IF NOT EXISTS idx_sticker_prints_by_user/.test(sql),
     'the only query it serves — my prints, newest first — is indexed');

  const src = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
  const rec = sliceOrNull(src, 'action") === "sticker-printed"', 'action") === "sticker-history"');
  ok(rec, 'worker.js records prints');
  ok(/stickerStore\(body\?\.store\)/.test(rec || ''),
     '🔑 the recorded store is validated, not taken on trust — a bad one poisons every reprint');
  ok(/Math\.round\(Number\(body\?\.price\) \* 100\)/.test(rec || ''),
     '…and the price is stored as cents');
  ok(/cents <= 0/.test(rec || ''), '…a zero or negative price is refused, as everywhere else');

  const hist = sliceOrNull(src, 'action") === "sticker-history"', 'POST ?action=merch-scan');
  ok(hist, 'worker.js lists them');
  ok(/WHERE printed_by = \?/.test(hist || ''),
     '🔑 scoped to the caller — reprinting someone else’s label is for a shelf you are not at');
  ok(/ORDER BY printed_at DESC LIMIT \?/.test(hist || ''), '…newest first, and bounded');
  ok(/Math\.min\(Math\.max\(parseInt/.test(hist || ''),
     '…with the limit clamped, so a crafted query cannot ask for the whole table');

  // Both actions must be classified, or the gate 403s them on first production use — which
  // is exactly what happened to sticker-check in #162.
  ok(/\["sticker-printed", "bl"\]/.test(src) && /\["sticker-history", "bl"\]/.test(src),
     '🛑 both actions are classified in ACTION_BUSINESS');
}

{
  const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  const rp = sliceOrNull(html, 'async function psReprint(i)', 'window.psReprint = psReprint;');
  ok(rp, 'index.html defines psReprint');
  ok(/action=sticker-check/.test(rp || ''),
     '🔑 a reprint runs the SAME check — every refusal a fresh scan gives, it gives too');
  ok(/l3: p\.l3, price: p\.price, store: p\.store/.test(rp || ''),
     '…from the stored INPUTS, so a renumbered category reprints under its new number');
  ok(/!a\.printable/.test(rp || ''),
     '🛑 …and prints only what comes back printable');
  ok(/psZpl\(a\.code, p\.price, \{ retail: p\.retail, categoryCode: a\.category_code \}, psTpl\)/.test(String(rp || '').replace(/\s+/g, ' ')),
     '🛑 the label carries the code the check JUST returned, never the stored one -- and the '
     + 'STORED street price, so a reprint is the same label the shelf already has');
  ok(/'Content-Type': 'text\/plain'/.test(rp || ''),
     '…and posts text/plain, so it does not trip the CORS preflight the main path already hit');
  ok(/if \(!w\.ok\)/.test(rp || ''), '…and a refused write is not reported as reprinted');

  const rec = sliceOrNull(html, 'async function psRecordPrint(', 'async function psRecentLoad(');
  ok(rec, 'index.html records a print');
  ok(/catch \(_\)/.test(rec || '') && /not worth an alarm/.test(rec || ''),
     '🔑 recording is best-effort — the label is already out, so a failed row is not a failed print');

  // The panel must survive a scan, because not scanning is the entire point of it.
  // 🛑 ASSERT THE PROPERTY, NOT A SNAPSHOT OF THE MARKUP. This pinned the literal
  // string `<div id="ps-recent" class="hidden"></div>` and broke the moment the hiding
  // mechanism changed -- while never once testing the containment it is named after.
  // #ps-result is empty in source (psRender owns its contents and wipes them wholesale),
  // so anything after that closing tag is a sibling of it rather than a child.
  const resAt = html.indexOf('<div id="ps-result"></div>');
  const recAt = html.indexOf('<div id="ps-recent"');
  ok(resAt > 0, '#ps-result is empty in source -- psRender fills and clears it wholesale');
  ok(recAt > resAt, '🔑 the list lives OUTSIDE #ps-result, which every scan wipes');
  ok(/psRecentLoad\(\);\n\s*setTimeout/.test(html),
     '…and loads with the page, not with a result');
  ok(!/merchLabel\(/.test(sliceOrNull(html, 'function psRecentRender()', 'function psRecentWhen') || ''),
     '🛑 no merchLabel here — it is worker-side, and calling it would throw on every row');
}

// ── 🛑 A PAGE THAT DOES NOT PRINT THE BARCODE IS NOT ABOUT IT ──────────────
// Live, 2026-09-02: three barcodes no allowlisted retailer indexes (062338995038,
// 895697005724, 019200780513) did not come back empty. The provider returned its nearest
// page on an allowed domain — Walmart's employee intranet, one.walmart.com — and its
// title, "own-your-wellbeing - One Walmart portal", was cached as the product name. Every
// rescan then re-priced the intranet for a Firecrawl credit, and identity never ran again.
{
  const realFetch = globalThis.fetch;
  const searchQueries = [];
  globalThis.fetch = async (u, init) => {
    const url = String(u);
    if (url.startsWith('https://api.search.tinyfish.ai')) {
      searchCalls++;
      searchQueries.push(decodeURIComponent(url));
      return new Response(JSON.stringify({ results: [
        { position: 1, url: 'https://one.walmart.com/content/uswire/en_us/me/health/health-programs/own-your-wellbeing.html',
          title: 'own-your-wellbeing - One Walmart portal',
          snippet: "Your apps and work related links will be available next time you're back on." },
        // The same kind of page on the PUBLIC host: the host block is not what saves this,
        // the missing number is.
        { position: 2, url: 'https://www.walmart.com/content/uswire/en_us/me/health.html',
          title: 'Health - One Walmart', snippet: 'Walmart policies. Click "MANAGE" to personalize your snapshots' },
      ] }), { status: 200 });
    }
    if (url.includes('api.anthropic.com')) {
      modelCalls++;
      return new Response(JSON.stringify({ content: [{ type: 'text', text: '{"items":[],"rows":[],"prices":[]}' }] }), { status: 200 });
    }
    return realFetch(u, init);
  };
  const before = searchCalls;
  const r = await post('merch-scan', { identifier: '062338995038' }, 'u-mgr1');
  eq(r.status, 200, 'a barcode the provider can only guess at still answers');
  eq(r.body.title, null, '🛑 …and the intranet page title is NOT the product name');
  ok((r.body.flags || []).includes('barcode not recognised'), '🔑 it says the code was not recognised');
  eq(searchCalls - before, 2, '🔑 two identity spellings, and NO price search on a page title');
  ok(!searchQueries.some(q => /wellbeing|portal/i.test(q)), '🛑 the page title is never searched as a product');
  eq(db.prepare(`SELECT COUNT(*) n FROM item_cache WHERE identifier='062338995038'`).get().n, 0,
     '🔑 nothing is cached, so the next scan tries again instead of inheriting junk');
  globalThis.fetch = realFetch;

  // The hosts themselves are also out, wherever they turn up.
  const wsrc = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
  const hb = sliceOrNull(wsrc, 'const RETAIL_HOST_BLOCK =', '\n');
  const hf = sliceOrNull(wsrc, 'function retailHostAllowed(url, domains) {', '\n}\n');
  const allowed = buildOrStub('retailHostAllowed', (hb || '') + '\n' + (hf || '') + '\n}', [], [], 'retailHostAllowed');
  eq(allowed('https://one.walmart.com/content/uswire/en_us/me/health.html', ['walmart.com']), false,
     '🛑 the employee intranet is not a retailer');
  eq(allowed('https://wlfc.walmart.com/content/usone/en_us/me/health.html', ['walmart.com']), false, '…nor its other host');
  eq(allowed('https://www.walmart.com/ip/RID-X-Platinum/995791537', ['walmart.com']), true, '…while the store still is');
}

// ── 🛑 THE NORMALISER SAYING "NO PRODUCT HERE" IS THE ANSWER, NOT A FALLBACK ─
// "Item #61854 (00518HDHY)" was cached as the product name for 032187618549 because the
// normaliser declined and the raw page title was used instead. A page that prints the
// barcode but whose title has no product in it is still not a product.
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, init) => {
    const url = String(u);
    if (url.startsWith('https://api.search.tinyfish.ai')) {
      searchCalls++;
      return new Response(JSON.stringify({ results: [
        { position: 1, url: 'https://www.publix.com/pd/item-61854/RIO-PDET-123',
          title: 'Item #61854 (00518HDHY)', snippet: 'UPC 032187618549 · see store for details' },
      ] }), { status: 200 });
    }
    if (url.includes('api.anthropic.com')) {
      modelCalls++;
      return new Response(JSON.stringify({ content: [{ type: 'text', text: '{"items":[],"rows":[],"prices":[]}' }] }), { status: 200 });
    }
    return realFetch(u, init);
  };
  const r = await post('merch-scan', { identifier: '032187618549' }, 'u-mgr1');
  eq(r.status, 200, 'the scan answers');
  eq(r.body.title, null, '🛑 a title the normaliser found no product in is not used raw');
  ok((r.body.flags || []).includes('barcode not recognised'), '…and it reads as an unrecognised code');
  eq(db.prepare(`SELECT COUNT(*) n FROM item_cache WHERE identifier='032187618549'`).get().n, 0, '…with nothing cached');
  globalThis.fetch = realFetch;
}

// ── 🛑 THE LAST DIGIT IS A CHECKSUM ────────────────────────────────────────
// RID-X Platinum is 019200780513. Retyped as 019200780511 — one digit off — it was
// accepted on length alone, the search fuzzy-matched it, and RID-X was cached under a
// barcode that cannot exist. Both doors now refuse it.
{
  const r = await post('merch-scan', { identifier: '019200780511' }, 'u-mgr1');
  eq(r.status, 400, '🛑 a UPC whose check digit does not add up is refused');
  eq(r.body.code, 'BAD_BARCODE', '…with the code the screen already acts on');
  ok(/digit/i.test(r.body.error) && !/an EAN is 13/.test(r.body.error), '…and says a DIGIT is wrong, not the length');
  eq(db.prepare(`SELECT COUNT(*) n FROM item_cache WHERE identifier='019200780511'`).get().n, 0, '…and nothing is stored under it');

  // The real code, its 13-digit spelling, a true EAN-13 and an 8-digit code all pass.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, init) => {
    if (String(u).startsWith('https://api.search.tinyfish.ai')) { searchCalls++; return new Response('{"results":[]}', { status: 200 }); }
    if (String(u).includes('api.anthropic.com')) { modelCalls++; return new Response(JSON.stringify({ content: [{ type: 'text', text: '{}' }] }), { status: 200 }); }
    return realFetch(u, init);
  };
  for (const code of ['019200780513', '0019200780513', '4006381333931', '01234565'])
    eq((await post('merch-scan', { identifier: code }, 'u-mgr1')).status, 200, `${code} checks out`);
  globalThis.fetch = realFetch;

  // 🔑 The screen runs the SAME function, so a mistyped digit never costs a round trip.
  const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  const wsrc = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
  const grab = (src) => (src.match(/function gtinCheckOk\(d\) \{[\s\S]*?\n\s*\}/) || [null])[0];
  const wf = grab(wsrc), hf = grab(html);
  ok(wf && hf, 'gtinCheckOk exists in both worker.js and index.html');
  eq((hf || '').replace(/\s+/g, ' ').trim(), (wf || '').replace(/\s+/g, ' ').trim(),
     '🔑 the screen and the worker check digits IDENTICALLY');
  const check = buildOrStub('gtinCheckOk (index.html)', hf, [], [], 'gtinCheckOk');
  eq(check('019200780511'), false, 'the screen refuses the retyped RID-X');
  eq(check('019200780513'), true, '…and accepts the real one');
  eq(check('062338995038'), true, '…and the Air Wick refill');
  eq(check('01234565'), true, '…and leaves 8 digits alone');
  ok(/gtinCheckOk\(digits\)/.test(sliceOrNull(html, 'async function psScan()', 'window.psScan') || ''),
     '🔑 …and psScan actually calls it before the round trip');
}

// ── The editor, driven the way a person drives it ────────────────────────────
// 🛑 TWO BUGS SHIPPED THAT NO GREP-SHAPED TEST COULD SEE, and both read to the user as
// "the template isn't saving":
//   1. stSet called stDraw on every oninput. stDraw assigns #st-fields innerHTML, which
//      destroys the input the caret is in -- so typing "113" into a box landed a 1 and threw
//      the rest away. Every assertion about the SAVE PAYLOAD passed; the payload was fine.
//      What was broken was that the number never got into it.
//   2. After "Save as new", the editor picked which template to show from `active`. A new
//      template is not necessarily the active one, so the screen swapped to the OTHER
//      template while reporting "Saved" -- the work was on the server and gone from view.
// The only test that catches either is one that types and clicks. So: run the editor.
{
  const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  const editorSrc = sliceOrNull(html, '  const ST_ROWS = [', '  window.stTest = stTest;');
  ok(editorSrc, 'the editor block is extractable');
  const pa = html.indexOf('  function psZpl(code, price, extras, tpl) {');
  const psZplSrc = html.slice(pa, html.indexOf('\n  }\n', pa) + 4);

  const DEF = { v: 1, fields: {
    qr:     { on: true,  x: 104, y: 10,  mag: 4 },
    mark:   { on: true,  x: 12,  y: 18,  h: 74, w: 74, font: '0', text: '$', mode: 'text' },
    code:   { on: true,  x: 10,  y: 116, h: 20, w: 20, font: '0' },
    price:  { on: true,  x: 10,  y: 142, h: 54, w: 54, font: '0' },
    retail: { on: false, x: 10,  y: 96,  h: 18, w: 18, font: '0', prefix: 'Compare at ' } } };

  // A KV-shaped stand-in for the worker: it stores, it answers, and it reports savedId the
  // way the real handler does. It deliberately does NOT clamp -- clamping is tested against
  // the real validator elsewhere, and mixing the two would hide which half broke.
  let store = { active: null, items: [] }, nextId = 1;
  const writes = [];
  const fakeFetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('sticker-template-set')) {
      const body = JSON.parse(opts.body);
      const op = body.op || 'save';
      let savedId = null;
      if (op === 'save') {
        const at = store.items.findIndex(t => t.id === String(body.id || ''));
        const fields = JSON.parse(JSON.stringify(body.fields));
        if (at >= 0) { store.items[at] = { ...store.items[at], name: body.name, fields }; savedId = store.items[at].id; }
        else {
          const fresh = { id: 't' + (nextId++), name: body.name, fields };
          store.items.push(fresh); savedId = fresh.id;
          if (!store.active) store.active = fresh.id;
          if (body.activate) store.active = fresh.id;
        }
      } else if (op === 'activate') { store.active = body.id; savedId = body.id; }
      const active = store.items.find(t => t.id === store.active) || null;
      return { ok: true, status: 200, json: async () => ({
        ok: true, active: store.active, savedId, template: active, items: store.items,
        templates: store.items.map(t => ({ id: t.id, name: t.name })), defaults: DEF }) };
    }
    if (u.includes('sticker-template')) {
      const active = store.items.find(t => t.id === store.active) || null;
      return { ok: true, status: 200, json: async () => ({
        ok: true, active: store.active, template: active, markImage: null, defaults: DEF,
        templates: store.items.map(t => ({ id: t.id, name: t.name })),
        limits: { maxTemplates: 10, markMaxSide: 150, markMaxBytes: 1600 } }) };
    }
    if (u.includes('9100/write')) { writes.push(JSON.parse(opts.body)); return { ok: true, status: 200 }; }
    throw new Error('unexpected fetch ' + u);
  };

  const node = () => ({ innerHTML: '', textContent: '', className: '', value: '' });
  const nodes = {};
  for (const id of ['st-bar', 'st-fields', 'st-preview', 'st-warn', 'st-status', 'st-file', 'st-cut']) nodes[id] = node();
  const ctx = {
    el: (id) => nodes[id] || null,
    psEsc: (v) => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    document: { createElement: () => { throw new Error('no canvas here'); } },
    uiConfirm: async () => true,
    WORKER_BASE: 'https://worker.test',
    window: {},
    fetch: fakeFetch,
    AbortSignal: { timeout: () => null },
    psZebraDevice: async () => ({ dev: { name: 'ZD410' } }),
    psNoPrinter: () => 'no printer',
    PS_ZEBRA_PROBE_MS: 5000,
  };
  const names = Object.keys(ctx);
  const api = buildOrStub('the editor', `${psZplSrc}\n${editorSrc}`, names, names.map(n => ctx[n]),
    '{ get stTpl(){return stTpl}, stLoad, stTest, window }');
  const flush = () => new Promise(r => setTimeout(r, 0));

  await api.stLoad();
  ok(api.stTpl && api.stTpl.fields, 'the editor loads a template to edit');

  // 🛑 THE WORKER ACCEPTING 3 IS USELESS IF THE BOX WILL NOT TAKE IT. These are two
  // independent floors and only one of them was moved for a long minute; a number input with
  // min="4" refuses 3 in the browser before any request is made.
  ok(/min="3" max="8"[^>]*stSet\('qr','mag'/.test(nodes['st-fields'].innerHTML),
     '🛑 the QR magnification box accepts 3, matching the worker');
  ok(/Size \(3–8\)/.test(nodes['st-fields'].innerHTML), '…and its label says so');

  // 1. TYPE. A browser fires oninput with the box's running value, and only while the box
  // still exists. Rebuilding #st-fields mid-word is what ate the other two characters.
  let alive = true, typed = '';
  for (const ch of '113') {
    if (!alive) break;
    typed += ch;
    const real = nodes['st-fields'];
    let rebuilt = false;
    nodes['st-fields'] = { get innerHTML() { return real.innerHTML; },
                           set innerHTML(v) { rebuilt = true; real.innerHTML = v; },
                           textContent: '', className: '', value: '' };
    api.window.stSet('qr', 'x', typed);
    nodes['st-fields'] = real;
    if (rebuilt) alive = false;
  }
  eq(api.stTpl.fields.qr.x, 113, '🛑 typing a three-digit coordinate lands all three digits');

  // …and dragging the threshold must not replace the slider under the finger either.
  {
    const real = nodes['st-fields'];
    let rebuilt = false;
    nodes['st-fields'] = { get innerHTML() { return real.innerHTML; },
                           set innerHTML(v) { rebuilt = true; real.innerHTML = v; },
                           textContent: '', className: '', value: '' };
    api.window.stCutSet(90);
    nodes['st-fields'] = real;
    eq(rebuilt, false, '🛑 the threshold slider is not destroyed mid-drag');
    ok(/90/.test(nodes['st-cut'].textContent), '…and its reading updates in place');
  }

  // 2. SAVE THE FIRST ONE.
  api.window.stNameSet('Big price');
  await api.window.stSave(); await flush();
  eq(api.stTpl.name, 'Big price', 'the first template saves and stays on screen');
  eq(api.stTpl.fields.qr.x, 113, '…carrying the number that was typed');
  ok(api.stTpl.id, '…and comes back with an id');

  // 3. SAVE A SECOND ONE WHILE THE FIRST IS IN USE. This is the case that broke.
  api.window.stPick('');
  api.window.stSet('price', 'y', 40);
  api.window.stNameSet('With mascot');
  await api.window.stSave(); await flush();
  eq(api.stTpl.name, 'With mascot', '🛑 "Save as new" leaves the NEW template on screen…');
  eq(api.stTpl.fields.price.y, 40, '…with the edit that was just made…');
  eq(store.items.length, 2, '…and both templates exist on the server');
  eq(store.active, store.items[0].id, '…while the one in use is untouched, as asked');
  ok(/Saved/.test(nodes['st-status'].textContent), '…and it says so');

  // 4. PRINT A TEST LABEL. It prints what is ON SCREEN, not what is active.
  writes.length = 0;
  await api.stTest();
  eq(writes.length, 1, 'the test label reaches Browser Print');
  const zpl = writes[0] ? writes[0].data : '';
  ok(/\^FO10,40\^A0N,54,54\^FD\$2\.50\^FS/.test(zpl),
     '🔑 …drawn from the template on screen, not the one in use');
  ok(zpl.startsWith('^XA') && zpl.trim().endsWith('^XZ'), '…and it is a framed job');
}

// ── The code line can be shortened; the QR never is ──────────────────────────
// 🛑 THE WHOLE RISK OF THIS OPTION IS SHORTENING THE WRONG THING. What a person reads and
// what the register reads come off the same variable, one line apart, and an option that
// trimmed both would still LOOK right on the label — it would just stop scanning at a till.
// So every case below re-checks the ^BQ payload, not only the text field.
{
  const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  const at = html.indexOf('function psZpl(');
  const psZpl = eval('(' + html.slice(at, html.indexOf('\n  }\n', at) + 5).replace(/\n\s*\/\/[^\n]*/g, '') + ')');
  const CODE = 'BL-50008-2_5';
  const qrOf = (z) => (z.match(/\^BQN,2,\d+\^FDLA,([^\^]*)\^FS/) || [])[1];
  const codeLine = (z) => (z.split('\n').find(l => /\^FO10,116\^A0N,20,20/.test(l)) || '');

  const full = psZpl(CODE, 2.5, { categoryCode: '50008' }, null);
  eq(qrOf(full), CODE, 'the QR carries the whole key by default');
  ok(codeLine(full).includes(`^FD${CODE}^FS`), '…and the printed line does too');

  const short = psZpl(CODE, 2.5, { categoryCode: '50008' },
                      { fields: { code: { on: true, show: 'number' } } });
  ok(codeLine(short).includes('^FD50008^FS'), '🔑 show:number prints only the category number');
  ok(!codeLine(short).includes('BL-'), '…with none of the key left on the line');
  eq(qrOf(short), CODE, '🛑 …and the QR STILL carries the whole key — the register is untouched');

  // 🛑 A MISSING NUMBER MUST DEGRADE TO THE FULL CODE, NOT TO NOTHING. A caller that does
  // not pass one -- a path not updated, an older worker response -- would otherwise print an
  // empty field or the literal "undefined" on a shelf label, and neither is recoverable by
  // the person holding it. The long code always works.
  const orphan = psZpl(CODE, 2.5, {}, { fields: { code: { on: true, show: 'number' } } });
  ok(codeLine(orphan).includes(`^FD${CODE}^FS`), '🛑 no number supplied falls back to the full code');
  ok(!/undefined|\^FD\^FS/.test(orphan), '…never "undefined" and never an empty field');
  eq(qrOf(psZpl(CODE, 2.5, {}, { fields: { code: { on: false, show: 'number' } } })), CODE,
     'and turning the printed line off entirely still leaves the QR whole');

  // The number is handed over as a value, never re-derived from the string. The price
  // segment has three shapes and the third carries no separator at all, so a split on
  // dashes would work until somebody priced something at a round dollar.
  const round = psZpl('BL-50008-10', 10, { categoryCode: '50008' },
                      { fields: { code: { on: true, show: 'number' } } });
  ok(codeLine(round).includes('^FD50008^FS'),
     '🛑 a round-dollar code (no underscore at all) shortens correctly too');
  eq(qrOf(round), 'BL-50008-10', '…and its QR is intact');
}

// ── The worker validates `show`, and the two defaults still agree ────────────
{
  const worker = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
  const grab = (re, what) => { const m = worker.match(re); ok(m, `${what} is extractable`); return m ? m[0] : ''; };
  const decls = [
    grab(/const STICKER_LABEL_DOTS = [\s\S]*?\n/, 'STICKER_LABEL_DOTS'),
    grab(/const STICKER_QR_MIN_MAG = [\s\S]*?\n/, 'STICKER_QR_MIN_MAG'),
    grab(/const STICKER_QR_MAX_MAG = [\s\S]*?\n/, 'STICKER_QR_MAX_MAG'),
    grab(/const STICKER_TEXT_MIN = [\s\S]*?\n/, 'STICKER_TEXT_MIN'),
    grab(/const STICKER_TEXT_MAX = [\s\S]*?\n/, 'STICKER_TEXT_MAX'),
    grab(/const STICKER_FONTS = new Set\(\[[\s\S]*?\]\);/, 'STICKER_FONTS'),
    grab(/const STICKER_TEMPLATE_DEFAULT = Object\.freeze\(\{[\s\S]*?\n\}\);/, 'defaults'),
    grab(/const stickerInt = [\s\S]*?\n\};/, 'stickerInt'),
    grab(/const stickerText = [\s\S]*?\n\};/, 'stickerText'),
    grab(/function sanitizeStickerTemplate\(body\) \{[\s\S]*?\n\}/, 'sanitizeStickerTemplate'),
  ].join('\n');
  const clean = new Function(`${decls}; return sanitizeStickerTemplate;`)();

  eq(clean({}).tpl.fields.code.show, 'full', 'the stock label still prints the whole code');
  eq(clean({ fields: { code: { show: 'number' } } }).tpl.fields.code.show, 'number', 'number is accepted');
  // 🛑 An unknown value must fall back to the LONG form. Falling back to "number" would let
  // a typo silently shorten every label in the chain.
  eq(clean({ fields: { code: { show: 'nmber' } } }).tpl.fields.code.show, 'full',
     '🛑 a typo falls back to the full code, never to the short one');
  eq(clean({ fields: { code: { show: { evil: 1 } } } }).tpl.fields.code.show, 'full',
     '…and so does a non-string');
  // `show` belongs to the code field alone — it is not a general text-field property.
  eq(clean({ fields: { price: { show: 'number' } } }).tpl.fields.price.show, undefined,
     'show is not silently accepted on other fields');

  // The editor offers it, and offers only the two the worker will store.
  const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  const editor = sliceOrNull(html, '  const ST_ROWS = [', '  window.stTest = stTest;') || '';
  const offered = [...editor.matchAll(/stSet\('code','show'[\s\S]{0,400}?<\/select>/g)]
    .flatMap(m => [...m[0].matchAll(/<option value="(\w+)"/g)].map(o => o[1]));
  eq(offered.sort().join(','), 'full,number', '🛑 the editor offers exactly the values the worker accepts');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
