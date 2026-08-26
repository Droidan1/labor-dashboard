// The retail lookup (R1–R8), driven through the real endpoint with TinyFish and Claude
// stubbed at the network boundary.
//
// Every rule here exists because a real lookup produced a WRONG NUMBER on Aug 19. The
// tests are those failures, pinned:
//
//   R1 snippet-first — a page fetch is the exception, not the plan (cost control).
//   R2 basis is first-class — half the prices came from multipacks; a per-unit price
//      without the divisor is out by the pack size.
//   R3 seller check, not just a domain filter — walmart.com hosted marketplace sellers
//      at 3–5× real retail (the Yardley line).
//   R4 in-stock beats listed — Dove 50ct at $6.63 OOS vs an in-stock 30ct implying
//      $3.78, a 2.9× gap.
//   R5 imports scale by size and never guess — ~40% of the Alliance file.
//   R6 MSRP identifies, street prices — a $399 MSRP microwave sells at $269.
//   R7 a vendor's comp is an input to verify, never to use — Tide claimed $6.00 against
//      a real $3.44–4.88.
//   R8 big-ticket sites 403 plain fetches — that is where the METERED endpoint would be,
//      so it is flagged rather than spent.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, applyMigrationAlters, ctx, req } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
const near = (a, b, m) => ok(a !== null && Math.abs(a - b) < 0.02, `${m} (got ${JSON.stringify(a)}, want ~${b})`);

const worker = await loadWorker(repo);
const { db, env } = makeEnv(repo);
for (const m of ['migration-041.sql','migration-042.sql','migration-043.sql','migration-044.sql','migration-045.sql','migration-046.sql','migration-047.sql'])
  db.exec(fs.readFileSync(path.join(repo, m), 'utf8'));
applyMigrationAlters(db, repo);
env.TINYFISH_API_KEY = 'tf-test';
env.ANTHROPIC_API_KEY = 'sk-test';

// Network stubs, RECORDED so "did we fetch when we didn't need to" is an assertion.
let searches = [], fetches = [], agentCalls = [], crawls = [];
let normalizeCalls = [], priceParsePrompts = [], normalizeReply = [];
let firecrawlBody = null, firecrawlOk = true;
let searchResults = [], snippetPrices = [], pagePrices = null, fetchFails = false;
globalThis.fetch = async (u, init) => {
  const url = String(u);
  if (url.startsWith('https://api.search.tinyfish.ai')) {
    searches.push(decodeURIComponent(url));
    return new Response(JSON.stringify({ results: searchResults }), { status: 200 });
  }
  if (url.startsWith('https://api.fetch.tinyfish.ai')) {
    fetches.push(JSON.parse(init.body));
    if (fetchFails) return new Response('blocked', { status: 403 });
    return new Response(JSON.stringify({ results: (JSON.parse(init.body).urls || []).map(u => ({ url: u, title: 'page', text: 'page text' })) }), { status: 200 });
  }
  if (url.includes('agent.tinyfish.ai')) { agentCalls.push(url); return new Response('{}', { status: 200 }); }
  if (url.startsWith('https://api.firecrawl.dev')) {
    crawls.push(JSON.parse(init.body));
    if (!firecrawlOk) return new Response('{"error":"Payment required"}', { status: 402 });
    return new Response(JSON.stringify({ success: true, data: firecrawlBody || {} }), { status: 200 });
  }
  if (url.includes('api.anthropic.com')) {
    const body = JSON.parse(init.body);
    if (/expand abbreviated/i.test(body.system || '')) {
      normalizeCalls.push(body.messages[0].content);
      return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ items: normalizeReply }) }] }), { status: 200 });
    }
    priceParsePrompts.push(body.messages[0].content);
    const isPage = body.messages[0].content.includes('page text');
    const prices = isPage && pagePrices ? pagePrices : snippetPrices;
    return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ prices }) }] }), { status: 200 });
  }
  throw new Error('unexpected egress: ' + url.slice(0, 60));
};

const call = async (url, opts) => {
  const r = await worker.fetch(req(url, opts), env, ctx);
  const t = await r.text();
  let body; try { body = JSON.parse(t); } catch { body = { _raw: t.slice(0,160) }; }
  return { status: r.status, body };
};
const post = (a, b, user='u-su') => call(`/?action=${a}`, { user, method:'POST', body:b });
const get  = (q, user='u-su') => call(`/?action=${q}`, { user });

// One manifest per scenario, so nothing leaks between rules.
let n = 0;
async function scenario({ desc, upc = null, cost = 1, msrp = null, comp = null, results, snippets, pages = null, blocked = false }) {
  const id = `m${++n}`;
  db.prepare(`INSERT INTO manifests (id,vendor,uploaded_at,sell_as,units_per_case,status) VALUES (?,?,?,'each',1,'draft')`)
    .run(id, 'V', '2026-08-20T00:00:00Z');
  db.prepare(`INSERT INTO manifest_lines (manifest_id,row_no,identifier,identifier_type,description,qty,cost,msrp,vendor_claimed_retail,flags)
              VALUES (?,1,?,?,?,10,?,?,?,'[]')`)
    .run(id, upc, upc ? 'upc' : 'none', desc, cost, msrp, comp);
  searches = []; fetches = []; agentCalls = []; crawls = []; normalizeCalls = []; priceParsePrompts = [];
  searchResults = results; snippetPrices = snippets; pagePrices = pages; fetchFails = blocked;
  const r = await post('manifest-retail', { id });
  const line = db.prepare(`SELECT * FROM manifest_lines WHERE manifest_id=?`).get(id);
  return { r, line, flags: JSON.parse(line.flags || '[]'), id };
}
const RES = (...urls) => urls.map((u,i) => ({ position:i+1, url:u, title:'t', snippet:'s' }));

console.log('Retail lookup (R1–R8)');

// ── The key is required, and its absence is SAID, not silently skipped ──────
{
  const saved = env.TINYFISH_API_KEY; delete env.TINYFISH_API_KEY;
  db.prepare(`INSERT INTO manifests (id,vendor,uploaded_at,status) VALUES ('nokey','V','2026-08-20T00:00:00Z','draft')`).run();
  const r = await post('manifest-retail', { id: 'nokey' });
  eq(r.status, 503, 'with no API key the lookup refuses');
  eq(r.body.code, 'NO_LOOKUP_KEY', '...with a code the page can act on');
  ok(/not configured/i.test(r.body.error), '...and says why in words');
  env.TINYFISH_API_KEY = saved;
}

