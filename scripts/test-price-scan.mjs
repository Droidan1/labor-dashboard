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

const SNACKS = 'FG BL CONSUMABLES - FOOD - SNACKS';

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
  eq((await post('merch-scan', { identifier: '111' }, 'u-mgr1')).status, 200, 'a manager may scan');
  eq((await post('merch-scan', { identifier: '111' }, 'u-staff')).status, 403, 'staff may not, yet');
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

  // The measured total, so the schedule cannot drift from the thing it describes.
  const total = api.psStages('barcode').reduce((n, s2) => n + s2[1], 0);
  ok(total > 15000 && total < 22000, `the schedule adds up to the measured ~17s (${(total / 1000).toFixed(1)}s)`);

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
