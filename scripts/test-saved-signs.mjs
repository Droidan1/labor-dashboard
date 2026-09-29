// Saved signs (Sign Studio): who sees what, the save that can't be doubled, the field rules,
// the soft delete and the month folders, all through the REAL worker on the harness.
//
// Brian, 2026-09-29: folders by sign type, then by month. A manager sees only the signs they
// saved, plus one shared All stores folder. Admins and superusers see All stores only, and
// whatever they save goes there. The rule lives in savedSignAccess (worker.js); the table is
// migration-075.sql.
//
// 🔑 Every negative below has its positive beside it, and each fixture varies ONE thing
// ("The cross-store test passed because the fixture picked the wrong store", lessons.md). The
// two managers share BL1, so a visibility result can only come from the owner, never the store.
process.removeAllListeners('warning');   // node:sqlite is experimental in this Node
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { loadWorker, makeEnv, applyMigrationAlters, ctx, req, blockNetwork, USERS } from './lib/worker-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// The clock is pinned and movable. Sessions are pushed to 2099 below, so moving it logs nobody out.
let NOW = '2026-09-29T15:00:00.000Z';
const RealDate = Date;
class FixedDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(NOW); else super(...a); }
  static now() { return new RealDate(NOW).getTime(); }
}
globalThis.Date = FixedDate;
blockNetwork();
const worker = await loadWorker(repo);

// The page's own renderer: what the page sends is JSON.stringify(normalizeSign(sign)), and what
// the page refuses is validate(model, null).msgs. Both are used as they ship, from index.html.
const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
const OPEN = '<script id="sign-render">', at = html.indexOf(OPEN);
const rctx = vm.createContext({ window: {} });
vm.runInContext(html.slice(at + OPEN.length, html.indexOf('</script>', at)), rctx);
const R = rctx.window.SignRender;
const sign = o => R.normalizeSign(Object.assign(R.blankSign(), o));
const pageRefuses = s => Object.keys(R.validate(R.signModel(s), null).msgs);

