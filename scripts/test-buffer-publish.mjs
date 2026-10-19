// Content Studio publishes through Buffer (2026-10-19). With BUFFER_API_KEY set, a
// draft is handed to Buffer instead of posted with our own Meta app, and a sync
// follows it until Buffer sends it.
//
// What has to hold:
//   - the payload Buffer needs (channel, shareNow, facebook type, images in order),
//     with image links our own public routes actually serve;
//   - Buffer's 10-image cap is refused with a plain message, never trimmed;
//   - a post is never handed over twice (no idempotency key on Buffer's side);
//   - a failure Buffer reports after the hand-off reaches the card and a push.
// Drives the real worker.fetch and worker.scheduled: the wiring (cron → publisher,
// cron → sync, endpoint → publisher) is what a regex-extracted helper cannot see.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, applyMigrationAlters, req } from './lib/worker-harness.mjs';

const repo = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
let assertions = 0, failures = 0;
const ok = (c, m) => { assertions++; if (!c) { failures++; console.error('  FAIL ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const worker = await loadWorker(repo);
const BL2_CHANNEL = '6ac7dd7f6a5c39ccb6548539';
const LINK = 'https://facebook.com/264627006733058_122311668812239321';

// ── Outbound fetch: Buffer is answered by `buffer`, anything else is recorded and refused.
let calls = [], buffer = () => ({ data: {} });
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u === 'https://api.buffer.com') {
    const body = JSON.parse(init.body);
    calls.push({ url: u, auth: (init.headers || {}).Authorization, body });
    const r = buffer(body);
    return new Response(JSON.stringify(r.json || r), { status: r.status || 200, headers: { 'Content-Type': 'application/json' } });
  }
  calls.push({ url: u });
  throw new Error('outbound fetch blocked in test: ' + u.slice(0, 80));
};
const bufferCalls = () => calls.filter(c => c.url === 'https://api.buffer.com');
const created = (id = 'b0000000000000000000000a') => ({ data: { createPost: { __typename: 'PostActionSuccess', post: { id, status: 'sending' } } } });
const status = (s, extra = {}) => ({ data: { post: { id: 'x', status: s, sentAt: null, externalLink: null, error: null, ...extra } } });

const uuid = n => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-a${String(n).repeat(3)}-${String(n).repeat(12)}`;
const BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

async function setup({ key = 'buffer-test-key' } = {}) {
  const { db, env } = makeEnv(repo);
  db.exec(fs.readFileSync(path.join(repo, 'migration-020.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(repo, 'migration-021.sql'), 'utf8'));
  applyMigrationAlters(db, repo);
  if (key) env.BUFFER_API_KEY = key;
  let n = 0;
  const photo = async ({ type = 'bins', ct = 'image/jpeg', ext = 'jpeg', status: st = 'new' } = {}) => {
    // Distinct keys per photo; the public route only needs the key to END with the link's uuid.ext.
    const u = uuid(++n % 10), k = `marketing/BL2/${type}/2026-10/${n}/${u}.${ext}`;
    const r = db.prepare(`INSERT INTO marketing_photos (store, photo_type, r2_key, content_type, bytes, uploader, status, created_at)
                          VALUES ('BL2',?,?,?,8,'m@x.com',?,?)`).run(type, k, ct, st, new Date().toISOString());
    await env.MEDIA.put(k, BYTES, { httpMetadata: { contentType: ct } });
    return Number(r.lastInsertRowid);
  };
  const cover = async () => {
    const k = `marketing/_thumbnails/${uuid(7)}.png`;
    const r = db.prepare(`INSERT INTO marketing_thumbnails (name, r2_key, content_type, bytes, uploaded_by, created_at)
                          VALUES ('Bin day', ?, 'image/png', 8, 'a@x.com', ?)`).run(k, new Date().toISOString());
    await env.MEDIA.put(k, BYTES, { httpMetadata: { contentType: 'image/png' } });
    return Number(r.lastInsertRowid);
  };
  const draft = (fields) => {
    const f = { store: 'BL2', status: 'draft', caption: 'Fresh bins at South Bend', thumbnail_id: null, photo_ids: [], ...fields };
    const r = db.prepare(`INSERT INTO marketing_drafts (store, thumbnail_id, photo_ids, caption, caption_source, status, created_at, updated_at)
                          VALUES (?,?,?,?,'ai',?,?,?)`).run(f.store, f.thumbnail_id, JSON.stringify(f.photo_ids), f.caption, f.status, new Date().toISOString(), new Date().toISOString());
    const id = Number(r.lastInsertRowid);
    for (const [k, v] of Object.entries(fields)) {
      if (['scheduled_at', 'publish_live', 'publish_attempts', 'claimed_at'].includes(k)) db.prepare(`UPDATE marketing_drafts SET ${k}=? WHERE id=?`).run(v, id);
    }
    return id;
  };
  const row = id => db.prepare('SELECT * FROM marketing_drafts WHERE id=?').get(id);
  const logs = id => db.prepare('SELECT * FROM marketing_publish_log WHERE draft_id=? ORDER BY id').all(id);
  return { db, env, photo, cover, draft, row, logs };
}

const publish = (env, id, published = true) => worker.fetch(req('/?action=publish-draft', { user: 'u-admin', method: 'POST', body: { draft_id: id, published } }), env, { waitUntil: () => {} });
async function tick(env, cron) {
  const waits = [];
  await worker.scheduled({ cron, scheduledTime: Date.now() }, env, { waitUntil: p => waits.push(p) });
  await Promise.allSettled(waits);
}
const ago = ms => new Date(Date.now() - ms).toISOString();

console.log('Hub → Buffer publishing');

// ── 1. Publish now: the payload Buffer gets, and links our own routes serve ──
{
  calls = [];
  const s = await setup();
  const c = await s.cover(), p1 = await s.photo(), p2 = await s.photo({ type: 'retail' });
  const id = s.draft({ thumbnail_id: c, photo_ids: [p1, p2] });
  buffer = () => created();
  const r = await publish(s.env, id);
  const j = await r.json();
  eq(r.status, 200, 'publish answers 200');
  ok(/Buffer/.test(j.note || ''), 'and says it went to Buffer');
  const b = bufferCalls();
  eq(b.length, 1, 'one call to Buffer');
  eq(calls.filter(x => /graph\.facebook\.com/.test(x.url)).length, 0, '🛑 nothing posted through our own Meta app');
  eq(b[0].auth, 'Bearer buffer-test-key', 'authorised with the key');
  const input = b[0].body.variables.input;
  eq(input.channelId, BL2_CHANNEL, "the store's Buffer Facebook channel");
  eq(input.mode, 'shareNow', 'shareNow: the Hub already decided the time');
  eq(input.schedulingType, 'automatic', 'automatic, not a phone reminder');
  eq(JSON.stringify(input.metadata), JSON.stringify({ facebook: { type: 'post' } }), 'facebook.type, which Buffer requires');
  eq(input.text, 'Fresh bins at South Bend', 'the caption');
  eq(input.saveToDraft, undefined, 'not a Buffer draft');
  eq(input.assets.length, 3, 'cover + 2 photos');
  ok(/^https:\/\/api\.retjghub\.com\/t\//.test(input.assets[0].image.url), 'the cover first, on the cover route');
  ok(input.assets.slice(1).every(a => /^https:\/\/api\.retjghub\.com\/p\//.test(a.image.url)), 'then the photos, on the photo route');
  // 🔑 The links are only worth anything if our own public routes answer them.
  for (const a of input.assets) {
    const u = new URL(a.image.url);
    const res = await worker.fetch(new Request('https://api.retjghub.com' + u.pathname), s.env, { waitUntil: () => {} });
    eq(res.status, 200, `🔑 ${u.pathname.slice(0, 3)} link is served with no sign-in`);
  }
  eq(s.row(id).status, 'published', 'the draft moves to Published');
  const L = s.logs(id);
  eq(L.length, 1, 'one log row');
  eq(L[0].status, 'queued', "logged 'queued' until Buffer sends it");
  eq(L[0].buffer_post_id, 'b0000000000000000000000a', 'with the Buffer post id');
  eq(L[0].post_id, null, 'no Facebook id yet');
}

// ── 2. The cover route: same rules as /p/ ──────────────────────────────────
{
  const s = await setup();
  const c = await s.cover();
  const get = p => worker.fetch(new Request('https://api.retjghub.com' + p), s.env, { waitUntil: () => {} });
  const good = await get(`/t/${c}-${uuid(7)}.png`);
  eq(good.status, 200, 'a cover is served');
  eq(good.headers.get('content-type'), 'image/png', 'as its type');
  eq(good.headers.get('content-security-policy'), "default-src 'none'; sandbox", 'sandboxed');
  eq((await get(`/t/${c}-${uuid(8)}.png`)).status, 404, '🛑 a made-up UUID is refused');
  const p = await s.photo();
  const pkey = s.db.prepare('SELECT r2_key FROM marketing_photos WHERE id=?').get(p).r2_key.split('/').pop();
  eq((await get(`/t/${p}-${pkey}`)).status, 404, '🛑 a photo cannot be fetched through the cover route');
  const odd = s.db.prepare(`INSERT INTO marketing_thumbnails (name, r2_key, content_type, created_at) VALUES ('x', ?, 'image/png', 'now')`)
    .run(`bin-dump/BL1/${uuid(5)}.png`);
  await s.env.MEDIA.put(`bin-dump/BL1/${uuid(5)}.png`, BYTES, { httpMetadata: { contentType: 'image/png' } });
  eq((await get(`/t/${Number(odd.lastInsertRowid)}-${uuid(5)}.png`)).status, 404, '🛑 a key outside marketing/_thumbnails/ is refused');
  const svg = s.db.prepare(`INSERT INTO marketing_thumbnails (name, r2_key, content_type, created_at) VALUES ('x', ?, 'image/svg+xml', 'now')`)
    .run(`marketing/_thumbnails/${uuid(4)}.svgxm`);
  await s.env.MEDIA.put(`marketing/_thumbnails/${uuid(4)}.svgxm`, BYTES, {});
  eq((await get(`/t/${Number(svg.lastInsertRowid)}-${uuid(4)}.svgxm`)).status, 404, '🛑 a non-raster cover is refused');
}

// ── 3. 🛑 Buffer's 10-image cap is refused, never trimmed ─────────────────────
{
  calls = [];
  const s = await setup();
  const c = await s.cover();
  const ten = []; for (let i = 0; i < 10; i++) ten.push(await s.photo());
  const id = s.draft({ thumbnail_id: c, photo_ids: ten });
  const r = await publish(s.env, id);
  const j = await r.json();
  eq(r.status, 400, 'cover + 10 photos is refused');
  ok(/keep your best 9/.test(j.error || ''), `and says what to do (${j.error})`);
  eq(bufferCalls().length, 0, '🛑 nothing reaches Buffer');
  eq(s.row(id).status, 'draft', 'the draft goes back to Drafts');

  const sch = await worker.fetch(req('/?action=draft-schedule', { user: 'u-admin', method: 'POST', body: { id, et_wall_clock: '2099-01-01T09:00' } }), s.env, { waitUntil: () => {} });
  eq(sch.status, 400, '🛑 scheduling it is refused now, not when nobody is watching');
  eq(s.row(id).status, 'draft', 'still a draft');

  const noCover = s.draft({ photo_ids: ten });
  buffer = () => created();
  eq((await publish(s.env, noCover)).status, 200, 'without a cover, 10 photos fit');
  eq(bufferCalls().at(-1).body.variables.input.assets.length, 10, 'all 10 sent');
}

// ── 4. Photos Buffer could not fetch are refused before the hand-off ─────────
{
  calls = [];
  const s = await setup();
  const team = await s.photo({ type: 'team' });
  const id = s.draft({ photo_ids: [team] });
  const r = await publish(s.env, id);
  eq(r.status, 400, 'a team photo (sign-in only) is refused');
  const heic = await s.photo({ ct: 'image/heic', ext: 'heic' });
  const id2 = s.draft({ photo_ids: [heic] });
  const r2 = await publish(s.env, id2);
  ok(r2.status === 400 && /JPEG, PNG or WebP/.test((await r2.json()).error), 'a HEIC photo is refused with the formats Buffer takes');
  eq(bufferCalls().length, 0, 'neither reached Buffer');
}

// ── 5. No key: the old Graph path, untouched ────────────────────────────────
{
  calls = [];
  const s = await setup({ key: null });
  const id = s.draft({ photo_ids: [await s.photo()] });
  const r = await publish(s.env, id);
  const j = await r.json();
  ok(/No Page token/.test(j.error || ''), 'without BUFFER_API_KEY it takes the Graph path (here: no Page token)');
  eq(bufferCalls().length, 0, 'and never calls Buffer');
}

// ── 6. A scheduled post goes out on the minute cron, then the sync finds it sent ──
{
  calls = [];
  const s = await setup();
  const id = s.draft({ photo_ids: [await s.photo()], status: 'scheduled', scheduled_at: ago(60e3), publish_live: 1 });
  buffer = (b) => /createPost/.test(b.query) ? created('b0000000000000000000000b') : status('sending');
  await tick(s.env, '* * * * *');
  eq(s.row(id).status, 'published', 'the cron hands it to Buffer');
  eq(bufferCalls().filter(c => /createPost/.test(c.body.query)).length, 1, 'once');
  eq(s.logs(id)[0].status, 'queued', 'queued');

  buffer = () => status('sent', { externalLink: LINK, sentAt: new Date().toISOString() });
  await tick(s.env, '* * * * *');
  const L = s.logs(id)[0];
  eq(L.status, 'published', "the sync marks it published once Buffer sent it");
  eq(L.post_url, LINK, "with Facebook's link");
  eq(L.post_id, '264627006733058_122311668812239321', "and Facebook's post id (comment ingest reads it)");
  eq(bufferCalls().filter(c => /createPost/.test(c.body.query)).length, 1, '🛑 never handed over a second time');
  const list = await (await worker.fetch(req('/?action=drafts&status=all', { user: 'u-admin' }), s.env, { waitUntil: () => {} })).json();
  eq(list.drafts.find(d => d.id === id).post_url, LINK, 'the card gets its View link');

  const before = bufferCalls().length;
  await tick(s.env, '* * * * *');
  eq(bufferCalls().length, before, 'a sent post is not checked again');
}

// ── 7. Buffer fails after the hand-off: the card says so ────────────────────
{
  calls = [];
  const s = await setup();
  const id = s.draft({ photo_ids: [await s.photo()] });
  buffer = () => created();
  await publish(s.env, id);
  buffer = () => status('error', { error: { message: 'Facebook rejected the image' } });
  await tick(s.env, '* * * * *');
  eq(s.row(id).status, 'schedule_error', 'the draft shows as failed');
  ok(/Buffer couldn't post it: Facebook rejected the image/.test(s.row(id).schedule_error), "with Buffer's reason");
  eq(s.logs(id)[0].status, 'error', 'the log row is an error');

  // Retry (Publish again) is allowed: an errored hand-off does not count as posted.
  buffer = (b) => /createPost/.test(b.query) ? created('b0000000000000000000000c') : { data: { posts: { edges: [] } } };
  eq((await publish(s.env, id)).status, 200, 'publishing again is allowed');
}

// ── 8. Deleted in Buffer before it went out ─────────────────────────────────
{
  const s = await setup();
  const id = s.draft({ photo_ids: [await s.photo()] });
  buffer = () => created();
  await publish(s.env, id);
  buffer = () => ({ status: 200, json: { errors: [{ message: 'Post not found for id', extensions: { code: 'NOT_FOUND' } }], data: null } });
  await tick(s.env, '* * * * *');
  eq(s.row(id).status, 'schedule_error', 'a post deleted in Buffer shows as failed');
  ok(/Deleted in Buffer/.test(s.row(id).schedule_error), 'and says why');
}

// ── 9. The sync's windows bound what it spends ──────────────────────────────
{
  calls = [];
  const s = await setup();
  const old = s.draft({ status: 'published' }), mid = s.draft({ status: 'published' });
  const ins = s.db.prepare(`INSERT INTO marketing_publish_log (draft_id, store, status, created_at, buffer_post_id) VALUES (?, 'BL2', 'queued', ?, ?)`);
  ins.run(old, ago(49 * 3600e3), 'b00000000000000000000old');
  ins.run(mid, ago(2 * 3600e3), 'b00000000000000000000mid');
  buffer = () => status('sending');
  await tick(s.env, '* * * * *');
  eq(bufferCalls().length, 0, 'the minute cron leaves posts older than 30 minutes alone');
  await tick(s.env, '0 * * * *');
  eq(bufferCalls().length, 1, 'the hourly cron checks the 2-hour-old one, once');
  eq(s.row(old).status, 'schedule_error', 'a post Buffer never confirmed in 48 h is called failed');
  ok(/48 h/.test(s.row(old).schedule_error), 'and says so');
  eq(s.row(mid).status, 'published', 'the one still sending is left as it is');
}

// ── 10. 🛑 A retry finds the post an earlier attempt made ─────────────────────
{
  calls = [];
  const s = await setup();
  const id = s.draft({ photo_ids: [await s.photo()], publish_attempts: 1 });
  buffer = (b) => /posts\(/.test(b.query)
    ? { data: { posts: { edges: [{ node: { id: 'b0000000000000000000000d', status: 'sending', text: 'Fresh bins at South Bend' } }] } } }
    : created('b00000000000000000000dup');
  const r = await publish(s.env, id);
  eq(r.status, 200, 'the retry succeeds');
  eq(bufferCalls().filter(c => /createPost/.test(c.body.query)).length, 0, '🛑 and does not create a second post');
  eq(s.logs(id)[0].buffer_post_id, 'b0000000000000000000000d', 'it adopts the one Buffer already has');

  // First attempt: nothing to look for, so no extra call.
  calls = [];
  const fresh = s.draft({ photo_ids: [await s.photo()] });
  buffer = () => created('b0000000000000000000000e');
  await publish(s.env, fresh);
  eq(bufferCalls().length, 1, 'a first attempt makes exactly one call');
}

// ── 11. Transient failures retry on the scheduler's backoff; a bad key does not ──
{
  calls = [];
  const s = await setup();
  const id = s.draft({ photo_ids: [await s.photo()], status: 'scheduled', scheduled_at: ago(60e3), publish_live: 1 });
  buffer = () => ({ status: 429, json: { errors: [{ message: 'Too many requests', extensions: { code: 'RATE_LIMIT_EXCEEDED' } }] } });
  await tick(s.env, '* * * * *');
  eq(s.row(id).status, 'scheduled', 'rate-limited: still scheduled');
  ok(!!s.row(id).next_attempt_at, 'with a retry time');

  const id2 = s.draft({ photo_ids: [await s.photo()], status: 'scheduled', scheduled_at: ago(60e3), publish_live: 1 });
  buffer = () => ({ status: 401, json: { errors: [{ message: 'An authentication JWT or Access Token is required', extensions: { code: 'UNAUTHENTICATED' } }] } });
  await tick(s.env, '* * * * *');
  eq(s.row(id2).status, 'schedule_error', 'a refused key fails it straight away (retrying cannot help)');
}

// ── 12. Staged → a Buffer draft for marketing, not followed by the sync ──────
{
  calls = [];
  const s = await setup();
  const id = s.draft({ photo_ids: [await s.photo()] });
  buffer = () => created('b0000000000000000000000f');
  await publish(s.env, id, false);
  const input = bufferCalls()[0].body.variables.input;
  eq(input.saveToDraft, true, 'staged becomes a Buffer draft');
  eq(input.mode, 'addToQueue', 'queued mode, as the Oct 13 draft test used');
  eq(s.logs(id)[0].status, 'staged', "logged 'staged'");
  eq(s.row(id).status, 'approved', 'the draft reads approved, as a staged Graph post did');
  calls = [];
  await tick(s.env, '* * * * *');
  eq(bufferCalls().length, 0, 'the sync does not poll a Buffer draft');
}

// ── 13. A crashed tick's 'publishing' row is reconciled from the queued log ──
{
  calls = [];
  const s = await setup();
  const id = s.draft({ photo_ids: [await s.photo()], status: 'publishing', claimed_at: ago(10 * 60e3), publish_attempts: 1 });
  s.db.prepare(`INSERT INTO marketing_publish_log (draft_id, store, status, created_at, buffer_post_id) VALUES (?, 'BL2', 'queued', ?, 'b0000000000000000000000g')`).run(id, ago(9 * 60e3));
  buffer = () => status('sending');
  await tick(s.env, '* * * * *');
  eq(s.row(id).status, 'published', 'the reaper sees the hand-off and marks it published');
  eq(bufferCalls().filter(c => /createPost/.test(c.body.query)).length, 0, '🛑 without handing it over again');
}

console.log(`\n${assertions - failures} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
