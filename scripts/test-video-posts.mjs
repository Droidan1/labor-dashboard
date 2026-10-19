// Video posts (2026-10-19): Content Studio posts ONE video to the store's Facebook Page
// through Buffer — a store walk as a normal video, a short clip as a Reel.
//
// What has to hold:
//   - /v/ serves a FINISHED video publicly, by an unguessable link, with Range (Safari
//     and Buffer's fetcher), and nothing else — not an unfinished upload, not a photo;
//   - ?action=video is signed-in and store-scoped, with CORS credentials so Content
//     Studio can grab a frame; ?action=video-poster stores that frame;
//   - a video draft is one video and nothing else, from the same store;
//   - Buffer gets the video URL our own route serves, as `post` or `reel`;
//   - the caption writer is told it is a video and sees its poster frame.
// Drives the real worker.fetch / worker.scheduled.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, applyMigrationAlters, req } from './lib/worker-harness.mjs';

const repo = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
let assertions = 0, failures = 0;
const ok = (c, m) => { assertions++; if (!c) { failures++; console.error('  FAIL ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
const json = async r => { try { return await r.json(); } catch { return {}; } };
const worker = await loadWorker(repo);
const ctx = { waitUntil: () => {}, passThroughOnException() {} };

// Outbound: a fake Buffer (createPost stores the post) and a fake Anthropic (records the ask).
let calls = [], buffer = new Map(), seq = 0, asked = [], rehost = false;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u === 'https://api.buffer.com') {
    const body = JSON.parse(init.body); calls.push(body);
    if (/createPost/.test(body.query)) {
      const id = 'v' + String(++seq).padStart(23, '0'), inp = body.variables.input;
      // rehost: Buffer keeps the video under ITS OWN URL, as a transcoder may.
      buffer.set(id, { id, status: 'sending', text: inp.text, channelId: inp.channelId, createdAt: new Date().toISOString(),
        assets: inp.assets.map(a => a.video ? { type: 'video', source: rehost ? `https://buffer-media.example/${id}.mp4` : a.video.url } : { type: 'image', source: a.image.url }) });
      return new Response(JSON.stringify({ data: { createPost: { __typename: 'PostActionSuccess', post: { id, status: 'sending' } } } }));
    }
    if (/posts\(/.test(body.query)) return new Response(JSON.stringify({ data: { posts: { pageInfo: { hasNextPage: false }, edges: [...buffer.values()].map(node => ({ node })) } } }));
    return new Response(JSON.stringify({ data: {} }));
  }
  if (u.startsWith('https://api.anthropic.com/')) {
    asked.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Walk the floor with us! #BargainLaneSouthBend' }] }));
  }
  throw new Error('outbound fetch blocked in test: ' + u.slice(0, 80));
};

const uuid = n => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-a${String(n).repeat(3)}-${String(n).repeat(12)}`;
const BYTES = new Uint8Array(Array.from({ length: 100 }, (_, i) => i));   // 0..99, so ranges are checkable

async function setup({ key = 'buffer-test-key' } = {}) {
  calls = []; buffer = new Map(); asked = []; rehost = false;
  const { db, env } = makeEnv(repo);
  for (const m of ['020', '021', '025', '080']) db.exec(fs.readFileSync(path.join(repo, `migration-${m}.sql`), 'utf8'));
  applyMigrationAlters(db, repo);
  if (key) env.BUFFER_API_KEY = key;
  env.ANTHROPIC_API_KEY = 'test-anthropic';
  env.MEDIA.head = async k => { const o = await env.MEDIA.get(k); return o ? { size: o.size } : null; };
  // R2's get(key, { range }) returns just those bytes, with the object's full size.
  const realGet = env.MEDIA.get;
  env.MEDIA.get = async (k, opts) => {
    const o = await realGet(k); if (!o || !opts || !opts.range) return o;
    const buf = new Uint8Array(await o.arrayBuffer()), { offset, length } = opts.range;
    const part = buf.slice(offset, offset + length);
    return { size: o.size, range: opts.range, get body() { return new Blob([part]).stream(); }, arrayBuffer: async () => part.buffer };
  };
  let n = 0;
  const video = async ({ store = 'BL2', type = 'store_walk', status = 'new', ct = 'video/quicktime', ext = 'mov', ms = type === 'clip' ? 45000 : 190000, w = type === 'clip' ? 1080 : 1920, h = type === 'clip' ? 1920 : 1080, poster = false, note = null } = {}) => {
    const u = uuid(++n % 10), key = `marketing/${store}/video/2026-10/${n}/${u}.${ext}`;
    const r = db.prepare(`INSERT INTO marketing_videos (store, video_type, r2_key, content_type, bytes, duration_ms, width, height, uploader, note, status, created_at)
                          VALUES (?,?,?,?,?,?,?,?,'m@x.com',?,?,?)`).run(store, type, key, ct, BYTES.length, ms, w, h, note, status, new Date().toISOString());
    await env.MEDIA.put(key, BYTES, { httpMetadata: { contentType: ct } });
    if (poster) await env.MEDIA.put(key.replace(/\.[a-z0-9]+$/, '.thumb.jpg'), new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 1, 2]), {});
    return { id: Number(r.lastInsertRowid), key, path: `/v/${Number(r.lastInsertRowid)}-${u}.${ext}` };
  };
  const draft = (f) => {
    const r = db.prepare(`INSERT INTO marketing_drafts (store, thumbnail_id, photo_ids, video_id, caption, caption_source, status, created_at, updated_at)
                          VALUES (?,?,?,?,?,'manual','draft',?,?)`).run(f.store || 'BL2', f.thumbnail_id || null, JSON.stringify(f.photo_ids || []), f.video_id || null, f.caption || 'Walk the floor', new Date().toISOString(), new Date().toISOString());
    return Number(r.lastInsertRowid);
  };
  return { db, env, video, draft, row: id => db.prepare('SELECT * FROM marketing_drafts WHERE id=?').get(id) };
}
const pub = (env, p, headers = {}, method = 'GET') => worker.fetch(new Request('https://api.retjghub.com' + p, { method, headers }), env, ctx);
const call = (env, url, opts = {}) => worker.fetch(req(url, opts), env, ctx);

console.log('video posts');

// ── 1. /v/: public, finished only, with ranges ─────────────────────────────
{
  const s = await setup();
  const v = await s.video();
  const r = await pub(s.env, v.path);
  eq(r.status, 200, 'a finished video is served with no sign-in');
  eq(r.headers.get('content-type'), 'video/quicktime', 'as its type');
  eq(r.headers.get('accept-ranges'), 'bytes', 'and says it takes ranges');
  eq(r.headers.get('content-length'), '100', 'with its length');
  eq(r.headers.get('content-security-policy'), "default-src 'none'; sandbox", 'sandboxed');
  eq(r.headers.get('x-content-type-options'), 'nosniff', 'nosniff');
  eq((await r.arrayBuffer()).byteLength, 100, 'the whole file');
  const part = await pub(s.env, v.path, { Range: 'bytes=10-19' });
  eq([part.status, part.headers.get('content-range'), part.headers.get('content-length')], [206, 'bytes 10-19/100', '10'], '🔑 a Range gets a 206 with Content-Range (Safari will not play without it)');
  eq([...new Uint8Array(await part.arrayBuffer())], [10, 11, 12, 13, 14, 15, 16, 17, 18, 19], 'and exactly those bytes');
  const tail = await pub(s.env, v.path, { Range: 'bytes=-5' });
  eq([tail.status, tail.headers.get('content-range')], [206, 'bytes 95-99/100'], 'a suffix range');
  const open = await pub(s.env, v.path, { Range: 'bytes=90-' });
  eq([open.status, open.headers.get('content-range')], [206, 'bytes 90-99/100'], 'an open-ended range');
  const over = await pub(s.env, v.path, { Range: 'bytes=90-500' });
  eq(over.headers.get('content-range'), 'bytes 90-99/100', 'a range past the end is clipped');
  eq((await pub(s.env, v.path, { Range: 'bytes=200-300' })).status, 416, 'a range wholly past the end is 416');
  eq((await pub(s.env, v.path, { Range: 'bytes=0-1,5-6' })).status, 200, 'several ranges: ignored, the whole file (RFC 9110), not a refusal');
  eq((await pub(s.env, v.path, { Range: 'bytes=5-2' })).status, 200, 'an end before its start: ignored, the whole file');
  eq((await pub(s.env, v.path, { Range: 'Bytes=0-0' })).headers.get('content-range'), 'bytes 0-0/100', "the unit is case-insensitive, and bytes=0-0 is one byte");
  const head = await pub(s.env, v.path, {}, 'HEAD');
  ok(head.status === 200 && head.headers.get('content-length') === '100' && (await head.arrayBuffer()).byteLength === 0, 'HEAD answers with the length and no body');

  for (const [what, opts] of [['an upload still in progress', { status: 'uploading' }], ['an aborted upload', { status: 'aborted' }], ['a rejected video', { status: 'rejected' }]]) {
    const x = await s.video(opts);
    eq((await pub(s.env, x.path)).status, 404, `🛑 not ${what}`);
  }
  eq((await pub(s.env, v.path.replace(/-(\d)/, '-9'))).status, 404, '🛑 not with a made-up UUID');
  const odd = await s.video({ ct: 'text/html', ext: 'mp4' });
  eq((await pub(s.env, odd.path)).status, 404, '🛑 not a row whose type is not a video type');
  const misfiled = await s.video();
  s.db.prepare("UPDATE marketing_videos SET r2_key=? WHERE id=?").run(misfiled.key.replace('/video/', '/team/'), misfiled.id);
  eq((await pub(s.env, misfiled.path)).status, 404, '🛑 not a key outside marketing/<store>/video/');
}

// ── 2. ?action=video and the poster frame ──────────────────────────────────
{
  const s = await setup();
  const v = await s.video({ store: 'BL1' });
  const mine = await call(s.env, `/?action=video&id=${v.id}`, { user: 'u-mgr1' });
  eq(mine.status, 200, "a Coliseum manager can watch Coliseum's video");
  eq((await call(s.env, `/?action=video&id=${v.id}`, { user: 'u-mgr1', method: 'GET' })).headers.get('accept-ranges'), 'bytes', 'with ranges');
  const other = await s.video({ store: 'BL2' });
  eq((await call(s.env, `/?action=video&id=${other.id}`, { user: 'u-mgr1' })).status, 403, "🛑 but not South Bend's");
  eq((await worker.fetch(new Request(`https://api.retjghub.com/?action=video&id=${v.id}`), s.env, ctx)).status, 401, '🛑 signed out: refused');
  const cors = await worker.fetch(new Request(`https://api.retjghub.com/?action=video&id=${v.id}`, { headers: { Cookie: 'session=sess-u-admin', Origin: 'https://www.retjghub.com' } }), s.env, ctx);
  eq([cors.headers.get('access-control-allow-origin'), cors.headers.get('access-control-allow-credentials')], ['https://www.retjghub.com', 'true'],
     '🔑 CORS with credentials, so Content Studio can draw a frame of it onto a canvas');
  eq((await call(s.env, `/?action=video&id=${v.id}&size=thumb`, { user: 'u-admin' })).status, 404, 'no poster yet');
  const pre = await worker.fetch(new Request(`https://api.retjghub.com/?action=video&id=${v.id}`, { method: 'OPTIONS', headers: { Origin: 'https://www.retjghub.com', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'range' } }), s.env, ctx);
  ok(/\bRange\b/i.test(pre.headers.get('access-control-allow-headers') || ''), 'the preflight allows a Range header (Safari, fetch())');

  const fd = (type = 'image/jpeg', n = 6) => { const f = new FormData(); f.append('id', String(v.id)); f.append('poster', new Blob([new Uint8Array(n)], { type }), 'poster.jpg'); return f; };
  const post = (user, body) => worker.fetch(new Request('https://api.retjghub.com/?action=video-poster', { method: 'POST', headers: { Cookie: `session=sess-${user}` }, body }), s.env, ctx);
  eq((await post('u-mgr1', fd())).status, 403, '🛑 only an admin saves a poster');
  eq((await post('u-admin', fd('image/png'))).status, 400, 'a poster must be a JPEG');
  eq((await post('u-admin', fd('image/jpeg', 600 * 1024))).status, 400, 'and under 512 KB');
  eq((await post('u-admin', fd())).status, 200, 'an admin saves the frame');
  const th = await call(s.env, `/?action=video&id=${v.id}&size=thumb`, { user: 'u-admin' });
  eq([th.status, th.headers.get('content-type')], [200, 'image/jpeg'], 'and it is served as the poster');

  const list = await json(await call(s.env, '/?action=marketing-videos&store=BL1', { user: 'u-admin' }));
  await s.video({ store: 'BL1', status: 'uploading' });
  const list2 = await json(await call(s.env, '/?action=marketing-videos&store=BL1', { user: 'u-admin' }));
  eq(list.videos.map(x => [x.id, x.has_poster]), [[v.id, true]], "the store's videos, with whether each has a poster");
  eq(list2.videos.length, 1, 'an upload in progress is not offered');
  ok(!('r2_key' in list.videos[0]), "🛑 the list does not hand out storage keys (the UUID is the link's secret)");
  eq((await call(s.env, '/?action=marketing-videos&store=BL1', { user: 'u-mgr1' })).status, 403, 'the list is for admins');
}

// ── 3. A video draft is one video, nothing else, from the same store ───────
{
  const s = await setup();
  const v = await s.video();
  const save = body => call(s.env, '/?action=draft-save', { user: 'u-admin', method: 'POST', body: { store: 'BL2', caption: 'x', ...body } });
  eq((await save({ video_id: v.id, thumbnail_id: 3 })).status, 400, '🛑 a video with a cover is refused');
  eq((await save({ video_id: v.id, photo_ids: [1] })).status, 400, '🛑 a video with photos is refused');
  const other = await s.video({ store: 'BL1' });
  eq((await save({ video_id: other.id })).status, 400, "🛑 another store's video is refused");
  const busy = await s.video({ status: 'uploading' });
  eq((await save({ video_id: busy.id })).status, 400, '🛑 an unfinished upload is refused');
  const r = await json(await save({ video_id: v.id }));
  ok(r.ok, 'a video alone saves');
  eq(s.row(r.id).video_id, v.id, 'with its video');
  const list = await json(await call(s.env, '/?action=drafts&status=all', { user: 'u-admin' }));
  const d = list.drafts.find(x => x.id === r.id);
  eq([d.video_type, d.video_duration_ms], ['store_walk', 190000], "the board gets the video's type and length for the card");
  eq((await call(s.env, '/?action=draft-schedule', { user: 'u-admin', method: 'POST', body: { id: r.id, et_wall_clock: '2099-01-01T09:00' } })).status, 200, 'a video draft schedules (no cover or photo needed)');
}

// ── 4. Publishing: Buffer gets OUR video URL, as `post` or `reel` ──────────
{
  const s = await setup();
  const walk = await s.video({ type: 'store_walk' }), clip = await s.video({ type: 'clip' });
  const dw = s.draft({ video_id: walk.id, caption: 'Walk the floor' }), dc = s.draft({ video_id: clip.id, caption: 'New today' });
  eq((await call(s.env, '/?action=publish-draft', { user: 'u-admin', method: 'POST', body: { draft_id: dw, published: true } })).status, 200, 'a store-walk post publishes');
  eq((await call(s.env, '/?action=publish-draft', { user: 'u-admin', method: 'POST', body: { draft_id: dc, published: true } })).status, 200, 'a clip post publishes');
  const creates = calls.filter(c => /createPost/.test(c.query)).map(c => c.variables.input);
  eq(creates.map(i => i.metadata.facebook.type), ['post', 'reel'], '🔑 a store walk posts as a normal video, a clip as a Reel');
  eq(creates.map(i => i.assets.length), [1, 1], 'one asset each');
  ok(creates.every(i => i.assets[0].video && !i.assets[0].image), 'a video asset, no images');
  eq(creates[0].assets[0].video.url, 'https://api.retjghub.com' + walk.path, 'the store walk by its /v/ link');
  for (const i of creates) eq((await pub(s.env, new URL(i.assets[0].video.url).pathname)).status, 200, `🔑 and our public route serves the link Buffer was given (${i.metadata.facebook.type})`);
  eq(s.row(dw).status, 'published', 'the draft is published');

  // A video that no longer meets its rules is refused, not posted.
  const bad = await s.video({ type: 'store_walk' });
  s.db.prepare('UPDATE marketing_videos SET width=1080, height=1920 WHERE id=?').run(bad.id);
  const db_ = s.draft({ video_id: bad.id });
  const r = await call(s.env, '/?action=publish-draft', { user: 'u-admin', method: 'POST', body: { draft_id: db_, published: true } });
  ok(r.status === 400 && /sideways/.test((await json(r)).error || ''), 'an upright store walk is refused at publish');
  eq((await call(s.env, '/?action=draft-schedule', { user: 'u-admin', method: 'POST', body: { id: db_, et_wall_clock: '2099-01-01T09:00' } })).status, 400, 'and at schedule');

  // A draft with both (written around draft-save) is refused at publish.
  const both = s.draft({ video_id: walk.id, thumbnail_id: 1 });
  eq((await call(s.env, '/?action=publish-draft', { user: 'u-admin', method: 'POST', body: { draft_id: both, published: true } })).status, 400, '🛑 a video and a cover together are refused at publish');
}

// ── 5. Without Buffer, a video post is refused (the Graph path has no video) ──
{
  const s = await setup({ key: null });
  const v = await s.video();
  const id = s.draft({ video_id: v.id });
  const j = await json(await call(s.env, '/?action=publish-draft', { user: 'u-admin', method: 'POST', body: { draft_id: id, published: true } }));
  ok(/through Buffer/.test(j.error || ''), 'without BUFFER_API_KEY a video post is refused with the reason');
  eq(s.row(id).status, 'draft', 'and stays a draft');
  const sch = await call(s.env, '/?action=draft-schedule', { user: 'u-admin', method: 'POST', body: { id, et_wall_clock: '2099-01-01T09:00' } });
  ok(sch.status === 400 && /through Buffer/.test((await json(sch)).error || ''), '🛑 and it cannot be scheduled either (refused now, not at 9 pm)');
}

// ── 5b. A video post needs a caption (a retry recognises a re-hosted video by it) ──
{
  const s = await setup();
  const v = await s.video();
  const id = s.draft({ video_id: v.id, caption: '   ' });
  const r = await call(s.env, '/?action=publish-draft', { user: 'u-admin', method: 'POST', body: { draft_id: id, published: true } });
  ok(r.status === 400 && /caption/.test((await json(r)).error || ''), 'a video post with no caption is refused at publish');
  eq((await call(s.env, '/?action=draft-schedule', { user: 'u-admin', method: 'POST', body: { id, et_wall_clock: '2099-01-01T09:00' } })).status, 400, 'and at schedule');
  eq(buffer.size, 0, 'nothing reached Buffer');
}

// ── 6. 🛑 A lost answer on a video post: the retry adopts it, never posts twice ──
{
  const s = await setup();
  const v = await s.video();
  const id = s.draft({ video_id: v.id });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, init) => {
    const res = await realFetch(u, init);
    if (String(u) === 'https://api.buffer.com' && /createPost/.test(JSON.parse(init.body).query)) throw new Error('socket hang up');   // Buffer made it; the answer is lost
    return res;
  };
  eq((await call(s.env, '/?action=publish-draft', { user: 'u-admin', method: 'POST', body: { draft_id: id, published: true } })).status, 503, 'the lost answer reads as unreachable');
  globalThis.fetch = realFetch;
  eq((await call(s.env, '/?action=publish-draft', { user: 'u-admin', method: 'POST', body: { draft_id: id, published: true } })).status, 200, 'the retry succeeds');
  eq(buffer.size, 1, '🛑 by adopting the video post Buffer already has (matched on its video URL)');
}