// ── 🛑 include_domains LEAKS — the allowlist is enforced on results too ────
// Not hypothetical. Verified against the live TinyFish API on 2026-08-20: a Tide query
// scoped to five first-party domains returned familydollar, savemart, starmarket,
// homedepot and tide.com as well — and those leaked rows were the ONLY ones whose
// snippets carried prices. None of them is a marketplace, so the marketplace regex lets
// them through. Without the host filter, a grocery site nobody approved sets our retail.
{
  const s = await scenario({ desc: 'Tide Pods 42 ct', upc: '012345678920',
    results: [
      { position:1, url:'https://www.cvs.com/shop/tide-pods-42-ct', title:'Tide PODS 42 ct', snippet:'no price here' },
      { position:2, url:'https://sameday.familydollar.com/store/family-dollar/products/tide', title:'Tide Pods', snippet:'Current price: $16.99' },
      { position:3, url:'https://shop.savemart.com/store/savemart/products/tide', title:'Tide Pods', snippet:'Current price: $13.00' },
      { position:4, url:'https://www.starmarket.com/shop/product-details.tide.html', title:'Tide', snippet:'$15.49' },
      { position:5, url:'https://tide.com/en-us/shop/tide-pods', title:'Tide', snippet:'$18.00' },
    ],
    // The parser would happily read every one of these if they reached it.
    snippets: [
      { url:'https://sameday.familydollar.com/store/family-dollar/products/tide', price:16.99, title:'Tide Pods 42ct', pack:1, in_stock:true },
      { url:'https://shop.savemart.com/store/savemart/products/tide', price:13.00, title:'Tide Pods 42ct', pack:1, in_stock:true },
    ]});
  // Only the cvs.com row survives the host filter, and it carries no price.
  eq(s.line.retail_price, null, '🛑 a price from an unapproved domain is never used');
  // cvs.com IS approved and DID appear in the results, so the item is carried — we just
  // could not read a price off it. Reporting "not at big box" here would be a false
  // negative telling the buyer there is no competition when CVS stocks it.
  ok(s.flags.includes('no price found'),
     '...and says WHY: carried, but no readable first-party price');
  const sent0 = searches[0] || '';
  ok(sent0.includes('include_domains'), 'the allowlist is still sent as a query hint');
  ok(!/familydollar/.test(JSON.stringify(s.line)), 'nothing from the leaked domain reaches the row');
}

// ── The allowlist is EARNED by publishing a real shelf price ────────────────
// Checked live twice. Meijer quotes "$2.39" and a sale price and is in our own markets;
// H-E-B quotes "$2.27 each". Dollar General's product page publishes nothing at all —
// and its search snippets carry "$20.35" for a can Meijer sells at $2.39, which our
// parser would take as gospel and turn into a $10.50 shelf price. A confidently wrong
// number is worse than a missing one, so it stays out however good a comparator it
// looks on paper.
{
  const s2 = await scenario({ desc: 'Pringles Original 5.5 oz', upc: '038000138416',
    results: RES('https://www.meijer.com/shopping/product/pringles/3800013897.html'),
    snippets: [{ url:'https://www.meijer.com/shopping/product/pringles/3800013897.html',
                 price:2.39, title:'Pringles Potato Crisps 5.5 oz', pack:1, in_stock:true, sold_by:'Meijer' }] });
  near(s2.line.retail_price, 2.39, '🔑 Meijer is accepted — it publishes a real shelf price, in our markets');
}
{
  const s3 = await scenario({ desc: 'Pringles Original 5.5 oz', upc: '038000138417',
    results: RES('https://www.dollargeneral.com/p/pringles/38000138430'),
    snippets: [{ url:'https://www.dollargeneral.com/p/pringles/38000138430',
                 price:20.35, title:'Pringles Potato Crisps 5.5 oz', pack:1, in_stock:true }] });
  eq(s3.line.retail_price, null,
     "🛑 Dollar General's $20.35 for a $2.39 can never becomes our retail — the domain is not allowed");
  ok(s3.flags.includes('not at big box'), '...and it reads as no comparison found, not as a price');
}

// ── A subdomain of an approved retailer IS approved ────────────────────────
{
  const s = await scenario({ desc: 'Cereal 12oz', upc: '012345678921',
    results: [{ position:1, url:'https://shop.kroger.com/p/cereal', title:'Cereal', snippet:'$3.49' }],
    snippets: [{ url:'https://shop.kroger.com/p/cereal', price:3.49, title:'Cereal 12oz', pack:1, in_stock:true, sold_by:'Kroger' }] });
  near(s.line.retail_price, 3.49, 'shop.kroger.com counts as Kroger');
}

// ── R1 — snippets answer, so NO page is fetched ────────────────────────────
let pricedId;   // captured, not assumed — inserting a scenario above renumbers them all
{
  const s = await scenario({ desc: 'Chips 8oz', upc: '012345678905',
    results: RES('https://www.target.com/p/chips'),
    snippets: [{ url:'https://www.target.com/p/chips', price:2.49, title:'Chips 8oz', pack:1, in_stock:true }] });
  eq(searches.length, 1, 'one search');
  eq(fetches.length, 0, '🔑 R1 — snippets answered, so nothing was fetched');
  pricedId = s.id;
  near(s.line.retail_price, 2.49, 'the price lands');
  eq(s.line.retail_basis, 'single', 'basis recorded as single');
  // Not high any more, deliberately. "High" now means we saw it on a SHELF; a page that
  // says only "in stock" online, with no store availability, is a weaker answer and reads
  // as one. That is the point of the in-store check.
  eq(s.line.retail_confidence, 'medium', 'in stock online but not confirmed in a store caps at medium');
  ok(!s.flags.includes('no retail'), 'not flagged as unpriced');
}

