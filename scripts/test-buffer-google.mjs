// Google Business Profile posts beside Facebook (Brian, 2026-10-27): a per-post "Also post
// to Google" switch, on by default, for the three stores whose listing is connected in
// Buffer (Coliseum, Dupont, South Bend); the cover as Google's one image; no button.
//
// What has to hold:
//   - each store's post reaches ITS listing (Coliseum and Dupont share a Facebook Page but
//     not a Google listing), with Google's input: whats_new, one image, no hashtags;
//   - the switch, videos and Battle Creek / Indy East keep Facebook-only;
//   - anything Google would refuse is refused before anything is sent;
//   - 🛑 each destination is guarded on its own: a retry skips the one already done and
//     never posts a second copy of either; the scheduler does not call a draft "posted"
//     while Google is still owed.
// Drives the real worker.fetch / worker.scheduled against a fake Buffer.
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

const FB = { BL1: '6ac7dd7f6a5c39ccb654853c', BL4: '6ac7dd7f6a5c39ccb654853c', BL2: '6ac7dd7f6a5c39ccb6548539', BL14: '6ac7dd7f6a5c39ccb654853a' };
const GBP = { BL1: '6ac7ddf26a5c39ccb6548d88', BL4: '6ac7ddf26a5c39ccb6548d8b', BL2: '6ac7ddf26a5c39ccb6548d8a' };