const EMAIL = Object.fromEntries(USERS.map(u => [u[0], u[1]]));
const ASSOC = 'u-assoc';
function env0() {
  const { db, env } = makeEnv(repo);
  db.exec(fs.readFileSync(path.join(repo, 'migration-075.sql'), 'utf8'));
  applyMigrationAlters(db, repo);   // 🔑 again, AFTER the migration created its table
  db.prepare("UPDATE sessions SET expires_at = '2099-01-01T00:00:00.000Z'").run();
  // An associate holding a (forged) Sign Studio page grant: staff with a PIN and pages.
  db.prepare(`INSERT INTO users (id, email, role, stores, status, created_at, name, pin_hash, pages) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(ASSOC, 'dee@bargainlane.com', 'staff', '["BL1"]', 'active', '2026-01-01', 'Dee Ramirez', 'a'.repeat(64), '{"merch-signs":"edit"}');
  db.prepare('INSERT INTO user_grants (user_id, business_id, role, units) VALUES (?,?,?,?)').run(ASSOC, 'bl', 'staff', '["BL1"]');
  db.prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?,?,?,?)').run('sess-' + ASSOC, ASSOC, '2099-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  return { db, env };
}
let E = env0();
const call = (url, o = {}) => worker.fetch(req(url, o), E.env, ctx);
const rawSave = (user, text) => worker.fetch(new Request('https://api.retjghub.com/?action=saved-sign-save', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(user ? { Cookie: `session=sess-${user}` } : {}) }, body: text }), E.env, ctx);
const J = async r => { try { return await r.json(); } catch { return {}; } };
const count = () => E.db.prepare('SELECT COUNT(*) AS n FROM saved_signs').get().n;
// A missing row reads as {} so a broken worker FAILS assertions here instead of crashing the
// suite, which a mutation run would count as caught without knowing why (lessons.md, 2026-09-29).
const rowOf = id => (typeof id === 'string' ? E.db.prepare('SELECT * FROM saved_signs WHERE id = ?').get(id) : null) || {};
let seq = 0;
const uid = () => `00000000-0000-4000-8000-${(++seq).toString(16).padStart(12, '0')}`;
const save = (user, s, id = uid(), design_version = 2) => call('/?action=saved-sign-save', { user, method: 'POST', body: { id, sign: s, design_version } });
const folders = async user => J(await call('/?action=saved-sign-folders', { user }));
const list = async (user, scope, template, month = '2026-09', extra = '') =>
  call(`/?action=saved-sign-list&scope=${scope}&template=${template}&month=${month}${extra}`, { user });
const ids = async r => ((await J(r)).signs || []).map(s => s.id);
const savedId = async (user, s) => ((await J(await save(user, s))).sign || {}).id;

const OKS = sign({ groups: [{ name: 'All cereal', price: '2', unit: 'each' }] });

// ── 1. Access ────────────────────────────────────────────────────────────────
console.log('Access');
{
  const ACTIONS = [
    ['folders', u => call('/?action=saved-sign-folders', { user: u })],
    ['list', u => call('/?action=saved-sign-list&scope=all&template=price&month=2026-09', { user: u })],
    ['save', u => call('/?action=saved-sign-save', { user: u, method: 'POST', body: { id: uid(), sign: OKS, design_version: 2 } })],
    ['delete', u => call('/?action=saved-sign-delete', { user: u, method: 'POST', body: { id: uid() } })],
  ];
  for (const [who, status, code, why] of [
    ['u-exec', 403, 'NEED_SIGN_STUDIO', 'an executive: passes canSeeFinancials, refused by role'],
    ['u-staff', 403, 'NO_FINANCIAL_ACCESS', 'staff: refused by the financial gate'],
    [ASSOC, 403, 'NO_FINANCIAL_ACCESS', 'an associate holding a Sign Studio page grant'],
    [null, 401, 'NO_SESSION', 'no session'],
  ]) {
    for (const [name, fn] of ACTIONS) {
      const before = count(), r = await fn(who), j = await J(r);
      eq([r.status, j.code], [status, code], `${name}: ${why} is refused`);
      eq(count(), before, `${name}: ${why} writes nothing`);
    }
  }
  // The machine caller (the snapshot secret) has no user, so it has no folders either.
  for (const [name, url, method, body] of [['folders', '/?action=saved-sign-folders', 'GET'],
      ['save', '/?action=saved-sign-save', 'POST', { id: uid(), sign: OKS, design_version: 2 }]]) {
    const r = await worker.fetch(req(url, { method, body, secret: 'harness-secret-not-used' }), E.env, ctx), j = await J(r);
    eq([r.status, j.code], [403, 'NEED_SIGN_STUDIO'], `${name}: the snapshot-secret caller is refused`);
  }
  eq(count(), 0, 'no refused request left a row');
  // The positive controls, and the gate that would silently 403 all of this in production.
  for (const u of ['u-mgr1', 'u-mgr2', 'u-admin', 'u-su']) {
    for (const [name, fn] of ACTIONS) {
      const r = await fn(u), j = await J(r);
      ok(j.code !== 'UNCLASSIFIED_ACTION' && j.code !== 'NEED_SIGN_STUDIO' && j.code !== 'NO_FINANCIAL_ACCESS',
         `${name}: ${u} gets through every gate (${r.status} ${j.code || ''})`);
    }
  }
  eq((await call('/?action=saved-sign-folders', { user: 'u-mgr1' })).status, 200, 'a manager opens the folders');
  eq((await call('/?action=saved-sign-folders', { user: 'u-admin' })).status, 200, 'an admin opens the folders');
  eq((await call('/?action=saved-sign-folders', { user: 'u-su' })).status, 200, 'a superuser opens the folders');
}

// ── 2. What a save stores ────────────────────────────────────────────────────
console.log('What a save stores');
E = env0();
{
  const id = uid(), r = await save('u-mgr1', OKS, id), j = await J(r);
  eq(r.status, 200, 'a manager saves a sign');
  eq(j.sign, { id, scope: 'own', template: 'price', month: '2026-09', saved_at: NOW, saved_by: null, design_version: 2, sign: JSON.parse(JSON.stringify(OKS)), can_delete: true },
     '…and gets it back: their own, in Price signs › 2026-09, theirs to delete');
  const row = rowOf(id);
  eq([row.owner_id, row.owner_email, row.scope, row.template, row.saved_month, row.design_version, row.saved_at, row.deleted_at],
     ['u-mgr1', EMAIL['u-mgr1'], 'own', 'price', '2026-09', 2, NOW, null], '…stored against the session\'s user, as own');
  eq(row.sign_json, JSON.stringify(OKS), '…and the stored sign is the page\'s own JSON.stringify(normalizeSign(sign)), character for character');
  const a = await J(await save('u-admin', sign({ template: 'pct', groups: [{ name: 'All coats', pct: '20' }] })));
  eq([(a.sign || {}).scope, (a.sign || {}).saved_by, (a.sign || {}).can_delete], ['all', EMAIL['u-admin'], true], 'an admin\'s save goes to All stores, saved by them, theirs to delete');
  const s = await J(await save('u-su', sign({ template: 'uvt', them: '59.99', groups: [{ name: 'Stand mixer', price: '19.99' }] })));
  eq([(s.sign || {}).scope, (s.sign || {}).template], ['all', 'uvt'], 'so does a superuser\'s');
  // The name is kept as typed; the rules judged the cleaned text (22 characters).
  const loose = sign({ groups: [{ name: ' All' + ' '.repeat(30) + 'cereal ', price: '2' }] });
  const l = await save('u-mgr1', loose);
  eq(l.status, 200, 'spaces the sign collapses do not count toward the 22 characters');
  eq(JSON.parse(rowOf(((await J(l)).sign || {}).id).sign_json || '{"groups":[{}]}').groups[0].name, ' All' + ' '.repeat(30) + 'cereal ', '…and the name is stored as typed, so reopening shows what was typed');
  // A manager can't choose where a sign goes.
  const before = count();
  const forced = await rawSave('u-mgr1', JSON.stringify({ id: uid(), sign: OKS, design_version: 2, scope: 'all' }));
  eq([forced.status, (await J(forced)).code, count()], [400, 'BAD_REQUEST', before], '🛑 a manager\'s request naming scope:"all" is refused whole, and writes nothing');
}

// ── 3. The save that can't be doubled ────────────────────────────────────────
console.log('Idempotency');
E = env0();
{
  const id = uid();
  const r1 = await save('u-mgr1', OKS, id), r2 = await save('u-mgr1', OKS, id);
  eq([r1.status, r2.status, count()], [200, 200, 1], 'the same save twice (a retry after a lost reply) is one row, and both answers are success');
  eq((await J(r2)).sign, (await J(r1)).sign, '…and the retry gets the same sign back as the first answer');
  const id2 = uid();
  const both = await Promise.all([save('u-mgr1', OKS, id2), save('u-mgr1', OKS, id2)]);
  eq([both[0].status, both[1].status, count()], [200, 200, 2], 'two identical saves at once are still one row');
  const again = await save('u-mgr1', OKS, id, 3);
  eq([again.status, rowOf(id).design_version], [200, 2], 'a retry that reports another design version is the same save: the stored version stands');
  const other = sign({ groups: [{ name: 'All cereal', price: '3' }] });
  const c1 = await save('u-mgr1', other, id), j1 = await J(c1);
  eq([c1.status, j1.code, rowOf(id).sign_json], [409, 'ID_USED', JSON.stringify(OKS)], 'the same id with a different sign is refused, and the saved sign is unchanged');
  const c2 = await save('u-mgr2', OKS, id), j2 = await J(c2);
  eq([c2.status, Object.keys(j2).sort(), rowOf(id).owner_id], [409, ['code', 'error'], 'u-mgr1'],
     '🛑 another manager\'s save with that id is refused with nothing but {error, code}: it says nothing about whose it is, and moves nothing');
  eq(j2, j1, '…the same body as the owner\'s own clash, so the answer can\'t be used to probe for ids');
  eq((await save('u-admin', OKS, id)).status, 409, 'an admin can\'t take a manager\'s id either');
}

// ── 4. What the server refuses (every refusal writes nothing) ────────────────
console.log('Refusals');
E = env0();
{
  const good = { id: uid(), sign: OKS, design_version: 2 };
  const variants = [
    ['a body that is not JSON', 'not json', 400, 'BAD_REQUEST'],
    ['an array', '[]', 400, 'BAD_REQUEST'],
    ['no id', JSON.stringify({ sign: OKS, design_version: 2 }), 400, 'BAD_REQUEST'],
    ['a v1 UUID', JSON.stringify({ ...good, id: '00000000-0000-1000-8000-000000000001' }), 400, 'BAD_REQUEST'],
    ['an id that is not a UUID', JSON.stringify({ ...good, id: 'abc' }), 400, 'BAD_REQUEST'],
    ['a numeric id', JSON.stringify({ ...good, id: 7 }), 400, 'BAD_REQUEST'],
    ['design version 0', JSON.stringify({ ...good, design_version: 0 }), 400, 'BAD_REQUEST'],
    ['design version 1000', JSON.stringify({ ...good, design_version: 1000 }), 400, 'BAD_REQUEST'],
    ['design version 1.5', JSON.stringify({ ...good, design_version: 1.5 }), 400, 'BAD_REQUEST'],
    ['design version "2"', JSON.stringify({ ...good, design_version: '2' }), 400, 'BAD_REQUEST'],
    ['an extra top-level key', JSON.stringify({ ...good, owner_id: 'u-mgr2' }), 400, 'BAD_REQUEST'],
    ['a body over 8 KB', JSON.stringify(good) + ' '.repeat(9000), 413, 'SIGN_TOO_LARGE'],
  ];
  const signVariants = [
    ['no sign', null, 'sign'],
    ['a sign that is an array', [], 'sign'],
    ['a sign with an extra key', { ...OKS, owner: 'x' }, 'sign'],
    ['a sign missing a key', (({ them, ...rest }) => rest)(OKS), 'sign'],
    ['an unknown sign type', { ...OKS, template: 'poster' }, 'template'],
    ['an unknown sale label', { ...OKS, sale: 'mega' }, 'sale'],
    ['two as a string', { ...OKS, two: 'yes' }, 'two'],
    ['two products on Us vs Them', { ...sign({ template: 'uvt', them: '10', groups: [{ name: 'Tea', price: '2' }] }), two: true }, 'two'],
    ['one group', { ...OKS, groups: [OKS.groups[0]] }, 'sign'],
    ['three groups', { ...OKS, groups: [OKS.groups[0], OKS.groups[1], OKS.groups[1]] }, 'sign'],
    ['a group with an extra key', { ...OKS, groups: [{ ...OKS.groups[0], color: 'red' }, OKS.groups[1]] }, 'sign'],
    ['a group missing its dot', { ...OKS, groups: [(({ dot, ...g }) => g)(OKS.groups[0]), OKS.groups[1]] }, 'sign'],
    ['an unknown unit', { ...OKS, groups: [{ ...OKS.groups[0], unit: 'dozen' }, OKS.groups[1]] }, 'sign'],
    ['a dot that is a string', { ...OKS, groups: [{ ...OKS.groups[0], dot: 'true' }, OKS.groups[1]] }, 'sign'],
    ['a 201-character string', { ...OKS, custom: 'x'.repeat(201) }, 'sign'],
    ['a price as a number', { ...OKS, groups: [{ ...OKS.groups[0], price: 2 }, OKS.groups[1]] }, 'sign'],
    ['two dots', { ...OKS, two: true, groups: [{ ...OKS.groups[0], dot: true, qual: 'a' }, { name: 'Tea', price: '2', pct: '', unit: '', qual: 'b', dot: true }] }, 'qual-1'],
    ['a 23-character name', sign({ groups: [{ name: 'x'.repeat(23), price: '2' }] }), 'name-0'],
    ['no name', sign({ groups: [{ name: '   ', price: '2' }] }), 'name-0'],
    ['an emoji in the name', sign({ groups: [{ name: 'Shoes 👟', price: '2' }] }), 'name-0'],
    ['a bidi override in the name', sign({ groups: [{ name: 'Shoes \u202Eoff', price: '2' }] }), 'name-0'],
    ['a third decimal', sign({ groups: [{ name: 'Tea', price: '2.505' }] }), 'price-0'],
    ['$10,000', sign({ groups: [{ name: 'Tea', price: '10000' }] }), 'price-0'],
    ['100% off', sign({ template: 'pct', groups: [{ name: 'Tea', pct: '100' }] }), 'pct-0'],
    ['the second price, when two print', sign({ two: true, groups: [{ name: 'Tea', price: '2' }, { name: 'Coffee', price: 'abc' }] }), 'price-1'],
    ['a dot with no note', sign({ groups: [{ name: 'Tea', price: '2', dot: true }] }), 'qual-0'],
    ['a 33-character note', sign({ groups: [{ name: 'Tea', price: '2', qual: 'x'.repeat(33) }] }), 'qual-0'],
    ['an empty custom label', sign({ sale: 'custom', custom: '  ', groups: [{ name: 'Tea', price: '2' }] }), 'custom'],
    ['a 13-character custom label', sign({ sale: 'custom', custom: 'Weekend deals', groups: [{ name: 'Tea', price: '2' }] }), 'custom'],
    ['Us vs Them with no price of theirs', sign({ template: 'uvt', them: '', groups: [{ name: 'Table', price: '30' }] }), 'them'],
    ['Us vs Them paying what they charge', sign({ template: 'uvt', them: '100', groups: [{ name: 'Table', price: '100' }] }), 'price-0'],
    ['Us vs Them saving under 1%', sign({ template: 'uvt', them: '100', groups: [{ name: 'Table', price: '99.50' }] }), 'price-0'],
  ];
  for (const [what, text, status, code] of variants) {
    const before = count(), r = await rawSave('u-mgr1', text), j = await J(r);
    eq([r.status, j.code, count()], [status, code, before], `${what}: refused (${status} ${code}), nothing written`);
  }
  // An id with letters in it, so upper-casing changes it (an all-digit id would test nothing).
  const lower = 'abcdef01-2345-4abc-8def-0123456789ab', upper = lower.toUpperCase();
  ok(upper !== lower, 'the fixture id really changes when upper-cased');
  const before = count(), up = await rawSave('u-mgr1', JSON.stringify({ ...good, id: upper }));
  eq([up.status, (await J(up)).code, count()], [400, 'BAD_REQUEST', before], 'an upper-case UUID is refused: crypto.randomUUID() is lower case, so a retry can\'t miss its own row');
  eq((await rawSave('u-mgr1', JSON.stringify({ ...good, id: lower }))).status, 200, '…and the same id in lower case is accepted (the positive beside it)');
  for (const [what, s, field] of signVariants) {
    const before = count(), r = await rawSave('u-mgr1', JSON.stringify({ ...good, id: uid(), sign: s })), j = await J(r);
    eq([r.status, j.code, j.field, count()], [400, 'BAD_SIGN', field, before], `${what}: refused as ${field}, nothing written`);
  }
  // The edges that ARE signs.
  for (const [what, s] of [
    ['a 22-character name with ß (23 capitals)', sign({ groups: [{ name: 'Straßenschuhe für alle', price: '2' }] })],
    ['a decomposed é', sign({ groups: [{ name: 'Cafe\u0301', price: '2' }] })],
    ['ß, ÿ, Œ, curly quotes, dashes, ™ and €', sign({ groups: [{ name: 'ß ÿ Œ “Q” – ™ €', price: '2' }] })],
    ['hostile text, kept as text', sign({ groups: [{ name: '<img src=x onerror=1>', price: '2' }] })],
    ['a second group that does not print', sign({ groups: [{ name: 'Tea', price: '2' }, { name: 'x'.repeat(40), price: 'abc' }] })],
    ['a price field on a % Off sign', sign({ template: 'pct', groups: [{ name: 'Coats', pct: '20', price: 'abc' }] })],
    ['a 12-character custom label', sign({ sale: 'custom', custom: 'Weekend deal', groups: [{ name: 'Tea', price: '2' }] })],
  ]) eq((await save('u-mgr1', s)).status, 200, `${what}: saved`);
}

// ── 4b. The character list is the page's, spelled the same way ──────────────
// The parity cases below can't tell a \u escape from the character it names. On 29 Sep this
// file's first draft of the list reached worker.js as the characters themselves, including
// an invisible no-break space at the start of a range (lessons.md, 2026-09-25). So the
// spelling is pinned too: the worker's list is the page's TEXT_CHARS, character for character,
// and the saved-sign code in worker.js is plain ASCII.
{
  const wsrc = fs.readFileSync(path.join(repo, 'worker.js'), 'utf8');
  const pageList = (html.match(/const TEXT_CHARS = (\/\^\[[^\n]*?\]\$\/);/) || [])[1];
  const workerList = (wsrc.match(/\n  chars: (\/\^\[[^\n]*?\]\$\/),/) || [])[1];
  ok(pageList && pageList.startsWith('/^[\\u0020-\\u007E'), `the page's list is found, spelled with escapes (${pageList && pageList.slice(0, 24)})`);
  eq(workerList, pageList, "the worker's printable-character list is the page's TEXT_CHARS, spelled the same way");
  const a = wsrc.indexOf('/* ── Saved signs (Sign Studio)'), b = wsrc.indexOf('// Category code -> name', a);
  const r0 = wsrc.indexOf('// ── Saved signs (Sign Studio): folders'), r1 = wsrc.indexOf('// ── "What\'s New" announcement', r0);
  const nonAscii = s => [...s].filter(c => c.charCodeAt(0) > 127 && !'─→🔑…“”’'.includes(c)).map(c => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0'));
  ok(a > 0 && b > a && r0 > 0 && r1 > r0, 'the saved-sign helpers and routes are found in worker.js');
  eq([...new Set(nonAscii(wsrc.slice(a, b)).concat(nonAscii(wsrc.slice(r0, r1))))], [], 'and they hold no characters beyond ASCII and the house dashes, arrows and quotes');
}

// ── 5. Parity: the page and the server refuse the same signs ─────────────────
// The worker's copy of the field rules (savedSignCheck) against the page's own validate(), one
// field varied at a time around every limit and every parser case the page's tests use.
console.log('Parity with the page');
E = env0();
{
  const NAMES = ['', ' ', 'A', 'x'.repeat(22), 'x'.repeat(23), 'Straßenschuhe für alle', ' All' + ' '.repeat(30) + 'cereal ',
    'Café µ', 'Shoes 👟', 'Shoes \u202Eoff', 'Cafe\u0301', '<img src=x onerror=1>', 'Œuvre “Deal” – 50% ™ €', 'Tab\there', 'x'.repeat(200)];
  const PRICES = ['2', '2.5', '2.50', '$2', '$ 2.05', '1,299.99', '9999.99', '0.99', '.99', '10000', '0', '0.00', '-2', '2.505',
    'abc', '', '12,34', '1,2345', '2.', '.', '1e3', ' 7 ', '$', '$0.01'];
  const PCTS = ['20', '20%', '20 %', '20% off', '20 % OFF', ' 5 ', '99', '1', '07', '', '0', '100', '12.5', '20.5', '-5', 'abc', '%', '2 0', '20%%'];
  const QUALS = ['', 'Yellow dot on bottom', 'x'.repeat(32), 'x'.repeat(33), 'Soft\u00ADhyphen', 'µ', '   '];
  const CUSTOMS = ['', 'Weekend deal', 'Weekend deals', 'Ω deal', '  Hot   buy  ', 'x'.repeat(12) + ' '];
  const cases = [];
  const BASES = {
    price: { groups: [{ name: 'All cereal', price: '2', unit: 'each' }] },
    price2: { two: true, groups: [{ name: 'Adult costumes', price: '7', unit: 'each' }, { name: 'Kids costumes', price: '5' }] },
    pct: { template: 'pct', groups: [{ name: 'All coats', pct: '20' }] },
    pct2: { template: 'pct', two: true, groups: [{ name: 'Shoes', pct: '20' }, { name: 'Boots', pct: '40' }] },
    uvt: { template: 'uvt', them: '59.99', groups: [{ name: 'Stand mixer', price: '19.99', unit: 'each' }] },
  };
  const withGroup = (base, k, patch) => ({ ...base, groups: base.groups.map((g, i) => i === k ? { ...g, ...patch } : g).concat(k >= base.groups.length ? [patch] : []) });
  for (const [bn, base] of Object.entries(BASES)) {
    const n = base.two ? 2 : 1, isPct = base.template === 'pct';
    for (let k = 0; k < n; k++) {
      for (const name of NAMES) cases.push([`${bn} name-${k} ${JSON.stringify(name)}`, withGroup(base, k, { name })]);
      for (const v of isPct ? PCTS : PRICES) cases.push([`${bn} ${isPct ? 'pct' : 'price'}-${k} ${JSON.stringify(v)}`, withGroup(base, k, isPct ? { pct: v } : { price: v })]);
      for (const qual of QUALS) for (const dot of [false, true]) cases.push([`${bn} qual-${k} ${JSON.stringify(qual)} dot ${dot}`, withGroup(base, k, { qual, dot })]);
    }
    for (const custom of CUSTOMS) cases.push([`${bn} custom ${JSON.stringify(custom)}`, { ...base, sale: 'custom', custom }]);
  }
  for (const them of ['', '100', '59.99', '19.99', '19.98', '20', '0.99', 'abc', '2.505'])
    for (const price of ['19.99', '59.99', '99.50', '100', '0.99']) cases.push([`uvt them ${them} price ${price}`, { ...BASES.uvt, them, groups: [{ ...BASES.uvt.groups[0], price }] }]);
  let agree = 0, accepted = 0, refusedN = 0;
  const differ = [];
  for (const [what, o] of cases) {
    const s = sign(o), page = pageRefuses(s), r = await save('u-mgr1', s), server = r.status === 200;
    if (server !== (page.length === 0)) differ.push(`${what}: page ${page.join(',') || 'accepts'}, server ${r.status} ${(await J(r)).field || ''}`);
    else agree++;
    if (server) accepted++; else refusedN++;
  }
  eq(differ, [], `the server refuses exactly the signs the page refuses (${agree} of ${cases.length} cases agree)`);
  ok(accepted > 100 && refusedN > 100, `…with both sides exercised: ${accepted} saved, ${refusedN} refused`);
}

// ── 6. Who sees what ─────────────────────────────────────────────────────────
console.log('Visibility');
E = env0();
{
  const A = await savedId('u-mgr1', sign({ groups: [{ name: 'Mgr one tea', price: '2' }] }));
  const A2 = await savedId('u-mgr1', sign({ template: 'uvt', them: '10', groups: [{ name: 'Mgr one mixer', price: '5' }] }));
  const B = await savedId('u-mgr2', sign({ groups: [{ name: 'Mgr two tea', price: '2' }] }));
  const C = await savedId('u-admin', sign({ template: 'pct', groups: [{ name: 'Admin coats', pct: '20' }] }));
  const D = await savedId('u-su', sign({ template: 'uvt', them: '59.99', groups: [{ name: 'Su mixer', price: '19.99' }] }));
  const F = f => (f.folders || []).map(x => `${x.scope}/${x.template}/${x.month}:${x.count}`);
  const m1 = await folders('u-mgr1'), m2 = await folders('u-mgr2'), ad = await folders('u-admin'), su = await folders('u-su');
  eq([m1.view, m1.save_to, F(m1)], ['manager', 'own', ['all/pct/2026-09:1', 'all/uvt/2026-09:1', 'own/price/2026-09:1', 'own/uvt/2026-09:1']],
     'manager 1 sees All stores and their own two, and not manager 2\'s price sign');
  eq(F(m2), ['all/pct/2026-09:1', 'all/uvt/2026-09:1', 'own/price/2026-09:1'], 'manager 2 sees All stores and their own one');
  eq(await ids(await list('u-mgr1', 'own', 'price')), [A], '🛑 manager 1\'s Price signs hold only manager 1\'s sign, though both managers are at BL1');
  eq(await ids(await list('u-mgr2', 'own', 'price')), [B], '…and manager 2\'s hold only manager 2\'s (the positive beside the negative)');
  eq(await ids(await list('u-mgr1', 'own', 'price', '2026-09', '&owner=u-mgr2&owner_id=u-mgr2')), [A], 'an owner named in the URL is ignored: the owner is the session');
  eq(await ids(await list('u-mgr1', 'own', 'uvt')), [A2], 'their Us vs Them folder holds their Us vs Them sign');
  const allPct = await J(await list('u-mgr1', 'all', 'pct'));
  eq((allPct.signs || []).map(s => [s.id, s.saved_by, s.can_delete]), [[C, EMAIL['u-admin'], false]], 'every manager sees the admin\'s All stores sign, saved by the admin, and can\'t delete it');
  eq(((await J(await list('u-mgr2', 'all', 'uvt'))).signs || []).map(s => [s.id, s.saved_by]), [[D, EMAIL['u-su']]], '…and the superuser\'s');
  eq([ad.view, ad.save_to, F(ad)], ['admin', 'all', ['all/pct/2026-09:1', 'all/uvt/2026-09:1']], 'an admin sees All stores only');
  eq(F(su), F(ad), 'a superuser sees exactly what an admin sees');
  const own = await list('u-admin', 'own', 'price');
  eq([own.status, (await J(own)).code], [403, 'ALL_STORES_ONLY'], '🛑 an admin asking for a manager folder is refused');
  eq(((await J(await list('u-admin', 'all', 'pct'))).signs || []).map(s => [s.id, s.can_delete]), [[C, true]], 'an admin can delete All stores signs');
  // A private row owned by an admin (say, saved before a promotion) stays out of their view.
  E.db.prepare(`INSERT INTO saved_signs (id, owner_id, owner_email, scope, template, saved_month, sign_json, design_version, saved_at)
    VALUES (?, 'u-admin', ?, 'own', 'price', '2026-09', ?, 2, ?)`).run(uid(), EMAIL['u-admin'], JSON.stringify(OKS), NOW);
  eq(F(await folders('u-admin')), ['all/pct/2026-09:1', 'all/uvt/2026-09:1'], 'an admin\'s own-scope row stays out of their folders: admins see All stores only');
  const texts = await Promise.all([['u-mgr1', 'own', 'price'], ['u-mgr1', 'all', 'pct'], ['u-admin', 'all', 'uvt']].map(async a => (await list(...a)).text()));
  ok(texts.every(t => !/owner_id|u-mgr2|u-admin|u-su/.test(t)), 'no list answer carries an owner id');
}

// ── 7. Delete ────────────────────────────────────────────────────────────────
console.log('Delete');
E = env0();
{
  const del = (user, id) => call('/?action=saved-sign-delete', { user, method: 'POST', body: { id } });
  const A = await savedId('u-mgr1', OKS);
  const C = await savedId('u-admin', sign({ template: 'pct', groups: [{ name: 'Coats', pct: '20' }] }));
  const D = await savedId('u-su', sign({ template: 'pct', groups: [{ name: 'Hats', pct: '30' }] }));
  const live = id => rowOf(id).deleted_at === null;
  const r1 = await del('u-mgr2', A);
  eq([r1.status, (await J(r1)).error, live(A)], [404, 'Not found', true], '🛑 another manager can\'t delete it, and is told only "Not found"');
  eq([(await del('u-admin', A)).status, live(A)], [404, true], '…nor can an admin, who can\'t see it');
  const r3 = await del('u-mgr1', C);
  eq([r3.status, (await J(r3)).code, live(C)], [403, 'NEED_ADMIN', true], 'a manager can\'t delete an All stores sign');
  eq([(await del('u-exec', A)).status, live(A)], [403, true], 'an executive can\'t delete anything');
  eq([(await call('/?action=saved-sign-delete', { user: 'u-mgr1', method: 'POST', body: { id: 'abc' } })).status], [400], 'an id that is not a UUID is refused');
  const r5 = await del('u-mgr1', A);
  eq([r5.status, (await J(r5)).id], [200, A], 'the owner deletes their own sign');
  const row = rowOf(A);
  eq([row.deleted_at, row.deleted_by, row.sign_json], [NOW, EMAIL['u-mgr1'], JSON.stringify(OKS)], '…softly: the row stays, stamped with when and by whom, for audit');
  eq(((await folders('u-mgr1')).folders || []).filter(f => f.scope === 'own'), [], '…and it leaves their folders');
  eq(await ids(await list('u-mgr1', 'own', 'price')), [], '…and their list');
  eq((await del('u-mgr1', A)).status, 404, 'deleting it again is "Not found"');
  eq((await save('u-mgr1', OKS, A)).status, 409, 'its id can\'t be saved again: a deleted sign is not quietly revived');
  eq([(await del('u-admin', D)).status, live(D)], [200, false], 'an admin deletes any All stores sign, a superuser\'s included');
  eq([(await del('u-su', C)).status, live(C)], [200, false], 'and a superuser deletes an admin\'s');
}

// ── 8. Month folders are Eastern ─────────────────────────────────────────────
console.log('Eastern months');
E = env0();
{
  for (const [now, month, why] of [
    ['2026-10-01T03:59:30.000Z', '2026-09', '11:59 pm on 30 Sep, Eastern (already October in UTC)'],
    ['2026-10-01T04:00:30.000Z', '2026-10', 'just after midnight on 1 Oct, Eastern'],
    ['2026-12-01T04:30:00.000Z', '2026-11', '11:30 pm on 30 Nov, Eastern Standard Time (4:30 UTC is still November in EST)'],
    ['2026-12-01T05:00:30.000Z', '2026-12', 'just after midnight on 1 Dec, EST'],
  ]) {
    NOW = now;
    const j = await J(await save('u-mgr1', OKS));
    eq([j.sign && j.sign.month, rowOf((j.sign || {}).id).saved_month], [month, month], `saved at ${now}: ${why} → ${month}`);
  }
  eq(((await folders('u-mgr1')).folders || []).map(f => `${f.month}:${f.count}`), ['2026-12:1', '2026-11:1', '2026-10:1', '2026-09:1'], 'the month folders come newest first');
  NOW = '2026-09-29T15:00:00.000Z';
}

// ── 9. Limits and order ──────────────────────────────────────────────────────
console.log('Limits');
E = env0();
{
  const ins = E.db.prepare(`INSERT INTO saved_signs (id, owner_id, owner_email, scope, template, saved_month, sign_json, design_version, saved_at)
    VALUES (?, 'u-mgr1', 'x', 'own', 'price', '2026-08', ?, 2, ?)`);
  const made = [];
  for (let i = 0; i < 205; i++) { const id = uid(); made.push(id); ins.run(id, JSON.stringify(OKS), new RealDate(Date.UTC(2026, 7, 1, 12, 0, i)).toISOString()); }
  const newest = made.slice().reverse();
  const L = async q => J(await list('u-mgr1', 'own', 'price', '2026-08', q));
  const d = await L('');
  eq([(d.signs || []).length, d.truncated, ((d.signs || [])[0] || {}).id, ((d.signs || [])[99] || {}).id], [100, true, newest[0], newest[99]], 'a folder shows its newest 100 by default, and says there are more');
  eq([((await L('&limit=200')).signs || []).length, (await L('&limit=200')).truncated], [200, true], 'up to 200 on request');
  eq(((await L('&limit=999')).signs || []).length, 200, 'never more than 200');
  eq(((await L('&limit=-5')).signs || []).length, 1, 'a negative limit is 1');
  eq(((await L('&limit=0')).signs || []).length, 100, 'a zero or unreadable limit is the default');
  eq(((await L('&limit=abc')).signs || []).length, 100, '…as is text');
  // Signs saved in the same millisecond still come back in a fixed order: the later insert first.
  const same = '2026-08-20T00:00:00.000Z', t = [uid(), uid(), uid()];
  t.forEach(id => ins.run(id, JSON.stringify(OKS), same));
  E.db.prepare("DELETE FROM saved_signs WHERE saved_month = '2026-08' AND saved_at <> ?").run(same);
  eq(((await L('')).signs || []).map(s => s.id), t.slice().reverse(), 'three signs from the same instant list latest-inserted first');
  const bad = await list('u-mgr1', 'own', 'price', '2026-13');
  eq([bad.status, (await J(bad)).code], [400, 'BAD_FOLDER'], 'a month that isn\'t one is refused');
  eq((await list('u-mgr1', 'mine', 'price')).status, 400, 'so is an unknown scope');
  eq((await list('u-mgr1', 'own', 'poster')).status, 400, 'and an unknown sign type');
}

// ── 10. The worker's own queries use the folder indexes ──────────────────────
console.log('Index use');
E = env0();
{
  const seen = [];
  const prep = E.env.DB.prepare.bind(E.env.DB);
  E.env.DB.prepare = sql => { seen.push(sql); return prep(sql); };
  await save('u-mgr1', OKS); await save('u-admin', OKS);
  await folders('u-mgr1'); await folders('u-admin');
  await list('u-mgr1', 'own', 'price'); await list('u-mgr1', 'all', 'price');
  const reads = [...new Set(seen.filter(s => /^\s*SELECT[\s\S]*FROM saved_signs/i.test(s) && !/WHERE id = \?/.test(s)))];
  eq(reads.length, 4, 'the folder and list reads were captured: own and All stores, counts and lists');
  for (const sql of reads) {
    const n = (sql.match(/\?/g) || []).length;
    const binds = Array.from({ length: n }, (_, i) => (i === n - 1 && /LIMIT \?\s*$/.test(sql)) ? 101 : 'x');
    const plan = E.db.prepare('EXPLAIN QUERY PLAN ' + sql).all(...binds).map(r => r.detail).join(' | ');
    ok(/USING (COVERING )?INDEX idx_saved_signs_(own|all)/.test(plan) && !/TEMP B-TREE/.test(plan),
       `${sql.replace(/\s+/g, ' ').slice(0, 90)}… reads its folder index with no sort step (${plan})`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
