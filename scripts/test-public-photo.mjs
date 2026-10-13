// Public photo links: GET|HEAD /p/<uuid>.<ext> serves one submitted marketing photo
// with no sign-in, for Buffer, which fetches post images from a public URL at publish.
//
// 🛑 This route sits ABOVE every auth gate, so what it must NOT serve matters more than
// what it does. Drives the real worker.fetch: a regex-extracted helper cannot see that
// the route is reached before the session check, or that it is reached at all.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, applyMigrationAlters, ctx, blockNetwork } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let assertions = 0, failures = 0;
const ok = (c, m) => { assertions++; if (!c) { failures++; console.error('  FAIL ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

blockNetwork();
const worker = await loadWorker(repo);
const { db, env } = makeEnv(repo);
db.exec(fs.readFileSync(path.join(repo, 'migration-020.sql'), 'utf8'));
applyMigrationAlters(db, repo);

const U = {
  retail: '1b4e28ba-2fa1-41d2-883f-0016d3cca427',
  rejected: '2c5f39cb-3ab2-42e3-994a-1127e4ddb538',
  png: '3d6a4adc-4bc3-43f4-a05b-2238f5eec649',
  noObject: '4e7b5bed-5cd4-4405-b16c-3349a6ffd75a',
  binDump: '5f8c6cfe-6de5-4516-827d-445ab700e86b',   // in the bucket, not in marketing_photos
};
const BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
async function photo(uuid, { ext = 'jpeg', ct = 'image/jpeg', status = 'new', store = 'BL2', put = true } = {}) {
  const key = `marketing/${store}/retail/2026-10/${uuid}.${ext}`;
  db.prepare(`INSERT INTO marketing_photos (store, photo_type, r2_key, content_type, bytes, uploader, status, created_at)
              VALUES (?,?,?,?,?,?,?,?)`).run(store, 'retail', key, ct, BYTES.length, 'm@x.com', status, '2026-10-13T15:00:00.000Z');
  if (put) await env.MEDIA.put(key, BYTES, { httpMetadata: { contentType: ct } });
  return key;
}
await photo(U.retail);
await photo(U.rejected, { status: 'rejected' });
await photo(U.png, { ext: 'png', ct: 'image/png', status: 'published' });
await photo(U.noObject, { put: false });
await env.MEDIA.put(`bin-dump/BL1/2026-10/${U.binDump}.jpeg`, BYTES, { httpMetadata: { contentType: 'image/jpeg' } });

let dbCalls = 0;
const realPrepare = env.DB.prepare.bind(env.DB);
env.DB.prepare = (sql) => { if (/marketing_photos/.test(sql)) dbCalls++; return realPrepare(sql); };

// No cookie, no secret: exactly what Buffer sends.
const get = (p, method = 'GET') => worker.fetch(new Request('https://api.retjghub.com' + p, { method }), env, ctx);

console.log('public photo links');

// ── Serves the photo ─────────────────────────────────────────────────────────
{
  const r = await get(`/p/${U.retail}.jpeg`);
  eq(r.status, 200, '🔑 a submitted photo is served with no sign-in');
  eq(r.headers.get('content-type'), 'image/jpeg', 'as the image type it was stored with');
  ok(/immutable/.test(r.headers.get('cache-control') || ''), 'cached as immutable: a photo never changes');
  eq(r.headers.get('x-content-type-options'), 'nosniff', 'nosniff');
  const got = new Uint8Array(await r.arrayBuffer());
  eq(Buffer.from(got).toString('hex'), Buffer.from(BYTES).toString('hex'), 'the exact stored bytes');

  const h = await get(`/p/${U.retail}.jpeg`, 'HEAD');
  eq(h.status, 200, 'HEAD answers too');
  eq((await h.arrayBuffer()).byteLength, 0, 'with no body');
  eq(h.headers.get('content-length'), String(BYTES.length), 'and the length');

  eq((await get(`/p/${U.png}.png`)).status, 200, 'a published photo is served (posting it is the point)');
  eq((await get(`/p/${U.retail}.jpeg?action=list-users`)).headers.get('content-type'), 'image/jpeg',
     '🛑 a query string cannot turn the route into anything but the photo');
}

// ── Refuses everything else, the same way ───────────────────────────────────
const refused = [
  [`/p/${U.rejected}.jpeg`, 'a rejected photo'],
  [`/p/${U.noObject}.jpeg`, 'a row whose object is gone'],
  [`/p/${U.binDump}.jpeg`, '🛑 a bin-dump photo in the same bucket (no marketing_photos row)'],
  [`/p/${U.retail}.png`, 'the right UUID with the wrong extension'],
  [`/p/${U.retail}.thumb.jpg`, 'the thumbnail derivative'],
  [`/p/${U.retail.toUpperCase()}.jpeg`, 'an upper-case UUID (one canonical spelling)'],
  ['/p/00000000-0000-0000-0000-000000000000.jpeg', 'a UUID that does not exist'],
  ['/p/%25.jpeg', 'a LIKE wildcard'],
  ['/p/', 'nothing'],
];
for (const [p, why] of refused) {
  const r = await get(p);
  eq(r.status, 404, `refuses ${why}`);
  eq(await r.text(), 'Not found', `  and says only "Not found" (${why})`);
}
{
  dbCalls = 0;
  for (const p of ['/p/%25.jpeg', `/p/${U.retail}.thumb.jpg`]) await get(p);
  eq(dbCalls, 0, 'a malformed path is refused before any database read');
  eq((await get(`/p/${U.retail}.jpeg`, 'POST')).status, 405, 'POST is refused');
  eq((await get(`/p/${U.retail}.jpeg`, 'DELETE')).status, 405, 'DELETE is refused');
}

// ── The rest of the API is untouched ────────────────────────────────────────
eq((await get('/?action=photo-targets')).status, 401, '🛑 every other endpoint still needs a session');
eq((await get('/photos/x.jpeg')).status, 401, 'and only /p/ is public, not anything that looks like it');
// A climb never reaches the route: the URL is normalised to /worker.js first, which
// is an ordinary API path and gets the ordinary sign-in answer.
eq((await get('/p/../worker.js')).status, 401, '🛑 a path climb out of /p/ lands on the normal sign-in gate');

console.log(`\n${assertions - failures} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