// ── A MISS NAMES ITSELF: three outcomes, three different answers ───────────
// For a discounter "we found no price" is not one fact. Whether the item is absent from
// big box, present but sold by a third party, or present with a price we failed to read
// changes the buy decision, so each gets its own verdict rather than a shared blank.
{
  const s = await scenario({ desc: 'Obscure import wafer', upc: '8901234567890',
    results: [], snippets: [] });
  eq(s.line.retail_price, null, 'nothing found anywhere leaves no price');
  ok(s.flags.includes('not at big box'),
     '🔑 an item no approved retailer carries is ANSWERED, not left blank');
  ok(!s.flags.includes('no retail'),
     '...and the specific answer is not overwritten by the vague one');
}
{
  // Walmart carries it and the page is first-party — we simply could not read a price.
  // That is our failure, and must not be reported as the item being absent from retail.
  const s = await scenario({ desc: 'Readable at Walmart', upc: '012345678999',
    results: RES('https://www.walmart.com/ip/thing'), snippets: [] });
  eq(s.line.retail_price, null, 'an unreadable page still leaves no price');
  ok(s.flags.includes('no price found'), '...but that is OUR failure, and says so');
  ok(!s.flags.includes('not at big box'),
     '🔑 …and is never reported as absent from big box, which would be a false negative');
}
{
  // A settled miss must leave the queue. The drainer used to look for one literal flag,
  // so a line settled under any NEW reason was re-offered forever.
  const s = await scenario({ desc: 'Another obscure import', upc: '8901234567891',
    results: [], snippets: [] });
  const again = await post('manifest-retail', { id: s.id });
  eq(again.body.remaining, 0, '🔑 a line settled as "not at big box" drains, it does not respin');
}

// ── R2 — a multipack is divided down, and the basis says so ────────────────
{
  const s = await scenario({ desc: 'Soap bar 4 ct', upc: '012345678906',
    results: RES('https://www.walmart.com/ip/soap'),
    snippets: [{ url:'https://www.walmart.com/ip/soap', price:10.39, title:'Soap 6 pack', pack:6, in_stock:true, sold_by:'Walmart.com' }] });
  // $10.39 over a found 6-pack is $1.73 a bar; the LINE is a 4-count, so its retail is
  // $6.93. Quoting $1.73 against a 4-count's cost is the unit mismatch R2 exists to stop.
  near(s.line.retail_price, 6.93, '🔑 R2 — a 6-pack at $10.39 prices our 4-count at $6.93');
  eq(s.line.retail_basis, 'multipack_div_n', 'the basis records that a conversion happened');
  eq(s.line.retail_confidence, 'medium', '...and it caps confidence at medium');
}

// ── 🛑 R3 — a marketplace seller is never a retail price ───────────────────
{
  const s = await scenario({ desc: 'Yardley soap', upc: '012345678907',
    results: RES('https://www.walmart.com/ip/yardley'),
    snippets: [{ url:'https://www.walmart.com/ip/yardley', price:18.99, title:'Yardley', pack:1, in_stock:true,
                 sold_by:'BargainBinSellers LLC' }] });
  eq(s.line.retail_price, null, '🛑 R3 — a third-party seller on a first-party domain is refused');
  ok(s.flags.includes('marketplace only'), '...and the line says why');
  // …and specifically NOT "not at big box": Walmart DOES carry it, the seller is the
  // problem. Collapsing these two would tell a buyer the item has no retail presence.
  ok(!s.flags.includes('not at big box'), '...but is NOT reported as absent from big box');
}

// ── R4 — in stock beats listed, and a wide spread is a conflict ────────────
{
  const s = await scenario({ desc: 'Dove bar', upc: '012345678908',
    results: RES('https://www.target.com/p/dove','https://www.cvs.com/p/dove'),
    snippets: [
      { url:'https://www.target.com/p/dove', price:6.63, title:'Dove 50ct', pack:1, in_stock:false },
      { url:'https://www.cvs.com/p/dove',    price:3.78, title:'Dove 30ct', pack:1, in_stock:true },
    ]});
  near(s.line.retail_price, 3.78, '🔑 R4 — the in-stock price wins over the out-of-stock one');
  ok(s.flags.includes('price conflict'), '...a 1.75× gap is flagged as a conflict');
  eq(s.line.retail_confidence, 'medium', '...and caps confidence');
}

// ── R5 — an import scales by size and is flagged ───────────────────────────
{
  const s = await scenario({ desc: 'Biscuits 12 oz', upc: '8901234567890',
    results: RES('https://www.walmart.com/ip/biscuit'),
    snippets: [{ url:'https://www.walmart.com/ip/biscuit', price:4.00, title:'Biscuits 6 oz', pack:1, size_oz:6, in_stock:true, sold_by:'Walmart' }] });
  near(s.line.retail_price, 8.00, '🔑 R5 — a 6oz at $4 scales to $8 for a 12oz');
  eq(s.line.retail_basis, 'per_oz_scaled', 'the basis records the scaling');
  ok(s.flags.includes('size mismatch'), '...and the line is flagged');
  eq(s.line.retail_confidence, 'low', 'an import priced off a scaled match is low confidence');
}

// ── R6 — MSRP identifies; the street price is what counts ──────────────────
{
  const s = await scenario({ desc: 'Frigidaire microwave', upc: '012345678909', cost: 99.75, msrp: 399,
    results: RES('https://www.bestbuy.com/site/microwave'),
    snippets: [{ url:'https://www.bestbuy.com/site/microwave', price:269, title:'Microwave', pack:1, in_stock:true }] });
  near(s.line.retail_price, 269, '🔑 R6 — street, not the $399 MSRP');
  ok(s.flags.includes('msrp above street'), '...and the gap is surfaced, not hidden');
  ok(searches[0].includes('bestbuy.com'), 'a big-ticket line searches the big-ticket sellers');
  ok(!searches[0].includes('cvs.com'), '...not the drugstore set');
}

// ── R7 — a vendor's comp is contradicted, never used ───────────────────────
{
  const s = await scenario({ desc: 'Tide pods', upc: '012345678910', comp: 6.00,
    results: RES('https://www.target.com/p/tide'),
    snippets: [{ url:'https://www.target.com/p/tide', price:4.88, title:'Tide', pack:1, in_stock:true }] });
  near(s.line.retail_price, 4.88, '🔑 R7 — the found price is used');
  ok(s.flags.includes('comp overstated'), '...and the $6.00 claim is flagged as overstated');
  near(s.line.vendor_claimed_retail, 6.00, 'the claim is kept, to be contradicted');
}

