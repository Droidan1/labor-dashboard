// Store videos from Submit Photos (2026-10-19): a sideways store walk (at least 3:00)
// and an upright short clip (3–90 s), at most 1 GB, uploaded in parts straight into R2.
//
// What has to hold:
//   - the type rules are enforced by the WORKER, not only by the phone;
//   - every part is exactly the agreed size (R2 needs equal parts, and it is what
//     holds the file to the size that was checked), and only the uploader can send them;
//   - a video counts toward the weekly store-walk target only once it is complete;
//   - an abandoned upload is aborted, so its parts don't sit in R2;
//   - the targets endpoint still works on a database without the new table.
// Drives the real worker.fetch / worker.scheduled with real sessions.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Tuesday 2026-10-13, noon Eastern. The week is Sun Oct 11 – Sat Oct 17.
const PINNED = '2026-10-13T16:00:00.000Z';
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...a) { if (a.length === 0) super(PINNED); else super(...a); }
  static now() { return new RealDate(PINNED).getTime(); }
};

const { loadWorker, makeEnv, applyMigrationAlters, req, blockNetwork } = await import('./lib/worker-harness.mjs');
const repo = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));

let assertions = 0, failures = 0;
const ok = (c, m) => { assertions++; if (!c) { failures++; console.error('  FAIL ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

blockNetwork();
const worker = await loadWorker(repo);
const waits = [];
const ctx = { waitUntil: p => waits.push(p), passThroughOnException() {} };
const json = async r => { try { return await r.json(); } catch { return {}; } };
const PART = 10 * 1024 * 1024;
// A first part that opens like a real MP4/MOV: [size]['ftyp']… (the worker checks for it).
const firstPart = (n, fill = 0) => { const b = new Uint8Array(n).fill(fill); if (n >= 8) b.set([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70], 0); return b; };

// R2 multipart, faithfully enough: parts are kept by number, complete() joins them in
// order and the object's size is the real byte count.
function withMultipart(env) {
  const mpus = new Map();
  env.MEDIA._mpus = mpus;
  // Like R2, create returns the same R2MultipartUpload object resume does (key, uploadId,
  // uploadPart, complete, abort) — a bare {key, uploadId} hid a missing abort once.
  env.MEDIA.createMultipartUpload = async (key, opts = {}) => {
    const uploadId = 'mpu-' + (mpus.size + 1);
    mpus.set(uploadId, { key, opts, parts: new Map(), state: 'open' });
    return { key, uploadId, ...env.MEDIA.resumeMultipartUpload(key, uploadId) };
  };
  env.MEDIA.resumeMultipartUpload = (key, uploadId) => ({
    async uploadPart(n, body) {
      const u = mpus.get(uploadId);
      if (!u || u.key !== key || u.state !== 'open') throw new Error('NoSuchUpload');
      const bytes = new Uint8Array(body instanceof ArrayBuffer ? body : await new Response(body).arrayBuffer());
      u.parts.set(n, bytes);
      return { partNumber: n, etag: 'etag-' + n + '-' + bytes.length };
    },
    async complete(parts) {
      const u = mpus.get(uploadId);
      if (!u || u.state !== 'open') throw new Error('NoSuchUpload');
      for (const p of parts) if (!u.parts.has(p.partNumber) || p.etag !== 'etag-' + p.partNumber + '-' + u.parts.get(p.partNumber).length) throw new Error('InvalidPart');
      const all = parts.map(p => u.parts.get(p.partNumber));
      const joined = new Uint8Array(all.reduce((n, b) => n + b.length, 0));
      let o = 0; for (const b of all) { joined.set(b, o); o += b.length; }
      u.state = 'complete';
      await env.MEDIA.put(key, joined, { httpMetadata: u.opts.httpMetadata });
      return { key, size: env.MEDIA._sizeOverride != null ? env.MEDIA._sizeOverride : joined.length };
    },
    async abort() { const u = mpus.get(uploadId); if (u) u.state = 'aborted'; },
  });
  return env;
}

function env0({ videos = true } = {}) {
  const { db, env } = makeEnv(repo);
  db.exec(fs.readFileSync(path.join(repo, 'migration-020.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(repo, 'migration-021.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(repo, 'migration-025.sql'), 'utf8'));
  if (videos) db.exec(fs.readFileSync(path.join(repo, 'migration-080.sql'), 'utf8'));
  applyMigrationAlters(db, repo);
  return { db, env: withMultipart(env) };
}
const call = (env, url, opts = {}) => worker.fetch(req(url, opts), env, ctx);
const put = (env, user, id, part, bytes) => worker.fetch(new Request(`https://api.retjghub.com/?action=video-upload-part&id=${id}&part=${part}`, {
  method: 'POST', headers: { Cookie: `session=sess-${user}` }, body: bytes,
}), env, ctx);
const complete = (env, user, id, parts, poster) => {
  const fd = new FormData();
  fd.append('id', String(id));
  fd.append('parts', JSON.stringify(parts));
  if (poster) fd.append('poster', poster, 'poster.jpg');
  return worker.fetch(new Request('https://api.retjghub.com/?action=video-upload-complete', {
    method: 'POST', headers: { Cookie: `session=sess-${user}` }, body: fd,
  }), env, ctx);
};
const WALK = { store: 'BL1', video_type: 'store_walk', content_type: 'video/quicktime', bytes: PART + 5, duration_ms: 190000, width: 1920, height: 1080 };
const CLIP = { store: 'BL1', video_type: 'clip', content_type: 'video/mp4', bytes: 3 * 1e6, duration_ms: 45000, width: 1080, height: 1920 };
const start = (env, user, body) => call(env, '/?action=video-upload-start', { user, method: 'POST', body });

console.log('store videos: chunked upload');

// ── 0. 🛑 Every method the page sends cross-origin passes the CORS preflight ──
// The first cut sent parts as PUT, which resolveCors does not allow: every part died in
// the browser while every test here passed, because worker.fetch has no preflight.
{
  const { env } = env0();
  const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  const methods = [...new Set([...html.matchAll(/method:\s*'([A-Z]+)'/g)].map(m => m[1]))].filter(m => m !== 'GET');
  ok(methods.includes('POST'), `(found the page's methods: ${methods.join(', ')})`);
  for (const m of methods) {
    const r = await worker.fetch(new Request('https://api.retjghub.com/?action=video-upload-part&id=1&part=1', {
      method: 'OPTIONS', headers: { Origin: 'https://www.retjghub.com', 'Access-Control-Request-Method': m, 'Access-Control-Request-Headers': 'content-type' },
    }), env, ctx);
    const allow = (r.headers.get('access-control-allow-methods') || '').split(/,\s*/);
    ok(allow.includes(m), `🛑 the preflight allows ${m}, which index.html sends (allowed: ${allow.join(', ')})`);
  }
}

// ── 1. The type rules, enforced by the worker ──────────────────────────────
{
  const { env } = env0();
  const refused = [
    [{ ...WALK, duration_ms: 179000 }, /at least 3:00; this one is 2:59/, 'a store walk under 3:00'],
    [{ ...WALK, width: 1080, height: 1920 }, /sideways/, 'an upright store walk (it would post as a Reel, and Reels stop at 90 s)'],
    [{ ...CLIP, duration_ms: 91000 }, /at most 1:30/, 'a clip over 90 s'],
    [{ ...CLIP, width: 1920, height: 1080 }, /upright/, 'a sideways clip'],
    [{ ...WALK, bytes: 1e9 + 1 }, /limit is 1,000 MB.*1080p/, 'over Buffer’s 1 GB, with how to fix it'],
    [{ ...WALK, content_type: 'video/webm' }, /MP4 or MOV/, 'a format Buffer won’t take for Facebook'],
    [{ ...WALK, duration_ms: 0 }, /Couldn't read/, 'no length'],
    [{ ...WALK, video_type: 'photo' }, /Store walk or Short clip/, 'an unknown type'],
  ];
  for (const [body, re, what] of refused) {
    const r = await start(env, 'u-mgr1', body);
    const j = await json(r);
    ok(r.status === 400 && re.test(j.error || ''), `refused: ${what} (${r.status} ${j.error})`);
  }
  eq(env.MEDIA._mpus.size, 0, '🛑 none of them opened an upload');
  const other = await start(env, 'u-mgr1', { ...WALK, store: 'BL2' });
  eq(other.status, 403, '🛑 a manager cannot upload for another store');
  eq((await start(env, null, WALK)).status, 401, 'signed out: refused');
  const clip = await start(env, 'u-mgr1', CLIP);
  eq(clip.status, 200, 'a 45 s upright clip starts');
  const staff = await start(env, 'u-staff', WALK);
  eq(staff.status, 200, '🔑 staff (no financial access) can upload a store walk, as they can photos');
}

// ── 2. Start → parts → complete ────────────────────────────────────────────
{
  const { db, env } = env0();
  const r = await start(env, 'u-mgr1', { ...WALK, note: 'Furniture aisle reset' });
  const j = await json(r);
  eq([r.status, j.part_bytes, j.parts], [200, PART, 2], 'starts: 10 MiB parts, 2 of them');
  const row = db.prepare('SELECT * FROM marketing_videos WHERE id=?').get(j.id);
  eq(row.status, 'uploading', "the row exists from the start, as 'uploading'");
  ok(/^marketing\/BL1\/video\/2026-10\/[0-9a-f-]{36}\.mov$/.test(row.r2_key), `stored under marketing/<store>/video/ (${row.r2_key})`);
  eq(env.MEDIA._mpus.get(row.upload_id).opts.httpMetadata.contentType, 'video/quicktime', 'with its content type');
  eq([row.duration_ms, row.width, row.height, row.note, row.uploader], [190000, 1920, 1080, 'Furniture aisle reset', 'howardbrian260@gmail.com'], 'and what the phone read');

  eq((await put(env, 'u-mgr2', j.id, 1, new Uint8Array(PART))).status, 403, '🛑 another user cannot add parts to it');
  eq((await put(env, 'u-mgr1', j.id, 1, new Uint8Array(PART - 1))).status, 400, '🛑 a part one byte short is refused');
  eq((await put(env, 'u-mgr1', j.id, 2, new Uint8Array(6))).status, 400, '🛑 a last part one byte long is refused (the file is held to its checked size)');
  eq((await put(env, 'u-mgr1', j.id, 3, new Uint8Array(5))).status, 400, 'a part past the end is refused');
  eq((await put(env, 'u-mgr1', j.id, 1, new Uint8Array(PART).fill(7))).status, 400, '🛑 a first part that is not an MP4/MOV (no ftyp box) is refused');
  const p1 = await json(await put(env, 'u-mgr1', j.id, 1, firstPart(PART, 7)));
  const p2 = await json(await put(env, 'u-mgr1', j.id, 2, new Uint8Array(5).fill(9)));
  ok(p1.ok && p2.ok, 'both parts land');

  eq((await complete(env, 'u-mgr1', j.id, [{ part: 1, etag: p1.etag }])).status, 400, 'complete with a part missing is refused');
  const poster = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xdb])], { type: 'image/jpeg' });
  const c = await complete(env, 'u-mgr1', j.id, [{ part: 2, etag: p2.etag }, { part: 1, etag: p1.etag }], poster);
  const cj = await json(c);
  eq([c.status, cj.bytes], [200, PART + 5], 'completes (parts in any order), at the declared size');
  const done = db.prepare('SELECT * FROM marketing_videos WHERE id=?').get(j.id);
  eq([done.status, done.upload_id], ['new', null], "now 'new'");
  const obj = await env.MEDIA.get(done.r2_key);
  eq(obj && obj.size, PART + 5, 'the whole video is in R2');
  ok(!!(await env.MEDIA.get(done.r2_key.replace(/\.mov$/, '.thumb.jpg'))), 'with its poster frame beside it');
  eq((await put(env, 'u-mgr1', j.id, 1, new Uint8Array(PART))).status, 409, 'a finished upload takes no more parts');
  // The phone's complete went through but its answer was lost; it asks again.
  const again = await complete(env, 'u-mgr1', j.id, [{ part: 1, etag: p1.etag }, { part: 2, etag: p2.etag }]);
  const aj = await json(again);
  ok(again.status === 200 && aj.ok && aj.already, '🔑 completing a finished upload again answers ok (so the manager is not told it failed)');
  eq((await complete(env, 'u-mgr2', j.id, [])).status, 403, 'but not for someone else');
}

// ── 2b. At most two uploads in flight per person; an abandoned one of theirs is cleared ──
{
  const { db, env } = env0();
  const a = await json(await start(env, 'u-mgr1', WALK));
  const b = await json(await start(env, 'u-mgr1', WALK));
  const third = await start(env, 'u-mgr1', WALK);
  eq(third.status, 429, '🛑 a third upload in flight is refused (each can hold 1 GB of parts)');
  ok(/two videos uploading/.test((await json(third)).error || ''), 'with a plain reason');
  eq((await start(env, 'u-mgr2', { ...WALK, store: 'BL4' })).status, 200, "someone else's uploads are theirs to count");
  db.prepare('UPDATE marketing_videos SET created_at=? WHERE id=?').run('2026-10-13T13:00:00.000Z', a.id);   // 3 h ago
  const aUid = db.prepare('SELECT upload_id FROM marketing_videos WHERE id=?').get(a.id).upload_id;
  eq((await start(env, 'u-mgr1', WALK)).status, 200, '🔑 a crashed upload over 2 h old does not lock them out: it is cleared and the new one starts');
  eq(db.prepare('SELECT status FROM marketing_videos WHERE id=?').get(a.id).status, 'aborted', 'the stale one is aborted');
  eq(env.MEDIA._mpus.get(aUid).state, 'aborted', 'and its parts freed');
  eq(db.prepare('SELECT status FROM marketing_videos WHERE id=?').get(b.id).status, 'uploading', 'the recent one is untouched');
}

// ── 2c. No row, no upload: an insert that fails aborts the R2 upload it just opened ──
{
  const { env } = env0({ videos: false });
  const r = await start(env, 'u-mgr1', WALK);
  ok(r.status >= 400, 'without migration-080, start fails');
  ok([...env.MEDIA._mpus.values()].every(u => u.state !== 'open'), 'and leaves no upload open in R2');

  const { env: env2 } = env0();
  const real = env2.DB.prepare.bind(env2.DB);
  env2.DB.prepare = sql => { if (/INSERT INTO marketing_videos/.test(sql)) throw new Error('D1 unavailable'); return real(sql); };
  const r2 = await start(env2, 'u-mgr1', WALK);
  ok(r2.status >= 400, 'an insert that fails fails the start');
  eq([...env2.MEDIA._mpus.values()].map(u => u.state), ['aborted'], '🛑 and the multipart upload it had opened is aborted, not orphaned');
}

// ── 3. A completed object that is not the declared size is thrown away ─────
{
  const { db, env } = env0();
  const j = await json(await start(env, 'u-mgr1', { ...CLIP, bytes: 12 }));
  const p1 = await json(await put(env, 'u-mgr1', j.id, 1, firstPart(12)));
  env.MEDIA._sizeOverride = 11;
  const c = await complete(env, 'u-mgr1', j.id, [{ part: 1, etag: p1.etag }]);
  eq(c.status, 400, 'a size mismatch at complete is refused');
  const row = db.prepare('SELECT * FROM marketing_videos WHERE id=?').get(j.id);
  eq(row.status, 'aborted', "the row is 'aborted'");
  eq(await env.MEDIA.get(row.r2_key), null, 'and the object deleted');
}

// ── 4. Abort, and the hourly sweep of abandoned uploads ────────────────────
{
  const { db, env } = env0();
  const j = await json(await start(env, 'u-mgr1', WALK));
  const uid = db.prepare('SELECT upload_id FROM marketing_videos WHERE id=?').get(j.id).upload_id;
  eq((await call(env, '/?action=video-upload-abort', { user: 'u-mgr2', method: 'POST', body: { id: j.id } })).status, 403, '🛑 only the uploader can abort it');
  eq((await call(env, '/?action=video-upload-abort', { user: 'u-mgr1', method: 'POST', body: { id: j.id } })).status, 200, 'the uploader aborts');
  eq(env.MEDIA._mpus.get(uid).state, 'aborted', 'the R2 upload is aborted');
  eq(db.prepare('SELECT status FROM marketing_videos WHERE id=?').get(j.id).status, 'aborted', "and the row says so");

  const old = await json(await start(env, 'u-mgr1', WALK));
  const fresh = await json(await start(env, 'u-mgr1', WALK));
  db.prepare('UPDATE marketing_videos SET created_at=? WHERE id=?').run('2026-10-12T10:00:00.000Z', old.id);   // 30 h ago
  const oldUid = db.prepare('SELECT upload_id FROM marketing_videos WHERE id=?').get(old.id).upload_id;
  await worker.scheduled({ cron: '0 * * * *', scheduledTime: Date.now() }, env, ctx);
  await Promise.allSettled(waits.splice(0));
  eq(db.prepare('SELECT status FROM marketing_videos WHERE id=?').get(old.id).status, 'aborted', 'the hourly sweep aborts an upload abandoned for a day');
  eq(env.MEDIA._mpus.get(oldUid).state, 'aborted', 'and frees its parts');
  eq(db.prepare('SELECT status FROM marketing_videos WHERE id=?').get(fresh.id).status, 'uploading', 'an upload still in progress is left alone');
}

// ── 5. The weekly store-walk target counts finished store walks only ───────
{
  const { db, env } = env0();
  const ins = db.prepare(`INSERT INTO marketing_videos (store, video_type, r2_key, content_type, bytes, duration_ms, width, height, uploader, status, created_at)
                          VALUES (?, ?, 'k', 'video/mp4', 1, 190000, 1920, 1080, 'm@x.com', ?, ?)`);
  ins.run('BL1', 'store_walk', 'new', '2026-10-12T15:00:00.000Z');        // counts
  ins.run('BL1', 'store_walk', 'uploading', '2026-10-12T15:00:00.000Z');  // in flight
  ins.run('BL1', 'store_walk', 'aborted', '2026-10-12T15:00:00.000Z');    // abandoned
  ins.run('BL1', 'clip', 'new', '2026-10-12T15:00:00.000Z');              // a clip is not a walk
  ins.run('BL1', 'store_walk', 'new', '2026-10-10T15:00:00.000Z');        // last week
  ins.run('BL4', 'store_walk', 'new', '2026-10-12T15:00:00.000Z');
  const d = await json(await call(env, '/?action=photo-targets', { user: 'u-admin' }));
  eq(d.targets.store_walk, 1, 'the default store-walk target is 1');
  eq(d.stores.find(s => s.store === 'BL1').store_walk, 1, '🛑 BL1: one finished walk this week (not the in-flight, abandoned, clip or last-week ones)');
  eq(d.stores.find(s => s.store === 'BL4').store_walk, 1, 'BL4: one');
  eq(d.stores.find(s => s.store === 'BL2').store_walk, 0, 'BL2: none');

  const { env: noTable } = env0({ videos: false });
  const r = await call(noTable, '/?action=photo-targets', { user: 'u-mgr1' });
  const nd = await json(r);
  ok(r.status === 200 && nd.stores[0].store_walk === 0, '🔑 without migration-080 the bars still load (store walk 0)');
}

// ── 6. The admin can set the store-walk target; an old editor's save still works ──
{
  const { env } = env0();
  const set = value => call(env, '/?action=content-setting', { user: 'u-admin', method: 'POST', body: { key: 'upload_targets', value } });
  eq((await set({ retail: 20, bins: 20, store_walk: 2 })).status, 200, 'saves a store-walk target of 2');
  eq((await json(await call(env, '/?action=photo-targets', { user: 'u-admin' }))).targets.store_walk, 2, 'and it reads back');
  eq((await set({ retail: 15, bins: 25 })).status, 200, '🔑 a page still running the old editor (no store_walk) can save');
  eq((await json(await call(env, '/?action=photo-targets', { user: 'u-admin' }))).targets, { retail: 15, bins: 25, store_walk: 2 }, '🛑 and the store-walk target set on a newer page is kept');
  eq((await set({ retail: 15, bins: 25, store_walk: -1 })).status, 400, 'a negative store-walk target is refused');
}

console.log(`\n${assertions - failures} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
