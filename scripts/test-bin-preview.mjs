// Bin Preview (website pilot, Phase 1a): a store submits next sale day's bin photos, a
// reviewer approves them, and the public store feed shows them only inside their window.
// Plan: docs/plans/bargainlane-website.md §4–§5. Each block below is one eval, E1–E7.
//
// 🛑 /public/v1/* sits ABOVE every auth gate, so most of what this suite asserts is what
// the public side must NOT show. Drives the real worker.fetch with a pinned clock; the only
// fakes are the platform (sqlite D1, in-memory R2) and the social-draft adapter, which is a
// mock on purpose: this pass makes no Buffer calls of any kind.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, applyMigrationAlters, ctx, req, blockNetwork } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let assertions = 0, failures = 0;
const ok = (c, m) => { assertions++; if (!c) { failures++; console.error('  FAIL ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

blockNetwork();
const worker = await loadWorker(repo);
const { db, env } = makeEnv(repo);
for (const f of ['migration-020.sql', 'migration-021.sql', 'migration-093.sql']) {
  db.exec(fs.readFileSync(path.join(repo, f), 'utf8'));
}
// 🔑 migration-093 must be safe to run twice (it is applied by hand).
db.exec(fs.readFileSync(path.join(repo, 'migration-093.sql'), 'utf8'));
// migration-094 (slice 1b) runs after it, as in production. Before applyMigrationAlters, which would
// otherwise add its column first and make the real file fail.
const M094 = fs.readFileSync(path.join(repo, 'migration-094.sql'), 'utf8');
db.exec(M094);
applyMigrationAlters(db, repo);

// A South Bend manager, for the wrong-store checks. The harness's u-mgr2 manages BL1 + BL4.
{
  const exp = new Date(Date.now() + 3600e3).toISOString();
  db.prepare("INSERT INTO users (id,email,role,stores,status,created_at) VALUES ('u-sb','sb@bargainlane.com','manager','[\"BL2\"]','active','2026-01-01')").run();
  db.prepare("INSERT INTO user_grants (user_id,business_id,role,units) VALUES ('u-sb','bl','manager','[\"BL2\"]')").run();
  db.prepare("INSERT INTO sessions (id,user_id,expires_at,created_at) VALUES ('sess-u-sb','u-sb',?,?)").run(exp, exp);
}

// ── The clock. Every time the code reads comes from Date.now(). ─────────────
let NOW = Date.parse('2026-12-02T15:00:00Z'); // Wednesday, 10:00 Eastern
const realNow = Date.now;
Date.now = () => NOW;
const at = (iso) => { NOW = Date.parse(iso); };

// ── The mock social-draft adapter. Records every call; can "lose" its response. ─
const calls = [];
let adapterMode = 'ok';
const mockAdapter = {
  async createDraft(p) {
    await new Promise(r => setTimeout(r, 3)); // a real await, so concurrent requests interleave
    calls.push(p);
    if (adapterMode === 'lose') throw new Error('socket hang up (the draft may exist)');
    return { remoteId: `mock-${calls.length}` };
  },
};
env.SOCIAL_DRAFT_ADAPTER = mockAdapter;
const callsFor = (previewId) => calls.filter(c => c.previewId === previewId);

// ── Request helpers ─────────────────────────────────────────────────────────
async function call(action, { user, method, body, secret, qs = '' } = {}) {
  const r = await worker.fetch(req(`/?action=${action}${qs}`, { user, method: method || (body ? 'POST' : 'GET'), body, secret }), env, ctx);
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch (_) {}
  return { status: r.status, body: json, text };
}
async function pub(p, method = 'GET') {
  const r = await worker.fetch(new Request('https://api.retjghub.com' + p, { method }), env, ctx);
  const text = method === 'HEAD' ? '' : await r.text();
  let json = null; try { json = JSON.parse(text); } catch (_) {}
  return { status: r.status, body: json, text, headers: r.headers };
}
const feed = async () => (await pub('/public/v1/stores/BL4')).body;
const previewIds = (f) => (f?.binPreviews || []).map(p => p.id);
// The revision a reviewer has on screen: what they send with a decision.
const rev = (id) => db.prepare('SELECT revision FROM bin_previews WHERE id = ?').get(id)?.revision;

// ── Photos, inserted the way photo-upload does ──────────────────────────────
const uuid = n => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-a${String(n).repeat(3)}-${String(n).repeat(12)}`;
const BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9]);
async function photo(n, store = 'BL4', type = 'bins', status = 'new') {
  const key = `marketing/${store}/${type}/2026-12/${uuid(n)}.jpeg`;
  const r = db.prepare(`INSERT INTO marketing_photos (store, photo_type, r2_key, content_type, bytes, uploader, status, created_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(store, type, key, 'image/jpeg', BYTES.length, 'alyson@bargainlane.com', status, '2026-12-01T15:00:00.000Z');
  await env.MEDIA.put(key, BYTES, { httpMetadata: { contentType: 'image/jpeg' } });
  return Number(r.lastInsertRowid);
}
const P = { a: await photo(1), b: await photo(2), c: await photo(3), d: await photo(4), e: await photo(5), f: await photo(6) };
const bl1Photo = await photo(7, 'BL1');
const retailPhoto = await photo(8, 'BL4', 'retail');
const rejectedPhoto = await photo(9, 'BL4', 'bins', 'rejected');
const retailPhoto2 = await photo(10, 'BL4', 'retail');
const bl1Retail = await photo(11, 'BL1', 'retail');

// ── Store settings: test values, written through the API so the write path is exercised ─
const HOURS = {
  sun: { open: '10:00', close: '19:00' }, mon: { open: '09:00', close: '21:00' }, tue: { open: '09:00', close: '21:00' },
  wed: { open: '09:00', close: '21:00' }, thu: { open: '09:00', close: '21:00' }, fri: { open: '09:00', close: '21:00' },
  sat: { open: '09:00', close: '21:00' },
};
const PRICES = {
  fri: [{ from: '00:00', price: 12 }, { from: '14:00', price: 9 }], sat: [{ from: '00:00', price: 6 }],
  sun: [{ from: '00:00', price: 4 }], mon: [{ from: '00:00', price: 2 }], tue: [{ from: '00:00', price: 1 }],
  wed: [{ from: '00:00', price: 0.5 }], thu: [],
};
const PROFILE = {
  displayName: 'Bargain Lane Dupont',
  address: { street: '704 E Dupont Rd', city: 'Fort Wayne', state: 'IN', zip: '46825' },
  phone: '260-555-0100', mapsUrl: 'https://maps.google.com/?q=704+E+Dupont+Rd+Fort+Wayne+IN',
};

console.log('bin preview + public store feed');

// ── Settings: who may write, and what is accepted ───────────────────────────
{
  const body = { store: 'BL4', profile: PROFILE, hours: HOURS, binPrices: PRICES, public: true, expectedRevision: 0 };
  eq((await call('store-settings-save', { user: 'u-mgr2', body })).status, 403, 'a manager cannot edit store settings, even for their own store');
  eq((await call('store-settings-save', { user: 'u-admin', body: { ...body, binPrices: { fri: [{ from: '14:00', price: 9 }] } } })).status, 400,
     'a price day must start at 00:00 (no gap at opening)');
  eq((await call('store-settings-save', { user: 'u-admin', body: { ...body, tz: 'Mars/Olympus' } })).status, 400, 'an unknown time zone is refused');
  eq((await call('store-settings-save', { user: 'u-admin', body: { ...body, profile: { ...PROFILE, mapsUrl: 'javascript:alert(1)' } } })).status, 400,
     '🛑 a maps link must be https');
  eq((await call('store-settings-save', { user: 'u-admin', body: { ...body, extra: 1 } })).status, 400, 'unknown fields are refused, not ignored');
  const s = await call('store-settings-save', { user: 'u-admin', body });
  eq(s.status, 200, 'an admin saves BL4 settings');
  eq(s.body?.settings?.revision, 1, '  at revision 1');
  eq((await call('store-settings-save', { user: 'u-admin', body })).status, 409, 'a second save with the old revision is a conflict');
  const r = await call('store-settings', { user: 'u-mgr2', qs: '&store=BL4' });
  eq(r.status, 200, 'the BL4 manager can read their settings');
  eq(r.body?.settings?.hours?.fri, HOURS.fri, '  and gets them back');
  eq((await call('store-settings', { user: 'u-sb', qs: '&store=BL4' })).status, 403, 'a South Bend manager cannot read Dupont settings');
}

// ── The main flow: save → submit → approve ──────────────────────────────────
let main;
{
  const s = await call('bin-preview-save', { user: 'u-mgr2', body: { store: 'BL4', saleDate: '2026-12-04', photoIds: [P.a, P.b], caption: 'Friday bins: fresh truck!' } });
  eq(s.status, 200, 'the Dupont manager saves a draft');
  main = s.body?.preview;
  eq(main?.status, 'draft', '  as a draft');
  const sub = await call('bin-preview-submit', { user: 'u-mgr2', body: { id: main.id, expectedRevision: main.revision } });
  eq(sub.status, 200, 'and submits it');
  eq(sub.body?.preview?.status, 'submitted', '  status submitted');
  const ap = await call('bin-preview-review', { user: 'u-admin', body: { id: main.id, decision: 'approve', expectedRevision: rev(main.id) } });
  eq(ap.status, 200, 'an admin approves it');
  main = ap.body?.preview;
  // Default window: noon Eastern the day before the sale, to close on the sale day.
  eq(main?.startsAt, '2026-12-03T17:00:00.000Z', '  window opens at noon Thursday Eastern (17:00Z)');
  eq(main?.endsAt, '2026-12-05T02:00:00.000Z', '  and closes at 9 PM Friday Eastern (02:00Z Saturday)');
}

// ── E1: start and expiry ────────────────────────────────────────────────────
{
  const img = (f) => f?.binPreviews?.[0]?.images?.[0];
  at('2026-12-03T17:00:00Z');
  const live = await feed();
  const imgUrl = img(live);
  ok(typeof imgUrl === 'string' && imgUrl.startsWith('https://api.retjghub.com/public/v1/img/'), `E1 an approved preview carries approval-checked image links (${imgUrl})`);
  const imgPath = imgUrl ? new URL(imgUrl).pathname : '/public/v1/img/0/0-x.jpeg';

  at('2026-12-03T16:59:59Z');
  eq(previewIds(await feed()), [], 'E1 absent 1 s before it starts');
  eq((await pub(imgPath)).status, 404, 'E1   and so are its images');
  at('2026-12-03T17:00:00Z');
  eq(previewIds(await feed()), [main.id], 'E1 present at the start');
  const im = await pub(imgPath);
  eq(im.status, 200, 'E1   and its images are served');
  eq(im.headers.get('content-type'), 'image/jpeg', 'E1   as an image');
  eq(im.headers.get('content-security-policy'), "default-src 'none'; sandbox", 'E1   sandboxed');
  eq(im.headers.get('access-control-allow-origin'), '*', 'E1   readable by the website');
  at('2026-12-05T01:59:59Z');
  eq(previewIds(await feed()), [main.id], 'E1 still present 1 s before the end');
  at('2026-12-05T02:00:00Z');
  eq(previewIds(await feed()), [], 'E1 absent at the end');
  eq((await pub(imgPath)).status, 404, 'E1   and its images stop too');
  at('2026-12-05T01:59:30Z');
  const cc = (await pub('/public/v1/stores/BL4')).headers.get('cache-control');
  eq(cc, 'public, max-age=30', 'E1 the cache never outlives the window (30 s left → max-age=30)');
}

// ── E2: wrong-store denial ──────────────────────────────────────────────────
{
  at('2026-12-03T15:00:00Z');
  eq((await call('bin-preview-save', { user: 'u-sb', body: { store: 'BL4', saleDate: '2026-12-05', photoIds: [P.c] } })).status, 403,
     'E2 a South Bend manager cannot save a Dupont preview');
  eq((await call('bin-preview-save', { user: 'u-sb', body: { id: main.id, store: 'BL2', saleDate: '2026-12-05', photoIds: [P.c], expectedRevision: main.revision } })).status, 403,
     'E2 🛑 nor edit one by naming their own store in the body (the row\'s store decides)');
  eq((await call('bin-preview-submit', { user: 'u-sb', body: { id: main.id, expectedRevision: main.revision } })).status, 403, 'E2 nor submit one');
  eq((await call('bin-previews', { user: 'u-sb', qs: '&store=BL4' })).status, 403, 'E2 nor list Dupont\'s');
  const mine = await call('bin-previews', { user: 'u-sb' });
  eq(mine.status, 200, 'E2 listing with no store answers');
  ok(!/BL4/.test(mine.text), 'E2   and contains nothing from Dupont');
  // A South Bend preview, to show a manager cannot approve even their own store's.
  const sbPhoto = await photo(10, 'BL2');
  const sb = (await call('bin-preview-save', { user: 'u-sb', body: { store: 'BL2', saleDate: '2026-12-05', photoIds: [sbPhoto] } })).body?.preview;
  await call('bin-preview-submit', { user: 'u-sb', body: { id: sb?.id, expectedRevision: sb?.revision } });
  eq((await call('bin-preview-review', { user: 'u-sb', body: { id: sb?.id, decision: 'approve' } })).status, 403, 'E2 a manager cannot approve their own store\'s preview');
  eq((await call('bin-preview-review', { user: 'u-mgr2', body: { id: main.id, decision: 'approve' } })).status, 403, 'E2 nor can the Dupont manager approve Dupont\'s');
  eq((await call('bin-preview-pull', { user: 'u-mgr2', body: { id: main.id, reason: 'x' } })).status, 403, 'E2 nor pull one');
  eq((await call('bin-preview-save', { user: 'u-mgr2', body: { store: 'BL4', saleDate: '2026-12-05', photoIds: [bl1Photo] } })).status, 400,
     'E2 a Coliseum photo cannot go in a Dupont preview');
  eq((await call('bin-preview-save', { user: 'u-mgr2', body: { store: 'BL4', saleDate: '2026-12-05', photoIds: [retailPhoto] } })).status, 400, 'E2 nor a retail photo');
  eq((await call('bin-preview-save', { user: 'u-mgr2', body: { store: 'BL4', saleDate: '2026-12-05', photoIds: [rejectedPhoto] } })).status, 400, 'E2 nor a rejected one');
}

// ── E3: draft privacy ───────────────────────────────────────────────────────
{
  at('2026-12-03T15:00:00Z');
  const save = async (saleDate, ids) => (await call('bin-preview-save', { user: 'u-mgr2', body: { store: 'BL4', saleDate, photoIds: ids, caption: `SECRET-${saleDate}` } })).body?.preview;
  const draft = await save('2026-12-08', [P.c]);
  const submitted = await save('2026-12-09', [P.d]);
  await call('bin-preview-submit', { user: 'u-mgr2', body: { id: submitted.id, expectedRevision: submitted.revision } });
  const rejected = await save('2026-12-10', [P.e]);
  await call('bin-preview-submit', { user: 'u-mgr2', body: { id: rejected.id, expectedRevision: rejected.revision } });
  eq((await call('bin-preview-review', { user: 'u-admin', body: { id: rejected.id, decision: 'reject', expectedRevision: rev(rejected.id) } })).status, 400, 'E3 a rejection needs a note');
  eq((await call('bin-preview-review', { user: 'u-admin', body: { id: rejected.id, decision: 'reject', expectedRevision: rev(rejected.id), note: 'blurry' } })).status, 200, 'E3 a reviewer rejects with a note');
  // Give all three a window covering NOW: status alone must keep them private.
  db.prepare("UPDATE bin_previews SET starts_at='2026-12-01T00:00:00.000Z', ends_at='2026-12-31T00:00:00.000Z' WHERE id IN (?,?,?)").run(draft.id, submitted.id, rejected.id);
  const f = await pub('/public/v1/stores/BL4');
  eq(f.status, 200, 'E3 the feed answers');
  eq(previewIds(f.body), [], 'E3 🛑 draft, submitted and rejected previews never appear, even inside a window');
  ok(!/SECRET-/.test(f.text), 'E3   nor does any of their text');
  for (const [p, id] of [[draft, P.c], [submitted, P.d], [rejected, P.e]]) {
    eq((await pub(`/public/v1/img/${p.id}/${id}.jpeg`)).status, 404, `E3 the ${p.status} preview's photo is not served`);
  }
  // The approved one's photo through ANOTHER preview's id, and a photo not in the preview.
  at('2026-12-04T12:00:00Z');
  eq((await pub(`/public/v1/img/${main.id}/${P.c}.jpeg`)).status, 404, 'E3 🛑 a live preview cannot be used to reach a photo that is not in it');
  eq((await pub(`/public/v1/img/${main.id}/${P.a}.png`)).status, 404, 'E3 the wrong extension');
  eq((await pub(`/public/v1/img/${main.id}/${P.a}-${uuid(1)}.jpeg`)).status, 404, 'E3 the /p/-style UUID form is not a public image path');
  eq((await pub(`/public/v1/img/${main.id}/0${P.a}.jpeg`)).status, 404, 'E3 a zero-padded id');
  // Allowlist: every key in the public body is one the site is meant to have.
  const live = await pub('/public/v1/stores/BL4');
  const ALLOWED = new Set(['version', 'store', 'generatedAt', 'timezone', 'profile', 'displayName', 'address', 'street', 'city', 'state', 'zip',
    'phone', 'mapsUrl', 'today', 'date', 'weekday', 'closed', 'open', 'close', 'note', 'binPrice', 'price', 'until', 'next', 'week', 'binPrices',
    'from', 'binPreviews', 'id', 'saleDate', 'caption', 'startsAt', 'endsAt', 'images',
    'retailLine', 'retailHighlights', 'showFrom']);
  const keys = new Set();
  const walk = (v) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { keys.add(k); walk(x); } };
  walk(live.body);
  const extra = [...keys].filter(k => !ALLOWED.has(k));
  eq(extra, [], 'E3 🛑 the public body has only allowlisted keys');
  ok(!/@/.test(live.text), 'E3 🛑 no email address anywhere');
  ok(!/marketing\//.test(live.text), 'E3 🛑 no R2 key path anywhere');
  // 🛑 The UUID in a photo's R2 key IS its /p/ link (public from upload, never expiring). If the
  // feed showed it, a pull could never take the photo down: anyone who saw it keeps it.
  ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(live.text), 'E3 🛑 no photo UUID anywhere (it is the permanent /p/ capability)');
  eq(live.body?.binPreviews?.[0]?.images, [`https://api.retjghub.com/public/v1/img/${main.id}/${P.a}.jpeg`, `https://api.retjghub.com/public/v1/img/${main.id}/${P.b}.jpeg`],
     'E3 image links are preview id + photo id only');
  ok(!/u-mgr2|u-admin|alyson|bgeorges/.test(live.text), 'E3 🛑 no user ids or names');
  eq(live.headers.get('access-control-allow-origin'), '*', 'E3 open CORS, so the site can read it');
  ok(!live.headers.get('access-control-allow-credentials'), 'E3   and never with credentials');
  // Stores without a published page.
  eq((await pub('/public/v1/stores/BL2')).status, 404, 'E3 a store with no settings has no page');
  eq((await pub('/public/v1/stores/BL8')).status, 404, 'E3 nor does closed Holland');
  eq((await pub('/public/v1/stores/bl4')).status, 404, 'E3 one canonical spelling');
  eq((await pub('/public/v1/stores/BL4', 'POST')).status, 405, 'E3 POST is refused');
  eq((await pub('/public/v1/stores/BL4', 'HEAD')).status, 200, 'E3 HEAD answers');
  // Unpublishing the store page hides it whole.
  const srev = (await call('store-settings', { user: 'u-admin', qs: '&store=BL4' })).body.settings.revision;
  eq((await call('store-settings-save', { user: 'u-admin', body: { store: 'BL4', public: false, expectedRevision: srev } })).status, 200, 'E3 an admin unpublishes the page');
  eq((await pub('/public/v1/stores/BL4')).status, 404, 'E3   and the feed is gone');
  eq((await pub(`/public/v1/img/${main.id}/${P.a}.jpeg`)).status, 404, 'E3   with its images');
  await call('store-settings-save', { user: 'u-admin', body: { store: 'BL4', public: true, expectedRevision: srev + 1 } });
  eq((await pub(`/public/v1/img/${main.id}/${P.a}.jpeg`)).status, 200, 'E3 and back when republished');
}

// ── E6: no duplicate social draft (before E4 pulls the main preview) ─────────
{
  eq(callsFor(main.id).length, 2, 'E6 approval made one draft per Dupont channel');
  eq(callsFor(main.id).map(c => c.channel).sort(), ['facebook:fortwayne', 'google:dupont'], 'E6   Fort Wayne Facebook + Google Dupont');
  ok(callsFor(main.id).every(c => c.text.includes('Friday bins: fresh truck!') && c.photoIds.length === 2), 'E6   with the caption and both photos');
  eq(new Set(callsFor(main.id).map(c => c.idempotencyKey)).size, 2, 'E6   each with its own idempotency key');
  const again = await call('bin-preview-review', { user: 'u-admin', body: { id: main.id, decision: 'approve' } });
  eq(again.status, 200, 'E6 approving again answers');
  eq(again.body?.alreadyApproved, true, 'E6   as already approved');
  eq(callsFor(main.id).length, 2, 'E6 🛑 and makes no new draft');

  // Two approvals at once.
  at('2026-12-03T15:00:00Z');
  const p2 = (await call('bin-preview-save', { user: 'u-mgr2', body: { store: 'BL4', saleDate: '2026-12-05', photoIds: [P.f] } })).body.preview;
  await call('bin-preview-submit', { user: 'u-mgr2', body: { id: p2.id, expectedRevision: p2.revision } });
  const [x, y] = await Promise.all([
    call('bin-preview-review', { user: 'u-admin', body: { id: p2.id, decision: 'approve', expectedRevision: rev(p2.id) } }),
    call('bin-preview-review', { user: 'u-su', body: { id: p2.id, decision: 'approve', expectedRevision: rev(p2.id) } }),
  ]);
  eq([x.status, y.status], [200, 200], 'E6 two concurrent approvals both answer');
  eq([x.body?.alreadyApproved, y.body?.alreadyApproved].filter(Boolean).length, 1, 'E6   exactly one of them did the approving');
  eq(callsFor(p2.id).length, 2, 'E6 🛑 and exactly one draft per channel was made');
  eq(db.prepare("SELECT COUNT(*) n FROM content_audit WHERE entity='bin_preview' AND entity_id=? AND action='approve'").get(String(p2.id)).n, 1,
     'E6   and one approval is audited');

  // A lost response: the adapter made the draft but the answer never came back.
  const p3photo = await photo(11);
  const p3 = (await call('bin-preview-save', { user: 'u-mgr2', body: { store: 'BL4', saleDate: '2026-12-06', photoIds: [p3photo] } })).body.preview;
  await call('bin-preview-submit', { user: 'u-mgr2', body: { id: p3.id, expectedRevision: p3.revision } });
  adapterMode = 'lose';
  const lost = await call('bin-preview-review', { user: 'u-admin', body: { id: p3.id, decision: 'approve', expectedRevision: rev(p3.id) } });
  adapterMode = 'ok';
  eq(lost.status, 200, 'E6 an approval whose draft response is lost still approves');
  eq(lost.body?.socialDrafts?.map(d => d.status), ['needs_check', 'needs_check'], 'E6   and marks both channels needs_check');
  eq(callsFor(p3.id).length, 2, 'E6   after one call each');
  await call('bin-preview-review', { user: 'u-admin', body: { id: p3.id, decision: 'approve', expectedRevision: rev(p3.id) } });
  at('2026-12-03T16:00:00Z');
  await call('bin-preview-review', { user: 'u-admin', body: { id: p3.id, decision: 'approve', expectedRevision: rev(p3.id) } });
  eq(callsFor(p3.id).length, 2, 'E6 🛑 a retry never re-sends a needs_check draft');

  // A request that died mid-hand-off: one row stuck in 'handing'.
  at('2026-12-03T15:00:00Z');
  const p4photo = await photo(12);
  const p4 = (await call('bin-preview-save', { user: 'u-mgr2', body: { store: 'BL4', saleDate: '2026-12-07', photoIds: [p4photo] } })).body.preview;
  await call('bin-preview-submit', { user: 'u-mgr2', body: { id: p4.id, expectedRevision: p4.revision } });
  db.prepare(`INSERT INTO social_drafts (preview_id, channel_key, status, attempts, created_at, updated_at)
    VALUES (?, 'facebook:fortwayne', 'handing', 1, '2026-12-03T14:49:00.000Z', '2026-12-03T14:49:00.000Z')`).run(p4.id);
  const st = await call('bin-preview-review', { user: 'u-admin', body: { id: p4.id, decision: 'approve', expectedRevision: rev(p4.id) } });
  const byCh = Object.fromEntries((st.body?.socialDrafts || []).map(d => [d.channel, d.status]));
  eq(byCh, { 'facebook:fortwayne': 'needs_check', 'google:dupont': 'drafted' }, 'E6 a hand-off stuck over 10 minutes becomes needs_check; the other channel drafts');
  eq(callsFor(p4.id).map(c => c.channel), ['google:dupont'], 'E6 🛑 and the stuck channel is never re-sent');

  // A hand-off still in flight (under 10 minutes) is left alone.
  const p5photo = await photo(13);
  const p5 = (await call('bin-preview-save', { user: 'u-mgr2', body: { store: 'BL4', saleDate: '2026-12-12', photoIds: [p5photo] } })).body.preview;
  await call('bin-preview-submit', { user: 'u-mgr2', body: { id: p5.id, expectedRevision: p5.revision } });
  db.prepare(`INSERT INTO social_drafts (preview_id, channel_key, status, attempts, created_at, updated_at)
    VALUES (?, 'google:dupont', 'handing', 1, '2026-12-03T14:55:00.000Z', '2026-12-03T14:55:00.000Z')`).run(p5.id);
  const fl = await call('bin-preview-review', { user: 'u-admin', body: { id: p5.id, decision: 'approve', expectedRevision: rev(p5.id) } });
  eq(Object.fromEntries((fl.body?.socialDrafts || []).map(d => [d.channel, d.status]))['google:dupont'], 'handing', 'E6 a hand-off under 10 minutes old stays handing');
  eq(callsFor(p5.id).map(c => c.channel), ['facebook:fortwayne'], 'E6   and is not sent a second time');

  // No adapter configured (production in this pass): approval works, nothing is queued.
  delete env.SOCIAL_DRAFT_ADAPTER;
  const p6photo = await photo(14);
  const p6 = (await call('bin-preview-save', { user: 'u-mgr2', body: { store: 'BL4', saleDate: '2026-12-13', photoIds: [p6photo] } })).body.preview;
  await call('bin-preview-submit', { user: 'u-mgr2', body: { id: p6.id, expectedRevision: p6.revision } });
  const na = await call('bin-preview-review', { user: 'u-admin', body: { id: p6.id, decision: 'approve', expectedRevision: rev(p6.id) } });
  eq(na.status, 200, 'E6 with no adapter configured, approval still works');
  eq(na.body?.socialDrafts, [], 'E6   and queues nothing');
  eq(db.prepare('SELECT COUNT(*) n FROM social_drafts WHERE preview_id = ?').get(p6.id).n, 0, 'E6   not even a row');
  env.SOCIAL_DRAFT_ADAPTER = mockAdapter;

  // One live preview per store and sale day.
  const dupPhoto = await photo(15);
  const dup = (await call('bin-preview-save', { user: 'u-mgr2', body: { store: 'BL4', saleDate: '2026-12-04', photoIds: [dupPhoto] } })).body.preview;
  await call('bin-preview-submit', { user: 'u-mgr2', body: { id: dup.id, expectedRevision: dup.revision } });
  const d2 = await call('bin-preview-review', { user: 'u-admin', body: { id: dup.id, decision: 'approve', expectedRevision: rev(dup.id) } });
  eq(d2.status, 409, 'E6 a second approved preview for the same store and sale day is refused');
  eq(callsFor(dup.id).length, 0, 'E6   and makes no draft');
}

// ── Races the guarded UPDATEs exist for (found by review, 2026-11-23) ──────────
{
  at('2026-12-03T15:00:00Z');
  const sub = async (saleDate, n) => {
    const p = (await call('bin-preview-save', { user: 'u-mgr2', body: { store: 'BL4', saleDate, photoIds: [await photo(n)] } })).body.preview;
    await call('bin-preview-submit', { user: 'u-mgr2', body: { id: p.id, expectedRevision: p.revision } });
    return p.id;
  };
  // Runs `fn` against the database just before the next statement matching `re` is prepared,
  // i.e. after the handler has read the row and before its write: the window a real race uses.
  const realPrepare = env.DB.prepare;
  const beforeWrite = (re, fn) => {
    env.DB.prepare = (sql) => { if (re.test(sql)) { env.DB.prepare = realPrepare; fn(); } return realPrepare(sql); };
  };
  const approves = (id) => db.prepare("SELECT COUNT(*) n FROM content_audit WHERE entity='bin_preview' AND entity_id=? AND action='approve'").get(String(id)).n;

  const r1 = await sub('2026-12-15', 20);
  eq((await call('bin-preview-review', { user: 'u-admin', body: { id: r1, decision: 'approve' } })).status, 400,
     '🛑 an approval must name the revision the reviewer saw');
  eq((await call('bin-preview-review', { user: 'u-admin', body: { id: r1, decision: 'reject', note: 'x' } })).status, 400, '  so must a rejection');
  // The manager resubmits different photos while the reviewer's approval is in flight.
  const seen = rev(r1);
  const swapped = await photo(21);
  beforeWrite(/SET status = 'approved'/, () =>
    db.prepare("UPDATE bin_previews SET photo_ids = ?, revision = revision + 2 WHERE id = ?").run(JSON.stringify([swapped]), r1));
  const raced = await call('bin-preview-review', { user: 'u-admin', body: { id: r1, decision: 'approve', expectedRevision: seen } });
  eq(raced.status, 409, '🛑 a resubmission landing mid-approval is not approved unseen');
  eq(db.prepare('SELECT status FROM bin_previews WHERE id = ?').get(r1).status, 'submitted', '  it stays submitted');
  eq([approves(r1), callsFor(r1).length], [0, 0], '  with no approval recorded and no draft made');

  // Two previews for one day approved at once: the unique index refuses the second, and the
  // batch rolls back whole, so its audit row is not written either.
  const q1 = await sub('2026-12-16', 22), q2 = await sub('2026-12-16', 23);
  beforeWrite(/SET status = 'approved'/, () => db.prepare("UPDATE bin_previews SET status = 'approved' WHERE id = ?").run(q1));
  const dupRace = await call('bin-preview-review', { user: 'u-admin', body: { id: q2, decision: 'approve', expectedRevision: rev(q2) } });
  eq([dupRace.status, dupRace.body?.code], [409, 'ALREADY_APPROVED_FOR_DAY'], 'the unique index catches a same-day approval that slips past the check');
  eq([db.prepare('SELECT status FROM bin_previews WHERE id = ?').get(q2).status, approves(q2), callsFor(q2).length], ['submitted', 0, 0],
     '🛑   and the whole batch rolls back: still submitted, no audit row, no draft');

  // A pull that lands while the first channel's draft is being made stops the second channel.
  const r3 = await sub('2026-12-17', 24);
  const realCreate = mockAdapter.createDraft;
  mockAdapter.createDraft = async (pl) => {
    mockAdapter.createDraft = realCreate;
    await call('bin-preview-pull', { user: 'u-su', body: { id: r3, reason: 'Pulled mid-approval' } });
    return realCreate(pl);
  };
  const ap3 = await call('bin-preview-review', { user: 'u-admin', body: { id: r3, decision: 'approve', expectedRevision: rev(r3) } });
  eq(ap3.status, 200, 'an approval interrupted by a pull still answers');
  eq(callsFor(r3).length, 1, '🛑 and no channel is drafted after the pull');
}

// ── E4: emergency pull ──────────────────────────────────────────────────────
{
  at('2026-12-04T12:00:00Z');
  const imgPath = `/public/v1/img/${main.id}/${P.a}.jpeg`;
  ok(previewIds(await feed()).includes(main.id), 'E4 the preview is live before the pull');
  eq((await call('bin-preview-pull', { user: 'u-admin', body: { id: main.id } })).status, 400, 'E4 a pull needs a reason');
  const pl = await call('bin-preview-pull', { user: 'u-admin', body: { id: main.id, reason: 'Wrong store in photo' } });
  eq(pl.status, 200, 'E4 an admin pulls it');
  eq(pl.body?.preview?.status, 'pulled', '  status pulled');
  eq(pl.body?.socialDrafts?.length, 2, 'E4   and is told which social drafts exist (to delete in Buffer by hand)');
  ok(!previewIds(await feed()).includes(main.id), 'E4 🛑 gone from the feed on the next read');
  eq((await pub(imgPath)).status, 404, 'E4 🛑 and its images are gone too');
  const audit = db.prepare("SELECT action, actor_id, actor_email, detail_json FROM content_audit WHERE entity='bin_preview' AND entity_id=? ORDER BY id").all(String(main.id));
  eq(audit.map(a => a.action), ['save', 'submit', 'approve', 'pull'], 'E4 the audit has every step');
  const pullRow = audit.find(a => a.action === 'pull');
  eq([pullRow?.actor_id, pullRow?.actor_email], ['u-admin', 'bgeorges@retjg.com'], 'E4   with who pulled it');
  eq(JSON.parse(pullRow?.detail_json || '{}').reason, 'Wrong store in photo', 'E4   and why');
  eq(audit.find(a => a.action === 'approve')?.actor_id, 'u-admin', 'E4   and who approved it');
  const again = await call('bin-preview-pull', { user: 'u-admin', body: { id: main.id, reason: 'again' } });
  eq(again.body?.alreadyPulled, true, 'E4 pulling twice is harmless');
  eq((await call('bin-preview-review', { user: 'u-admin', body: { id: main.id, decision: 'approve', expectedRevision: rev(main.id) } })).status, 409, 'E4 🛑 a pulled preview cannot be re-approved');
  eq((await call('bin-preview-save', { user: 'u-mgr2', body: { id: main.id, store: 'BL4', saleDate: '2026-12-04', photoIds: [P.a], expectedRevision: pl.body.preview.revision } })).status, 409,
     'E4   nor edited back into a draft');
}

// ── E5: price override, holiday override, DST ───────────────────────────────
{
  const price = async (iso) => { at(iso); return (await feed())?.binPrice; };
  eq(await price('2026-12-04T18:59:00Z'), { price: 12, until: '14:00', next: 9 }, 'E5 Friday 1:59 PM Eastern: $12 until 2 PM, then $9');
  eq(await price('2026-12-04T19:00:00Z'), { price: 9, until: null, next: null }, 'E5 Friday 2:00 PM Eastern: $9');
  eq(await price('2026-12-05T15:00:00Z'), { price: 6, until: null, next: null }, 'E5 Saturday: $6');
  eq(await price('2026-12-03T15:00:00Z'), null, 'E5 Thursday: no bin price');
  at('2026-12-03T15:00:00Z');
  const f = await feed();
  eq(f?.today, { date: '2026-12-03', weekday: 'thu', closed: false, open: '09:00', close: '21:00', note: null }, 'E5 today\'s hours');
  eq(f?.week?.length, 7, 'E5 the week has seven days');
  eq(f?.week?.[1]?.binPrices, PRICES.fri, 'E5   and tomorrow\'s price tiers');

  // A holiday override replaces both hours and price for that date.
  eq((await call('store-override-save', { user: 'u-mgr2', body: { store: 'BL4', date: '2026-12-11', open: '10:00', close: '18:00' } })).status, 403, 'E5 a manager cannot set an override');
  eq((await call('store-override-save', { user: 'u-admin', body: { store: 'BL4', date: '2026-12-11', open: '18:00', close: '10:00' } })).status, 400, 'E5 close must be after open');
  eq((await call('store-override-save', { user: 'u-admin', body: {
    store: 'BL4', date: '2026-12-11', open: '10:00', close: '18:00', binPrices: [{ from: '00:00', price: 5 }], note: 'Holiday hours' } })).status, 200, 'E5 an admin sets a holiday override');
  eq((await call('store-override-save', { user: 'u-admin', body: { store: 'BL4', date: '2026-12-25', closed: true, note: 'Closed for Christmas' } })).status, 200, 'E5 and a closed day');
  eq(await price('2026-12-11T19:30:00Z'), { price: 5, until: null, next: null }, 'E5 the override price replaces Friday\'s $12/$9');
  eq((await feed())?.today, { date: '2026-12-11', weekday: 'fri', closed: false, open: '10:00', close: '18:00', note: 'Holiday hours' }, 'E5   and its hours replace Friday\'s');
  eq(await price('2026-12-25T16:00:00Z'), null, 'E5 a closed day has no bin price');
  eq((await feed())?.today?.closed, true, 'E5   and shows closed');
  at('2026-12-21T15:00:00Z');
  const wk = (await feed())?.week || [];
  eq(wk.find(d => d.date === '2026-12-25')?.note, 'Closed for Christmas', 'E5 the week shows the holiday ahead of time');
  eq(db.prepare("SELECT COUNT(*) n FROM content_audit WHERE entity='store_override'").get().n, 2, 'E5 both overrides are audited');

  // DST: the same 2 PM change, either side of the March 14 2027 clock change.
  eq((await price('2027-03-12T18:59:00Z'))?.price, 12, 'E5 DST: Friday Mar 12 (EST) 1:59 PM is 18:59Z → $12');
  eq((await price('2027-03-12T19:00:00Z'))?.price, 9, 'E5 DST:   and 2:00 PM is 19:00Z → $9');
  eq((await price('2027-03-19T17:59:00Z'))?.price, 12, 'E5 DST: Friday Mar 19 (EDT) 1:59 PM is 17:59Z → $12');
  eq((await price('2027-03-19T18:00:00Z'))?.price, 9, 'E5 DST: 🛑 and 2:00 PM is 18:00Z → $9 (a fixed −5 offset would still say $12)');

  // A preview window across the clock change.
  at('2027-03-10T15:00:00Z');
  const dp = await photo(16);
  const d = (await call('bin-preview-save', { user: 'u-mgr2', body: { store: 'BL4', saleDate: '2027-03-15', photoIds: [dp] } })).body.preview;
  await call('bin-preview-submit', { user: 'u-mgr2', body: { id: d.id, expectedRevision: d.revision } });
  const bad = await call('bin-preview-review', { user: 'u-admin', body: { id: d.id, decision: 'approve', expectedRevision: rev(d.id), startsAt: '2027-03-14T02:30', endsAt: '2027-03-15T21:00' } });
  eq(bad.status, 400, 'E5 🛑 a start time that does not exist (2:30 AM on spring-forward day) is refused, not shifted');
  eq((await call('bin-preview-review', { user: 'u-admin', body: { id: d.id, decision: 'approve', expectedRevision: rev(d.id), startsAt: '2027-03-15T10:00', endsAt: '2027-03-15T09:00' } })).status, 400,
     'E5 an end before the start is refused');
  const good = await call('bin-preview-review', { user: 'u-admin', body: { id: d.id, decision: 'approve', expectedRevision: rev(d.id) } });
  eq(good.body?.preview?.startsAt, '2027-03-14T16:00:00.000Z', 'E5 default start: noon Sunday Mar 14 is EDT (16:00Z)');
  eq(good.body?.preview?.endsAt, '2027-03-16T01:00:00.000Z', 'E5 default end: 9 PM Monday EDT (01:00Z)');
  const rs = await call('bin-preview-review', { user: 'u-admin', body: { id: d.id, decision: 'reschedule', expectedRevision: rev(d.id), startsAt: '2027-03-15T08:00', endsAt: '2027-03-15T20:00' } });
  eq([rs.status, rs.body?.preview?.startsAt, rs.body?.preview?.endsAt], [200, '2027-03-15T12:00:00.000Z', '2027-03-16T00:00:00.000Z'], 'E5 a reviewer reschedules it in store-local time');
  eq(db.prepare("SELECT COUNT(*) n FROM content_audit WHERE entity='bin_preview' AND entity_id=? AND action='reschedule'").get(String(d.id)).n, 1, 'E5   audited');
}

// ── E7: the gate, the leaked secret, revisions ──────────────────────────────
{
  at('2026-12-03T15:00:00Z');
  const ACTIONS = ['bin-preview-save', 'bin-preview-submit', 'bin-previews', 'bin-preview-review', 'bin-preview-pull',
    'store-settings', 'store-settings-save', 'store-override-save'];
  for (const a of ACTIONS) {
    const r = await call(a, { user: 'u-su', qs: '&store=BL4' });
    ok(r.body?.code !== 'UNCLASSIFIED_ACTION', `E7 ${a} is classified for the business gate`);
    eq((await call(a, {})).status, 401, `E7 ${a} needs a session`);
    const s = await call(a, { secret: env.SNAPSHOT_SECRET, qs: '&store=BL4', body: { id: 1, store: 'BL4', decision: 'approve', reason: 'x' } });
    eq([s.status, s.body?.code], [403, 'SESSION_ONLY'], `E7 🛑 ${a} refuses the leaked X-Snapshot-Secret`);
  }
  // A user with no Bargain Lane grant at all.
  db.prepare("DELETE FROM user_grants WHERE user_id='u-sb'").run();
  db.prepare("UPDATE users SET stores=NULL WHERE id='u-sb'").run();
  eq((await call('bin-previews', { user: 'u-sb' })).status, 403, 'E7 no Bargain Lane access, no bin previews');
  // Revisions.
  const p = (await call('bin-preview-save', { user: 'u-mgr2', body: { store: 'BL4', saleDate: '2026-12-14', photoIds: [P.a] } })).body.preview;
  const e1 = await call('bin-preview-save', { user: 'u-mgr2', body: { id: p.id, store: 'BL4', saleDate: '2026-12-14', photoIds: [P.a, P.b], expectedRevision: p.revision } });
  eq(e1.status, 200, 'E7 an edit with the current revision saves');
  const audits = () => db.prepare("SELECT COUNT(*) n FROM content_audit WHERE entity='bin_preview' AND entity_id=?").get(String(p.id)).n;
  const before = audits();
  const e2 = await call('bin-preview-save', { user: 'u-mgr2', body: { id: p.id, store: 'BL4', saleDate: '2026-12-14', photoIds: [P.a], expectedRevision: p.revision } });
  eq(e2.status, 409, 'E7 an edit with a stale revision is a conflict, not an overwrite');
  eq(audits(), before, 'E7   and records nothing in the audit');
  eq(rev(p.id), p.revision + 1, '  and leaves the row at the revision the first edit made');
  eq((await call('bin-preview-submit', { user: 'u-mgr2', body: { id: p.id, expectedRevision: p.revision } })).status, 409, 'E7 so is a stale submit');
  eq((await call('bin-preview-save', { user: 'u-mgr2', body: { store: 'BL4', saleDate: '2026-02-30', photoIds: [P.a] } })).status, 400, 'E7 an impossible sale date is refused');
  eq((await call('bin-preview-save', { user: 'u-mgr2', body: { store: 'BL4', saleDate: '2026-12-14', photoIds: [] } })).status, 400, 'E7 a preview needs a photo');
  eq((await call('bin-preview-save', { user: 'u-mgr2', body: { store: 'BL4', saleDate: '2026-12-14', photoIds: [P.a], caption: 'x'.repeat(501) } })).status, 400, 'E7 a caption over 500 characters is refused');
  eq((await call('bin-preview-save', { user: 'u-mgr2', method: 'GET' })).status, 405, 'E7 writes are POST only');
}

// ── Slice 1 (2026-11-25): the store's bin photos, for a manager's photo picker ─────────────
// marketing-photos is admins' only. A Dupont manager building a preview needs Dupont's bin photos
// (uploaded from Submit Photos), and nothing else: not another store's, not other types, not rejected.
{
  const r = await call('bin-preview-photos', { user: 'u-mgr2', qs: '&store=BL4' });
  eq(r.status, 200, 'S1 a Dupont manager lists Dupont bin photos');
  const ids = (r.body?.photos || []).map(x => x.id);
  ok(ids.includes(P.a) && ids.includes(P.f), 'S1   their bin photos are there');
  ok(!ids.includes(retailPhoto), 'S1   🛑 a retail photo is not');
  ok(!ids.includes(rejectedPhoto), 'S1   🛑 a rejected photo is not');
  ok(!ids.includes(bl1Photo), "S1   🛑 another store's photo is not");
  eq(Object.keys(r.body?.photos?.[0] || {}).sort(), ['createdAt', 'id'], 'S1   only id and time leave the worker (no R2 key, no uploader)');
  // The business gate refuses this one before the handler does (NO_BUSINESS_ACCESS): any 403 is right.
  eq((await call('bin-preview-photos', { user: 'u-sb', qs: '&store=BL4' })).status, 403, "S1 🛑 a South Bend manager can't list Dupont's");
  eq((await call('bin-preview-photos', { user: 'u-admin', qs: '&store=XX9' })).status, 400, 'S1 an unknown store is refused');
  eq((await call('bin-preview-photos', { qs: '&store=BL4', secret: env.SNAPSHOT_SECRET })).body?.code, 'SESSION_ONLY', 'S1 🛑 the leaked secret gets nothing');
  eq((await call('bin-preview-photos', { user: 'u-mgr2', method: 'POST', body: {}, qs: '&store=BL4' })).status, 405, 'S1 it is a read: GET only');
}

// ── Slice 1b (2026-11-25): retail highlights on the store page ─────────────────────────────
// The same reviewed thing as a bin preview with retail photos instead. Plan §7, slice 1b.
{
  // The schema: every old row is 'bins'; one approved per store, kind and day; the old index is gone.
  const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='bin_previews'").all().map(r => r.name).sort();
  eq(idx, ['idx_bin_previews_store', 'uq_bin_previews_approved_kind'], 'R0 migration-094 replaces the one-per-day index with one per kind');
  eq(db.prepare("SELECT COUNT(*) AS n FROM bin_previews WHERE kind != 'bins'").get().n, 0, 'R0 every preview made so far is a bin preview');
  let rerun = null; try { db.exec(M094); } catch (e) { rerun = String(e.message); }
  ok(/duplicate column/.test(rerun || ''), `R0 a second run of migration-094 stops at the ALTER (${rerun})`);

  // Save: a retail highlight takes only this store's retail photos, and a bin preview only bin photos.
  const save = (body, user = 'u-mgr2') => call('bin-preview-save', { user, body });
  eq((await save({ store: 'BL4', kind: 'retail', saleDate: '2026-12-09', photoIds: [P.c] })).body?.code, 'BAD_PHOTOS', 'R1 🛑 a retail highlight refuses a bin photo');
  eq((await save({ store: 'BL4', kind: 'retail', saleDate: '2026-12-09', photoIds: [bl1Retail] })).body?.code, 'BAD_PHOTOS', "R1 🛑 and another store's retail photo");
  eq((await save({ store: 'BL4', saleDate: '2026-12-09', photoIds: [retailPhoto] })).body?.code, 'BAD_PHOTOS', 'R1 🛑 a bin preview still refuses a retail photo');
  eq((await save({ store: 'BL4', kind: 'shoes', saleDate: '2026-12-09', photoIds: [retailPhoto] })).status, 400, 'R1 an unknown kind is refused');
  const r1 = await save({ store: 'BL4', kind: 'retail', saleDate: '2026-12-09', photoIds: [retailPhoto, retailPhoto2], caption: 'New: kitchen + home' });
  eq(r1.status, 200, 'R1 the Dupont manager saves a retail highlight');
  let retail = r1.body?.preview;
  eq(retail?.kind, 'retail', 'R1   as retail');
  eq((await save({ id: retail.id, store: 'BL4', kind: 'bins', saleDate: '2026-12-09', photoIds: [P.c], expectedRevision: retail.revision })).status, 400,
     'R1 🛑 an edit cannot turn it into a bin preview');
  const kept = await save({ id: retail.id, store: 'BL4', saleDate: '2026-12-09', photoIds: [retailPhoto, retailPhoto2], caption: 'New: kitchen + home', expectedRevision: retail.revision });
  eq([kept.status, kept.body?.preview?.kind], [200, 'retail'], 'R1 an edit that leaves kind out keeps it retail');
  retail = kept.body?.preview;

  // The photo picker lists one kind at a time.
  const pick = async (qs) => (await call('bin-preview-photos', { user: 'u-mgr2', qs })).body?.photos?.map(x => x.id) || [];
  const rp = await pick('&store=BL4&type=retail');
  ok(rp.includes(retailPhoto) && rp.includes(retailPhoto2), 'R2 type=retail lists Dupont retail photos');
  ok(!rp.includes(P.a) && !rp.includes(bl1Retail), "R2   🛑 not bin photos, not another store's");
  ok(!(await pick('&store=BL4')).includes(retailPhoto), 'R2 with no type it is bins, as the live page expects');
  eq((await call('bin-preview-photos', { user: 'u-mgr2', qs: '&store=BL4&type=shoes' })).status, 400, 'R2 an unknown type is refused');

  // Approve: the default window is opening on the show-from day to closing six days later.
  eq((await call('bin-preview-submit', { user: 'u-mgr2', body: { id: retail.id, expectedRevision: retail.revision } })).status, 200, 'R3 submitted');
  const before = calls.length;
  const ap = await call('bin-preview-review', { user: 'u-admin', body: { id: retail.id, decision: 'approve', expectedRevision: rev(retail.id) } });
  eq(ap.status, 200, 'R3 an admin approves it');
  retail = ap.body?.preview;
  eq(retail?.startsAt, '2026-12-09T14:00:00.000Z', 'R3   from 9 AM Wednesday Eastern (the show-from day opening)');
  eq(retail?.endsAt, '2026-12-16T02:00:00.000Z', 'R3   to 9 PM the next Tuesday (closing, six days later)');
  eq([calls.length - before, ap.body?.socialDrafts], [0, []], 'R3 🛑 no social draft for retail (social is slice 2)');

  // A bin preview and a retail highlight share a day; two retail highlights don't.
  const bins = (await save({ store: 'BL4', saleDate: '2026-12-09', photoIds: [P.c] })).body?.preview;
  await call('bin-preview-submit', { user: 'u-mgr2', body: { id: bins.id, expectedRevision: bins.revision } });
  eq((await call('bin-preview-review', { user: 'u-admin', body: { id: bins.id, decision: 'approve', expectedRevision: rev(bins.id) } })).status, 200,
     'R3 a bin preview is approved for the same day');
  const second = (await save({ store: 'BL4', kind: 'retail', saleDate: '2026-12-09', photoIds: [retailPhoto2] })).body?.preview;
  await call('bin-preview-submit', { user: 'u-mgr2', body: { id: second.id, expectedRevision: second.revision } });
  eq((await call('bin-preview-review', { user: 'u-admin', body: { id: second.id, decision: 'approve', expectedRevision: rev(second.id) } })).body?.code,
     'ALREADY_APPROVED_FOR_DAY', 'R3 🛑 a second retail highlight for that day is refused');
  const listed = (await call('bin-previews', { user: 'u-mgr2', qs: '&store=BL4' })).body?.previews || [];
  eq(listed.find(p => p.id === retail.id)?.kind, 'retail', 'R3 the list says which kind each one is');
  eq(listed.find(p => p.id === bins.id)?.kind, 'bins', 'R3   (bins too)');

  // The feed: bins stay bins, retail goes in its own list, each with its own photos only.
  // 10 AM Wednesday Eastern: the retail highlight and that day's bin preview are both live.
  at('2026-12-09T15:00:00Z');
  let f = await feed();
  ok(!previewIds(f).includes(retail.id), '🛑 R4 a retail highlight never appears as a bin preview (the live site would call it "bins")');
  eq((f?.retailHighlights || []).map(p => p.id), [retail.id], 'R4 it is in retailHighlights');
  const rh = f?.retailHighlights?.[0] || {};
  eq(Object.keys(rh).sort(), ['caption', 'endsAt', 'id', 'images', 'showFrom', 'startsAt'], 'R4   field by field, nothing else');
  eq([rh.showFrom, rh.caption], ['2026-12-09', 'New: kitchen + home'], 'R4   with its day and caption');
  const rImg = `/public/v1/img/${retail.id}/${retailPhoto}.jpeg`;
  eq(rh.images, [`https://api.retjghub.com${rImg}`, `https://api.retjghub.com/public/v1/img/${retail.id}/${retailPhoto2}.jpeg`], 'R4   and approval-checked image links');
  eq((await pub(rImg)).status, 200, 'R4 its images are served');
  // A row that somehow names a bin photo: the feed leaves it out and the route refuses it, both ways round.
  db.prepare('UPDATE bin_previews SET photo_ids = ? WHERE id = ?').run(JSON.stringify([retailPhoto, P.d]), retail.id);
  db.prepare('UPDATE bin_previews SET photo_ids = ? WHERE id = ?').run(JSON.stringify([P.c, retailPhoto2]), bins.id);
  f = await feed();
  eq(f?.retailHighlights?.[0]?.images, [`https://api.retjghub.com${rImg}`], 'R4 🛑 a bin photo on a retail row is left out of the feed');
  eq((await pub(`/public/v1/img/${retail.id}/${P.d}.jpeg`)).status, 404, 'R4 🛑   and never served through it');
  eq(f?.binPreviews?.find(p => p.id === bins.id)?.images?.length, 1, 'R4 🛑 a retail photo on a bin row is left out too');
  eq((await pub(`/public/v1/img/${bins.id}/${retailPhoto2}.jpeg`)).status, 404, 'R4 🛑   and never served through it');
  db.prepare('UPDATE bin_previews SET photo_ids = ? WHERE id = ?').run(JSON.stringify([retailPhoto, retailPhoto2]), retail.id);
  db.prepare('UPDATE bin_previews SET photo_ids = ? WHERE id = ?').run(JSON.stringify([P.c]), bins.id);

  // Start, end and the cache.
  at('2026-12-09T13:59:59Z');
  eq((await feed())?.retailHighlights, [], 'R5 absent 1 s before opening on the show-from day');
  eq((await pub(rImg)).status, 404, 'R5   and so are its images');
  at('2026-12-16T01:59:30Z');
  eq((await pub('/public/v1/stores/BL4')).headers.get('cache-control'), 'public, max-age=30', 'R5 the cache never outlives it (30 s left → max-age=30)');
  at('2026-12-16T02:00:00Z');
  eq((await feed())?.retailHighlights, [], 'R5 absent at the end');
  eq((await pub(rImg)).status, 404, 'R5   and its images stop too');

  // Pull.
  at('2026-12-11T15:00:00Z');
  eq((await call('bin-preview-pull', { user: 'u-admin', body: { id: retail.id, reason: 'Sold out' } })).status, 200, 'R6 an admin pulls it');
  eq((await feed())?.retailHighlights, [], 'R6 🛑 gone from the feed');
  eq((await pub(rImg)).status, 404, 'R6 🛑 and its images are gone');

  // The standing retail line, in the store profile.
  const st = () => db.prepare("SELECT revision, profile_json FROM store_settings WHERE store = 'BL4'").get();
  const setProfile = (profile, user = 'u-admin') => call('store-settings-save', { user, body: { store: 'BL4', profile, expectedRevision: st().revision } });
  eq((await setProfile({ ...PROFILE, retailLine: 'x'.repeat(161) })).status, 400, 'R7 a retail line over 160 characters is refused');
  eq((await setProfile({ ...PROFILE, retailLine: 7 })).status, 400, 'R7 a retail line must be text');
  eq((await setProfile({ ...PROFILE, retailLine: 'Name-brand home goods and more, new every week.' }, 'u-mgr2')).status, 403, 'R7 a manager still cannot edit settings');
  eq((await setProfile({ ...PROFILE, retailLine: '  Name-brand home goods and more, new every week.  ' })).status, 200, 'R7 an admin sets it');
  eq((await feed())?.profile?.retailLine, 'Name-brand home goods and more, new every week.', 'R7 the feed carries it, trimmed');
  eq((await setProfile({ ...PROFILE, phone: '260-555-0199' })).status, 200, 'R7 a profile saved without retailLine (an older page)');
  eq([(await feed())?.profile?.retailLine, (await feed())?.profile?.phone], ['Name-brand home goods and more, new every week.', '260-555-0199'],
     'R7 🛑   keeps the stored line and saves the rest');
  eq((await setProfile({ ...PROFILE, phone: '260-555-0199', retailLine: '' })).status, 200, 'R7 an empty line clears it');
  eq((await feed())?.profile?.retailLine, null, 'R7   (null in the feed)');
}

Date.now = realNow;
console.log(`${assertions - failures} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