// ── 🛑 R8 — a blocked fetch flags for the metered path, never spends it ────
{
  const s = await scenario({ desc: 'Dishwasher', upc: '012345678911', cost: 250,
    results: RES('https://www.homedepot.com/p/dishwasher'),
    snippets: [], blocked: true });
  eq(agentCalls.length, 0, '🛑 the METERED agent endpoint is never called');
  ok(s.flags.includes('needs agent'), '...the line is flagged for it instead');
  eq(s.line.retail_price, null, '...and stays unpriced rather than guessed');
}

// ── The cache means the same product is never looked up twice ──────────────
{
  const first = await scenario({ desc: 'Cereal 18oz', upc: '012345678912',
    results: RES('https://www.kroger.com/p/cereal'),
    snippets: [{ url:'https://www.kroger.com/p/cereal', price:3.99, title:'Cereal', pack:1, in_stock:true }] });
  eq(searches.length, 1, 'the first lookup searches');
  const again = await scenario({ desc: 'Cereal 18oz', upc: '012345678912',
    results: RES('https://www.kroger.com/p/cereal'),
    snippets: [{ url:'https://www.kroger.com/p/cereal', price:9.99, title:'Cereal', pack:1, in_stock:true }] });
  eq(searches.length, 0, '🔑 the second manifest carrying it searches ZERO times');
  near(again.line.retail_price, 3.99, '...and reuses the cached price, not the new stub');
  eq(again.r.body.cached, 1, 'reported as a cache hit');
}

// ── 🔑 R2's unit — retail is quoted in the pack WE buy, not one bar ────────
// Found live, not in a stub. "Kind bar … 6 ct" costs $1.95 for the BOX; a found 6-pack
// divided down to $1.12 a bar and left there compared a box price against a bar price
// and reported the buy at 174% of retail. Same for "ENERGIZER … AAA 8CT" at $2.90.
{
  const s = await scenario({ desc: 'Kind bar - peanut butter dark chocolate - 1.4 oz - 6 ct', upc: '012345678930', cost: 1.95,
    results: RES('https://www.walmart.com/ip/kind-6pk'),
    snippets: [{ url:'https://www.walmart.com/ip/kind-6pk', price:6.72, title:'Kind bars 6 pack', pack:6, in_stock:true, sold_by:'Walmart' }] });
  near(s.line.retail_price, 6.72, '🔑 a 6-ct line priced off a 6-pack is the PACK price, not the bar price');
  eq(s.line.retail_basis, 'single', 'pack matches pack, so the basis is single');

  // A found pack that differs from ours still lands in our unit.
  const t = await scenario({ desc: 'Batteries AAA 8CT', upc: '012345678931', cost: 2.90,
    results: RES('https://www.target.com/p/batt'),
    snippets: [{ url:'https://www.target.com/p/batt', price:2.44, title:'AAA 4 pack', pack:4, in_stock:true }] });
  near(t.line.retail_price, 4.88, 'a 4-pack at $2.44 becomes $4.88 for our 8-count');
  eq(t.line.retail_basis, 'multipack_div_n', '...and the basis records the conversion');
}

// ── 🔑 A long manifest is batched, and says what is left ──────────────────
// Alliance is 331 lines at ~2.6s a search: the single-request run died partway and left
// 305 lines never even asked — which read on the page as "no retail found".
{
  const id = 'batch1';
  db.prepare(`INSERT INTO manifests (id,vendor,uploaded_at,sell_as,units_per_case,status) VALUES (?,?,?,'each',1,'draft')`)
    .run(id, 'Big', '2026-08-20T00:00:00Z');
  const ins = db.prepare(`INSERT INTO manifest_lines (manifest_id,row_no,identifier,identifier_type,description,qty,cost,flags) VALUES (?,?,?,'upc',?,1,1,'[]')`);
  for (let i = 1; i <= 30; i++) ins.run(id, i, `9000000000${String(i).padStart(2,'0')}`, `Widget ${i}`);
  searchResults = []; snippetPrices = [];   // nothing found, so every line resolves fast

  const first = await post('manifest-retail', { id, batch: 10 });
  eq(first.body.lookedAt, 10, 'the first call handles one batch');
  eq(first.body.remaining, 20, '🔑 ...and reports exactly what is left');
  eq(first.body.total, 30, '...against the real total');

  const second = await post('manifest-retail', { id, batch: 10 });
  eq(second.body.remaining, 10, 'the second call picks up where the first stopped');
  await post('manifest-retail', { id, batch: 10 });
  const done = await post('manifest-retail', { id, batch: 10 });
  eq(done.body.remaining, 0, 'and it finishes');
  ok(/already been looked up/i.test(done.body.note || ''), '...saying there is nothing left rather than redoing it');
  const untouched = db.prepare(`SELECT COUNT(*) n FROM manifest_lines WHERE manifest_id=? AND flags='[]'`).get(id).n;
  eq(untouched, 0, '🛑 no line is left silently unasked');
}

// ── Every call is logged, so cost is a fact rather than an assumption ──────
{
  const rows = db.prepare(`SELECT provider, COUNT(*) c FROM lookup_log GROUP BY provider`).all();
  const by = Object.fromEntries(rows.map(r => [r.provider, r.c]));
  ok((by.tinyfish_search || 0) > 0, 'searches are logged');
  ok((by.claude || 0) > 0, 'model parses are logged');
  const spend = db.prepare(`SELECT COALESCE(SUM(credits),0) s FROM lookup_log`).get().s;
  eq(spend, 0, '🔑 nothing metered was spent — Search and Fetch are free');
}

