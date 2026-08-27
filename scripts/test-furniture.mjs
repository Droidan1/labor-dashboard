// Furniture pricing from a photo, driven through the REAL endpoints.
//
// 🛑 A WRONG MATCH PRICES THE WRONG ITEM and nothing downstream would catch it, which is
// why the machine only ever SUGGESTS. These tests are mostly about that boundary: what
// the matcher will and will not offer, and that a person always chooses.
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
for (const m of ['migration-041.sql','migration-042.sql','migration-043.sql','migration-044.sql',
                 'migration-045.sql','migration-046.sql','migration-047.sql','migration-052.sql'])
  { try { db.exec(fs.readFileSync(path.join(repo, m), 'utf8')); } catch (e) {} }
applyMigrationAlters(db, repo);
env.ANTHROPIC_API_KEY = 'sk-test';

const RTA = 'FG BL FURNITURE - READY TO ASSEMBLE';
const UPH = 'FG BL FURNITURE - UPHOLSTERY';

// The vision call is the only egress; everything else is real.
let visionAttrs = ['armchair','grey','fabric','wooden legs','buttoned back','four legs','upholstered seat','mid century'];
let visionOk = true;
globalThis.fetch = async (u, init) => {
  const url = String(u);
  if (url.includes('api.anthropic.com')) {
    if (!visionOk) return new Response('nope', { status: 500 });
    return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({
      descriptor: 'grey fabric armchair with wooden legs', attributes: visionAttrs }) }] }), { status: 200 });
  }
  throw new Error('unexpected egress: ' + url.slice(0, 60));
};

const call = async (url, opts) => {
  const r = await worker.fetch(req(url, opts), env, ctx);
  const t = await r.text();
  let body; try { body = JSON.parse(t); } catch { body = { _raw: t.slice(0, 160) }; }
  return { status: r.status, body };
};
const post = (a, b, user = 'u-su') => call(`/?action=${a}`, { user, method: 'POST', body: b });
const get  = (a, user = 'u-su') => call(`/?action=${a}`, { user });
const PHOTO = btoa('x'.repeat(600));

console.log('Furniture');

// ── who may use it ─────────────────────────────────────────────────────────
{
  eq((await post('furniture-identify', { image_b64: PHOTO, l3: RTA }, 'u-staff')).status, 403,
     '🛑 staff may not price furniture');
  eq((await post('furniture-bands-save', { l3: RTA, condition: 'good', low: 1, usual: 2, high: 3 }, 'u-mgr1')).status, 403,
     '🛑 a manager may not set the ranges — that is the admin control Brian asked for');
  eq((await post('furniture-bands-save', { l3: RTA, condition: 'good', low: 28, usual: 35, high: 45 }, 'u-admin')).status, 200,
     'an admin may');
  eq((await get('furniture-bands', 'u-mgr1')).status, 200, '…and a manager may READ them, which is the point');
}

// ── the ranges ─────────────────────────────────────────────────────────────
{
  eq((await post('furniture-bands-save', { l3: RTA, condition: 'good', low: 50, usual: 35, high: 45 }, 'u-admin')).status, 400,
     '🛑 a low above the usual is a typo, refused rather than shown to a manager');
  eq((await post('furniture-bands-save', { l3: RTA, condition: 'good', low: 28, usual: 60, high: 45 }, 'u-admin')).status, 400,
     '🛑 …and so is a usual above the high');
  eq((await post('furniture-bands-save', { l3: 'FG BL FURNITURE - MATTRESSES', condition: 'good', usual: 5 }, 'u-admin')).status, 400,
     'a category this surface does not admit is refused');
  eq((await post('furniture-bands-save', { l3: RTA, condition: 'mint', usual: 5 }, 'u-admin')).status, 400,
     'a condition we do not use is refused');

  const b = await get('furniture-bands', 'u-admin');
  const rta = b.body.categories.find(c => c.key === RTA);
  near(rta.bands.good.usual, 35, 'the range comes back');
  eq(rta.asp, null, '🔑 no ASP is invented for a category with no sales — it reads as unknown');
  ok(b.body.conditions.length === 5, 'five conditions, worst to best');
}