// ── 6b. 🛑 …even when Buffer re-hosts the video under its own URL ──────────
{
  const s = await setup();
  rehost = true;
  const v = await s.video();
  const id = s.draft({ video_id: v.id, caption: 'Walk the South Bend floor' });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, init) => {
    const res = await realFetch(u, init);
    if (String(u) === 'https://api.buffer.com' && /createPost/.test(JSON.parse(init.body).query)) throw new Error('socket hang up');
    return res;
  };
  await call(s.env, '/?action=publish-draft', { user: 'u-admin', method: 'POST', body: { draft_id: id, published: true } });
  globalThis.fetch = realFetch;
  ok([...buffer.values()][0].assets[0].source.startsWith('https://buffer-media.example/'), '(Buffer holds the video under its own URL)');
  s.db.prepare("UPDATE marketing_publish_log SET created_at=? WHERE draft_id=? AND status='handing'").run(new Date(Date.now() - 6 * 60e3).toISOString(), id);
  eq((await call(s.env, '/?action=publish-draft', { user: 'u-admin', method: 'POST', body: { draft_id: id, published: true } })).status, 200, 'the retry, 6 minutes on, succeeds');
  eq(buffer.size, 1, '🛑 by adopting the one live video with this caption — not by posting it again');

  // The same caption on a video another draft already owns is not this one.
  const s2 = await setup();
  rehost = true;
  const v2 = await s2.video(), v3 = await s2.video();
  const theirs = s2.draft({ video_id: v2.id, caption: 'Same words' }), mine = s2.draft({ video_id: v3.id, caption: 'Same words' });
  await call(s2.env, '/?action=publish-draft', { user: 'u-admin', method: 'POST', body: { draft_id: theirs, published: true } });
  globalThis.fetch = async (u, init) => {
    if (String(u) === 'https://api.buffer.com' && /createPost/.test(JSON.parse(init.body).query)) throw new Error('timeout');   // never arrived
    return realFetch(u, init);
  };
  await call(s2.env, '/?action=publish-draft', { user: 'u-admin', method: 'POST', body: { draft_id: mine, published: true } });
  globalThis.fetch = realFetch;
  s2.db.prepare("UPDATE marketing_publish_log SET created_at=? WHERE draft_id=? AND status='handing'").run(new Date(Date.now() - 6 * 60e3).toISOString(), mine);
  await call(s2.env, '/?action=publish-draft', { user: 'u-admin', method: 'POST', body: { draft_id: mine, published: true } });
  eq(buffer.size, 2, "🛑 a video another draft already claimed is not adopted: this draft's own video is posted");
  rehost = false;
}

