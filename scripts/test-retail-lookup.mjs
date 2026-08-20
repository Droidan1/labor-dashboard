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
for (const m of ['migration-041.sql','migration-042.sql','migration-043.sql','migration-044.sql','migration-045.sql','migration-046.sql'])
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
  ok(s.flags.includes('no retail'), '...the line reads as unpriced rather than cheaply priced');
  const sent = searches[0] || '';
  ok(sent.includes('include_domains'), 'the allowlist is still sent as a query hint');
  ok(!/familydollar/.test(JSON.stringify(s.line)), 'nothing from the leaked domain reaches the row');
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
  eq(s.line.retail_confidence, 'high', 'a single in-stock first-party price is high confidence');
  ok(!s.flags.includes('no retail'), 'not flagged as unpriced');
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
  ok(s.flags.includes('no retail'), '...and reads as unpriced rather than cheap');
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

// ── Access + a decided manifest is not re-priced underneath its decision ───
{
  eq((await post('manifest-retail', { id: pricedId }, 'u-admin')).status, 403, '🛑 an admin may not run the lookup — superuser only');
  await post('manifest-decide', { id: pricedId, status: 'approved', note: 'yes' });
  eq((await post('manifest-retail', { id: pricedId })).status, 409, '🛑 a decided manifest is not re-priced');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
