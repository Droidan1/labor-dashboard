// Bin photos auto-draft themselves into a reviewable post. This is triggered by
// the UPLOAD, not a clock, so the thing that has to hold is burst safety: one
// manager submitting a batch is ~30 separate photo-upload requests, and they must
// produce exactly ONE draft whose photo list converges — not 30 drafts, and not a
// list mangled by concurrent read-modify-write.
//
// Drives the REAL entry point, worker.fetch(?action=photo-upload). The wiring is
// most of what can break here (does a bins upload reach the draft code at all?),
// and a regex-extracted function cannot see wiring.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

const REPO = process.argv[2] || '.';
const src = fs.readFileSync(path.join(REPO, 'worker.js'), 'utf8');

// Pin inside F26 week 34 (Sunday 2026-08-16). Without this the week key drifts
// and the suite rots.
const PINNED = '2026-08-20T18:00:00Z';   // a Thursday
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...a) { if (a.length === 0) super(PINNED); else super(...a); }
  static now() { return new RealDate(PINNED).getTime(); }
};

let assertions = 0, failures = 0;
const ok = (c, m) => { assertions++; if (!c) { failures++; console.error('  FAIL ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const SECRET = 'test-secret';
const tmp = path.join(os.tmpdir(), `worker-upl-${src.length}.mjs`);
fs.writeFileSync(tmp, src);
const worker = (await import(pathToFileURL(tmp).href + `?v=${src.length}`)).default;

// thumbs: [id, post_type, created_at] — the cover picker's whole input.
function makeEnv({ apiKey = null, caption = 'A generated caption 🔥 #BargainLaneColiseum',
                   thumbs = [[6, 'bin_preview', '2026-08-01T00:00:00Z']] } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE marketing_photos (id INTEGER PRIMARY KEY AUTOINCREMENT, store TEXT, photo_type TEXT,
      r2_key TEXT, content_type TEXT, bytes INTEGER, uploader TEXT, note TEXT,
      status TEXT DEFAULT 'new', created_at TEXT);
    CREATE TABLE marketing_drafts (id INTEGER PRIMARY KEY AUTOINCREMENT, store TEXT,
      thumbnail_id INTEGER, photo_ids TEXT, caption TEXT, caption_source TEXT, topic TEXT,
      post_type TEXT, status TEXT, origin TEXT, auto_week TEXT, flow_fiscal_year TEXT,
      flow_retail_week INTEGER, created_by TEXT, created_at TEXT, updated_at TEXT, published_at TEXT);
    CREATE UNIQUE INDEX uq_drafts_auto_week ON marketing_drafts(store, auto_week) WHERE origin = 'photos';
    CREATE TABLE marketing_flow (fiscal_year TEXT, retail_week INTEGER, week_start TEXT, week_end TEXT,
      special_event TEXT, weekly_theme TEXT, product_focus TEXT, dd_loyalty TEXT);
    CREATE TABLE marketing_thumbnails (id INTEGER PRIMARY KEY, name TEXT, r2_key TEXT,
      content_type TEXT, post_type TEXT, active INTEGER DEFAULT 1, created_at TEXT);
  `);
  for (const [id, type, at] of thumbs) {
    db.prepare(`INSERT INTO marketing_thumbnails (id,name,r2_key,post_type,active,created_at) VALUES (?,?,?,?,1,?)`)
      .run(id, `cover-${id}`, `k/${id}.png`, type, at);
  }

  const DB = {
    prepare(sql) {
      const mk = p => ({
        bind: (...a) => mk(a),
        all: async () => ({ results: db.prepare(sql).all(...p) }),
        first: async () => db.prepare(sql).all(...p)[0] || null,
        run: async () => {
          const r = db.prepare(sql).run(...p);
          return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
        },
      });
      return mk([]);
    },
  };
  // Anthropic is the only network call in this path. Keep every request body:
  // WHAT the model was shown is the thing this feature gets wrong.
  const sent = [];
  globalThis.fetch = async (_url, init) => {
    sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify({
      stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: caption }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  // R2 stands in as a Map so an uploaded photo can actually be read back and
  // turned into an image block — a get() that always returns null would let a
  // regression in the image path pass.
  const media = new Map();
  // Cover bytes exist too, so "the cover was sent instead" is a case the
  // assertions can actually see rather than one that silently loads nothing.
  for (const [id] of thumbs) media.set(`k/${id}.png`, new Uint8Array([1, 2, 3]).buffer);
  const MEDIA = {
    put: async (k, buf) => { media.set(k, buf); },
    get: async k => (media.has(k) ? { arrayBuffer: async () => media.get(k) } : null),
  };

  return { env: { DB, MEDIA, SNAPSHOT_SECRET: SECRET, ANTHROPIC_API_KEY: apiKey }, db, sent, media };
}

// The images and the user text of the one caption request that was made.
function askedFor(sent) {
  const msg = sent[0].messages[0].content;
  const parts = Array.isArray(msg) ? msg : [{ type: 'text', text: msg }];
  return {
    images: parts.filter(x => x.type === 'image'),
    text: parts.filter(x => x.type === 'text').map(x => x.text).join(''),
  };
}

async function upload(env, store, type, { at = PINNED } = {}) {
  const fd = new FormData();
  fd.append('store', store);
  fd.append('photo_type', type);
  fd.append('photo', new File([new Uint8Array([1, 2, 3])], 'p.jpg', { type: 'image/jpeg' }));
  const waits = [];
  const res = await worker.fetch(
    new Request('https://x/?action=photo-upload', { method: 'POST', body: fd, headers: { 'X-Snapshot-Secret': SECRET } }),
    env, { waitUntil: p => waits.push(p) });
  const body = await res.json().catch(() => ({}));
  await Promise.allSettled(waits);          // let the caption fill land
  return { res, body };
}

const drafts = db => db.prepare(`SELECT * FROM marketing_drafts ORDER BY id`).all();

console.log('bin-photo auto-draft (upload-triggered)');

// 1 — a bins upload creates the draft
{
  const { env, db } = makeEnv();
  const { body } = await upload(env, 'BL1', 'bins');
  ok(body.ok, 'upload succeeded');
  const d = drafts(db);
  eq(d.length, 1, 'one draft created');
  eq(d[0].store, 'BL1', 'for the uploading store');
  eq(d[0].origin, 'photos', 'tagged origin=photos');
  eq(d[0].status, 'draft', 'lands in Drafts');
  eq(d[0].post_type, 'bin_preview', 'post_type is bin_preview');
  eq(d[0].auto_week, '2026-08-16', 'keyed to the Sunday that starts the week');
  eq(d[0].thumbnail_id, 6, 'cover auto-picked');
  eq(d[0].created_by, 'auto:bin-photos', 'provenance recorded');
  eq(JSON.parse(d[0].photo_ids).length, 1, 'the uploaded photo is attached');
}

// 2 — retail uploads never create a draft
{
  const { env, db } = makeEnv();
  await upload(env, 'BL1', 'retail');
  await upload(env, 'BL1', 'other');
  eq(drafts(db).length, 0, 'non-bins uploads create nothing (Brian chose bins-only)');
}

// 3 — 🛑 the burst property: N uploads -> exactly ONE draft, list converges
{
  const { env, db } = makeEnv();
  for (let i = 0; i < 30; i++) await upload(env, 'BL1', 'bins');
  const d = drafts(db);
  eq(d.length, 1, '🛑 30 uploads produce exactly ONE draft, not 30');
  eq(JSON.parse(d[0].photo_ids).length, 30, 'photo_ids converges to all 30 — no clobbering');
}

// 4 — concurrent uploads (the real Thursday shape) still yield one draft
{
  const { env, db } = makeEnv();
  await Promise.all(Array.from({ length: 12 }, () => upload(env, 'BL1', 'bins')));
  const d = drafts(db);
  eq(d.length, 1, 'concurrent burst still yields ONE draft');
  eq(JSON.parse(d[0].photo_ids).length, 12, 'all 12 photos present after a concurrent burst');
}

// 5 — stores are independent
{
  const { env, db } = makeEnv();
  for (const s of ['BL1', 'BL2', 'BL4']) { await upload(env, s, 'bins'); await upload(env, s, 'bins'); }
  const d = drafts(db);
  eq(d.length, 3, 'one draft per store');
  ok(d.every(r => JSON.parse(r.photo_ids).length === 2), "each store's draft holds only its own photos");
}

// 6 — 🛑 a scheduled or published post is never mutated by a later upload
{
  for (const frozen of ['scheduled', 'published', 'publishing']) {
    const { env, db } = makeEnv();
    await upload(env, 'BL1', 'bins');
    db.prepare(`UPDATE marketing_drafts SET status = ?`).run(frozen);
    const before = drafts(db)[0].photo_ids;
    await upload(env, 'BL1', 'bins');
    const after = drafts(db);
    eq(after.length, 1, `no second draft while one is ${frozen}`);
    eq(after[0].photo_ids, before, `🛑 a ${frozen} post's photo list is left alone`);
  }
}

// 7 — the caption is written asynchronously, once, FROM THE BIN PHOTOS
{
  const { env, db, sent } = makeEnv({ apiKey: 'sk-test' });
  await upload(env, 'BL1', 'bins');
  const d = drafts(db)[0];
  ok(d.caption && d.caption.includes('#BargainLaneColiseum'), 'caption generated and stored');
  eq(d.caption_source, 'ai', 'marked as AI-sourced');
  eq(sent.length, 1, 'exactly one model call');
  const { images, text } = askedFor(sent);
  // 🛑 The regression this suite exists to catch: shown the branded cover, the
  // model writes about the cover's promo. Five live posts opened on a price
  // ladder and none on the bins (2026-08-20).
  eq(images.length, 1, 'the uploaded bin photo is what the model is shown');
  ok(text.includes("just took of THIS week's bins"), 'the photos are named as the subject');
  ok(!text.includes('branded cover graphic'), '🛑 the cover is NOT sent as the subject');
  ok(!/Customer Appreciation|Double Dip|weekly theme/i.test(text), '🛑 no Flow Calendar week in the prompt');
}

// 8 — an edited caption is never overwritten by a later upload
{
  const { env, db } = makeEnv({ apiKey: 'sk-test' });
  await upload(env, 'BL1', 'bins');
  db.prepare(`UPDATE marketing_drafts SET caption = 'Brian wrote this'`).run();
  await upload(env, 'BL1', 'bins');
  eq(drafts(db)[0].caption, 'Brian wrote this', "🛑 Brian's edit survives later uploads");
}

// 9 — no API key: draft still created, just captionless
{
  const { env, db } = makeEnv();               // apiKey null
  await upload(env, 'BL1', 'bins');
  const d = drafts(db)[0];
  eq(d.caption, null, 'no key → no caption');
  eq(d.caption_source, 'manual', 'not falsely marked AI');
  eq(JSON.parse(d.photo_ids).length, 1, 'photos still attached — the draft is still useful');
}

// 10 — a different week gets its own draft
{
  const { env, db } = makeEnv();
  await upload(env, 'BL1', 'bins');
  db.prepare(`UPDATE marketing_drafts SET auto_week = '2026-08-09'`).run();   // pretend last week
  await upload(env, 'BL1', 'bins');
  eq(drafts(db).length, 2, 'a new week gets its own draft');
}

// 11 — 🛑 the cover never crosses post types, however new the other one is
{
  const { env, db } = makeEnv({ thumbs: [
    [6, 'bin_preview',  '2026-08-01T00:00:00Z'],
    [8, 'weekly_promo', '2026-08-19T00:00:00Z'],   // newer, and this week's promo
    [9, 'event',        '2026-08-20T00:00:00Z'],   // newer still
  ] });
  await upload(env, 'BL1', 'bins');
  eq(drafts(db)[0].thumbnail_id, 6, '🛑 the bin cover wins over a newer promo/event cover');
}

// 12 — no bin cover at all → no cover, NOT someone else's
{
  const { env, db, sent } = makeEnv({ apiKey: 'sk-test', thumbs: [
    [8, 'weekly_promo', '2026-08-19T00:00:00Z'],
    [9, 'event',        '2026-08-20T00:00:00Z'],
  ] });
  await upload(env, 'BL1', 'bins');
  const d = drafts(db)[0];
  eq(d.thumbnail_id, null, '🛑 no bin_preview cover → no cover, no cross-type fallback');
  ok(d.caption, 'the draft is still captioned from its photos');
  eq(askedFor(sent).images.length, 1, 'and still written from the photo, not a promo cover');
}

// 13 — the model is shown a sample, not the whole batch (request size is real)
{
  const { env, db, sent, media } = makeEnv({ apiKey: 'sk-test' });
  // Photos already on the floor when this week's first upload lands.
  for (let i = 1; i <= 8; i++) {
    const key = `marketing/BL1/bins/2026-08/seed-${i}.jpg`;
    media.set(key, new Uint8Array([1, 2, 3]).buffer);
    db.prepare(`INSERT INTO marketing_photos (store,photo_type,r2_key,content_type,bytes,status,created_at)
                VALUES ('BL1','bins',?,'image/jpeg',3,'new','2026-08-18T10:00:00.000Z')`).run(key);
  }
  await upload(env, 'BL1', 'bins');
  eq(JSON.parse(drafts(db)[0].photo_ids).length, 9, 'all 9 photos are attached to the draft');
  eq(askedFor(sent).images.length, 4, 'but the caption request carries at most 4 images');
}

// Tally in the shape scripts/test.sh counts: "<n> passed, <m> failed".
console.log(`\n${assertions - failures} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