// ── 7. The caption writer is told it is a video, and sees its frame ────────
{
  const s = await setup();
  const walk = await s.video({ type: 'store_walk', poster: true, note: 'Furniture aisle reset' });
  const r = await json(await call(s.env, '/?action=draft-generate-caption', { user: 'u-admin', method: 'POST', body: { store: 'BL2', topic: 'Store walk', video_id: walk.id } }));
  ok(r.ok && r.caption, 'a caption comes back');
  const msg = asked[0].messages[0].content;
  const text = Array.isArray(msg) ? msg.filter(x => x.type === 'text').map(x => x.text).join('') : msg;
  ok(/walk-through VIDEO of the store floor \(3 minutes long\)/.test(text), 'it is told this is a 3-minute walk-through video');
  ok(Array.isArray(msg) && msg.filter(x => x.type === 'image').length === 1, 'and shown one image: the poster frame');
  ok(/Furniture aisle reset/.test(text) && /STORE NOTES/.test(text), "the uploader's note reaches it, fenced as data");
  const clip = await s.video({ type: 'clip' });
  await call(s.env, '/?action=draft-generate-caption', { user: 'u-admin', method: 'POST', body: { store: 'BL2', topic: 'x', video_id: clip.id } });
  const m2 = asked[1].messages[0].content;
  const t2 = Array.isArray(m2) ? m2.map(x => x.text || '').join('') : m2;
  ok(/SHORT VIDEO CLIP \(45 seconds\), posted as a Facebook Reel/.test(t2) && /You cannot see it/.test(t2), 'a clip with no poster: told it is a Reel it cannot see');
  ok(typeof m2 === 'string', 'and shown no image');
}

console.log(`\n${assertions - failures} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