// ── Scoring switches basis to retail, and says which it used ───────────────
{
  await post('merch-criteria-draft', { cells: [{ category: null, field: 'max_cost_pct_retail', value: '30' }] });
  await post('merch-criteria-publish', { note: 'v1' });
  const r = await get(`manifest&id=${pricedId}`);
  const l = r.body.score.lines[0];
  eq(l.basisName, 'street retail', '🔑 with a retail price the cost test uses retail');
  ok(l.costPctRetail !== null, 'and reports cost of retail');
  eq(r.body.score.withoutRetail, false, 'the without-retail caveat lifts');
  ok(/street retail/i.test(r.body.score.basis), '...and the basis line says so');
}

// The lookup finishes on its own, and only where somebody asked.
{
  // The shared ctx fires waitUntil and forgets, so a cron's real work finishes after
  // scheduled() returns. Collect the promises and await them, or this asserts on the
  // database before the drainer has touched it.
  const tick = async () => {
    const held = [];
    await worker.scheduled({ cron: '* * * * *' }, env,
      { waitUntil: (pr) => held.push(Promise.resolve(pr).catch(() => {})), passThroughOnException: () => {} });
    await Promise.all(held);
  };

  const id = 'drain1';
  db.prepare(`INSERT INTO manifests (id,vendor,uploaded_at,sell_as,units_per_case,status) VALUES (?,?,?,'each',1,'draft')`)
    .run(id, 'Queued', '2026-08-20T00:00:00Z');
  const ins = db.prepare(`INSERT INTO manifest_lines (manifest_id,row_no,identifier,identifier_type,description,qty,cost,flags) VALUES (?,?,?,'upc',?,1,1,'[]')`);
  for (let i = 1; i <= 25; i++) ins.run(id, i, `770000000${String(i).padStart(3,'0')}`, `Thing ${i}`);
  searchResults = []; snippetPrices = [];

  // 🛑 Nobody asked, so nothing happens — an upload must never make the Hub call out.
  await tick();
  eq(db.prepare(`SELECT COUNT(*) n FROM manifest_lines WHERE manifest_id=? AND flags='[]'`).get(id).n, 25,
     'a manifest nobody asked about is left completely alone');

  // Consent, then the drainer picks it up a batch at a time.
  db.prepare(`UPDATE manifests SET auto_retail=1 WHERE id=?`).run(id);
  await tick();
  const afterOne = db.prepare(`SELECT COUNT(*) n FROM manifest_lines WHERE manifest_id=? AND flags='[]'`).get(id).n;
  ok(afterOne < 25 && afterOne > 0, `one tick does a bounded batch, not the lot (${25 - afterOne} done)`);

  for (let i = 0; i < 5; i++) await tick();
  eq(db.prepare(`SELECT COUNT(*) n FROM manifest_lines WHERE manifest_id=? AND flags='[]'`).get(id).n, 0,
     'successive ticks finish the manifest');
  eq(db.prepare(`SELECT auto_retail a FROM manifests WHERE id=?`).get(id).a, 0,
     'and the flag clears, so the queue drains to empty rather than spinning');
}

// The kill switch stops it without a deploy.
{
  const id = 'drain2';
  db.prepare(`INSERT INTO manifests (id,vendor,uploaded_at,sell_as,units_per_case,status,auto_retail) VALUES (?,?,?,'each',1,'draft',1)`)
    .run(id, 'Switched', '2026-08-20T00:00:00Z');
  db.prepare(`INSERT INTO manifest_lines (manifest_id,row_no,identifier,identifier_type,description,qty,cost,flags) VALUES (?,1,'770000000999','upc','Thing',1,1,'[]')`).run(id);
  const tick2 = async () => {
    const held = [];
    await worker.scheduled({ cron: '* * * * *' }, env,
      { waitUntil: (pr) => held.push(Promise.resolve(pr).catch(() => {})), passThroughOnException: () => {} });
    await Promise.all(held);
  };
  await env.SALES_SNAPSHOTS.put('merch:retail-auto', 'off');
  await tick2();
  eq(db.prepare(`SELECT flags f FROM manifest_lines WHERE manifest_id=?`).get(id).f, '[]',
     'switched off, the drainer does nothing');
  await env.SALES_SNAPSHOTS.delete('merch:retail-auto');
  await tick2();
  ok(db.prepare(`SELECT flags f FROM manifest_lines WHERE manifest_id=?`).get(id).f !== '[]',
     '...and resumes when the switch is removed');
}

// Firecrawl is the PAID fallback, and only ever a fallback.
{
  const FC = { product: { title: 'Widget', url: 'https://www.target.com/p/w', variants: [
    { title: 'Widget 2 pack', price: { amount: 7.00, currency: 'USD' }, availability: { inStock: true } },
  ]}};

  // 🛑 Without a key it never fires, whatever happens upstream.
  delete env.FIRECRAWL_API_KEY;
  firecrawlBody = FC;
  let s1 = await scenario({ desc: 'Widget 2 ct', upc: '012345678940',
    results: RES('https://www.target.com/p/w'), snippets: [], blocked: true });
  eq(crawls.length, 0, '🛑 no key, no paid call');
  ok(s1.flags.includes('fetch blocked'), '...and the line says the free path was blocked');

  // 🛑 With a key it STILL does not fire while the free path is working.
  env.FIRECRAWL_API_KEY = 'fc-test';
  const s2 = await scenario({ desc: 'Widget 2 ct', upc: '012345678941',
    results: RES('https://www.target.com/p/w'),
    snippets: [{ url:'https://www.target.com/p/w', price:3.50, title:'Widget 2 pack', pack:2, in_stock:true }] });
  eq(crawls.length, 0, '🛑 snippets answered, so nothing paid was spent');
  // $3.50 for a 2-pack, and the line IS a 2-count: (3.50/2)x2 = 3.50.
  near(s2.line.retail_price, 3.50, '...and the free answer stands');

  // It fires only once the free fetch has actually failed.
  const s3 = await scenario({ desc: 'Widget 2 ct', upc: '012345678942',
    results: RES('https://www.target.com/p/w'), snippets: [], blocked: true });
  eq(crawls.length, 1, 'a blocked free fetch escalates exactly once');
  eq(crawls[0].proxy, 'auto', 'with the proxy retry that gets past a 403');
  ok(crawls[0].formats.includes('product'), 'asking for structured product data');
  near(s3.line.retail_price, 7.00, 'and the structured price lands');
  eq(s3.line.retail_basis, 'single', '...in our own unit');

  // 🔑 The structured path needs NO model parse — which is where a third of the Alliance
  // run died with a bare 400.
  const parseCount = () => db.prepare(`SELECT COUNT(*) n FROM lookup_log WHERE provider='claude' AND detail LIKE 'price parse%'`).get().n;
  const modelBefore = parseCount();
  await scenario({ desc: 'Widget 2 ct', upc: '012345678943',
    results: RES('https://www.target.com/p/w'), snippets: [], blocked: true });
  const modelAfter = parseCount();
  ok(modelAfter - modelBefore <= 1,
     'structured product data avoids a second model parse — where a third of the Alliance run died');

  // Spend is counted and logged, including a call that failed.
  firecrawlOk = false;
  await scenario({ desc: 'Widget 2 ct', upc: '012345678944',
    results: RES('https://www.target.com/p/w'), snippets: [], blocked: true });
  firecrawlOk = true;
  const spend = db.prepare(`SELECT COALESCE(SUM(credits),0) c, COUNT(*) n FROM lookup_log WHERE provider='firecrawl'`).get();
  ok(spend.c > 0, 'credits are recorded, not assumed to be zero');
  eq(spend.c, spend.n, '🔑 a failed scrape is counted too — it can still have been billed');

  delete env.FIRECRAWL_API_KEY;
}

