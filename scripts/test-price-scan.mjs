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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