// ── the photo path ─────────────────────────────────────────────────────────
let first;
{
  const r = await post('furniture-identify', { image_b64: PHOTO, l3: RTA }, 'u-mgr1');
  eq(r.status, 200, 'a photo identifies');
  eq(r.body.descriptor, 'grey fabric armchair with wooden legs', '…with a line a person can read');
  ok(r.body.r2_key.startsWith('furniture/'), '🔑 the photo is stored on the FIRST call, not uploaded twice');
  ok(await env.MEDIA.get(r.body.r2_key), '…and it really is in the bucket');
  eq(r.body.candidates.length, 0, 'nothing to match against yet');

  const s = await post('furniture-save', { ...r.body, condition: 'good', price: 35 }, 'u-mgr1');
  eq(s.status, 200, 'and it saves');
  first = s.body.id;
  ok(Number.isInteger(first), '…with an id');
}

// ── 🔑 THE SAME PIECE, PHOTOGRAPHED AGAIN ──────────────────────────────────
{
  // Different angle and light: some attributes change wording, most do not.
  visionAttrs = ['armchair','grey','fabric upholstery','wooden legs','buttoned back','four legs','upholstered seat','tapered legs'];
  const r = await post('furniture-identify', { image_b64: PHOTO, l3: RTA }, 'u-mgr1');
  eq(r.body.candidates.length > 0, true, '🔑 the piece we priced before comes back');
  eq(r.body.candidates[0].id, first, '…as the best candidate');
  near(r.body.candidates[0].price, 35, '…carrying what we charged');
  ok(r.body.candidates[0].descriptor, '…and a description to compare against');

  // 🛑 The match does NOT price it. A person confirms, and the save is what decides.
  const s = await post('furniture-save', { ...r.body, price: 35, matched_id: first }, 'u-mgr1');
  eq(s.status, 200, '🔑 a matched piece needs no condition — it inherits the decision');
  const row = db.prepare(`SELECT * FROM furniture_pieces WHERE id = ?`).get(s.body.id);
  eq(Number(row.matched_id), first, '…and records WHICH piece it was matched to, so a price can be traced back');
}

// ── 🛑 WHAT IT MUST NOT OFFER ──────────────────────────────────────────────
{
  visionAttrs = ['bookcase','white','laminate','five shelves','flat pack','rectangular','tall'];
  const r = await post('furniture-identify', { image_b64: PHOTO, l3: RTA }, 'u-mgr1');
  eq(r.body.candidates.length, 0, '🛑 a bookcase is not offered the price of an armchair');

  visionAttrs = ['sofa','three seat','grey','fabric','wooden legs','cushioned back','upholstered seat'];
  const r2 = await post('furniture-identify', { image_b64: PHOTO, l3: RTA }, 'u-mgr1');
  eq(r2.body.candidates.length, 0, '🛑 …nor is a sofa, despite sharing grey, fabric and wooden legs');
}

// ── the category scopes the search ─────────────────────────────────────────
{
  visionAttrs = ['armchair','grey','fabric','wooden legs','buttoned back','four legs','upholstered seat','mid century'];
  const r = await post('furniture-identify', { image_b64: PHOTO, l3: UPH }, 'u-mgr1');
  eq(r.body.candidates.length, 0,
     '🔑 the same photo finds nothing in a DIFFERENT category — a match is never cross-category');
}

// ── refusals ───────────────────────────────────────────────────────────────
{
  eq((await post('furniture-identify', { image_b64: PHOTO, l3: 'FG BL HOME - RUGS' }, 'u-mgr1')).status, 400,
     'a category outside this surface is refused');
  eq((await post('furniture-identify', { l3: RTA }, 'u-mgr1')).status, 400, 'no photo is refused');
  eq((await post('furniture-save', { r2_key: 'furniture/x.jpg', l3: RTA, price: 0, condition: 'good' }, 'u-mgr1')).status, 400,
     'a price of zero is refused');
  eq((await post('furniture-save', { r2_key: 'furniture/x.jpg', l3: RTA, price: 30 }, 'u-mgr1')).status, 400,
     '🔑 a FRESH piece with no condition is refused — the condition is what chose the band');
  eq((await post('furniture-save', { r2_key: 'elsewhere/x.jpg', l3: RTA, price: 30, condition: 'good' }, 'u-mgr1')).status, 400,
     '🛑 a key outside the furniture prefix is refused, so this cannot be pointed at another bucket path');
  visionOk = false;
  eq((await post('furniture-identify', { image_b64: PHOTO, l3: RTA }, 'u-mgr1')).status, 502,
     'a vision failure says so rather than pretending nothing matched');
  visionOk = true;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