// Warehouse shorthand is expanded before it becomes a search.
// 🔑 This is the difference between 80% and 25%. Kind described items the way a person
// would and priced at 80%. Alliance writes "CASCADE AP COMP FRSH 4CT" and priced at 25%,
// with every call succeeding technically and finding nothing. Searching an abbreviation
// is not a lookup problem — it is a question nobody would ask out loud.
{
  normalizeReply = [{ row: 1, brand: 'Cascade', title: 'Cascade ActionPacs Complete Fresh dishwasher detergent', size: '4 ct' }];
  const s1 = await scenario({ desc: 'CASCADE AP COMP FRSH 4CT', upc: '030772176269',
    results: RES('https://www.target.com/p/cascade'),
    snippets: [{ url:'https://www.target.com/p/cascade', price:5.99, title:'Cascade ActionPacs 4ct', pack:4, in_stock:true }] });
  eq(normalizeCalls.length, 1, 'the shorthand is expanded first');
  ok(/Cascade ActionPacs/.test(searches[0]),
     `🔑 the SEARCH uses the expanded name, not the abbreviation (${searches[0].slice(0, 90)})`);
  ok(!/AP COMP FRSH/.test(searches[0]),
     '...and the warehouse string never reaches the search box');
  near(s1.line.retail_price, 5.99, 'and the price lands');

  // The expansion is cached, so the next manifest carrying it costs nothing.
  const cached = db.prepare(`SELECT brand, title FROM item_cache WHERE identifier='030772176269'`).get();
  eq(cached.title, 'Cascade ActionPacs Complete Fresh dishwasher detergent', 'the expanded name is cached');
  eq(cached.brand, 'Cascade', '...with its brand');

  normalizeCalls = [];
  await scenario({ desc: 'CASCADE AP COMP FRSH 4CT', upc: '030772176269',
    results: RES('https://www.target.com/p/cascade'),
    snippets: [{ url:'https://www.target.com/p/cascade', price:5.99, title:'Cascade ActionPacs 4ct', pack:4, in_stock:true }] });
  eq(normalizeCalls.length, 0, 'a name already expanded is never expanded twice');
}

// 🛑 A refused expansion falls back to the raw text rather than inventing a product.
{
  normalizeReply = [];   // the model declines rather than guessing
  const s2 = await scenario({ desc: 'ZZQ MYSTERY THING 9X', upc: '012345678950',
    results: RES('https://www.target.com/p/z'),
    snippets: [{ url:'https://www.target.com/p/z', price:2.00, title:'Thing', pack:1, in_stock:true }] });
  ok(/ZZQ/.test(decodeURIComponent(searches[0])),
     '🛑 with no expansion the original text is searched, not a guessed one');
  near(s2.line.retail_price, 2.00, 'and it still works');
}

// 🛑 Two ticks cannot process the same manifest at once.
// A batch of ten takes longer than the minute between ticks, so without a claim the next
// tick queries for pending lines, gets the same set, and does the work twice. Measured
// live at 44 searches for 34 lines — and two runs escalating the same line to Firecrawl
// spend real credits twice for one answer.
{
  const id = 'lock1';
  db.prepare(`INSERT INTO manifests (id,vendor,uploaded_at,sell_as,units_per_case,status,auto_retail) VALUES (?,?,?,'each',1,'draft',1)`)
    .run(id, 'Locked', '2026-08-20T00:00:00Z');
  const ins = db.prepare(`INSERT INTO manifest_lines (manifest_id,row_no,identifier,identifier_type,description,qty,cost,flags) VALUES (?,?,?,'upc',?,1,1,'[]')`);
  for (let i = 1; i <= 20; i++) ins.run(id, i, `660000000${String(i).padStart(3,'0')}`, `Thing ${i}`);
  searchResults = []; snippetPrices = []; normalizeReply = [];

  // Two ticks fired together, exactly as the cron does when a batch overruns.
  const held = [];
  const ctx2 = { waitUntil: (pr) => held.push(Promise.resolve(pr).catch(() => {})), passThroughOnException: () => {} };
  await Promise.all([
    worker.scheduled({ cron: '* * * * *' }, env, ctx2),
    worker.scheduled({ cron: '* * * * *' }, env, ctx2),
  ]);
  await Promise.all(held);

  const touched = db.prepare(`SELECT COUNT(*) n FROM manifest_lines WHERE manifest_id=? AND flags <> '[]'`).get(id).n;
  ok(touched <= 10, `🛑 two simultaneous ticks advance ONE batch, not two (${touched} lines touched)`);
  eq(db.prepare(`SELECT retail_lock_until l FROM manifests WHERE id=?`).get(id).l, null,
     'and the claim is released afterwards, so the queue is not stalled');
}

