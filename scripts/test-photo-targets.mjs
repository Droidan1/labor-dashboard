// Weekly upload targets (marketing meeting, 2026-10-13): Submit Photos shows each
// store's photos this week against a target, and admins can change the targets.
//
// Drives the REAL entry point, worker.fetch, with real sessions: which stores a
// caller sees is store scoping, and scoping lives in the wiring, not in a helper.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Tuesday 2026-10-13, noon Eastern. The week is Sun Oct 11 – Sat Oct 17, due Thu Oct 15.
const PINNED = '2026-10-13T16:00:00.000Z';
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...a) { if (a.length === 0) super(PINNED); else super(...a); }
  static now() { return new RealDate(PINNED).getTime(); }
};

const { loadWorker, makeEnv, applyMigrationAlters, req, blockNetwork } = await import('./lib/worker-harness.mjs');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let assertions = 0, failures = 0;
const ok = (c, m) => { assertions++; if (!c) { failures++; console.error('  FAIL ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

blockNetwork();
const worker = await loadWorker(repo);
const waits = [];
const ctx = { waitUntil: p => waits.push(p), passThroughOnException() {} };
const call = (url, opts = {}) => worker.fetch(req(url, opts), opts.env, ctx);
const json = async r => { try { return await r.json(); } catch { return {}; } };

function env0() {
  const { db, env } = makeEnv(repo);
  db.exec(fs.readFileSync(path.join(repo, 'migration-020.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(repo, 'migration-021.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(repo, 'migration-025.sql'), 'utf8'));
  applyMigrationAlters(db, repo);
  return { db, env };
}
const photo = (db, store, type, at, { by = 'mgr@x.com', status = 'new', note = null } = {}) =>
  db.prepare(`INSERT INTO marketing_photos (store, photo_type, r2_key, content_type, bytes, uploader, note, status, created_at)
              VALUES (?,?,?,?,?,?,?,?,?)`).run(store, type, `k/${Math.random()}`, 'image/jpeg', 1, by, note, status, at);

console.log('photo targets');

// ── 1. Counting the week ─────────────────────────────────────────────────────
{
  const { db, env } = env0();
  photo(db, 'BL1', 'retail', '2026-10-12T15:00:00.000Z', { by: 'a@x.com' });
  photo(db, 'BL1', 'retail', '2026-10-13T15:00:00.000Z', { by: 'a@x.com' });
  photo(db, 'BL1', 'retail', '2026-10-13T15:05:00.000Z', { by: 'b@x.com' });
  // 🔑 The week turns over at midnight EASTERN. 03:59 UTC on the 11th is 11:59 pm
  // Saturday in South Bend — last week. 04:00 UTC is midnight Sunday — this week.
  photo(db, 'BL1', 'retail', '2026-10-11T03:59:59.000Z', { by: 'old@x.com' });
  photo(db, 'BL1', 'retail', '2026-10-11T04:00:00.000Z', { by: 'a@x.com' });
  photo(db, 'BL1', 'retail', '2026-10-18T03:59:00.000Z', { by: 'a@x.com' });   // Sat 11:59 pm: still this week
  photo(db, 'BL1', 'retail', '2026-10-18T04:00:00.000Z', { by: 'a@x.com' });   // Sun: next week
  photo(db, 'BL1', 'retail', '2026-10-13T15:10:00.000Z', { by: 'rej@x.com', status: 'rejected' });
  photo(db, 'BL1', 'bins', '2026-10-13T15:00:00.000Z', { by: 'c@x.com' });
  photo(db, 'BL1', 'bins', '2026-10-14T15:00:00.000Z', { by: 'c@x.com', status: 'drafted' });
  photo(db, 'BL1', 'event', '2026-10-13T15:00:00.000Z', { by: 'd@x.com' });
  photo(db, 'BL4', 'bins', '2026-10-13T15:00:00.000Z');
  photo(db, 'BL8', 'retail', '2026-10-13T15:00:00.000Z');                      // Holland: closed

  const r = await call('/?action=photo-targets', { user: 'u-mgr1', env });
  eq(r.status, 200, 'a manager can read their targets');
  const j = await json(r);
  eq(j.week, { start: '2026-10-11', end: '2026-10-17', due: '2026-10-15' }, 'Sunday–Saturday week, due Thursday');
  eq(j.targets, { retail: 20, bins: 20 }, 'targets default to 20 retail, 20 bins');
  eq(j.stores.map(s => s.store), ['BL1'], '🛑 a one-store manager sees only their store');
  const bl1 = j.stores[0];
  eq(bl1.retail, 5, 'retail counts this week only, from midnight Sunday to midnight Saturday Eastern, rejected excluded');
  eq(bl1.bins, 2, 'bins counts drafted photos too, since drafting is what a bin photo is for');
  eq(bl1.people, 4, 'people = everyone who uploaded anything this week, events included, rejects not');
  eq(bl1.label, 'Coliseum', 'with the store name');

  const two = await json(await call('/?action=photo-targets', { user: 'u-mgr2', env }));
  eq(two.stores.map(s => s.store), ['BL1', 'BL4'], 'a two-store manager sees both, in report order');
  eq(two.stores[1].bins, 1, 'each store counted on its own');

  const adm = await json(await call('/?action=photo-targets', { user: 'u-admin', env }));
  eq(adm.stores.map(s => s.store), ['BL1', 'BL4', 'BL2', 'BL14', 'BL16'], 'an admin sees every open store, Holland left out');
  eq(adm.stores.find(s => s.store === 'BL2'), { store: 'BL2', label: 'South Bend', retail: 0, bins: 0, people: 0 },
     'a store with no uploads is listed at zero, not missing');

  const staff = await call('/?action=photo-targets', { user: 'u-staff', env });
  eq(staff.status, 200, '🔑 a staff account (no financial access) still reads its targets');
  eq((await json(staff)).stores.map(s => s.store), ['BL1'], 'scoped to its store');

  eq((await call('/?action=photo-targets', { env })).status, 401, 'signed out is refused');
}

// ── 2. Changing the targets ──────────────────────────────────────────────────
{
  const { db, env } = env0();
  const set = (user, value) => call('/?action=content-setting', { user, env, method: 'POST', body: { key: 'upload_targets', value } });
  const targets = async () => (await json(await call('/?action=photo-targets', { user: 'u-mgr1', env }))).targets;

  eq((await set('u-admin', { retail: 25, bins: 10 })).status, 200, 'an admin can set the targets');
  eq(await targets(), { retail: 25, bins: 10 }, 'and every store reads them');
  eq((await set('u-admin', '{"retail":"30","bins":"12"}')).status, 200, 'a JSON string of numerals is accepted');
  eq(await targets(), { retail: 30, bins: 12 }, 'and stored as numbers');

  for (const [bad, why] of [
    [{ retail: -1, bins: 10 }, 'a negative target'], [{ retail: 2.5, bins: 10 }, 'a fraction'],
    [{ retail: 'abc', bins: 10 }, 'text'], [{ retail: 10 }, 'a missing key'], [{ retail: null, bins: 10 }, 'a null'],
    [{ retail: 501, bins: 10 }, 'over the 500 ceiling'], [[20, 20], 'an array'], ['not json', 'unparseable text'], [null, 'nothing'],
  ]) eq((await set('u-admin', bad)).status, 400, `refuses ${why}`);
  eq(await targets(), { retail: 30, bins: 12 }, 'and a refused write changes nothing');

  eq((await set('u-mgr1', { retail: 1, bins: 1 })).status, 403, '🛑 a manager cannot change the targets');
  eq((await set('u-staff', { retail: 1, bins: 1 })).status, 403, '🛑 nor can staff');
  eq(await targets(), { retail: 30, bins: 12 }, 'unchanged after both refusals');

  // 🔑 Number(null) is 0. A stored null must fall back to the default, not to a
  // target of zero that would paint every store green.
  db.prepare("UPDATE content_settings SET value = ? WHERE key = 'upload_targets'").run('{"retail":null,"bins":7}');
  eq(await targets(), { retail: 20, bins: 7 }, 'a stored null falls back to its default, key by key');
  db.prepare("UPDATE content_settings SET value = ? WHERE key = 'upload_targets'").run('{garbage');
  eq(await targets(), { retail: 20, bins: 20 }, 'unparseable storage falls back to the defaults');
}

// ── 3. Associates upload, and the alert names them ───────────────────────────
// An associate's email is synthetic (…@associate.invalid). The admin push must say
// who uploaded by NAME. The payload is encrypted on the wire, so this captures it at
// the one place it is still plaintext: the AES-GCM encrypt call.
{
  const { db, env } = env0();
  db.prepare(`INSERT INTO users (id,email,role,stores,status,created_at,name,pin_hash) VALUES (?,?,?,?,?,?,?,?)`)
    .run('u-assoc', 'assoc_usr_1@associate.invalid', 'staff', '["BL1"]', 'active', '2026-01-01', 'Dee Ramirez', 'f'.repeat(64));
  db.prepare(`INSERT INTO user_grants (user_id,business_id,role,units) VALUES ('u-assoc','bl','staff','["BL1"]')`).run();
  db.prepare(`INSERT INTO sessions (id,user_id,expires_at,created_at) VALUES ('sess-u-assoc','u-assoc',?,?)`)
    .run('2026-10-14T00:00:00.000Z', PINNED);

  // Real keys, so sendWebPush gets as far as encrypting.
  const b64u = b => Buffer.from(b).toString('base64url');
  const vapid = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
  env.VAPID_PUBLIC_KEY = b64u(await crypto.subtle.exportKey('raw', vapid.publicKey));
  env.VAPID_PRIVATE_KEY = (await crypto.subtle.exportKey('jwk', vapid.privateKey)).d;
  env.VAPID_SUBJECT = 'mailto:test@example.com';
  const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  db.prepare(`INSERT INTO push_subscriptions (id,user_id,endpoint,p256dh,auth,created_at) VALUES (?,?,?,?,?,?)`)
    .run('s1', 'u-admin', 'https://push.example/admin', b64u(await crypto.subtle.exportKey('raw', ua.publicKey)),
         b64u(crypto.getRandomValues(new Uint8Array(16))), PINNED);
  db.prepare(`INSERT INTO notification_preferences (user_id, push_enabled, upload_alerts) VALUES ('u-admin',1,1)`).run();

  const plain = [];
  const realEncrypt = crypto.subtle.encrypt.bind(crypto.subtle);
  crypto.subtle.encrypt = async (alg, key, data) => { plain.push(new TextDecoder().decode(data)); return realEncrypt(alg, key, data); };
  const pushed = [];
  globalThis.fetch = async u => { pushed.push(String(u)); return new Response('', { status: 201 }); };

  const upload = async (user, type) => {
    const fd = new FormData();
    fd.append('store', 'BL1'); fd.append('photo_type', type);
    fd.append('photo', new File([new Uint8Array([1, 2, 3])], 'p.jpg', { type: 'image/jpeg' }));
    return worker.fetch(new Request('https://api.retjghub.com/?action=photo-upload',
      { method: 'POST', body: fd, headers: { Cookie: `session=sess-${user}` } }), env, ctx);
  };
  const up = await upload('u-assoc', 'retail');
  eq(up.status, 200, '🔑 an associate can upload, with no page grant');
  const n = await call('/?action=notify-photo-upload', { user: 'u-assoc', env, method: 'POST', body: { store: 'BL1', photo_type: 'retail' } });
  eq((await json(n)).notified, true, 'and their batch alerts the admins');
  await Promise.allSettled(waits.splice(0));
  eq(pushed, ['https://push.example/admin'], 'one push, to the admin');
  const body = JSON.parse(plain.join('').replace(/\x02\0*$/, '')).body;
  ok(/^Dee Ramirez · Retail floor$/.test(body), `the alert names the associate (got ${JSON.stringify(body)})`);
  ok(!/associate\.invalid/.test(plain.join('')), '🛑 and never shows their synthetic address');

  const t = await json(await call('/?action=photo-targets', { user: 'u-assoc', env }));
  eq([t.stores.length, t.stores[0].retail, t.stores[0].people], [1, 1, 1], 'the upload counts toward the store target');

  // A manager's alert is unchanged: still their email.
  plain.length = 0; pushed.length = 0;
  eq((await upload('u-mgr1', 'bins')).status, 200, 'a manager uploads');
  await call('/?action=notify-photo-upload', { user: 'u-mgr1', env, method: 'POST', body: { store: 'BL1', photo_type: 'bins' } });
  await Promise.allSettled(waits.splice(0));
  const mbody = JSON.parse(plain.join('').replace(/\x02\0*$/, '')).body;
  eq(mbody, 'howardbrian260@gmail.com · Bins', "a manager's alert still shows their email");
  crypto.subtle.encrypt = realEncrypt;
  blockNetwork();
}

console.log(`\n${assertions - failures} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
