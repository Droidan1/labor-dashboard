// Public photo links: GET|HEAD /p/<id>-<uuid>.<ext> serves one submitted marketing
// photo with no sign-in, for Buffer, which fetches post images from a public URL at publish.
//
// 🛑 This route sits ABOVE every auth gate, so what it must NOT serve matters more than
// what it does. Drives the real worker.fetch: a regex-extracted helper cannot see that
// the route is reached before the session check, or that it is reached at all.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, applyMigrationAlters, ctx, req, blockNetwork } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let assertions = 0, failures = 0;
const ok = (c, m) => { assertions++; if (!c) { failures++; console.error('  FAIL ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

blockNetwork();
const worker = await loadWorker(repo);
const { db, env } = makeEnv(repo);
db.exec(fs.readFileSync(path.join(repo, 'migration-020.sql'), 'utf8'));
db.exec(fs.readFileSync(path.join(repo, 'migration-021.sql'), 'utf8'));
applyMigrationAlters(db, repo);

const uuid = n => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-a${String(n).repeat(3)}-${String(n).repeat(12)}`;
const BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
// Inserts a marketing photo the way the upload does and returns its public path.
async function photo(n, { ext = 'jpeg', ct = 'image/jpeg', status = 'new', type = 'retail', put = true } = {}) {
  const u = uuid(n);
  const key = `marketing/BL2/${type}/2026-10/${u}.${ext}`;
  const r = db.prepare(`INSERT INTO marketing_photos (store, photo_type, r2_key, content_type, bytes, uploader, status, created_at)
              VALUES (?,?,?,?,?,?,?,?)`).run('BL2', type, key, ct, BYTES.length, 'm@x.com', status, '2026-10-13T15:00:00.000Z');
  if (put) await env.MEDIA.put(key, BYTES, { httpMetadata: { contentType: ct } });
  return { id: Number(r.lastInsertRowid), u, path: `/p/${Number(r.lastInsertRowid)}-${u}.${ext}` };
}
const retail = await photo(1);
const bins = await photo(2, { type: 'bins', status: 'drafted' });
const png = await photo(3, { ext: 'png', ct: 'image/png', type: 'event', status: 'published' });
const rejected = await photo(4, { status: 'rejected' });
const noObject = await photo(5, { put: false });
const team = await photo(6, { type: 'team' });
const other = await photo(7, { type: 'other' });
// Rows that predate the upload allowlist: the route must not serve them either.
const svg = await photo(8, { ext: 'svgxml', ct: 'image/svg+xml' });
const html = await photo(9, { ext: 'text', ct: 'image/,text/html' });
await env.MEDIA.put(`bin-dump/BL1/2026-10/${uuid(0)}.jpeg`, BYTES, { httpMetadata: { contentType: 'image/jpeg' } });

const sqls = [];
const realPrepare = env.DB.prepare.bind(env.DB);
env.DB.prepare = (sql) => { if (/marketing_photos/.test(sql)) sqls.push(sql); return realPrepare(sql); };

// No cookie, no secret: exactly what Buffer sends.
const get = (p, method = 'GET') => worker.fetch(new Request('https://api.retjghub.com' + p, { method }), env, ctx);

console.log('public photo links');

// ── Serves the photo ─────────────────────────────────────────────────────────
{
  const r = await get(retail.path);
  eq(r.status, 200, '🔑 a submitted photo is served with no sign-in');
  eq(r.headers.get('content-type'), 'image/jpeg', 'as its image type');
  eq(r.headers.get('x-content-type-options'), 'nosniff', 'nosniff');
  eq(r.headers.get('content-security-policy'), "default-src 'none'; sandbox", '🛑 sandboxed, so nothing in it can run');
  eq(r.headers.get('cache-control'), 'public, max-age=3600', 'cached for an hour, so a deletion takes');
  const got = new Uint8Array(await r.arrayBuffer());
  eq(Buffer.from(got).toString('hex'), Buffer.from(BYTES).toString('hex'), 'the exact stored bytes');

  const h = await get(retail.path, 'HEAD');
  eq(h.status, 200, 'HEAD answers too');
  eq((await h.arrayBuffer()).byteLength, 0, 'with no body');
  eq(h.headers.get('content-length'), String(BYTES.length), 'and the length');

  eq((await get(bins.path)).status, 200, 'a bin photo already in a draft is served');
  eq((await get(png.path)).status, 200, 'a published event photo is served (posting it is the point)');
  eq((await get(retail.path + '?action=list-users')).headers.get('content-type'), 'image/jpeg',
     '🛑 a query string cannot turn the route into anything but the photo');
}

// ── Refuses everything else, the same way ───────────────────────────────────
const refused = [
  [rejected.path, 'a rejected photo'],
  [noObject.path, 'a row whose object is gone'],
  [team.path, 'a team photo (staff stay sign-in only)'],
  [other.path, 'an "other" photo'],
  [svg.path, '🛑 an SVG, which can carry script'],
  [html.path, '🛑 a row labelled "image/,text/html"'],
  [`/p/${retail.id}-${uuid(0)}.jpeg`, '🛑 a bin-dump photo in the same bucket, via a real id'],
  [`/p/${retail.id}-${bins.u}.jpeg`, "🛑 one row's id with another row's UUID"],
  [`/p/${bins.id}-${retail.u}.jpeg`, '  …and the other way round'],
  [`/p/${retail.id}-${retail.u}.png`, 'the right id and UUID with the wrong extension'],
  [`/p/${retail.u}.jpeg`, 'the UUID alone, without the id'],
  [`/p/${retail.id}-${retail.u}.thumb.jpg`, 'the thumbnail derivative'],
  [`/p/${retail.id}-${retail.u.toUpperCase()}.jpeg`, 'an upper-case UUID (one canonical spelling)'],
  [`/p/0${retail.id}-${retail.u}.jpeg`, 'a zero-padded id'],
  [`/p/99999-${retail.u}.jpeg`, 'an id that does not exist'],
  ['/p/1-%25.jpeg', 'a LIKE wildcard'],
  ['/p/', 'nothing'],
];
for (const [p, why] of refused) {
  const r = await get(p);
  eq(r.status, 404, `refuses ${why}`);
  eq(await r.text(), 'Not found', `  and says only "Not found" (${why})`);
}
{
  sqls.length = 0;
  for (const p of ['/p/1-%25.jpeg', `/p/${retail.u}.jpeg`, `/p/${retail.id}-${retail.u}.thumb.jpg`]) await get(p);
  eq(sqls.length, 0, 'a malformed path is refused before any database read');
  sqls.length = 0;
  for (let i = 0; i < 5; i++) await get(`/p/${100000 + i}-${uuid(i)}.jpeg`);
  ok(sqls.length === 5 && sqls.every(q => /WHERE id = \?/.test(q) && !/LIKE/i.test(q)),
     `🛑 a made-up link is one primary-key read, never a scan (${JSON.stringify([...new Set(sqls)])})`);
  eq((await get(retail.path, 'POST')).status, 405, 'POST is refused');
  eq((await get(retail.path, 'DELETE')).status, 405, 'DELETE is refused');
}

// ── Nothing that could run gets stored in the first place ───────────────────
// Code review content-flow-1: both uploads took any type that began "image/".
{
  const upload = async (action, field, type, user) => {
    const fd = new FormData();
    fd.append('store', 'BL1'); fd.append('photo_type', 'retail');
    fd.append(field, new File(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'], 'x', { type }));
    return worker.fetch(new Request(`https://api.retjghub.com/?action=${action}`,
      { method: 'POST', body: fd, headers: { Cookie: `session=sess-${user}` } }), env, ctx);
  };
  for (const type of ['image/svg+xml', 'image/,text/html', 'image/x-icon']) {
    eq((await upload('photo-upload', 'photo', type, 'u-staff')).status, 400, `🛑 a staff upload of ${type} is refused`);
    eq((await upload('thumbnail-upload', 'thumbnail', type, 'u-admin')).status, 400, `🛑 so is an admin cover of ${type}`);
  }
  eq((await upload('photo-upload', 'photo', 'image/heic', 'u-staff')).status, 200, 'an iPhone HEIC still uploads');
  eq((await upload('photo-upload', 'photo', 'image/jpeg', 'u-staff')).status, 200, 'and a JPEG');
}

// ── The rest of the API is untouched ────────────────────────────────────────
eq((await get('/?action=photo-targets')).status, 401, '🛑 every other endpoint still needs a session');
eq((await get('/photos/x.jpeg')).status, 401, 'and only /p/ is public, not anything that looks like it');
// A climb never reaches the route: the URL is normalised to /worker.js first, which
// is an ordinary API path and gets the ordinary sign-in answer.
eq((await get('/p/../worker.js')).status, 401, '🛑 a path climb out of /p/ lands on the normal sign-in gate');

console.log(`\n${assertions - failures} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