// A stale claim does not wedge the queue forever.
{
  const id = 'lock2';
  db.prepare(`INSERT INTO manifests (id,vendor,uploaded_at,sell_as,units_per_case,status,auto_retail,retail_lock_until) VALUES (?,?,?,'each',1,'draft',1,?)`)
    .run(id, 'Stale', '2026-08-19T00:00:00Z', '2026-08-19T00:00:00Z');   // expired yesterday
  db.prepare(`INSERT INTO manifest_lines (manifest_id,row_no,identifier,identifier_type,description,qty,cost,flags) VALUES (?,1,'660000000999','upc','Thing',1,1,'[]')`).run(id);
  const held = [];
  await worker.scheduled({ cron: '* * * * *' }, env,
    { waitUntil: (pr) => held.push(Promise.resolve(pr).catch(() => {})), passThroughOnException: () => {} });
  await Promise.all(held);
  ok(db.prepare(`SELECT flags f FROM manifest_lines WHERE manifest_id=?`).get(id).f !== '[]',
     'an expired claim is taken over rather than blocking the manifest forever');
}

// 🛑 A third-party seller is refused UNLESS a store actually stocks it.
// Walmart and Target host marketplace sellers on their own domain, sometimes at multiples
// of real retail. Being on the retailer's site is not proof the retailer sells it; being
// on a shelf is.
{
  const s1 = await scenario({ desc: 'Widget', upc: '012345678960',
    results: RES('https://www.walmart.com/ip/widget'),
    snippets: [{ url:'https://www.walmart.com/ip/widget', price:18.99, title:'Widget', pack:1,
                 in_stock:true, in_store:false, sold_by:'BargainBin LLC' }] });
  eq(s1.line.retail_price, null, '🛑 a third-party price with no shelf presence is refused');

  const s2 = await scenario({ desc: 'Widget', upc: '012345678961',
    results: RES('https://www.walmart.com/ip/widget'),
    snippets: [{ url:'https://www.walmart.com/ip/widget', price:4.99, title:'Widget', pack:1,
                 in_stock:true, in_store:true, sold_by:'BargainBin LLC' }] });
  near(s2.line.retail_price, 4.99, '...but the same seller IS trusted when a store stocks it');
  eq(s2.line.retail_in_store, 1, 'and that is recorded');

  const s3 = await scenario({ desc: 'Widget', upc: '012345678965',
    results: RES('https://www.target.com/p/w'),
    snippets: [{ url:'https://www.target.com/p/w', price:4.99, title:'Widget', pack:1,
                 in_stock:true, in_store:true, sold_by:'Target' }] });
  eq(s3.line.retail_confidence, 'high', 'confirmed on a shelf at a first-party retailer IS high confidence');
}

// A shelf price beats an online-only one, even when the online one is cheaper.
{
  const s = await scenario({ desc: 'Widget', upc: '012345678962',
    results: RES('https://www.target.com/p/w', 'https://www.walmart.com/ip/w'),
    snippets: [
      { url:'https://www.target.com/p/w',  price:9.99, title:'Widget', pack:1, in_stock:true, in_store:true, sold_by:'Target' },
      { url:'https://www.walmart.com/ip/w', price:8.99, title:'Widget', pack:1, in_stock:true, in_store:false, sold_by:'Walmart' },
    ]});
  near(s.line.retail_price, 9.99, 'the shelf price wins — it is what a customer walks up and pays');
}

// 🛑 Walmart Business quotes CASE prices and is not consumer retail.
// Found live: 13 Alliance lines priced off business.walmart.com.
{
  const s = await scenario({ desc: 'Widget', upc: '012345678963',
    results: [{ position:1, url:'https://business.walmart.com/ip/widget', title:'Widget', snippet:'$2.10' },
              { position:2, url:'https://beta.walmart.com/ip/widget', title:'Widget', snippet:'$2.10' }],
    snippets: [{ url:'https://business.walmart.com/ip/widget', price:2.10, title:'Widget', pack:1, in_stock:true, sold_by:'Walmart' }] });
  eq(s.line.retail_price, null, '🛑 no price is taken from a B2B or beta subdomain');
}

// A bulk listing with no readable count cannot become a shelf price.
{
  const s = await scenario({ desc: 'Widget', upc: '012345678964',
    results: RES('https://www.walmart.com/ip/widget'),
    snippets: [{ url:'https://www.walmart.com/ip/widget', price:89.00, title:'Widget Bulk Carton', pack:1, in_stock:true, sold_by:'Walmart' }] });
  eq(s.line.retail_price, null, '🛑 a bulk listing with no count to divide by is dropped, not used whole');
}

// ── Access + a decided manifest is not re-priced underneath its decision ───
{
  eq((await post('manifest-retail', { id: pricedId }, 'u-admin')).status, 403, '🛑 an admin may not run the lookup — superuser only');
  await post('manifest-decide', { id: pricedId, status: 'approved', note: 'yes' });
  eq((await post('manifest-retail', { id: pricedId })).status, 409, '🛑 a decided manifest is not re-priced');
}