// A fake Buffer: createPost stores; posts() lists; post() reads. `fail(body)` may answer first.
let calls = [], posts = new Map(), seq = 0, fail = null;
globalThis.fetch = async (url, init = {}) => {
  if (String(url) !== 'https://api.buffer.com') throw new Error('outbound fetch blocked: ' + String(url).slice(0, 60));
  const body = JSON.parse(init.body); calls.push(body);
  const r = fail && fail(body);
  if (r === 'THROW') throw new Error('timeout');
  if (r === 'LOST') { answer(body); throw new Error('socket hang up'); }
  const out = r || answer(body);
  return new Response(JSON.stringify(out.json || out), { status: out.status || 200 });
};
function answer(body) {
  const q = body.query;
  if (/createPost/.test(q)) {
    const id = 'g' + String(++seq).padStart(23, '0'), inp = body.variables.input;
    posts.set(id, { id, status: inp.saveToDraft ? 'draft' : 'sending', text: inp.text, channelId: inp.channelId, createdAt: new Date().toISOString(),
      assets: inp.assets.map(a => a.video ? { type: 'video', source: a.video.url } : { type: 'image', source: a.image.url }) });
    return { data: { createPost: { __typename: 'PostActionSuccess', post: { id, status: posts.get(id).status } } } };
  }
  if (/posts\(/.test(q)) {
    const { ch, since } = body.variables, live = /status: \[scheduled, sending, sent\]/.test(q);
    const rows = [...posts.values()].filter(p => ch.includes(p.channelId) && p.createdAt >= since && (!live || ['scheduled', 'sending', 'sent'].includes(p.status)));
    return { data: { posts: { pageInfo: { hasNextPage: false }, edges: rows.map(node => ({ node })) } } };
  }
  if (/post\(input/.test(q)) { const p = posts.get(body.variables.id); return p ? { data: { post: p } } : { status: 404, json: { errors: [{ message: 'not found', extensions: { code: 'NOT_FOUND' } }] } }; }
  return { data: {} };
}
const creates = () => calls.filter(c => /createPost/.test(c.query)).map(c => c.variables.input);
const uuid = n => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-a${String(n).repeat(3)}-${String(n).repeat(12)}`;

async function setup() {
  calls = []; posts = new Map(); fail = null;
  const { db, env } = makeEnv(repo);
  for (const m of ['020', '021', '025', '080']) db.exec(fs.readFileSync(path.join(repo, `migration-${m}.sql`), 'utf8'));
  applyMigrationAlters(db, repo);
  env.BUFFER_API_KEY = 'k';
  let n = 0;
  const photo = async (store = 'BL1', ct = 'image/jpeg') => {
    const u = uuid(++n % 10), k = `marketing/${store}/retail/2026-10/${n}/${u}.jpeg`;
    const r = db.prepare(`INSERT INTO marketing_photos (store, photo_type, r2_key, content_type, bytes, status, created_at) VALUES (?,'retail',?,?,8,'new',?)`).run(store, k, ct, new Date().toISOString());
    await env.MEDIA.put(k, new Uint8Array(8), {});
    return Number(r.lastInsertRowid);
  };
  const cover = async (ct = 'image/png', ext = 'png') => {
    const key = `marketing/_thumbnails/${++n}/${uuid(7)}.${ext}`;
    const r = db.prepare(`INSERT INTO marketing_thumbnails (name, r2_key, content_type, created_at) VALUES ('c', ?, ?, ?)`).run(key, ct, new Date().toISOString());
    await env.MEDIA.put(key, new Uint8Array(8), {});
    return Number(r.lastInsertRowid);
  };
  const draft = (f) => {
    const d = { store: 'BL1', caption: 'New arrivals on the floor!\n\n#BargainLaneColiseum #NewArrivals', google: null, status: 'draft', ...f };
    const r = db.prepare(`INSERT INTO marketing_drafts (store, thumbnail_id, photo_ids, video_id, google, caption, caption_source, status, created_at, updated_at)
                          VALUES (?,?,?,?,?,?,'ai',?,?,?)`).run(d.store, d.thumbnail_id || null, JSON.stringify(d.photo_ids || []), d.video_id || null, d.google, d.caption, d.status, new Date().toISOString(), new Date().toISOString());
    const id = Number(r.lastInsertRowid);
    for (const k of ['scheduled_at', 'publish_live', 'publish_attempts', 'claimed_at']) if (k in f) db.prepare(`UPDATE marketing_drafts SET ${k}=? WHERE id=?`).run(f[k], id);
    return id;
  };
  const row = id => db.prepare('SELECT * FROM marketing_drafts WHERE id=?').get(id);
  const logs = id => db.prepare('SELECT status, channel_id, service, buffer_post_id FROM marketing_publish_log WHERE draft_id=? ORDER BY id').all(id);
  return { db, env, photo, cover, draft, row, logs };
}
const publish = (env, id) => worker.fetch(req('/?action=publish-draft', { user: 'u-admin', method: 'POST', body: { draft_id: id, published: true } }), env, ctx);
const schedule = (env, id) => worker.fetch(req('/?action=draft-schedule', { user: 'u-admin', method: 'POST', body: { id, et_wall_clock: '2099-01-01T09:00' } }), env, ctx);
async function tick(env, cron = '* * * * *') { const w = []; await worker.scheduled({ cron, scheduledTime: Date.now() }, env, { waitUntil: p => w.push(p) }); await Promise.allSettled(w); }
const ago = ms => new Date(Date.now() - ms).toISOString();

console.log('Google Business Profile posts');

// ── 1. Each store's post reaches its own listing, as Google takes it ──────
for (const store of ['BL1', 'BL4', 'BL2']) {
  const s = await setup();
  const c = await s.cover(), p1 = await s.photo(store), p2 = await s.photo(store);
  const id = s.draft({ store, thumbnail_id: c, photo_ids: [p1, p2] });
  const r = await json(await publish(s.env, id));
  ok(r.ok && r.google === 'sent', `[${store}] publishes to Facebook and Google (${r.google})`);
  const [fb, g] = creates();
  eq([fb.channelId, g.channelId], [FB[store], GBP[store]], `[${store}] 🔑 its own Facebook Page, then its own Google listing`);
  eq(g.metadata, { google: { type: 'whats_new' } }, `[${store}] a What's New post, no button`);
  eq(g.assets.length, 1, `[${store}] one image`);
  ok(/\/t\/\d+-.*\.png$/.test(g.assets[0].image.url), `[${store}] the cover (Brian's choice)`);
  eq(g.text, 'New arrivals on the floor!', `[${store}] the caption without its hashtags`);
  eq(fb.assets.length, 3, `[${store}] Facebook still gets cover + photos`);
  ok(/#BargainLaneColiseum/.test(fb.text), `[${store}] and keeps its hashtags`);
  eq(s.logs(id).map(l => `${l.service}:${l.status}`), ['facebook:queued', 'googlebusiness:queued'], `[${store}] one guarded hand-off per destination`);
  eq(s.row(id).status, 'published', `[${store}] the draft is published`);
}

// ── 2. Facebook-only: the switch off, a video, a store with no listing ────
{
  const s = await setup();
  const c = await s.cover(), p = await s.photo();
  await publish(s.env, s.draft({ thumbnail_id: c, photo_ids: [p], google: 0 }));
  eq(creates().length, 1, 'the switch off: Facebook only');
  calls = [];
  const p14 = await s.photo('BL14');
  await publish(s.env, s.draft({ store: 'BL14', thumbnail_id: c, photo_ids: [p14] }));
  eq(creates().map(i => i.channelId), [FB.BL14], 'Battle Creek (no Google listing): Facebook only');
  calls = [];
  const vid = s.db.prepare(`INSERT INTO marketing_videos (store, video_type, r2_key, content_type, bytes, duration_ms, width, height, status, created_at)
                            VALUES ('BL1','clip','marketing/BL1/video/2026-10/${uuid(3)}.mp4','video/mp4',8,45000,1080,1920,'new',?)`).run(new Date().toISOString());
  await s.env.MEDIA.put(`marketing/BL1/video/2026-10/${uuid(3)}.mp4`, new Uint8Array(8), {});
  await publish(s.env, s.draft({ video_id: Number(vid.lastInsertRowid), caption: 'Clip' }));
  eq(creates().map(i => i.channelId), [FB.BL1], 'a video: Facebook only (Google takes no video)');
  calls = [];
  const noCover = s.draft({ photo_ids: [p] });
  await publish(s.env, noCover);
  ok(/\/p\//.test(creates()[1].assets[0].image.url), 'no cover: Google gets the first photo');
}

// ── 3. What Google would refuse is refused first, with nothing sent ───────
{
  const s = await setup();
  const c = await s.cover(), p = await s.photo();
  for (const [caption, re, what] of [
    ['Call us at (260) 555-0142 for hours! #BargainLane', /phone number/, 'a phone number'],
    ['#OnlyHashtags #Nothing', /add a caption/, 'nothing left without hashtags'],
    ['x'.repeat(1501), /Google takes 1500/, 'over 1,500 characters'],
  ]) {
    calls = [];
    const id = s.draft({ thumbnail_id: c, photo_ids: [p], caption });
    const r = await publish(s.env, id);
    const j = await json(r);
    ok(r.status === 400 && re.test(j.error || ''), `refused: ${what} (${j.error})`);
    eq(creates().length, 0, `🛑 and nothing reached Buffer — not even Facebook (${what})`);
    eq((await schedule(s.env, id)).status, 400, `and it can't be scheduled either (${what})`);
  }
  const webp = await s.cover('image/webp', 'webp');
  const r = await publish(s.env, s.draft({ thumbnail_id: webp, photo_ids: [p] }));
  ok(r.status === 400 && /JPEG or PNG/.test((await json(r)).error || ''), 'a WebP cover is refused for Google');
  const off = s.draft({ thumbnail_id: c, photo_ids: [p], caption: 'Call (260) 555-0142', google: 0 });
  eq((await publish(s.env, off)).status, 200, 'with the switch off, Google’s rules do not apply');
}

// ── 4. 🛑 Google refuses after Facebook went out: the card says so; Retry sends Google only ──
{
  const s = await setup();
  const c = await s.cover(), p = await s.photo();
  const id = s.draft({ thumbnail_id: c, photo_ids: [p] });
  fail = b => /createPost/.test(b.query) && b.variables.input.channelId === GBP.BL1 ? { data: { createPost: { __typename: 'InvalidInputError', message: 'Image too small' } } } : null;
  const j = await json(await publish(s.env, id));
  ok(j.ok && j.partial && /Google failed: Buffer refused the post: Image too small/.test(j.note), 'the publish reports Facebook out, Google refused');
  eq(s.row(id).status, 'schedule_error', 'the card shows it as failed');
  ok(/^Posted to Facebook\. Google: .*Retry sends it to Google only/.test(s.row(id).schedule_error), 'and says Facebook is out, Google is not');
  fail = null; calls = [];
  eq((await publish(s.env, id)).status, 200, 'Retry');
  eq(creates().map(i => i.channelId), [GBP.BL1], '🛑 Retry sends it to Google only — Facebook is not posted twice');
  eq(s.row(id).status, 'published', 'and the draft is published');
}

// ── 5. 🛑 A lost Google answer: the retry adopts it, even if Buffer re-hosted the image ──
{
  const s = await setup();
  const c = await s.cover(), p = await s.photo();
  const id = s.draft({ thumbnail_id: c, photo_ids: [p] });
  fail = b => (/createPost/.test(b.query) && b.variables.input.channelId === GBP.BL1 ? 'LOST' : null);
  await publish(s.env, id);
  fail = null;
  for (const post of posts.values()) if (post.channelId === GBP.BL1) post.assets = [{ type: 'image', source: 'https://buffer-media.example/re-hosted.png' }];
  s.db.prepare("UPDATE marketing_publish_log SET created_at=? WHERE draft_id=? AND status='handing'").run(ago(6 * 60e3), id);
  calls = [];
  eq((await publish(s.env, id)).status, 200, 'the retry succeeds');
  eq(creates().length, 0, '🛑 by adopting the Google post Buffer already has — nothing is sent again, to either');
  eq(posts.size, 2, 'one post on each');
}

// ── 6. 🛑 The scheduler: Facebook done does not mean posted while Google is owed ──
{
  const s = await setup();
  const c = await s.cover(), p = await s.photo();
  const id = s.draft({ thumbnail_id: c, photo_ids: [p], status: 'scheduled', scheduled_at: ago(60e3), publish_live: 1 });
  fail = b => (/createPost/.test(b.query) && b.variables.input.channelId === GBP.BL1 ? 'THROW' : null);   // Google unreachable
  await tick(s.env);
  fail = null;
  eq(s.row(id).status, 'schedule_error', 'Facebook out, Google unreachable: the card says so');
  // Reschedule (Retry) → the cron: the reconcile must not call it posted on Facebook's row alone.
  s.db.prepare("UPDATE marketing_drafts SET status='scheduled', scheduled_at=?, publish_attempts=0 WHERE id=?").run(ago(60e3), id);
  s.db.prepare("UPDATE marketing_publish_log SET created_at=? WHERE draft_id=? AND status='handing'").run(ago(6 * 60e3), id);
  calls = [];
  await tick(s.env);
  eq(creates().map(i => i.channelId), [GBP.BL1], '🛑 the next run sends Google only');
  eq(s.row(id).status, 'published', 'and then it is published');

  // The reaper: an interrupted run with Facebook done and Google not → a visible failure, not "published".
  const s2 = await setup();
  const id2 = s2.draft({ thumbnail_id: await s2.cover(), photo_ids: [await s2.photo()], status: 'publishing', claimed_at: ago(10 * 60e3), publish_attempts: 1, publish_live: 1 });
  s2.db.prepare(`INSERT INTO marketing_publish_log (draft_id, store, status, created_at, buffer_post_id, channel_id, service) VALUES (?, 'BL1', 'queued', ?, 'g00000000000000000000fb1', ?, 'facebook')`).run(id2, ago(9 * 60e3), FB.BL1);
  await tick(s2.env);
  eq(s2.row(id2).status, 'schedule_error', '🛑 the reaper does not call it posted while Google is owed');
  ok(/Google did not finish/.test(s2.row(id2).schedule_error), 'and says so');
}

// ── 7. The sync follows both; a Google failure names Google; the card links Facebook first ──
{
  const s = await setup();
  const id = s.draft({ thumbnail_id: await s.cover(), photo_ids: [await s.photo()] });
  await publish(s.env, id);
  for (const p of posts.values()) {
    p.status = 'sent';
    p.externalLink = p.channelId === GBP.BL1 ? 'https://business.google.com/posts/abc' : 'https://facebook.com/113655020488471_1';
  }
  await tick(s.env);
  const list = await json(await worker.fetch(req('/?action=drafts&status=all', { user: 'u-admin' }), s.env, ctx));
  const d = list.drafts.find(x => x.id === id);
  eq(d.post_url, 'https://facebook.com/113655020488471_1', "the card's View link is the Facebook post");
  eq(d.google_url, 'https://business.google.com/posts/abc', 'and it has the Google post too');

  const s2 = await setup();
  const id2 = s2.draft({ thumbnail_id: await s2.cover(), photo_ids: [await s2.photo()] });
  await publish(s2.env, id2);
  for (const p of posts.values()) if (p.channelId === GBP.BL1) Object.assign(p, { status: 'error', error: { message: 'Location suspended' } });
  await tick(s2.env);
  ok(/^Google: Buffer couldn't post it: Location suspended/.test(s2.row(id2).schedule_error || ''), 'a Google failure says it was Google');
}

// ── 8. The switch is saved; an older page's save keeps it ──────────────────
{
  const s = await setup();
  const c = await s.cover(), p = await s.photo();
  const save = body => worker.fetch(req('/?action=draft-save', { user: 'u-admin', method: 'POST', body: { store: 'BL1', thumbnail_id: c, photo_ids: [p], caption: 'x', ...body } }), s.env, ctx);
  const a = await json(await save({ google: false }));
  eq(s.row(a.id).google, 0, 'switched off: saved as 0');
  await save({ id: a.id });
  eq(s.row(a.id).google, 0, 'a save from a page without the switch keeps it off');
  await save({ id: a.id, google: true });
  eq(s.row(a.id).google, 1, 'switched back on');
}

// ── 9. Review fixes (2026-10-27) ────────────────────────────────────────────
// 🛑 On the schedule nobody is watching: a Google rule (a draft scheduled before Google
// existed was never checked for it) must not stop Facebook going out on time.
for (const [what, cover, caption, re] of [
  ['a WebP cover', ['image/webp', 'webp'], undefined, /^Posted to Facebook\. Google: Google takes JPEG or PNG/],
  ['a caption that is only hashtags', undefined, '#OnlyHashtags #Nothing', /^Posted to Facebook\. Google: add a caption/],
]) {
  const s = await setup();
  const c = await s.cover(...(cover || [])), p = await s.photo();
  const id = s.draft({ thumbnail_id: c, photo_ids: [p], ...(caption ? { caption } : {}), status: 'scheduled', scheduled_at: ago(60e3), publish_live: 1 });
  await tick(s.env);
  eq(creates().map(i => i.channelId), [FB.BL1], `🛑 scheduled, ${what}: Facebook still goes on time`);
  eq(s.row(id).status, 'schedule_error', `and the card shows Google as failed (${what})`);
  ok(re.test(s.row(id).schedule_error || ''), `and says what Google needs (${s.row(id).schedule_error})`);
}
// A Facebook-only retry is not blocked by a Google rule when Google is already done.
{
  const s = await setup();
  const id = s.draft({ thumbnail_id: await s.cover(), photo_ids: [await s.photo()], caption: 'Call (260) 555-0142 for hours', status: 'schedule_error' });
  s.db.prepare(`INSERT INTO marketing_publish_log (draft_id, store, status, created_at, buffer_post_id, channel_id, service) VALUES (?, 'BL1', 'queued', ?, 'g00000000000000000000gb1', ?, 'googlebusiness')`).run(id, ago(60e3), GBP.BL1);
  s.db.prepare(`INSERT INTO marketing_publish_log (draft_id, store, status, created_at, buffer_post_id, channel_id, service) VALUES (?, 'BL1', 'error', ?, 'g00000000000000000000fb1', ?, 'facebook')`).run(id, ago(60e3), FB.BL1);
  const r = await publish(s.env, id);
  eq(r.status, 200, 'Google done, Facebook failed: Retry is not refused for a Google rule');
  eq(creates().map(i => i.channelId), [FB.BL1], 'and it sends Facebook only');
}
// 🛑 A Page reconnected in Buffer gets a new channel id; its earlier post is still this
// draft's Facebook post, so a Google-only retry must not post Facebook again.
{
  const s = await setup();
  const id = s.draft({ thumbnail_id: await s.cover(), photo_ids: [await s.photo()], status: 'schedule_error' });
  s.db.prepare(`INSERT INTO marketing_publish_log (draft_id, store, status, created_at, buffer_post_id, channel_id, service) VALUES (?, 'BL1', 'queued', ?, 'g00000000000000000000fb1', 'an-old-channel-id', 'facebook')`).run(id, ago(60e3));
  await publish(s.env, id);
  eq(creates().map(i => i.channelId), [GBP.BL1], '🛑 Facebook done under an old channel id: Retry sends Google only');
}
// 🛑 A staged run that adopts a LIVE Facebook post marks the draft published, so Google goes live too.
{
  const s = await setup();
  const id = s.draft({ thumbnail_id: await s.cover(), photo_ids: [await s.photo()] });
  fail = b => (/createPost/.test(b.query) && b.variables.input.channelId === FB.BL1 ? 'LOST' : null);
  await publish(s.env, id);   // live; Facebook's answer is lost, Buffer has it
  fail = null;
  s.db.prepare("UPDATE marketing_publish_log SET created_at=? WHERE draft_id=? AND status='handing'").run(ago(6 * 60e3), id);
  calls = [];
  await worker.fetch(req('/?action=publish-draft', { user: 'u-admin', method: 'POST', body: { draft_id: id, published: false } }), s.env, ctx);
  const g = creates().filter(i => i.channelId === GBP.BL1);
  eq(creates().filter(i => i.channelId === FB.BL1).length, 0, 'the staged run adopts the live Facebook post');
  ok(g.length === 1 && g[0].mode === 'shareNow' && !g[0].saveToDraft, `🛑 and Google goes live with it, not as a Buffer draft (${JSON.stringify(g.map(x => [x.mode, x.saveToDraft]))})`);
  eq(s.row(id).status, 'published', 'the draft is published');
}
// 🛑 The sync fails the Facebook hand-off while a Google-only retry is in flight: the
// failure stays on the card; the retry must not overwrite it as published.
{
  const s = await setup();
  const id = s.draft({ thumbnail_id: await s.cover(), photo_ids: [await s.photo()], status: 'schedule_error' });
  s.db.prepare(`INSERT INTO marketing_publish_log (draft_id, store, status, created_at, buffer_post_id, channel_id, service) VALUES (?, 'BL1', 'queued', ?, 'g00000000000000000000fb1', ?, 'facebook')`).run(id, ago(60e3), FB.BL1);
  fail = b => {
    if (/createPost/.test(b.query) && b.variables.input.channelId === GBP.BL1) {
      s.db.prepare("UPDATE marketing_publish_log SET status='error' WHERE draft_id=? AND service='facebook'").run(id);
      s.db.prepare("UPDATE marketing_drafts SET status='schedule_error', schedule_error='Buffer couldn''t post it: Page token expired' WHERE id=?").run(id);
    }
    return null;
  };
  await publish(s.env, id);
  fail = null;
  eq(s.row(id).status, 'schedule_error', '🛑 a Facebook failure seen mid-retry is not overwritten as published');
  ok(/Page token expired/.test(s.row(id).schedule_error || ''), 'and its reason stays on the card');
}
// Without BUFFER_API_KEY (the Graph path) a Google copy alone is not "posted".
{
  const s = await setup();
  delete s.env.BUFFER_API_KEY;
  const id = s.draft({ thumbnail_id: await s.cover(), photo_ids: [await s.photo()], status: 'publishing', publish_attempts: 1, publish_live: 1 });
  s.db.prepare(`INSERT INTO marketing_publish_log (draft_id, store, status, created_at, buffer_post_id, channel_id, service) VALUES (?, 'BL1', 'queued', ?, 'g00000000000000000000gb1', ?, 'googlebusiness')`).run(id, ago(60e3), GBP.BL1);
  await tick(s.env);
  ok(s.row(id).status !== 'published', `the reaper does not call a Google-only draft posted (${s.row(id).status})`);
}
// The card's View link is Facebook's; a Google link alone is only "Google ↗".
{
  const s = await setup();
  const id = s.draft({ thumbnail_id: await s.cover(), photo_ids: [await s.photo()], status: 'schedule_error' });
  s.db.prepare(`INSERT INTO marketing_publish_log (draft_id, store, status, created_at, buffer_post_id, post_url, channel_id, service) VALUES (?, 'BL1', 'published', ?, 'g00000000000000000000gb1', 'https://business.google.com/posts/x', ?, 'googlebusiness')`).run(id, ago(60e3), GBP.BL1);
  const d = (await json(await worker.fetch(req('/?action=drafts&status=all', { user: 'u-admin' }), s.env, ctx))).drafts.find(x => x.id === id);
  eq([d.post_url, d.google_url], [null, 'https://business.google.com/posts/x'], 'only Google has a link: the card has no Facebook View link');
}
// A hashtag used as a word stays; tag lines and a line's trailing tags go.
{
  const s = await setup();
  await publish(s.env, s.draft({ thumbnail_id: await s.cover(), photo_ids: [await s.photo()],
    caption: 'Our #1 deal of the week!\n#BargainLane is the place to be #deals #shop\n\n#Coliseum #NewArrivals' }));
  eq(creates()[1].text, 'Our #1 deal of the week!\n#BargainLane is the place to be', 'Google text keeps "#1" and a tag used as a word');
}

console.log(`\n${assertions - failures} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
