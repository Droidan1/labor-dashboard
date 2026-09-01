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

  const scanned = await post('merch-scan', { identifier: '012345679900', description: 'Some snack bag' });
  eq(scanned.body.l3, SNACKS, '…and a barcode still works exactly as before');
  // The barcode path ALSO caches, so the next scan of it is free; a typed name cannot.
  const row = db.prepare(`SELECT l3 FROM item_cache WHERE identifier='012345679900'`).get();
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
      if (/038000293100/.test(q)) {
        return new Response(JSON.stringify({ results: [
          { position: 1, url: 'https://world.openfoodfacts.org/product/x', title: 'Pringles Everything Bagel – 5.5oz', snippet: 'Pringles 5.5oz' },
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

  const r = await post('merch-scan', { identifier: '038000293100' });
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
      if (/038000293133/.test(q)) {
        return new Response(JSON.stringify({ results: [
          { position: 1, url: 'https://world.openfoodfacts.org/product/y', title: 'Pringles Ranch – 5.5oz', snippet: 'Pringles 5.5oz' },
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

  const r = await post('merch-scan', { identifier: '0038000293133' });
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
          { position: 1, url: 'https://world.openfoodfacts.org/product/z', title: 'Test Beans 16oz', snippet: 'Brands: Testco' },
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
  add('090000000011', 'Bench Scanned Crisps', 'Benchco');
  add('090000000022', 'Manifest Only Beans', 'Loadco');
  // The ONLY thing that makes a row "from a manifest" is a manifest line pointing at it.
  db.prepare(`INSERT INTO manifests (id,vendor,uploaded_at,sell_as,units_per_case,status)
              VALUES ('pmf','V','2026-08-20T00:00:00Z','each',1,'draft')`).run();
  db.prepare(`INSERT INTO manifest_lines (manifest_id,row_no,identifier,identifier_type,description,qty,cost,flags)
              VALUES ('pmf',1,'090000000022','upc','MANIFEST BEANS',10,1.0,'[]')`).run();

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
  ok(ids(asAdmin.body).includes('090000000011'), '🔑 a bench-scanned item is under Scanned');
  ok(!ids(asAdmin.body).includes('090000000022'), '…and a manifest item is NOT');
  const mf = await get('merch-products&tab=manifest', 'u-admin');
  ok(ids(mf.body).includes('090000000022'), '🔑 …while it IS under Manifests');
  ok(!ids(mf.body).includes('090000000011'), '…and the bench item is not');
  ok(asAdmin.body.counts.scanned > 0 && mf.body.counts.manifest > 0, 'both tabs carry a count');

  // Search reaches the barcode as well as the words, because that is what is on the box.
  ok(ids((await get('merch-products&tab=scanned&q=Benchco', 'u-admin')).body).includes('090000000011'), 'search finds a brand');
  ok(ids((await get('merch-products&tab=scanned&q=090000000011', 'u-admin')).body).includes('090000000011'), '…and a barcode');
  eq(((await get('merch-products&tab=scanned&q=zzzznope', 'u-admin')).body.rows || []).length, 0, '…and finds nothing when there is nothing');

  // ── editing ──
  eq((await post('merch-product-save', { identifier: '090000000011', title: 'X' }, 'u-mgr1')).status, 403,
     '🛑 a manager may not edit');
  const saved = await post('merch-product-save',
    { identifier: '090000000011', title: 'Bench Crisps, Salted', l3: CANNED, retail_price_override: '2.25' }, 'u-admin');
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
    { identifier: '090000000011', retail_price_override: '' }, 'u-admin');
  eq(cleared.body.row.retail_price_override, null, '🔑 a blank price CLEARS the override');
  eq(cleared.body.row.title, 'Bench Crisps, Salted', '…and a field not sent is left alone');
  eq(cleared.body.row.retail_override_by, null, '…and the attribution goes with it');

  // ── refusals ──
  eq((await post('merch-product-save', { identifier: '090000000011', l3: 'NOT A REAL CATEGORY' }, 'u-admin')).status, 400,
     '🛑 a category we do not use is refused, not stored');
  eq((await post('merch-product-save', { identifier: '090000000011', retail_price_override: 'abc' }, 'u-admin')).status, 400,
     '🛑 …and so is a price that is not a number');
  eq((await post('merch-product-save', { identifier: '099999999999', title: 'ghost' }, 'u-admin')).status, 404,
     'editing a product we have never seen is a 404, not a silent insert');

  // 🔑 The 13-digit spelling of a barcode edits the SAME row as the 12 — the canonical
  // form is applied here too, or an edit would create a phantom that nothing reads.
  const viaLong = await post('merch-product-save', { identifier: '0090000000011', size: '14oz' }, 'u-admin');
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
        if (/038000299000/.test(q)) {
          return new Response(JSON.stringify({ results: [
            { position: 1, url: 'https://world.openfoodfacts.org/p/x', title: 'Testo Beans 16oz', snippet: 'Brands: Testo' }]}), { status: 200 });
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
    const r = await post('merch-scan', { identifier: '038000299000' });
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
      if (/0?12345600001/.test(q)) {
        return new Response(JSON.stringify({ results: [
          { position: 1, url: 'https://world.openfoodfacts.org/p/c', title: "Nature's Truth Collagen 60 ct", snippet: "Nature's Truth" }]}), { status: 200 });
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

  const r = await post('merch-scan', { identifier: '012345600001' });
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
      if (/0?12345600002/.test(q)) {
        return new Response(JSON.stringify({ results: [
          { position: 1, url: 'https://world.openfoodfacts.org/p/z', title: 'Listy Soap 4 oz', snippet: 'Brands: Listy' }]}), { status: 200 });
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
  const r = await post('merch-scan', { identifier: '012345600002' });
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
        { url: 'https://www.walmart.com/ip/Fresh-Item/1', title: 'Fresh Item 12 oz', snippet: '$4.00' },
      ] }), { status: 200 });
    }
    if (url.includes('api.anthropic.com')) {
      modelCalls++;
      return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({
        title: 'Fresh Item', brand: 'Fresh', size: '12 oz',
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
        { url: 'https://www.target.com/p/prov-item', title: 'Prov Item 6 ct', snippet: '$12.00' },
      ] }), { status: 200 });
    }
    if (url.includes('api.anthropic.com')) {
      modelCalls++;
      return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({
        title: 'Prov Item', brand: 'Prov', size: '8 oz',
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