// ── 🛑 A MANIFEST IS NOTHING BUT DISCONTINUED ITEMS ─────────────────────────
// Which is exactly why the exact SKU is the worst price source on this screen. Everyone
// still listing a closeout item is a reseller, and an inflated retail makes a bad buy
// look good — the expensive direction to be wrong in, on the surface where money is
// actually committed.
{
  const realFetch = globalThis.fetch;
  const mk = (id, upc, desc, cost) => {
    db.prepare(`INSERT INTO manifests (id,vendor,uploaded_at,sell_as,units_per_case,status) VALUES (?,?,?,'each',1,'draft')`)
      .run(id, 'ClassCheck', '2026-08-20T00:00:00Z');
    db.prepare(`INSERT INTO manifest_lines (manifest_id,row_no,identifier,identifier_type,description,qty,cost,flags)
                VALUES (?,1,?,'upc',?,10,?,'[]')`).run(id, upc, desc, cost);
  };
  const seenQueries = [];
  const stub = async (u, init) => {
    const url = String(u);
    if (url.startsWith('https://api.search.tinyfish.ai')) {
      const q = decodeURIComponent(url).split('&')[0];
      seenQueries.push(q);
      return new Response(JSON.stringify({ results: /Deluxe/.test(q)
        ? [{ position: 1, url: 'https://www.walmart.com/ip/widget-deluxe-3pk/1', title: '(3 pack) Widget Deluxe 5.5 oz', snippet: '3 Pack. $22.00' }]
        : [{ position: 1, url: 'https://www.walmart.com/ip/widget-plain/2', title: 'Widget Plain 5.5 oz', snippet: '$2.27' },
           { position: 2, url: 'https://www.target.com/p/widget-mild/3', title: 'Widget Mild 5.5 oz', snippet: '$2.49' },
           { position: 3, url: 'https://www.meijer.com/shopping/product/widget-hot/4', title: 'Widget Hot 5.5 oz', snippet: '$2.39' }],
      }), { status: 200 });
    }
    if (url.includes('api.anthropic.com')) {
      const b = JSON.parse(init.body);
      if (/expand abbreviated/i.test(b.system || '')) {
        return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({
          items: [{ row: 1, brand: 'Widget', title: 'Widget Deluxe', size: '5.5 oz' }] }) }] }), { status: 200 });
      }
      const asked = JSON.stringify(b.messages || '');
      return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ prices: /widget-deluxe/.test(asked)
        ? [{ url: 'https://www.walmart.com/ip/widget-deluxe-3pk/1', price: 22.00, title: '(3 pack) Widget Deluxe 5.5 oz', pack: 3, in_stock: true, sold_by: 'Walmart.com' }]
        : [{ url: 'https://www.walmart.com/ip/widget-plain/2', price: 2.27, title: 'Widget Plain 5.5 oz', pack: 1, in_stock: true, sold_by: 'Walmart.com' },
           { url: 'https://www.target.com/p/widget-mild/3', price: 2.49, title: 'Widget Mild 5.5 oz', pack: 1, in_stock: true, sold_by: 'Target' },
           { url: 'https://www.meijer.com/shopping/product/widget-hot/4', price: 2.39, title: 'Widget Hot 5.5 oz', pack: 1, in_stock: true, sold_by: 'Meijer' }],
      }) }] }), { status: 200 });
    }
    return realFetch(u, init);
  };

  // ── a line whose name is resolved in THIS batch ──
  globalThis.fetch = stub;
  mk('cls1', '0038000900001', 'WIDGET DLX 5.5', 0.81);
  const r1 = await post('manifest-retail', { id: 'cls1', batch: 1, max_searches: 5 });
  const l1 = db.prepare(`SELECT * FROM manifest_lines WHERE manifest_id='cls1'`).get();
  near(l1.retail_price, 2.27, '🔑 $22.00/3 = $7.33 is rejected for what the shelf equivalent costs');
  ok(JSON.parse(l1.flags || '[]').includes('priced as brand + size'),
     '🔑 …and the LINE says so — a substituted retail that looks found is a lie on a buy sheet');
  ok(seenQueries.some(q => /Deluxe/.test(q) && /5\.5/.test(q)),
     '🔑 the size goes into the SKU query here too, not just on a scan');
  ok(seenQueries.some(q => /Widget/.test(q) && !/Deluxe/.test(q)),
     '🔑 …and the class query drops the variant');

  // 🛑 THE CLASS SEARCH MUST NOT EAT THE LINE BUDGET. On one shared counter a 25-line
  // batch prices twelve and reports the rest "not looked up" — a partial run that reads
  // as a complete one, which is the exact failure this function was written to avoid.
  eq(r1.body.searchesLeft, 4, '🔑 one line spent ONE line-search, not two');

  // ── a line whose name was resolved on an EARLIER run ──
  // This is the case that was silently broken: the read asked item_cache for `title`
  // alone, so every already-named line reached pricing with no brand and no size.
  seenQueries.length = 0;
  db.prepare(`INSERT INTO item_cache (identifier, identifier_type, title, brand, size, updated_at)
              VALUES ('0038000900002','upc','Widget Deluxe','Widget','5.5 oz','2026-08-20T00:00:00Z')`).run();
  mk('cls2', '0038000900002', 'WIDGET DLX 5.5', 0.81);
  await post('manifest-retail', { id: 'cls2', batch: 1, max_searches: 5 });
  const l2 = db.prepare(`SELECT * FROM manifest_lines WHERE manifest_id='cls2'`).get();
  near(l2.retail_price, 2.27, '🔑 a line named on an EARLIER run gets the class check too');
  ok(seenQueries.some(q => /Widget/.test(q) && !/Deluxe/.test(q)),
     '…because brand and size are read back, not just the title');

  // The substitution is written to the shared cache, so the scan screen and the scorer
  // cannot disagree about what this item competes with.
  const c = db.prepare(`SELECT * FROM item_cache WHERE identifier='0038000900002'`).get();
  near(c.retail_price, 2.27, 'and the corrected price is what gets cached');

  // ── with no allowance, the check is skipped rather than starving the run ──
  seenQueries.length = 0;
  mk('cls3', '0038000900003', 'WIDGET DLX 5.5', 0.81);
  const r3 = await post('manifest-retail', { id: 'cls3', batch: 1, max_searches: 5, max_class_searches: 0 });
  const l3 = db.prepare(`SELECT * FROM manifest_lines WHERE manifest_id='cls3'`).get();
  near(l3.retail_price, 7.33, 'with the class allowance at zero the SKU price stands…');
  eq(r3.body.searchesLeft, 4, '…and the line budget is untouched either way');

  // 🛑 THE PAID BUDGET WAS NEVER A BUDGET. `Number(undefined) ?? 10` is NaN, `??` does
  // not catch NaN, and every comparison against NaN is false — so Firecrawl, the one
  // API here that bills, ran uncapped on every production run. The tell was sitting in
  // the response as `creditsSpent: null`, because JSON renders NaN as null.
  mk('cls4', '0038000900004', 'WIDGET DLX 5.5', 0.81);
  globalThis.fetch = stub;
  const r4 = await post('manifest-retail', { id: 'cls4', batch: 1, max_searches: 5 });
  ok(Number.isFinite(r4.body.creditsSpent),
     `🔑 the credit spend is a NUMBER, not NaN-rendered-as-null (got ${JSON.stringify(r4.body.creditsSpent)})`);
  globalThis.fetch = realFetch;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
