// Content Studio publishes through Buffer (2026-10-19). With BUFFER_API_KEY set, a
// draft is handed to Buffer instead of posted with our own Meta app, and a sync
// follows it until Buffer sends it.
//
// What has to hold:
//   - the payload Buffer needs (channel, shareNow, facebook type, images in order),
//     with image links our own public routes actually serve;
//   - Buffer's 10-image cap (and anything else it would refuse) is refused while
//     someone is watching, never trimmed;
//   - 🛑 a post is never handed over twice. Buffer has no idempotency key, so every
//     hand-off is recorded BEFORE it is made, and an attempt whose answer was lost is
//     looked for before another is made — however the retry arrives (Publish again,
//     Schedule, the Retry button, the cron's backoff);
//   - a failure Buffer reports after the hand-off reaches the card and a push, and one
//     stale read never fails a real post;
//   - the sync spends one call per pass, whatever is queued.
// Drives the real worker.fetch and worker.scheduled against a small fake Buffer: the
// wiring (cron → publisher, cron → sync, endpoint → publisher) is what a
// regex-extracted helper cannot see.
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
const NOT_FOUND = { status: 404, json: { errors: [{ message: 'Post not found for id', extensions: { code: 'NOT_FOUND' } }], data: null } };

// ── A fake Buffer: createPost stores the post; posts() lists them; post() reads one.
// `fake.before(body)` may answer first: return a reply, 'THROW' (the network drops),
// or 'LOST' (Buffer makes the post, then the answer is lost on the way back).
let calls = [];
const fake = { posts: new Map(), seq: 0, before: null };
function resetFake() { calls = []; fake.posts = new Map(); fake.before = null; }
function bufferAnswer(body) {
  const q = body.query;
  if (/createPost/.test(q)) {
    const id = 'b' + String(++fake.seq).padStart(23, '0'), inp = body.variables.input;
    fake.posts.set(id, { id, status: inp.saveToDraft ? 'draft' : 'sending', text: inp.text, channelId: inp.channelId,
      assets: inp.assets.map(a => ({ source: a.image.url })), externalLink: null, error: null, createdAt: new Date().toISOString() });
    return { data: { createPost: { __typename: 'PostActionSuccess', post: { id, status: fake.posts.get(id).status } } } };
  }
  if (/posts\(/.test(q)) {
    // Honours what the worker asks for: channel, created-since, a status filter if given,
    // oldest first, and `first:` with a real hasNextPage.
    const { ch, since } = body.variables;
    const live = /status: \[scheduled, sending, sent\]/.test(q);
    const first = Number((/first: (\d+)/.exec(q) || [])[1] || 20);
    const rows = [...fake.posts.values()].filter(p => ch.includes(p.channelId)
      && (!p.createdAt || p.createdAt >= since) && (!live || ['scheduled', 'sending', 'sent'].includes(p.status)))
      .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
    return { data: { posts: { pageInfo: { hasNextPage: rows.length > first }, edges: rows.slice(0, first).map(node => ({ node })) } } };
  }
  if (/post\(input/.test(q)) {
    const p = fake.posts.get(body.variables.id);
    return p ? { data: { post: p } } : NOT_FOUND;
  }
  return { data: {} };
}
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u === 'https://api.buffer.com') {
    const body = JSON.parse(init.body);
    calls.push({ auth: (init.headers || {}).Authorization, body });
    let r = fake.before ? fake.before(body) : null;
    if (r === 'THROW') throw new Error('The operation was aborted (timeout)');
    if (r === 'LOST') { bufferAnswer(body); throw new Error('socket hang up'); }
    if (r && r.raw) return new Response(r.raw, { status: r.status, headers: { 'Content-Type': 'text/html' } });
    r = r || bufferAnswer(body);
    return new Response(JSON.stringify(r.json || r), { status: r.status || 200, headers: { 'Content-Type': 'application/json' } });
  }
  calls.push({ url: u });
  throw new Error('outbound fetch blocked in test: ' + u.slice(0, 80));
};
const bufferCalls = () => calls.filter(c => c.body);
const creates = () => bufferCalls().filter(c => /createPost/.test(c.body.query)).length;
const lists = () => bufferCalls().filter(c => /posts\(/.test(c.body.query)).length;
// Other live posts on a channel (stories, marketing's own posts) created at `atMs`.
const crowd = (n, atMs, ch = BL2_CHANNEL) => { for (let i = 0; i < n; i++) {
  const id = 'crowd' + String(fake.seq++).padStart(19, '0');
  fake.posts.set(id, { id, status: 'sent', text: '', channelId: ch, assets: [{ source: 'https://scontent.xx.fbcdn.net/' + id + '.jpg' }], createdAt: new Date(atMs + i).toISOString() });
} };
const send = (id, extra = {}) => Object.assign(fake.posts.get(id), { status: 'sent', externalLink: LINK, ...extra });

const uuid = n => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-a${String(n).repeat(3)}-${String(n).repeat(12)}`;
const BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

async function setup({ key = 'buffer-test-key' } = {}) {
  resetFake();
  const { db, env } = makeEnv(repo);
  db.exec(fs.readFileSync(path.join(repo, 'migration-020.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(repo, 'migration-021.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(repo, 'migration-080.sql'), 'utf8'));   // ?action=drafts joins marketing_videos
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
const schedule = (env, id, when = '2099-01-01T09:00') => worker.fetch(req('/?action=draft-schedule', { user: 'u-admin', method: 'POST', body: { id, et_wall_clock: when } }), env, { waitUntil: () => {} });
async function tick(env, cron) {
  const waits = [];
  await worker.scheduled({ cron, scheduledTime: Date.now() }, env, { waitUntil: p => waits.push(p) });
  await Promise.allSettled(waits);
}
const ago = ms => new Date(Date.now() - ms).toISOString();
// A lost attempt younger than 5 minutes may not be listed yet, so a retry waits it out.
const ageHanding = (s, id) => s.db.prepare("UPDATE marketing_publish_log SET created_at=? WHERE draft_id=? AND status='handing'").run(ago(6 * 60e3), id);
// What a person does to make a draft due now: schedule it (resets attempts), then the clock passes.
async function scheduleNow(s, id) {
  eq((await schedule(s.env, id)).status, 200, `draft ${id} schedules`);
  s.db.prepare('UPDATE marketing_drafts SET scheduled_at=? WHERE id=?').run(ago(60e3), id);
}

console.log('Hub → Buffer publishing');

// ── 1. Publish now: the payload Buffer gets, and links our own routes serve ──
{
  const s = await setup();
  const c = await s.cover(), p1 = await s.photo(), p2 = await s.photo({ type: 'retail' });
  const id = s.draft({ thumbnail_id: c, photo_ids: [p1, p2] });
  const r = await publish(s.env, id);
  const j = await r.json();
  eq(r.status, 200, 'publish answers 200');
  ok(/Buffer/.test(j.note || ''), 'and says it went to Buffer');
  eq(bufferCalls().length, 1, 'one call to Buffer (a first attempt has nothing to look for)');
  eq(calls.filter(x => x.url && /graph\.facebook\.com/.test(x.url)).length, 0, '🛑 nothing posted through our own Meta app');
  eq(bufferCalls()[0].auth, 'Bearer buffer-test-key', 'authorised with the key');
  const input = bufferCalls()[0].body.variables.input;
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
  ok(/^b0+1$/.test(L[0].buffer_post_id), 'with the Buffer post id');
  eq(L[0].post_id, null, 'no Facebook id yet');
}

// ── 2. The cover route: same rules as /p/, and the two never cross ──────────
{
  const s = await setup();
  const c = await s.cover();
  const p = await s.photo();
  eq(c, p, '(fixture: a cover and a photo share id ' + c + ')');
  const get = q => worker.fetch(new Request('https://api.retjghub.com' + q), s.env, { waitUntil: () => {} });
  const good = await get(`/t/${c}-${uuid(7)}.png`);
  eq(good.status, 200, 'a cover is served');
  eq(good.headers.get('content-type'), 'image/png', 'as its type');
  eq(good.headers.get('content-security-policy'), "default-src 'none'; sandbox", 'sandboxed');
  eq((await get(`/t/${c}-${uuid(8)}.png`)).status, 404, '🛑 a made-up UUID is refused');
  const pkey = s.db.prepare('SELECT r2_key FROM marketing_photos WHERE id=?').get(p).r2_key.split('/').pop();
  eq((await get(`/t/${p}-${pkey}`)).status, 404, '🛑 a photo is not reachable through the cover route, even at the same id');
  eq((await get(`/p/${c}-${uuid(7)}.png`)).status, 404, '🛑 a cover is not reachable through the photo route, even at the same id');
  // A cover row pointing anywhere but marketing/_thumbnails/ — even at a sign-in-only team photo.
  const team = await s.photo({ type: 'team' });
  const tkey = s.db.prepare('SELECT r2_key FROM marketing_photos WHERE id=?').get(team).r2_key;
  const odd = s.db.prepare(`INSERT INTO marketing_thumbnails (name, r2_key, content_type, created_at) VALUES ('x', ?, 'image/jpeg', 'now')`).run(tkey);
  eq((await get(`/t/${Number(odd.lastInsertRowid)}-${tkey.split('/').pop()}`)).status, 404, '🛑 a cover row outside marketing/_thumbnails/ is refused');
  const svg = s.db.prepare(`INSERT INTO marketing_thumbnails (name, r2_key, content_type, created_at) VALUES ('x', ?, 'image/svg+xml', 'now')`)
    .run(`marketing/_thumbnails/${uuid(4)}.svgxm`);
  await s.env.MEDIA.put(`marketing/_thumbnails/${uuid(4)}.svgxm`, BYTES, {});
  eq((await get(`/t/${Number(svg.lastInsertRowid)}-${uuid(4)}.svgxm`)).status, 404, '🛑 a non-raster cover is refused');
}

// ── 3. 🛑 Buffer's limits are refused while someone is watching, never trimmed ─
{
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
  eq((await schedule(s.env, id)).status, 400, '🛑 scheduling it is refused now, not when nobody is watching');
  eq(s.row(id).status, 'draft', 'still a draft');

  const noCover = s.draft({ photo_ids: ten });
  eq((await publish(s.env, noCover)).status, 200, 'without a cover, 10 photos fit');
  eq(bufferCalls().at(-1).body.variables.input.assets.length, 10, 'all 10 sent');

  // What Buffer could not fetch or take, refused at schedule time too.
  const teamId = s.draft({ photo_ids: [await s.photo({ type: 'team' })] });
  const heicId = s.draft({ photo_ids: [await s.photo({ ct: 'image/heic', ext: 'heic' })] });
  const rt = await schedule(s.env, teamId), rh = await schedule(s.env, heicId);
  ok(rt.status === 400 && /not posted publicly/.test((await rt.json()).error), 'a team photo (sign-in only) is refused at schedule');
  ok(rh.status === 400 && /JPEG, PNG or WebP/.test((await rh.json()).error), 'a HEIC photo is refused at schedule, with the formats Buffer takes');
  const before = bufferCalls().length;
  eq((await publish(s.env, teamId)).status, 400, 'and at publish');
  eq(bufferCalls().length, before, 'neither reached Buffer');
}

// ── 4. No key: the old Graph path, untouched (incl. no Buffer check at schedule) ──
{
  const s = await setup({ key: null });
  const c = await s.cover();
  const ten = []; for (let i = 0; i < 10; i++) ten.push(await s.photo());
  const id = s.draft({ thumbnail_id: c, photo_ids: ten });
  const j = await (await publish(s.env, id)).json();
  ok(/No Page token/.test(j.error || ''), 'without BUFFER_API_KEY it takes the Graph path (here: no Page token)');
  eq((await schedule(s.env, id)).status, 200, 'and scheduling keeps its old rules');
  eq(bufferCalls().length, 0, 'never calls Buffer');
}

// ── 5. A scheduled post goes out on the minute cron, then the sync finds it sent ──
{
  const s = await setup();
  const id = s.draft({ photo_ids: [await s.photo()], status: 'scheduled', scheduled_at: ago(60e3), publish_live: 1 });
  await tick(s.env, '* * * * *');
  eq(s.row(id).status, 'published', 'the cron hands it to Buffer');
  eq(creates(), 1, 'once');
  eq(s.logs(id)[0].status, 'queued', 'queued');

  send(s.logs(id)[0].buffer_post_id);
  await tick(s.env, '* * * * *');
  const L = s.logs(id)[0];
  eq(L.status, 'published', 'the sync marks it published once Buffer sent it');
  eq(L.post_url, LINK, "with Facebook's link");
  eq(L.post_id, '264627006733058_122311668812239321', "and Facebook's post id (comment ingest reads it)");
  eq(creates(), 1, '🛑 never handed over a second time');
  const list = await (await worker.fetch(req('/?action=drafts&status=all', { user: 'u-admin' }), s.env, { waitUntil: () => {} })).json();
  eq(list.drafts.find(d => d.id === id).post_url, LINK, 'the card gets its View link');
  const before = bufferCalls().length;
  await tick(s.env, '* * * * *');
  eq(bufferCalls().length, before, 'a sent post is not checked again');
}

// ── 6. Buffer fails after the hand-off: the card says so, and Retry works ────
{
  const s = await setup();
  const id = s.draft({ photo_ids: [await s.photo()] });
  await publish(s.env, id);
  Object.assign(fake.posts.get(s.logs(id)[0].buffer_post_id), { status: 'error', error: { message: 'Facebook rejected the image' } });
  await tick(s.env, '* * * * *');
  eq(s.row(id).status, 'schedule_error', 'the draft shows as failed');
  ok(/Buffer couldn't post it: Facebook rejected the image/.test(s.row(id).schedule_error), "with Buffer's reason");
  eq(s.logs(id)[0].status, 'error', 'the log row is an error');
  eq((await publish(s.env, id)).status, 200, 'publishing again is allowed');
  eq(creates(), 2, 'and makes a new post (the failed one is not adopted)');
}

// ── 7. 🛑 A lost answer, however the retry arrives, never makes a second post ──
for (const via of ['publish', 'schedule', 'cron-backoff']) {
  const s = await setup();
  const scheduled = via === 'cron-backoff';
  const id = s.draft({ photo_ids: [await s.photo()], ...(scheduled ? { status: 'scheduled', scheduled_at: ago(60e3), publish_live: 1 } : {}) });
  fake.before = b => /createPost/.test(b.query) ? 'LOST' : null;   // Buffer makes it; the answer never arrives
  if (scheduled) await tick(s.env, '* * * * *'); else eq((await publish(s.env, id)).status, 503, `[${via}] the lost answer reads as unreachable`);
  eq(fake.posts.size, 1, `[${via}] (Buffer did make the post)`);
  eq(s.logs(id)[0].status, 'handing', `[${via}] the hand-off was recorded before it was made`);
  fake.before = null;
  if (via === 'publish') await publish(s.env, id);
  if (via === 'schedule') { await scheduleNow(s, id); await tick(s.env, '* * * * *'); }
  if (via === 'cron-backoff') { s.db.prepare('UPDATE marketing_drafts SET next_attempt_at=? WHERE id=?').run(ago(1000), id); await tick(s.env, '* * * * *'); }
  eq(fake.posts.size, 1, `🛑 [${via}] the retry does not make a second post`);
  eq(s.row(id).status, 'published', `[${via}] it adopts the one Buffer has`);
  const L = s.logs(id);
  eq(L.map(x => x.status).join(','), 'superseded,queued', `[${via}] the lost attempt is resolved and the adopted one queued`);
  eq(L[1].buffer_post_id, [...fake.posts.keys()][0], `[${via}] queued under Buffer's id`);
}

