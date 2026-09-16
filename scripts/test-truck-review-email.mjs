// The truck review email — who gets it, what it says, and the PDF it carries.
//
// 🔑 THE POINT OF THIS SUITE is the three things that are decisions rather than code:
//
//   1. RECIPIENTS FAIL CLOSED. Superusers, admins and THAT STORE's managers, and
//      nobody else. An E-Commerce-only admin must not be emailed Bargain Lane's
//      receiving; a BL4 manager must not be emailed a BL1 truck. Both gates are
//      invisible in the diff and both have been got wrong in this repo before.
//
//   2. THE BODY CARRIES EXCEPTIONS, THE ATTACHMENT CARRIES EVERY PALLET (Brian,
//      2026-09-16). A body that grows with the truck is a body Gmail clips at
//      ~102 KB, and a clipped mail hides its own ending without saying so.
//
//   3. THE PDF IS BYTES, NOT A STRING. Content streams are Latin-1 because a
//      WinAnsi font reads one byte per glyph, the xref is byte offsets, and the
//      BOL photo goes in as its own JPEG bytes. Each of those has already been
//      wrong once, and none of them errors when it is — the file still opens.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, applyMigrationAlters, req } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let assertions = 0, failures = 0;
const ok = (c, m) => { assertions++; if (!c) { failures++; console.error('  FAIL ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// Pinned, for the same reason test-inventory-receiver.mjs pins it: the 30th at 9pm
// Eastern is 01:00 UTC on OCTOBER 1st, so a UTC-derived month is visibly wrong rather
// than merely a day out. Also stops "generated <date>" in the PDF footer from drifting.
const PINNED = '2026-10-01T01:00:00Z';
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...a) { if (a.length === 0) super(PINNED); else super(...a); }
  static now() { return new RealDate(PINNED).getTime(); }
};

const worker = await loadWorker(repo);
const src = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');

// 🔑 The harness's own ctx SWALLOWS the waitUntil promise, which is exactly wrong for
// a suite about something that only happens in waitUntil. This one keeps them so the
// test can await the send instead of racing it.
const pending = [];
const ctx = { waitUntil: (p) => { pending.push(Promise.resolve(p).catch(() => {})); }, passThroughOnException: () => {} };
const settle = async () => { while (pending.length) await pending.shift(); };

// A genuinely well-formed JPEG header — SOI, APP0/JFIF, SOF0, SOS, EOI — so jpegInfo
// parses a real marker chain rather than a shape invented to match it.
function jpeg(w, h, comps = 3, payload = 64) {
  const sof = [0xFF, 0xC0, 0x00, 8 + comps * 3, 0x08, h >> 8, h & 0xFF, w >> 8, w & 0xFF, comps];
  for (let i = 1; i <= comps; i++) sof.push(i, 0x11, i === 1 ? 0x00 : 0x01);
  return new Uint8Array([
    0xFF, 0xD8,
    0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    ...sof,
    0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00,
    ...Array.from({ length: payload }, (_, i) => (i * 37) % 251),
    0xFF, 0xD9,
  ]);
}

function env0() {
  const { db, env } = makeEnv(repo);
  db.exec(fs.readFileSync(path.join(repo, 'migration-065.sql'), 'utf8'));
  db.exec(`CREATE TABLE IF NOT EXISTS notification_log (id TEXT PRIMARY KEY, user_id TEXT, type TEXT,
    event_type TEXT, status TEXT, error TEXT, provider_message_id TEXT, created_at TEXT)`);
  applyMigrationAlters(db, repo);
  env.RESEND_API_KEY = 'test-key';
  db.exec(`UPDATE users SET name = 'Kevin R' WHERE id = 'u-mgr1'`);
  // mgr2 is moved to BL4 only, so a BL1 truck must not reach them.
  db.exec(`UPDATE users SET name = 'Alyson B', stores = '["BL4"]' WHERE id = 'u-mgr2'`);
  db.exec(`UPDATE user_grants SET units = '["BL4"]' WHERE user_id = 'u-mgr2' AND business_id = 'bl'`);
  // An admin whose only grant is another business. The whole reason canAccessBusiness
  // is in the recipient filter.
  db.exec(`INSERT INTO businesses (id,name,unit_noun,source,active) VALUES ('ec','E-Commerce','channel',NULL,1)`);
  db.exec(`INSERT INTO users (id,email,role,stores,status,created_at)
           VALUES ('u-ecom','ecom@retjg.com','admin',NULL,'active','2026-01-01')`);
  db.exec(`INSERT INTO user_grants (user_id,business_id,role,units) VALUES ('u-ecom','ec','admin',NULL)`);
  // An associate: role staff, a synthetic address, and a pin_hash. Never a recipient.
  db.exec(`INSERT INTO users (id,email,role,stores,status,created_at)
           VALUES ('u-assoc','assoc-9f2@associates.local','staff','["BL1"]','active','2026-01-01')`);
  db.exec(`UPDATE users SET pin_hash = 'deadbeef' WHERE id = 'u-assoc'`);
  return { db, env };
}

// Capture what would have gone to Resend, and hand back a plausible id.
function mailSpy() {
  const sent = [];
  globalThis.fetch = async (u, init) => {
    sent.push({ url: String(u), headers: init.headers, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ id: 're_' + sent.length }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return sent;
}

const call = (url, opts = {}) => worker.fetch(req(url, opts), opts.env, ctx);
const json = async (r) => { try { return await r.json(); } catch { return {}; } };

// A truck and its pallets, straight into the database, so a test about the email is
// not also a test about opening a truck.
function seedTruck(db, o = {}) {
  const q = (v) => v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;
  db.exec(`INSERT INTO trucks (store, bol_no, ship_from, ship_from_addr, ship_to, bol_date, carrier,
             trailer_no, seal_no, pallet_count, r2_key, content_type, opened_by, opened_at,
             dup_approved_by, dup_reason)
           VALUES (${q(o.store || 'BL1')}, ${q(o.bol === undefined ? '7679' : o.bol)}, 'RM1',
                   '1450 Atlantic Ave, Rocky Mount NC 27801', 'FW2', '2026-09-11', 'Arrive Logistics',
                   '19353', '4949941', ${o.count === undefined ? 40 : (o.count == null ? 'NULL' : o.count)},
                   ${q(o.r2_key)}, ${q(o.content_type)}, 'Ranon Price', '2026-09-30T10:48:00Z',
                   ${q(o.dupBy)}, ${q(o.dupReason)})`);
  const id = db.prepare('SELECT last_insert_rowid() AS id').get().id;
  const ins = db.prepare(`INSERT INTO truck_pallets (truck_id, store, barcode, item_no, pallet_name,
    sup_ref, po, units, created_by_tag, truck_no, logged_by, logged_at, dup_approved_by, dup_reason)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  (o.pallets || []).forEach((p, i) => ins.run(id, o.store || 'BL1',
    p.barcode === undefined ? `PRM-10490-${20 + i}` : p.barcode,
    p.item_no === undefined ? `502${String(i).padStart(2, '0')}` : p.item_no,
    p.pallet_name === undefined ? 'PALLET AMAZON IND8' : p.pallet_name,
    p.sup_ref ?? null, p.po === undefined ? '5036' : p.po,
    p.units === undefined ? 100 + i : p.units,
    p.created_by_tag === undefined ? 'Ranon Price' : p.created_by_tag,
    p.truck_no ?? null, 'Kevin R', `2026-09-30T1${i % 9}:00:00Z`,
    p.dup_approved_by ?? null, p.dup_reason ?? null));
  return id;
}
const nPallets = (n, extra = {}) => Array.from({ length: n }, () => ({ ...extra }));

// Take a truck down and return the mail Resend was handed.
async function down(db, env, truckId, user = 'u-mgr1') {
  const sent = mailSpy();
  const r = await call('/?action=truck-down', { user, method: 'POST', body: { truck_id: truckId }, env });
  await settle();
  return { status: r.status, body: await json(r), sent };
}

// ── 1. Recipients: superusers, admins, and that store's managers ────────────
{
  const { db, env } = env0();
  const id = seedTruck(db, { pallets: nPallets(40) });
  const { sent } = await down(db, env, id);
  const to = sent.map(m => m.body.to).sort();

  ok(to.includes('bhoward@bargainlane.com'), 'the superuser is emailed');
  ok(to.includes('bgeorges@retjg.com'), 'the admin is emailed');
  ok(to.includes('howardbrian260@gmail.com'), "the BL1 truck reaches BL1's manager");
  // 🛑 The four that must not be on it, each for a different reason.
  ok(!to.includes('alyson@bargainlane.com'), '🔑 a BL4 manager is NOT emailed a BL1 truck');
  ok(!to.includes('ecom@retjg.com'), '🔑 an E-Commerce-only admin is NOT emailed Bargain Lane receiving');
  ok(!to.includes('owner@retjg.com'), 'an executive is not on the list Brian named');
  ok(!to.includes('lead@bargainlane.com'), 'a staff lead is not on the list Brian named');
  ok(!to.some(e => e.includes('associates.local')), "🔑 an associate's synthetic address is never mailed");
  eq(to.length, 3, 'three recipients, one message each');
  eq(new Set(to).size, to.length, 'nobody is mailed twice');

  // A truck at a store mgr2 DOES hold reaches them and not mgr1.
  const id4 = seedTruck(db, { store: 'BL4', bol: '8123', pallets: nPallets(4) });
  const b = await down(db, env, id4, 'u-su');
  const to4 = b.sent.map(m => m.body.to);
  ok(to4.includes('alyson@bargainlane.com'), 'the BL4 manager gets the BL4 truck');
  ok(!to4.includes('howardbrian260@gmail.com'), '...and the BL1 manager does not');
}

// ── 2. Every send is logged, and keyed so a repeat cannot double-deliver ────
{
  const { db, env } = env0();
  const id = seedTruck(db, { pallets: nPallets(3) });
  const { sent } = await down(db, env, id);

  const keys = sent.map(m => m.headers['Idempotency-Key']);
  ok(keys.every(k => typeof k === 'string' && k.startsWith(`truck-down-${id}-`)),
     '🔑 the idempotency key is truck + recipient, so a repeated Truck Down cannot re-deliver');
  eq(new Set(keys).size, keys.length, 'one key per recipient, not one shared key');

  const logged = db.prepare("SELECT user_id, status, provider_message_id FROM notification_log WHERE event_type = 'truck-review'").all();
  eq(logged.length, 3, 'every recipient gets a notification_log row');
  ok(logged.every(r => r.status === 'sent'), '...recording what the mailer actually said');
  ok(logged.every(r => r.provider_message_id), "...with Resend's message id, so it is a lookup and not a guess");

  // 🛑 A failed send must be recorded as failed, never silently dropped.
  globalThis.fetch = async () => new Response('{"message":"bad"}', { status: 422, headers: { 'content-type': 'application/json' } });
  const id2 = seedTruck(db, { bol: '7680', pallets: nPallets(1) });
  await call('/?action=truck-down', { user: 'u-mgr1', method: 'POST', body: { truck_id: id2 }, env });
  await settle();
  const failedRows = db.prepare("SELECT status FROM notification_log WHERE event_type = 'truck-review' AND status = 'failed'").all();
  eq(failedRows.length, 3, 'a 4xx from Resend is logged as failed, not as sent');

  // ...and must not fail Truck Down itself.
  globalThis.fetch = async () => { throw new Error('resend is down'); };
  const id3 = seedTruck(db, { bol: '7681', pallets: nPallets(1) });
  const r = await call('/?action=truck-down', { user: 'u-mgr1', method: 'POST', body: { truck_id: id3 }, env });
  await settle();
  eq(r.status, 200, '🛑 a mailer outage does not fail Truck Down at the dock');
  eq((db.prepare('SELECT closed_at FROM trucks WHERE id = ?').get(id3).closed_at != null), true,
     '...and the truck is still down');
}

// ── 3. The exceptions Brian signed off, and nothing else ───────────────────
{
  const { db, env } = env0();

  const cases = [
    { name: 'short', seed: { pallets: nPallets(37) },
      want: [/3 pallets short/, /of the 40 on the Bill of Lading/], subj: /3 short/ },
    { name: 'over', seed: { count: 4, pallets: nPallets(6) },
      want: [/2 pallets more/], subj: /2 over/ },
    { name: 'no count', seed: { count: null, pallets: nPallets(5) },
      want: [/No pallet count was read/, /5 scanned pallets/], subj: /5 pallets, no count on the BOL/ },
    { name: 'duplicate pallet', seed: { count: 2, pallets: [{}, { dup_approved_by: 'Kevin R', dup_reason: 'tag reprinted' }] },
      want: [/Duplicate barcode PRM-10490-21/, /approved by Kevin R \u2014 \u201ctag reprinted\u201d/], subj: /1 duplicate approved/ },
    { name: 'duplicate BOL', seed: { count: 1, pallets: nPallets(1), dupBy: 'Kevin R', dupReason: 're-delivery' },
      want: [/Duplicate Bill of Lading \d+<\/strong> approved by Kevin R/], subj: /1 duplicate approved/ },
    { name: 'one partial tag', seed: { count: 2, pallets: [{}, { units: null }] },
      want: [/A tag did not fully read/, /no unit count/], subj: /1 tag incomplete/ },
    { name: 'many partial tags', seed: { count: 5, pallets: nPallets(5, { po: null }) },
      want: [/5 tags did not fully read/, /dashed in the attached sheet/], subj: /5 tags incomplete/ },
  ];
  let bol = 9000;
  for (const c of cases) {
    const id = seedTruck(db, { bol: String(bol++), ...c.seed });
    const { sent } = await down(db, env, id);
    const html = sent[0].body.html;
    ok(/Needs a look/.test(html), `${c.name}: the amber block is shown`);
    for (const re of c.want) ok(re.test(html), `${c.name}: body says ${re}`);
    ok(c.subj.test(sent[0].body.subject), `${c.name}: subject says ${c.subj} (got ${JSON.stringify(sent[0].body.subject)})`);
  }

  // 🔑 sup_ref and truck_no appear on ONE of the two tag formats each, so their
  // absence is the format and not a failed read. A truck of clean format-A tags
  // must come through as clean.
  const clean = seedTruck(db, { bol: '9100', count: 3, pallets: nPallets(3, { sup_ref: null, truck_no: null }) });
  const { sent } = await down(db, env, clean);
  ok(!/Needs a look/.test(sent[0].body.html), '🔑 a missing sup_ref / truck_no is the tag format, not an exception');
  ok(/All <strong>3<\/strong> pallets/.test(sent[0].body.html), 'a clean truck gets the green line');
  ok(/Nothing short, no duplicates approved/.test(sent[0].body.html), '...saying so in one sentence');
  ok(/3 pallets, all accounted for/.test(sent[0].body.subject), '...and the subject says it too');
  ok(!/#422006/.test(sent[0].body.html), 'no amber block on a clean truck');
}

// ── 4. Exceptions in the body, every pallet in the attachment ──────────────
{
  const { db, env } = env0();
  const id = seedTruck(db, { count: 60, pallets: nPallets(58) });
  const { sent } = await down(db, env, id);
  const html = sent[0].body.html;

  // 🛑 Gmail clips at ~102 KB and hides its own ending. A body that grows with the
  // truck is the failure mode this shape exists to avoid, so it is pinned by size.
  ok(html.length < 12000, `the body stays small whatever the truck (${html.length} bytes)`);
  const bodyBarcodes = (html.match(/PRM-10490-\d+/g) || []).length;
  eq(bodyBarcodes, 0, '🔑 not one pallet row is in the body — they are all in the sheet');
  ok(/All 58 pallets are attached/.test(html), 'the body says where the pallets went');
  ok(/Truck-BOL-7679-BL1\.pdf/.test(html), '...and names the file, so it is findable in the client');
}

// ── 5. The attachments: the sheet, and the photo Brian asked to keep ───────
{
  const { db, env } = env0();
  const photo = jpeg(1200, 1600, 3, 512);
  await env.MEDIA.put('bol/BL1/2026-09/abc.jpg', photo, { httpMetadata: { contentType: 'image/jpeg' } });
  const id = seedTruck(db, { count: 40, pallets: nPallets(37), r2_key: 'bol/BL1/2026-09/abc.jpg', content_type: 'image/jpeg' });
  const { sent } = await down(db, env, id);
  const att = sent[0].body.attachments;

  eq(att.length, 2, '🔑 two attachments: the sheet and the BOL photo (Brian, 2026-09-16)');
  eq(att[0].filename, 'Truck-BOL-7679-BL1.pdf', 'the sheet is named for the BOL and the store');
  eq(att[1].filename, 'BOL-7679.jpg', 'the photo keeps the BOL number too');
  ok(att.every(a => typeof a.content === 'string' && !/[^A-Za-z0-9+/=]/.test(a.content)),
     'both are base64, which is what Resend takes');
  eq(att[0].content_type, 'application/pdf', 'the sheet declares its type');
  eq(att[1].content_type, 'image/jpeg', '...and so does the photo — without it some clients show an unnamed blob');

  const loose = Buffer.from(att[1].content, 'base64');
  ok(Buffer.from(photo).equals(loose), '🔑 the loose photo is the bytes that were uploaded, untouched');

  const pdf = Buffer.from(att[0].content, 'base64');
  // 🔑 The photo also goes INTO the sheet, as its own JPEG bytes through DCTDecode —
  // no decode, no re-encode — so the sheet prints as one self-contained document.
  ok(pdf.includes(Buffer.from(photo)), '🔑 the SAME bytes are embedded in the PDF, byte-identical');
  ok(/\/Filter \/DCTDecode/.test(pdf.toString('latin1')), '...through DCTDecode, not re-encoded');

  // Every recipient gets the same attachment array, built once.
  ok(sent.every(m => m.body.attachments.length === 2), 'every recipient gets both attachments');

  // 🛑 A BOL photo too large to mail drops out of BOTH places, and the body says so
  // rather than naming a file that is not there.
  const huge = new Uint8Array(4_000_001); huge.set(jpeg(10, 10), 0);
  await env.MEDIA.put('bol/BL1/2026-09/huge.jpg', huge, { httpMetadata: { contentType: 'image/jpeg' } });
  const big = seedTruck(db, { bol: '7690', count: 1, pallets: nPallets(1), r2_key: 'bol/BL1/2026-09/huge.jpg', content_type: 'image/jpeg' });
  const b2 = await down(db, env, big);
  eq(b2.sent[0].body.attachments.length, 1, 'an oversized photo leaves only the sheet attached');
  ok(/too large to attach/.test(b2.sent[0].body.html), '...and the body says so');

  // A truck with no photo at all still mails, with the sheet.
  const nophoto = seedTruck(db, { bol: '7691', count: 1, pallets: nPallets(1) });
  const b3 = await down(db, env, nophoto);
  eq(b3.sent[0].body.attachments.length, 1, 'a truck with no BOL photo still gets its sheet');

  // 🛑 WHAT THE BODY CLAIMS MUST MATCH WHAT THE SHEET HOLDS. The sentence used to say
  // "plus the Bill of Lading itself" whenever the photo merely was not oversized — so a
  // truck whose BOL was never photographed promised a page that is not in the file, and
  // somebody would have gone looking for it.
  ok(/No BOL photo was taken for this truck/.test(b3.sent[0].body.html),
     '🔑 a truck with no photo says so, instead of promising a BOL page the sheet lacks');
  ok(!/plus the Bill of Lading itself/.test(b3.sent[0].body.html),
     '...and does not claim one');
  ok(/plus the Bill of Lading itself/.test(sent[0].body.html),
     '...while a truck that HAS one still says so');
  ok(!/too large|attached separately|No BOL photo/.test(sent[0].body.html),
     '...with no contradicting note beside it');
}

// ── 6. The PDF is a real PDF ───────────────────────────────────────────────
{
  const { db, env } = env0();
  const photo = jpeg(1200, 1600, 3, 4096);
  await env.MEDIA.put('k.jpg', photo, { httpMetadata: { contentType: 'image/jpeg' } });
  const id = seedTruck(db, {
    count: 40, r2_key: 'k.jpg', content_type: 'image/jpeg',
    pallets: nPallets(37).map((_, i) => (i === 3 ? { dup_approved_by: 'Kevin R', dup_reason: 'tag reprinted' } : {})),
  });
  const { sent } = await down(db, env, id);
  const pdf = Buffer.from(sent[0].body.attachments[0].content, 'base64');
  const s = pdf.toString('latin1');

  ok(s.startsWith('%PDF-1.4'), 'starts with a PDF header');
  ok(s.trimEnd().endsWith('%%EOF'), 'ends with %%EOF');

  const xrefAt = +/startxref\s+(\d+)/.exec(s.slice(-80))[1];
  eq(s.slice(xrefAt, xrefAt + 4), 'xref', 'startxref points at the xref table');
  const m = /xref\s+0 (\d+)\s+([\s\S]*?)trailer/.exec(s.slice(xrefAt));
  const count = +m[1];
  const lines = m[2].trim().split(/\r?\n/);
  eq(lines.length, count, 'the xref has as many lines as it claims entries');
  // 🛑 Every offset, checked against the object it claims. Written as `first + length`
  // rather than `first + length - 1` the table declared a phantom final object at
  // offset 0 pointing back at the file header, which lenient readers ignore.
  let bad = 0;
  for (let n = 1; n < count; n++) {
    if (s.slice(parseInt(lines[n].slice(0, 10), 10), parseInt(lines[n].slice(0, 10), 10) + `${n} 0 obj`.length) !== `${n} 0 obj`) bad++;
  }
  eq(bad, 0, '🔑 every xref offset lands on the object it names');
  eq(/\/Size\s+(\d+)/.exec(/trailer\s*<<([\s\S]*?)>>/.exec(s)[1])[1], String(count), 'trailer /Size matches the xref');

  let streams = 0, badLen = 0;
  const re = /\/Length (\d+)[^>]*>>\s*stream\r?\n/g;
  let mm;
  while ((mm = re.exec(s))) {
    streams++;
    const start = mm.index + mm[0].length;
    const actual = s.indexOf('endstream', start) - start;
    if (actual !== +mm[1] && actual !== +mm[1] + 1) badLen++;
  }
  ok(streams >= 3, `found ${streams} streams`);
  eq(badLen, 0, 'every stream /Length matches the bytes that follow it');
  ok(/\/Count 3/.test(s), '37 pallets and a BOL make three pages');
  ok(/\/BaseFont \/Helvetica-Bold/.test(s), 'the bold face is declared');
  ok(/\/ColorSpace \/DeviceRGB/.test(s), 'a 3-component JPEG is DeviceRGB');

  // 🛑 The one that does not error when it is wrong. TextEncoder emits UTF-8, so
  // "\u00b7" went in as 0xC2 0xB7 and every middot printed as "Â·" — while /Length,
  // itself in bytes, still agreed with itself.
  const body = pdf.subarray(0, pdf.indexOf(Buffer.from(photo)));
  let utf8Middots = 0, winAnsiMiddots = 0;
  for (let i = 0; i < body.length - 1; i++) {
    if (body[i] === 0xC2 && body[i + 1] === 0xB7) utf8Middots++;
    if (body[i] === 0xB7) winAnsiMiddots++;
  }
  // 🛑 The second assertion without this one passes vacuously on a sheet that happens
  // to contain no middots at all, which is exactly what it would do if the separators
  // were ever changed back to hyphens "to be safe".
  ok(winAnsiMiddots > 0, `the sheet writes middots as the single WinAnsi byte (${winAnsiMiddots} of them)`);
  eq(utf8Middots, 0, '🔑 content streams are Latin-1 — no UTF-8 sequence where WinAnsi wants one byte');

  // The sheet has to carry the things the body does not.
  ok(s.includes('NEEDS A LOOK'), 'the exception block opens the sheet');
  ok(s.includes('DUP OK'), 'the approved duplicate is flagged in its row');
  ok(s.includes('PRM-10490-20') && s.includes('PRM-10490-56'), 'every pallet is in it, first and last');
  ok(s.includes('Bill of Lading - as photographed'), 'the BOL page is titled');
  ok(s.includes('BUILT BY'), 'the builder column is there');
  ok(s.includes('approved by Kevin R - "tag reprinted"'),
     '🔑 the sheet folds the em dash and curly quotes back to ASCII — base-14 Helvetica has no glyph for them');
  ok(!/\u2014|\u201c/.test(s), '...and no unmapped character survives into the file');
}

// ── 7. The sheet's geometry is asserted, not eyeballed ─────────────────────
{
  // 🛑 UNITS used to end 30pt INSIDE BUILT BY, and the DUP OK badge was drawn at a
  // hard-coded x with no column at all — straight through the builder's name. Neither
  // errors; both mangle the page. So the columns are boxes, and they are checked.
  const m = /const TRUCK_SHEET_COLS = \[([\s\S]*?)\];/.exec(src);
  ok(!!m, 'TRUCK_SHEET_COLS is a top-level const');
  const cols = [...m[1].matchAll(/x:\s*PDF_MARGIN(?:\s*\+\s*(\d+))?,\s*w:\s*(\d+)/g)]
    .map(c => ({ x: 42 + (+(c[1] || 0)), w: +c[2] }));
  eq(cols.length, 7, 'seven columns, including the flag column the badge used to lack');
  let overlaps = 0;
  for (let i = 1; i < cols.length; i++) if (cols[i - 1].x + cols[i - 1].w > cols[i].x) overlaps++;
  eq(overlaps, 0, '🔑 no column overlaps the next');
  ok(cols[cols.length - 1].x + cols[cols.length - 1].w <= 612 - 42, 'the last column stops at the right margin');
  ok(/function truckSheetColumns\(\)[\s\S]*?throw new Error/.test(src),
     '...and an overlapping layout throws at build time rather than printing wrong');
}

// ── 8. Greyscale and CMYK ──────────────────────────────────────────────────
{
  const { db, env } = env0();
  // 🔑 Hard-coding /DeviceRGB renders a greyscale scan as noise. A 4-component Adobe
  // CMYK JPEG additionally needs an inverted /Decode array, so it is REFUSED rather
  // than drawn wrong — the loose attachment still carries it.
  await env.MEDIA.put('g.jpg', jpeg(800, 600, 1, 128), { httpMetadata: { contentType: 'image/jpeg' } });
  const g = seedTruck(db, { bol: '7700', count: 1, pallets: nPallets(1), r2_key: 'g.jpg', content_type: 'image/jpeg' });
  const bg = await down(db, env, g);
  const gpdf = Buffer.from(bg.sent[0].body.attachments[0].content, 'base64').toString('latin1');
  ok(/\/ColorSpace \/DeviceGray/.test(gpdf), 'a 1-component JPEG is DeviceGray, not DeviceRGB');
  ok(/\/Count 2/.test(gpdf), '...and it still gets its own page');

  await env.MEDIA.put('c.jpg', jpeg(800, 600, 4, 128), { httpMetadata: { contentType: 'image/jpeg' } });
  const c = seedTruck(db, { bol: '7701', count: 1, pallets: nPallets(1), r2_key: 'c.jpg', content_type: 'image/jpeg' });
  const bc = await down(db, env, c);
  const cpdf = Buffer.from(bc.sent[0].body.attachments[0].content, 'base64').toString('latin1');
  ok(!/DCTDecode/.test(cpdf), '🛑 a CMYK JPEG is left out of the sheet rather than drawn wrong');
  ok(/\/Count 1/.test(cpdf), '...so the sheet is the pallet page alone');
  eq(bc.sent[0].body.attachments.length, 2, '...and the photo is still attached loose');
  ok(/attached separately/.test(bc.sent[0].body.html),
     '🔑 ...which is exactly what the body says, rather than claiming a BOL page');
  ok(!/plus the Bill of Lading itself/.test(bc.sent[0].body.html), '...and not the opposite');
}

// ── 9. Times are the store's, not UTC ──────────────────────────────────────
{
  const { db, env } = env0();
  const id = seedTruck(db, { count: 1, pallets: nPallets(1) });
  const { sent } = await down(db, env, id);
  const html = sent[0].body.html;
  // opened_at is 2026-09-30T10:48:00Z — 6:48 AM Eastern. A truck opened at 6:48 on
  // the dock must not read 10:48 to the person who worked it.
  ok(/6:48\s*AM/.test(html), '🔑 times are Eastern, not UTC');
  ok(!/10:48/.test(html), '...and the UTC time is nowhere in the body');
  ok(/Ranon Price/.test(html), 'who opened it');
  ok(/Kevin R/.test(html), 'who took it down');
  ok(/Sep 11, 2026/.test(html), "the BOL's own date, as printed on the paperwork");
  ok(/19353 \/ 4949941/.test(html), 'trailer and seal, the two handwritten fields');
}

// ── 10. The wiring: waitUntil, after the close, never awaited ──────────────
{
  const handler = src.slice(src.indexOf('action") === "truck-down"'));
  const upd = handler.indexOf('UPDATE trucks SET closed_by');
  const notify = handler.indexOf('notifyTruckDown');
  ok(upd > 0 && notify > upd, '🔑 the email is sent AFTER the truck is closed, not before');
  ok(/ctx\.waitUntil\(notifyTruckDown\(/.test(handler.slice(0, notify + 200)),
     '🛑 through waitUntil — a Resend outage must not fail Truck Down at the dock');
  ok(!/await notifyTruckDown/.test(handler.slice(0, 2000)), '...and never awaited on the response path');
  // The one thing that would silently stop the whole feature.
  ok(/eventType: "truck-review"/.test(src), 'every attempt is recorded under one event type');
}

console.log(`\n${assertions} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