// ── 8. 🛑 …and the look-up adopts only THIS draft's live post ─────────────────
{
  // A lost attempt that never reached Buffer: nothing to adopt, so it is made.
  let s = await setup();
  let id = s.draft({ photo_ids: [await s.photo()] });
  fake.before = b => /createPost/.test(b.query) ? 'THROW' : null;
  await publish(s.env, id);
  fake.before = null;
  const quick = await publish(s.env, id);
  ok(quick.status === 503 && /few minutes/.test((await quick.json()).error), '🛑 a retry seconds later waits: the lost one may not be listed yet');
  eq(fake.posts.size, 0, 'and makes nothing');
  ageHanding(s, id);
  await publish(s.env, id);
  eq(fake.posts.size, 1, 'a hand-off that never arrived is made on a later retry');

  // Staged first (a Buffer DRAFT, same text and images), then a lost live attempt:
  // the Buffer draft must not be adopted as the live post.
  s = await setup();
  id = s.draft({ photo_ids: [await s.photo()] });
  await publish(s.env, id, false);
  eq([...fake.posts.values()][0].status, 'draft', '(staged: a Buffer draft)');
  fake.before = b => /createPost/.test(b.query) ? 'THROW' : null;
  await publish(s.env, id);
  fake.before = null;
  ageHanding(s, id);
  await publish(s.env, id);
  const live = [...fake.posts.values()].filter(p => p.status !== 'draft');
  eq(live.length, 1, '🛑 the live publish made a live post, not adopting the Buffer draft');
  eq(s.logs(id).at(-1).buffer_post_id, live[0].id, 'and queued that one');

  // Empty caption, with a story on the channel (Buffer lists those with empty text).
  s = await setup();
  id = s.draft({ photo_ids: [await s.photo()], caption: '' });
  fake.posts.set('story0000000000000000000', { id: 'story0000000000000000000', status: 'sent', text: '', channelId: BL2_CHANNEL,
    assets: [{ source: 'https://scontent.xx.fbcdn.net/story.jpg' }] });
  fake.before = b => /createPost/.test(b.query) ? 'THROW' : null;
  await publish(s.env, id);
  fake.before = null;
  ageHanding(s, id);
  await publish(s.env, id);
  eq(creates(), 2, '🛑 an unrelated empty-text story is not adopted');

  // Coliseum and Dupont share a channel: the same caption on the other store's post is not this one.
  s = await setup();
  const mine = s.draft({ photo_ids: [await s.photo()] }), theirs = s.draft({ photo_ids: [await s.photo()] });
  await publish(s.env, theirs);
  fake.before = b => /createPost/.test(b.query) ? 'THROW' : null;
  await publish(s.env, mine);
  fake.before = null;
  ageHanding(s, mine);
  await publish(s.env, mine);
  eq(fake.posts.size, 2, '🛑 a post with the same caption but other photos is not adopted');

  // A definite refusal is not "maybe made": the next attempt does not look.
  s = await setup();
  id = s.draft({ photo_ids: [await s.photo()] });
  fake.before = b => /createPost/.test(b.query) ? { data: { createPost: { __typename: 'InvalidInputError', message: 'text too long' } } } : null;
  eq((await publish(s.env, id)).status, 400, 'a refusal answers 400');
  eq(s.logs(id)[0].status, 'error', 'and is logged as an error, not a lost hand-off');
  fake.before = null;
  await publish(s.env, id);
  eq(lists(), 0, 'so the next attempt goes straight to createPost');

  // Can't look (Buffer down for the look-up): refuse rather than risk a second post.
  s = await setup();
  id = s.draft({ photo_ids: [await s.photo()] });
  fake.before = b => /createPost/.test(b.query) ? 'LOST' : null;
  await publish(s.env, id);
  fake.before = b => /posts\(/.test(b.query) ? { status: 502, json: { errors: [{ message: 'Bad gateway' }] } } : null;
  const r = await publish(s.env, id);
  ok(r.status >= 500, `🛑 with the look-up failing, the retry is refused (${r.status})`);
  eq(fake.posts.size, 1, 'and makes nothing');

  // The hand-off cannot be recorded: nothing is sent.
  s = await setup();
  id = s.draft({ photo_ids: [await s.photo()] });
  const realPrepare = s.env.DB.prepare.bind(s.env.DB);
  s.env.DB.prepare = sql => { if (/'handing'/.test(sql) && /INSERT/.test(sql)) throw new Error('D1 unavailable'); return realPrepare(sql); };
  const rr = await publish(s.env, id);
  ok(rr.status >= 400, 'a hand-off it cannot record is refused');
  eq(fake.posts.size, 0, '🛑 and never reaches Buffer');
}

// ── 9. Deleted in Buffer: only a NOT_FOUND seen twice, 5 minutes apart ───────
{
  const s = await setup();
  const id = s.draft({ photo_ids: [await s.photo()] });
  await publish(s.env, id);
  fake.posts.clear();                       // gone from Buffer
  await tick(s.env, '* * * * *');
  eq(s.row(id).status, 'published', 'one NOT_FOUND is not enough');
  ok(/^not_found_at:/.test(s.logs(id)[0].response), 'it is noted');
  await tick(s.env, '* * * * *');
  eq(s.row(id).status, 'published', 'nor a second one a minute later');
  s.db.prepare('UPDATE marketing_publish_log SET response=? WHERE draft_id=?').run('not_found_at:' + ago(6 * 60e3), id);
  await tick(s.env, '* * * * *');
  eq(s.row(id).status, 'schedule_error', 'seen again 5+ minutes later, it shows as failed');
  ok(/Deleted in Buffer/.test(s.row(id).schedule_error), 'and says why');

  // A gateway's HTML 404 is not Buffer saying "deleted".
  const s2 = await setup();
  const id2 = s2.draft({ photo_ids: [await s2.photo()] });
  await publish(s2.env, id2);
  fake.posts.clear();
  fake.before = b => /post\(input/.test(b.query) ? { raw: '<html>404 Not Found</html>', status: 404 } : null;
  s2.db.prepare('UPDATE marketing_publish_log SET response=? WHERE draft_id=?').run('not_found_at:' + ago(6 * 60e3), id2);
  await tick(s2.env, '* * * * *');
  eq(s2.row(id2).status, 'published', '🛑 an HTML 404 never fails a post');
}

// ── 10. The sync spends one call per pass, and stops on a 429 ────────────────
{
  const s = await setup();
  const ids = [];
  for (let i = 0; i < 6; i++) { const id = s.draft({ photo_ids: [await s.photo()] }); ids.push(id); await publish(s.env, id); }
  calls = [];
  await tick(s.env, '* * * * *');
  eq(bufferCalls().length, 1, 'six queued posts: one list call');
  calls = [];
  fake.before = () => ({ status: 429, json: { errors: [{ message: 'Too many requests', extensions: { code: 'RATE_LIMIT_EXCEEDED', window: '15m' } }] } });
  await tick(s.env, '* * * * *');
  eq(bufferCalls().length, 1, 'rate-limited: one call, then it stops');
  ok(ids.every(id => s.row(id).status === 'published'), 'and nothing is failed for it');
}

// ── 11. The windows: minute for 30 min, hourly to 48 h, then 'unconfirmed' ──
{
  const s = await setup();
  const old = s.draft({ status: 'published' }), mid = s.draft({ status: 'published' });
  const ins = s.db.prepare(`INSERT INTO marketing_publish_log (draft_id, store, status, created_at, buffer_post_id) VALUES (?, 'BL2', 'queued', ?, ?)`);
  ins.run(old, ago(49 * 3600e3), 'b00000000000000000000old');
  ins.run(mid, ago(2 * 3600e3), 'b00000000000000000000mid');
  fake.posts.set('b00000000000000000000mid', { id: 'b00000000000000000000mid', status: 'sending', channelId: BL2_CHANNEL, assets: [] });
  await tick(s.env, '* * * * *');
  eq(bufferCalls().length, 0, 'the minute cron leaves posts older than 30 minutes alone');
  await tick(s.env, '0 * * * *');
  eq(bufferCalls().length, 1, 'the hourly cron checks the 2-hour-old one, in one call');
  eq(s.row(old).status, 'schedule_error', 'a post Buffer never confirmed in 48 h is called failed');
  ok(/48 h/.test(s.row(old).schedule_error), 'and says so');
  eq(s.logs(old)[0].status, 'unconfirmed', "logged 'unconfirmed': Buffer may still send it");
  eq(s.row(mid).status, 'published', 'the one still sending is left as it is');

  // Retry on the unconfirmed one: if Buffer did send it after all, it is adopted, not re-made.
  s.db.prepare('UPDATE marketing_drafts SET photo_ids=? WHERE id=?').run(JSON.stringify([await s.photo()]), old);
  fake.posts.set('b00000000000000000000old', { id: 'b00000000000000000000old', status: 'sent', channelId: BL2_CHANNEL, assets: [] });
  const before = creates();
  eq((await publish(s.env, old)).status, 200, 'Retry on the unconfirmed post');
  eq(creates(), before, '🛑 finds Buffer sent it after all, and makes no second post');
}

// ── 12. Transient failures retry on the scheduler's backoff; a bad key does not ──
{
  const s = await setup();
  const id = s.draft({ photo_ids: [await s.photo()], status: 'scheduled', scheduled_at: ago(60e3), publish_live: 1 });
  fake.before = () => ({ status: 429, json: { errors: [{ message: 'Too many requests', extensions: { code: 'RATE_LIMIT_EXCEEDED' } }] } });
  await tick(s.env, '* * * * *');
  eq(s.row(id).status, 'scheduled', 'rate-limited: still scheduled');
  ok(!!s.row(id).next_attempt_at, 'with a retry time');
  eq(s.logs(id)[0].status, 'error', 'a 429 is a definite "not made", so no look-up next time');

  const id2 = s.draft({ photo_ids: [await s.photo()], status: 'scheduled', scheduled_at: ago(60e3), publish_live: 1 });
  fake.before = () => ({ status: 401, json: { errors: [{ message: 'An authentication JWT or Access Token is required', extensions: { code: 'UNAUTHENTICATED' } }] } });
  await tick(s.env, '* * * * *');
  eq(s.row(id2).status, 'schedule_error', 'a refused key fails it straight away (retrying cannot help)');
}

// ── 13. Staged → a Buffer draft for marketing, not followed by the sync ──────
{
  const s = await setup();
  const id = s.draft({ photo_ids: [await s.photo()] });
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

// ── 14. A crashed tick's 'publishing' row is reconciled from the queued log ──
{
  const s = await setup();
  const id = s.draft({ photo_ids: [await s.photo()], status: 'publishing', claimed_at: ago(10 * 60e3), publish_attempts: 1 });
  s.db.prepare(`INSERT INTO marketing_publish_log (draft_id, store, status, created_at, buffer_post_id) VALUES (?, 'BL2', 'queued', ?, 'b0000000000000000000000g')`).run(id, ago(9 * 60e3));
  await tick(s.env, '* * * * *');
  eq(s.row(id).status, 'published', 'the reaper sees the hand-off and marks it published');
  eq(creates(), 0, '🛑 without handing it over again');
}

// ── 16. 🛑 The look-up matches what was SENT, not the draft as it is now ──────
{
  const s = await setup();
  const id = s.draft({ photo_ids: [await s.photo()] });
  fake.before = b => /createPost/.test(b.query) ? 'LOST' : null;
  await publish(s.env, id);                                   // Buffer has it; the answer was lost
  fake.before = null;
  const d = s.row(id);
  const ed = await worker.fetch(req('/?action=draft-save', { user: 'u-admin', method: 'POST',
    body: { id, store: 'BL2', thumbnail_id: null, photo_ids: JSON.parse(d.photo_ids), caption: 'Fixed a typo' } }), s.env, { waitUntil: () => {} });
  eq(ed.status, 200, 'the admin edits the caption before retrying');
  await publish(s.env, id);
  eq(fake.posts.size, 1, '🛑 the retry still finds the post that went out with the OLD caption');
  eq(s.row(id).status, 'published', 'and adopts it');
}

// ── 17. 🛑 Earlier attempts stay open until the new one is recorded ──────────
{
  // The adopt succeeds, but recording the new hand-off fails: the lost attempt must stay
  // findable, or the next retry looks from too late and posts again.
  const s = await setup();
  const id = s.draft({ photo_ids: [await s.photo()] });
  fake.before = b => /createPost/.test(b.query) ? 'LOST' : null;
  await publish(s.env, id);
  fake.before = null;
  const realPrepare = s.env.DB.prepare.bind(s.env.DB);
  let breakInsert = true;
  s.env.DB.prepare = sql => { if (breakInsert && /INSERT/.test(sql) && /'handing'/.test(sql)) throw new Error('D1 unavailable'); return realPrepare(sql); };
  const r = await publish(s.env, id);
  ok(r.status >= 400, 'the retry that cannot record its hand-off fails');
  eq(s.row(id).status, 'draft', 'and releases its claim (no card stuck in publishing)');
  eq(s.logs(id)[0].status, 'handing', 'the lost attempt is still open');
  breakInsert = false;
  await publish(s.env, id);
  eq(fake.posts.size, 1, '🛑 the next retry still adopts it: one post');

  // The adopt succeeds but every write after it fails: same rule.
  const s2 = await setup();
  const id2 = s2.draft({ photo_ids: [await s2.photo()] });
  fake.before = b => /createPost/.test(b.query) ? 'LOST' : null;
  await publish(s2.env, id2);
  fake.before = null;
  s2.db.prepare("UPDATE marketing_publish_log SET created_at=? WHERE draft_id=?").run(ago(10 * 60e3), id2);   // made 10 min ago
  const real2 = s2.env.DB.prepare.bind(s2.env.DB);
  let breakSettle = true;
  s2.env.DB.prepare = sql => { if (breakSettle && /^\s*UPDATE marketing_(publish_log SET status=\?, buffer_post_id|drafts SET status=\?)/.test(sql)) throw new Error('D1 unavailable'); return real2(sql); };
  await publish(s2.env, id2);
  ok(s2.logs(id2).some(l => l.status === 'handing' && l.created_at < ago(9 * 60e3)), 'the 10-minute-old attempt is not superseded');
  breakSettle = false;
  s2.db.prepare("UPDATE marketing_drafts SET status='draft' WHERE id=?").run(id2);   // as the reaper/requeue would leave it
  await publish(s2.env, id2);
  eq(fake.posts.size, 1, '🛑 a later retry looks from the earliest attempt and still adopts: one post');
}

// ── 18. 🛑 Staged, then rescheduled live: it goes out live ────────────────────
{
  const s = await setup();
  const id = s.draft({ photo_ids: [await s.photo()], status: 'scheduled', scheduled_at: ago(60e3), publish_live: 0 });
  await tick(s.env, '* * * * *');
  eq(s.row(id).status, 'approved', 'staged: a Buffer draft');
  eq((await worker.fetch(req('/?action=draft-schedule', { user: 'u-admin', method: 'POST', body: { id, et_wall_clock: '2099-01-01T09:00', publish_live: true } }), s.env, { waitUntil: () => {} })).status, 200, 'rescheduled live');
  s.db.prepare('UPDATE marketing_drafts SET scheduled_at=? WHERE id=?').run(ago(60e3), id);
  await tick(s.env, '* * * * *');
  const live = [...fake.posts.values()].filter(p => p.status !== 'draft');
  eq(live.length, 1, '🛑 a live post is made (the staged copy does not count as posted live)');
  eq(s.row(id).status, 'published', 'and the draft is published');
}

// ── 19. 🛑 Paging: a full page inside the attempt's window can't rule it out; a page
//        that runs well past the attempt can — and then the attempt is closed ─────
{
  let s = await setup();
  let id = s.draft({ photo_ids: [await s.photo()] });
  fake.before = b => /createPost/.test(b.query) ? 'THROW' : null;
  await publish(s.env, id);
  fake.before = null;
  ageHanding(s, id);
  const at = new Date(s.logs(id)[0].created_at).getTime();
  crowd(101, at + 30e3);                                  // 101 posts within a minute of the attempt
  const r = await publish(s.env, id);
  ok(r.status === 503 && /rule out/.test((await r.json()).error), 'a full page all inside the window: refused');
  eq(creates(), 1, 'and nothing more is made');            // (the THROWn one never reached the fake)

  // 🛑 A month later, 101 posts AFTER the window: the attempt is proven never-made, closed,
  // and the post goes out (it used to refuse forever).
  s = await setup();
  id = s.draft({ photo_ids: [await s.photo()] });
  fake.before = b => /createPost/.test(b.query) ? 'THROW' : null;
  await publish(s.env, id);
  fake.before = null;
  s.db.prepare("UPDATE marketing_publish_log SET created_at=? WHERE draft_id=? AND status='handing'").run(ago(30 * 864e5), id);
  crowd(101, Date.now() - 29 * 864e5);
  eq((await publish(s.env, id)).status, 200, '🛑 the retry posts');
  eq(s.logs(id)[0].status, 'superseded', 'and the never-made attempt is closed');
  eq([...fake.posts.values()].filter(p => !/^crowd/.test(p.id)).length, 1, 'one post');
}

// ── 20. 🛑 A never-made attempt is closed as soon as a look proves it, so a refusal
//        after it can't leave it open to pin every later search ─────────────────
{
  const s = await setup();
  const id = s.draft({ photo_ids: [await s.photo()] });
  fake.before = b => /createPost/.test(b.query) ? 'THROW' : null;
  await publish(s.env, id);                                // never arrived
  ageHanding(s, id);
  fake.before = b => /createPost/.test(b.query) ? { data: { createPost: { __typename: 'InvalidInputError', message: 'Buffer said no' } } } : null;
  await publish(s.env, id);                                // looked (nothing), then refused
  eq(s.logs(id).map(l => l.status).join(','), 'superseded,error', 'the lost attempt is closed by the look, not left open');
  fake.before = null;
  calls = [];
  await publish(s.env, id);
  eq(lists(), 0, 'so the next attempt does not look again');
  eq(creates(), 1, 'and posts');
}

// ── 21. 🛑 A post found in Buffer is live, whatever the retry asked for ────────
{
  const s = await setup();
  const id = s.draft({ photo_ids: [await s.photo()] });
  fake.before = b => /createPost/.test(b.query) ? 'LOST' : null;
  await publish(s.env, id);                                // live; Buffer has it, answer lost
  fake.before = null;
  const r = await publish(s.env, id, false);               // then someone Stages it
  const j = await r.json();
  ok(/already had this post/.test(j.note || ''), 'the retry says Buffer already had it');
  eq(s.row(id).status, 'published', '🛑 the draft reads published (it IS live), not approved');
  eq(s.logs(id).at(-1).status, 'queued', "logged 'queued', so a later live publish can't make a second");
  eq((await schedule(s.env, id)).status, 409, 'and it cannot be scheduled again');
  eq(fake.posts.size, 1, 'one post');
}

// ── 22. 🛑 The reaper finishes the interrupted attempt as what IT was ────────
{
  // A manual Stage on a draft whose schedule says live, interrupted after Buffer took it.
  const s = await setup();
  const id = s.draft({ photo_ids: [await s.photo()], status: 'publishing', claimed_at: ago(10 * 60e3), publish_attempts: 1, publish_live: 1 });
  s.db.prepare(`INSERT INTO marketing_publish_log (draft_id, store, status, created_at, buffer_post_id) VALUES (?, 'BL2', 'staged', ?, 'b00000000000000000stage1')`).run(id, ago(9 * 60e3));
  await tick(s.env, '* * * * *');
  eq(s.row(id).status, 'approved', '🛑 a staged hand-off is finished as staged, not published live');
  eq(creates(), 0, 'and nothing is posted');

  // A staged row from an EARLIER attempt says nothing about this one.
  const s2 = await setup();
  const id2 = s2.draft({ photo_ids: [await s2.photo()], status: 'publishing', claimed_at: ago(10 * 60e3), publish_attempts: 1, publish_live: 1 });
  s2.db.prepare(`INSERT INTO marketing_publish_log (draft_id, store, status, created_at, buffer_post_id) VALUES (?, 'BL2', 'staged', ?, 'b00000000000000000stage2')`).run(id2, ago(864e5));
  await tick(s2.env, '* * * * *');
  eq(s2.row(id2).status, 'scheduled', 'an older staged copy does not mark this attempt done: it is requeued');
}

// ── 23. A "can't rule it out yet" refusal is not a try ───────────────────────
{
  const s = await setup();
  const id = s.draft({ photo_ids: [await s.photo()], status: 'scheduled', scheduled_at: ago(60e3), publish_live: 1 });
  fake.before = b => /createPost/.test(b.query) ? 'THROW' : null;
  await tick(s.env, '* * * * *');                          // try 1: never arrived
  fake.before = null;
  eq(s.row(id).publish_attempts, 1, 'one try used');
  s.db.prepare('UPDATE marketing_drafts SET next_attempt_at=? WHERE id=?').run(ago(1000), id);
  await tick(s.env, '* * * * *');                          // 2 min later: too fresh to rule out
  eq(s.row(id).status, 'scheduled', 'too fresh to rule out: it waits');
  eq(s.row(id).publish_attempts, 1, '🛑 without spending a try');
  ok(/few minutes/.test(s.row(id).schedule_error || ''), 'and says why');
  ageHanding(s, id);
  s.db.prepare('UPDATE marketing_drafts SET next_attempt_at=? WHERE id=?').run(ago(1000), id);
  await tick(s.env, '* * * * *');
  eq(s.row(id).status, 'published', 'then it posts');
  eq(creates(), 2, '(the THROWn call plus the real one: one post on Facebook)');
  eq(fake.posts.size, 1, 'one post');
}



// ── 15. 🛑 A publish log it cannot read stops a publish (fail closed) ──────────
{
  const s = await setup();
  const id = s.draft({ photo_ids: [await s.photo()], status: 'scheduled', scheduled_at: ago(60e3), publish_live: 1 });
  const realPrepare = s.env.DB.prepare.bind(s.env.DB);
  s.env.DB.prepare = sql => (/COALESCE\(post_id, buffer_post_id\)/.test(sql) ? realPrepare('SELECT no_such_column FROM marketing_publish_log') : realPrepare(sql));
  await tick(s.env, '* * * * *');
  eq(creates(), 0, '🛑 the reconcile cannot read the log, so nothing is posted');
  eq(s.row(id).status, 'scheduled', 'the post waits');
  ok(/Publish log unreadable/.test(s.row(id).schedule_error || ''), 'and says why');
}

console.log(`\n${assertions - failures} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
