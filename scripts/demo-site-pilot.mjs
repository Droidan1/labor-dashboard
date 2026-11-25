// Click-through demo of the Bargain Lane website pilot (docs/plans/bargainlane-website.md §5).
//
// One command runs, on this computer, with made-up data:
//   • the Hub: the REAL worker.js over sqlite and in-memory storage (scripts/lib/worker-harness.mjs),
//     serving the built app from dist/ with its API pointed at itself;
//   • the website: the Dupont page from the bargainlane-site repo, reading that Hub.
// So the whole flow can be clicked through: review a preview → approve → the site shows its photos →
// pull it → they are gone. Nothing real is touched: every outside call (Clover, Buffer, Resend…) is
// refused, and sign-in is a demo-only persona page. No auth code changes.
//
//   bash scripts/build.sh < /dev/null          (builds dist/, the app this serves)
//   node scripts/demo-site-pilot.mjs           (this computer only)
//   node scripts/demo-site-pilot.mjs --lan     (also a phone on the same Wi-Fi)
//   node scripts/demo-site-pilot.mjs --check   (drives the flow headless; exit 1 on any failure)
//
// SITE_DIR=<path> points at the website repo (default ~/Projects/bargainlane-site).
// --check needs playwright-core (npm install --no-save playwright-core) and Chrome
// (PLAYWRIGHT_CHROMIUM, default the macOS Google Chrome).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadWorker, makeEnv, applyMigrationAlters, ctx } from './lib/worker-harness.mjs';

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const LAN = args.includes('--lan') && !CHECK;
const portArg = (() => { const i = args.indexOf('--port'); return i >= 0 ? Number(args[i + 1]) : 8788; })();
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(repo, 'dist');
const SITE_DIR = path.resolve(process.env.SITE_DIR || path.join(os.homedir(), 'Projects', 'bargainlane-site'));
const die = m => { console.error('\n' + m + '\n'); process.exit(2); };
if (!fs.existsSync(path.join(dist, 'index.html'))) die('dist/ is missing. Run `bash scripts/build.sh < /dev/null` first.');
if (!fs.existsSync(path.join(SITE_DIR, 'src', 'worker.js'))) die(`No website repo at ${SITE_DIR}. Set SITE_DIR to the bargainlane-site checkout.`);

// ── Where it listens ──────────────────────────────────────────────────────────
// --lan binds every interface and names this computer by its Wi-Fi address, so a phone's browser
// can reach both servers AND the photos the site page links to on the Hub.
const lanIp = () => Object.values(os.networkInterfaces()).flat().find(i => i && i.family === 'IPv4' && !i.internal)?.address;
const HOST = LAN ? (lanIp() || '127.0.0.1') : '127.0.0.1';
const BIND = LAN ? '0.0.0.0' : '127.0.0.1';
const HUB_PORT = CHECK ? 0 : portArg, SITE_PORT = CHECK ? 0 : portArg + 1;
let HUB, SITE;   // origins, known once listening

// ── The Hub: the real worker, a demo database ─────────────────────────────────
const hub = await loadWorker(repo);
const { db, env } = makeEnv(repo);
// The tables the app touches as it boots, from the repo's own migrations. Only CREATE TABLE / INDEX
// and DROP INDEX statements run, additively: a table-rebuild migration's DROP TABLE would wipe the
// harness's seed. Twice, in file order: an index on a column a later ALTER adds (migration-094's
// per-kind index) only builds on the second pass, after applyMigrationAlters.
const createPass = () => {
  for (const f of fs.readdirSync(repo).filter(f => /^migration-\d+\.sql$/.test(f)).sort()) {
    const sql = fs.readFileSync(path.join(repo, f), 'utf8').replace(/--[^\n]*/g, '');
    for (const stmt of sql.split(/;\s*(?:\n|$)/)) {
      if (/^\s*(CREATE\s+(TABLE|(UNIQUE\s+)?INDEX)|DROP\s+INDEX)\b/i.test(stmt)) { try { db.exec(stmt); } catch (_) {} }
    }
  }
};
createPass();
applyMigrationAlters(db, repo);
createPass();

// ── Nothing leaves this computer ──────────────────────────────────────────────
// The site reads the Hub through fetch: that goes straight to the Hub worker in this process.
// Anything else (Clover, Buffer, Resend, Anthropic…) is refused.
const refused = new Map();
globalThis.fetch = async (input, init) => {
  const u = String(input instanceof Request ? input.url : input);
  if (HUB && u.startsWith(HUB + '/')) return hub.fetch(input instanceof Request ? input : new Request(u, init), env, ctx);
  const host = (() => { try { return new URL(u).host; } catch (_) { return u.slice(0, 40); } })();
  refused.set(host, (refused.get(host) || 0) + 1);
  throw new TypeError(`outside call refused in the demo: ${host}`);
};

// ── Demo data: made up, and says so ───────────────────────────────────────────
const ymd = (ms, tz = 'America/New_York') => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const today = ymd(Date.now());
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const tomorrow = addDays(today, 1);
const nowIso = () => new Date().toISOString();
const PERSONAS = {
  super: { id: 'demo-super', email: 'brian.demo@example.invalid', role: 'superuser', stores: null, label: 'Brian, superuser', page: 'bin-preview' },
  admin: { id: 'demo-admin', email: 'alex.demo@example.invalid', role: 'admin', stores: null, grant: 'admin', label: 'Alex, Bargain Lane admin', page: 'bin-preview' },
  mgr: { id: 'demo-mgr', email: 'dee.demo@example.invalid', role: 'manager', stores: '["BL4"]', grant: 'manager', label: 'Dee, Dupont manager', page: 'bin-preview' },
};
{
  const exp = new Date(Date.now() + 30 * 864e5).toISOString();
  for (const p of Object.values(PERSONAS)) {
    db.prepare('INSERT INTO users (id,email,role,stores,status,created_at) VALUES (?,?,?,?,?,?)').run(p.id, p.email, p.role, p.stores, 'active', '2026-01-01');
    if (p.grant) db.prepare('INSERT INTO user_grants (user_id,business_id,role,units) VALUES (?,?,?,?)').run(p.id, 'bl', p.grant, p.stores);
    db.prepare('INSERT INTO sessions (id,user_id,expires_at,created_at) VALUES (?,?,?,?)').run('demo-sess-' + p.id, p.id, exp, nowIso());
  }
  // Dupont's page, switched on. Every value is sample data: the address and phone are made up, the
  // prices are test values. Previews start 2 days before their sale day, so one approved for
  // tomorrow shows on the site straight away.
  const open = (o, c) => ({ open: o, close: c });
  const hours = { sun: open('11:00', '18:00'), mon: open('10:00', '20:00'), tue: open('10:00', '20:00'), wed: open('10:00', '20:00'),
                  thu: open('10:00', '20:00'), fri: open('09:00', '21:00'), sat: open('09:00', '21:00') };
  const prices = { fri: [{ from: '00:00', price: 12 }, { from: '14:00', price: 9 }], sat: [{ from: '00:00', price: 6 }],
                   sun: [{ from: '00:00', price: 4 }], mon: [{ from: '00:00', price: 2 }], tue: [{ from: '00:00', price: 1 }],
                   wed: [{ from: '00:00', price: 0.5 }] };   // Thursday: bins being restocked, no price
  db.prepare(`INSERT INTO store_settings (store, tz, profile_json, hours_json, bin_prices_json, preview_defaults_json, public, revision, updated_by, updated_at)
              VALUES ('BL4', 'America/New_York', ?, ?, ?, ?, 1, 1, 'demo seed', ?)`).run(
    JSON.stringify({ displayName: 'Bargain Lane Dupont (demo)', address: { street: '123 Demo St', city: 'Fort Wayne', state: 'IN', zip: '46825' }, phone: '(260) 555-0100', mapsUrl: null,
      retailLine: 'Demo: home goods, toys and more on the retail floor, new every week.' }),
    JSON.stringify(hours), JSON.stringify(prices), JSON.stringify({ startDaysBefore: 2, startTime: '00:00' }), nowIso());
}

// Bin photos, drawn here as PNGs so the demo needs no image files: a coloured bin full of "items".
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function png(w, h, px) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b] = px(x, y); const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; }
  const chunk = (type, data) => { const t = Buffer.from(type); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const hsl = (h, s, l) => { s /= 100; l /= 100; const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  return [0, 8, 4].map(n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))))); };
function binPhoto(seed) {
  const hue = (seed * 53) % 360, items = [];
  let r = seed * 9301 + 49297;
  const rand = () => (r = (r * 9301 + 49297) % 233280) / 233280;
  for (let i = 0; i < 26; i++) items.push({ x: 110 + rand() * 380, y: 190 + rand() * 170, s: 16 + rand() * 26, c: hsl(rand() * 360, 65, 55) });
  return png(600, 450, (x, y) => {
    if (y > 160 && y < 400 && x > 80 && x < 520) {                      // the bin
      for (const it of items) if (Math.abs(x - it.x) < it.s && Math.abs(y - it.y) < it.s * 0.8) return it.c;
      return hsl(hue, 35, 30);
    }
    if (y > 130 && y <= 160 && x > 60 && x < 540) return hsl((hue + 25) % 360, 55, 70); // its rim
    return hsl(hue, 30, 88 - y / 30);                                    // the wall behind
  });
}
const photoIds = [];
for (let n = 1; n <= 8; n++) {
  const bytes = binPhoto(n), key = `marketing/BL4/bins/${today.slice(0, 7)}/demo-${String(n).padStart(4, '0')}-0000-4000-8000-000000000000.png`;
  await env.MEDIA.put(key, new Uint8Array(bytes), { httpMetadata: { contentType: 'image/png' } });
  const r = db.prepare(`INSERT INTO marketing_photos (store, photo_type, r2_key, content_type, bytes, uploader, status, created_at)
                        VALUES ('BL4', 'bins', ?, 'image/png', ?, ?, 'new', ?)`).run(key, bytes.length, PERSONAS.mgr.email, nowIso());
  photoIds.push(Number(r.lastInsertRowid));
}
// Retail photos (slice 1b): the same drawings, filed as retail, so only a retail highlight can use them.
const retailIds = [];
for (let n = 21; n <= 24; n++) {
  const bytes = binPhoto(n), key = `marketing/BL4/retail/${today.slice(0, 7)}/demo-${String(n).padStart(4, '0')}-0000-4000-8000-000000000000.png`;
  await env.MEDIA.put(key, new Uint8Array(bytes), { httpMetadata: { contentType: 'image/png' } });
  const r = db.prepare(`INSERT INTO marketing_photos (store, photo_type, r2_key, content_type, bytes, uploader, status, created_at)
                        VALUES ('BL4', 'retail', ?, 'image/png', ?, ?, 'new', ?)`).run(key, bytes.length, PERSONAS.mgr.email, nowIso());
  retailIds.push(Number(r.lastInsertRowid));
}
// Two previews waiting for review, sent in by the Dupont manager: tomorrow's bins (#1) and a retail
// highlight showing from today (#2).
db.prepare(`INSERT INTO bin_previews (store, kind, sale_date, photo_ids, caption, status, revision, created_by, created_at, updated_at, submitted_by, submitted_at)
            VALUES ('BL4', 'bins', ?, ?, ?, 'submitted', 2, ?, ?, ?, ?, ?)`).run(tomorrow, JSON.stringify(photoIds.slice(0, 3)),
  'Demo: new bins drop tomorrow. Kitchen, toys and home.', PERSONAS.mgr.email, nowIso(), nowIso(), PERSONAS.mgr.email, nowIso());
db.prepare(`INSERT INTO bin_previews (store, kind, sale_date, photo_ids, caption, status, revision, created_by, created_at, updated_at, submitted_by, submitted_at)
            VALUES ('BL4', 'retail', ?, ?, ?, 'submitted', 2, ?, ?, ?, ?, ?)`).run(today, JSON.stringify(retailIds.slice(0, 3)),
  'Demo: new kitchen and home goods on the floor.', PERSONAS.mgr.email, nowIso(), nowIso(), PERSONAS.mgr.email, nowIso());

// ── The persona page: the demo's only sign-in ─────────────────────────────────
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const demoPage = () => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bin Preview demo</title><style>
body{font:16px/1.5 system-ui,-apple-system,sans-serif;margin:0;background:#f4f3ee;color:#14110a}
main{max-width:640px;margin:0 auto;padding:24px 16px 40px}h1{font-size:24px;margin:0 0 4px}p{margin:8px 0}
.warn{background:#fff4d6;border:1px solid #92400e;color:#5c2a07;border-radius:10px;padding:10px 12px;font-size:14px}
a.p{display:block;margin:10px 0;padding:14px 16px;border-radius:12px;border:2px solid #13304f;background:#fff;color:#13304f;text-decoration:none;font-weight:600}
a.p span{display:block;font-weight:400;font-size:14px;color:#3d5875}a.site{background:#13304f;color:#fff}a.site span{color:#dfe8f2}
ol{padding-left:22px}li{margin:6px 0}code{background:#ebe7dc;border-radius:4px;padding:1px 4px}</style></head>
<body><main><h1>Bin Preview demo</h1>
<p class="warn">Made-up data on this computer only. Nothing here reaches the real Hub, Clover, Buffer or bargainlane.com.</p>
<h2>1. Sign in as</h2>
${Object.entries(PERSONAS).map(([k, p]) => `<a class="p" href="/demo/login?as=${k}">${esc(p.label)}<span>${k === 'mgr' ? 'Makes and submits previews for Dupont. Reviewing is for admins.' : 'Opens Marketing › Bin Preview.'}</span></a>`).join('')}
<h2>2. The website</h2>
<a class="p site" href="${SITE}/stores/dupont" target="_blank" rel="noopener">Open the Dupont page →<span>${esc(SITE)}/stores/dupont</span></a>
<h2>3. Try this</h2><ol>
<li>As Alex, open the <b>Bins</b> preview waiting for review and <b>Approve</b> it (the default window starts 2 days before the sale day, so it shows at once).</li>
<li>Reload the Dupont page: the sneak peek and its 3 photos are there.</li>
<li>Back in the Hub, <b>Pull from site</b> with a reason. Reload the Dupont page: the photos are gone, and their links now answer 404.</li>
<li>Before any retail approval, the Dupont page's <b>New on the shelves</b> card shows the store's retail line. Approve the <b>Retail</b> highlight and reload: its photos replace the line (and never appear as bins).</li>
<li>Change a bin price, the retail line, or add a holiday in <b>Store page settings</b>, save, and reload the Dupont page.</li>
<li>As Dee, make a <b>New preview</b> and submit it (upload works: photos stay in this demo's memory). Then approve it as Alex.</li>
</ol><p>Stop the demo with Ctrl+C. Everything is forgotten when it stops.</p></main>
<script>try{localStorage.setItem('bioPromptDismissed','1');localStorage.setItem('coachTipsDisabled','1')}catch(e){}</script></body></html>`;

// ── The two servers ───────────────────────────────────────────────────────────
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png',
                '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const DROP = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'keep-alive', 'upgrade', 'expect']);
function fileFrom(dir, p) {
  const f = path.join(dir, decodeURIComponent(p));
  return f.startsWith(dir + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile() ? f : null;
}
async function send(s, r) {
  const h = {};
  r.headers.forEach((v, k) => { if (k !== 'set-cookie') h[k] = v; });
  const cookies = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (cookies.length) h['set-cookie'] = cookies;
  s.writeHead(r.status, h);
  s.end(Buffer.from(await r.arrayBuffer()));
}
async function readBody(q) { const parts = []; for await (const c of q) parts.push(c); return parts.length ? Buffer.concat(parts) : undefined; }
let appHtml = null;
function app() {
  if (appHtml) return appHtml;
  const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  const re = /const WORKER_BASE = 'https:\/\/api(?:-staging)?\.retjghub\.com\/';/;
  if (!re.test(html)) die('dist/index.html no longer sets WORKER_BASE the way this demo expects. Update app() in scripts/demo-site-pilot.mjs.');
  // The app's one API address, pointed at wherever this page is being served from.
  return (appHtml = html.replace(re, "const WORKER_BASE = location.origin + '/';"));
}

const hubServer = http.createServer(async (q, s) => {
  try {
    const u = new URL(q.url, 'http://demo');
    if (u.pathname === '/demo') { s.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); return s.end(demoPage()); }
    if (u.pathname === '/demo/login') {
      const p = PERSONAS[u.searchParams.get('as')];
      if (!p) { s.writeHead(404); return s.end('No such persona'); }
      s.writeHead(302, { location: `/#${p.page}`, 'set-cookie': `session=demo-sess-${p.id}; Path=/; HttpOnly; SameSite=Lax`, 'cache-control': 'no-store' });
      return s.end();
    }
    if (u.searchParams.has('action') || /^\/(public|p)\//.test(u.pathname) || (q.method !== 'GET' && q.method !== 'HEAD')) {
      const headers = Object.fromEntries(Object.entries(q.headers).filter(([k]) => !DROP.has(k)));
      const body = q.method === 'GET' || q.method === 'HEAD' ? undefined : await readBody(q);
      return send(s, await hub.fetch(new Request(HUB + q.url, { method: q.method, headers, body }), env, ctx));
    }
    if (u.pathname === '/' || u.pathname === '/index.html') { s.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); return s.end(app()); }
    // No service worker here: it would cache this demo's app under localhost.
    const f = u.pathname !== '/sw.js' && fileFrom(dist, u.pathname);
    if (!f) { s.writeHead(404); return s.end('Not found'); }
    s.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(s);
  } catch (e) {
    console.error('hub server error:', e && e.stack || e);
    if (!s.headersSent) s.writeHead(500);
    s.end('Demo error: ' + (e && e.message));
  }
});

const site = (await import(pathToFileURL(path.join(SITE_DIR, 'src', 'worker.js')).href)).default;
const siteServer = http.createServer(async (q, s) => {
  try {
    const f = q.url !== '/' && fileFrom(path.join(SITE_DIR, 'public'), new URL(q.url, 'http://demo').pathname);
    if (f) { s.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); return fs.createReadStream(f).pipe(s); }
    return send(s, await site.fetch(new Request(SITE + q.url, { method: q.method }), { HUB_ORIGIN: HUB }));
  } catch (e) {
    console.error('site server error:', e && e.stack || e);
    if (!s.headersSent) s.writeHead(500);
    s.end('Demo error: ' + (e && e.message));
  }
});

const listen = (srv, port) => new Promise((res, rej) => { srv.once('error', rej); srv.listen(port, BIND, () => res(srv.address().port)); });
try {
  HUB = `http://${HOST}:${await listen(hubServer, HUB_PORT)}`;
  SITE = `http://${HOST}:${await listen(siteServer, SITE_PORT)}`;
} catch (e) {
  die(`Couldn't listen (${e.code || e.message}). Another demo running? Try --port 8798.`);
}

if (!CHECK) {
  console.log(`
  Bin Preview demo: made-up data, nothing leaves this computer.

    Start here:   ${HUB}/demo
    Hub app:      ${HUB}/
    Dupont page:  ${SITE}/stores/dupont
${LAN ? `\n  A phone on the same Wi-Fi can open ${HUB}/demo too.\n` : `\n  For a phone on the same Wi-Fi, stop this and run it with --lan.\n`}
  Ctrl+C to stop. Everything is forgotten when it stops.
`);
} else {
  process.exitCode = await selfCheck();
  hubServer.close(); siteServer.close();
  setTimeout(() => process.exit(process.exitCode), 50).unref();
}

// ── --check: the flow, driven in a real browser ───────────────────────────────
async function selfCheck() {
  let chromium;
  try { ({ chromium } = await import('playwright-core')); }
  catch (e) { console.error('--check needs playwright-core: npm install --no-save playwright-core'); return 2; }
  const results = [];
  const check = (c, m) => { results.push([!!c, m]); };
  const b = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  try {
    const ctxB = await b.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    const page = await ctxB.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    // Fonts and anything else outside the two demo servers: not fetched.
    await page.route(u => !u.href.startsWith(HUB) && !u.href.startsWith(SITE), r => r.abort());
    const text = sel => page.evaluate(x => document.querySelector(x)?.textContent.replace(/\s+/g, ' ').trim() || '', sel);
    const sitePage = async () => {
      const r = await page.request.get(`${SITE}/stores/dupont`);
      return { status: r.status(), html: await r.text() };
    };

    // The site before any approval: the page is up, with no sneak peek.
    let sp = await sitePage();
    check(sp.status === 200 && /Fort Wayne, Dupont/.test(sp.html), `the Dupont page reads the demo Hub (${sp.status})`);
    check(!/Sneak peek/.test(sp.html), 'before approval it has no sneak peek');
    // Slice 1b: before the retail highlight is approved, the card carries the store's retail line.
    check(/New on the shelves/.test(sp.html) && /home goods, toys and more/.test(sp.html) && !/Retail photo/.test(sp.html),
      'the "New on the shelves" card shows the retail line, no retail photos yet');

    // Sign in as the admin; the app opens on Bin Preview.
    await page.goto(`${HUB}/demo`);
    await page.click('a[href="/demo/login?as=admin"]');
    await page.waitForSelector('#bp-list tr[data-id]', { timeout: 15000 });
    check(/2 waiting for review/.test(await text('#bp-list .bp-status')), 'the admin sees the bin preview and the retail highlight waiting');
    check(/Bins/.test(await text('#bp-list tr[data-id="1"]')) && /Retail/.test(await text('#bp-list tr[data-id="2"]')), 'the list says which is which');
    await page.click('#bp-list tr[data-id="1"] .bp-open');
    await page.waitForSelector('#bp-detail [data-act="approve"]');
    // Two of the three load lazily: give them a moment, then count what actually decoded.
    await page.waitForFunction(() => [...document.querySelectorAll('#bp-detail .bp-phone img')].filter(i => i.complete && i.naturalWidth > 0).length === 3, null, { timeout: 8000 }).catch(() => {});
    const card = await page.evaluate(() => [...document.querySelectorAll('#bp-detail .bp-phone img')].map(i => `${i.complete && i.naturalWidth > 0 ? 'ok' : 'NOT LOADED'} ${i.getAttribute('src')}`));
    check(card.length === 3 && card.every(c => c.startsWith('ok')), `the phone card shows the preview's 3 photos ${JSON.stringify(card.filter(c => !c.startsWith('ok')))}`);
    await page.click('#bp-detail [data-act="approve"]');
    // The preview's own row, not the list: the legend always says "On the site".
    const onSite = await page.waitForFunction(() => /On the site/.test(document.querySelector('#bp-list tr[data-id="1"] .bp-chip')?.textContent || ''), null, { timeout: 10000 }).then(() => true, () => false);
    check(onSite, 'approving puts it on the site');

    // The website now shows it, photos and all.
    await page.goto(`${SITE}/stores/dupont`);
    check(/Sneak peek: bins for/.test(await page.content()), 'the Dupont page now shows the sneak peek');
    const imgs = await page.evaluate(() => [...document.querySelectorAll('.gallery img')].map(i => ({ ok: i.complete && i.naturalWidth > 0, src: i.src })));
    check(imgs.length === 3 && imgs.every(i => i.ok), `with its 3 photos loaded (${imgs.filter(i => i.ok).length}/3)`);
    check(/Today/.test(await page.content()), "and today's hours");

    // Pull it: the page and the photo links both drop it.
    await page.goto(`${HUB}/#bin-preview`);
    await page.waitForSelector('#bp-list tr[data-id="1"]', { timeout: 15000 });
    await page.click('#bp-list tr[data-id="1"] .bp-open');
    await page.waitForSelector('#bp-reason');
    await page.fill('#bp-reason', 'Demo: pulled to show it come down');
    await page.click('#bp-detail [data-act="pull"]');
    const dlg = page.locator('body > [role="dialog"][aria-modal="true"]').last();
    await dlg.waitFor({ state: 'visible', timeout: 5000 });
    await dlg.locator('button', { hasText: 'Pull from site' }).click();
    await page.waitForFunction(() => /Pulled/.test(document.querySelector('#bp-detail .bp-bar .bp-chip')?.textContent || ''), null, { timeout: 10000 });
    sp = await sitePage();
    check(!/Sneak peek/.test(sp.html), 'after the pull the Dupont page has no sneak peek');
    const img = await page.request.get(imgs[0]?.src || `${HUB}/public/v1/img/1/1.png`);
    check(img.status() === 404, `and its photo links answer 404 (${img.status()})`);

    // Slice 1b: approve the retail highlight; the card swaps the line for its photos, never as bins.
    await page.click('#bp-detail [data-act="close"]');
    await page.click('[data-filter="all"]');
    await page.waitForSelector('#bp-list tr[data-id="2"]', { timeout: 10000 });
    await page.click('#bp-list tr[data-id="2"] .bp-open');
    await page.waitForSelector('#bp-detail [data-act="approve"]');
    check(/^Retail highlight/.test(await text('#bp-detail .bp-lbl')), 'the admin opens the retail highlight');
    await page.click('#bp-detail [data-act="approve"]');
    const rOn = await page.waitForFunction(() => /On the site/.test(document.querySelector('#bp-list tr[data-id="2"] .bp-chip')?.textContent || ''), null, { timeout: 10000 }).then(() => true, () => false);
    check(rOn, 'approving puts the retail highlight on the site');
    await page.goto(`${SITE}/stores/dupont`);
    // Two of the three load lazily: bring the card into view and give them a moment to decode.
    await page.evaluate(() => document.querySelector('section.retail')?.scrollIntoView());
    await page.waitForFunction(() => [...document.querySelectorAll('section.retail .gallery img')].filter(i => i.complete && i.naturalWidth > 0).length === 3, null, { timeout: 8000 }).catch(() => {});
    const shelf = await page.evaluate(() => {
      const c = document.querySelector('section.retail');
      return { cap: c?.querySelector('.cap')?.textContent || '', imgs: [...(c?.querySelectorAll('.gallery img') || [])].map(i => i.complete && i.naturalWidth > 0), peek: !!document.querySelector('section.peek') };
    });
    check(/new kitchen and home goods/.test(shelf.cap) && shelf.imgs.length === 3 && shelf.imgs.every(Boolean),
      `the Dupont page shows it under "New on the shelves" with its 3 photos (${shelf.imgs.filter(Boolean).length}/3)`);
    check(!shelf.peek, '🛑 and not as a bin sneak peek (the bins were pulled above)');
    await page.goto(`${HUB}/#bin-preview`);

    // The Dupont manager (slice 1): makes and submits previews; no review or settings controls.
    await page.goto(`${HUB}/demo/login?as=mgr`);
    // The only preview was pulled above, so "Open" lists none: wait for the list to load, not for a row.
    await page.waitForFunction(() => /waiting for review/.test(document.querySelector('#bp-list .bp-status')?.textContent || ''), null, { timeout: 15000 });
    check(await page.evaluate(() => !document.getElementById('nav-bin-preview').classList.contains('hidden')), 'the Dupont manager has Bin Preview');
    check(await page.evaluate(() => document.getElementById('bp-settings').classList.contains('hidden')), 'without the store page settings');
    await page.click('#bp-list [data-act="new"]');
    await page.waitForSelector('#bp-detail .bp-pick');
    const picks = await page.evaluate(() => document.querySelectorAll('#bp-detail .bp-pick').length);
    check(picks === 8, `and picks from Dupont's 8 bin photos (${picks})`);
    await page.click('#bp-detail .bp-pick');
    await page.click('#bp-detail [data-act="submit"]');
    const sent = await page.waitForFunction(() => /Sent for review/.test(document.querySelector('#bp-detail .bp-msg')?.textContent || ''), null, { timeout: 10000 }).then(() => true, () => false);
    check(sent, 'and submits a new preview for review');
    check(!errs.length, `no page errors ${JSON.stringify(errs.slice(0, 2))}`);
    check(![...refused.keys()].some(h => /buffer|anthropic|resend/i.test(h)), `no Buffer, Anthropic or Resend call was even attempted (${[...refused.keys()].join(', ') || 'none'})`);
  } catch (e) {
    check(false, 'the walk-through stopped: ' + String(e && e.message || e).split('\n')[0]);
  } finally { await b.close(); }
  for (const [ok, m] of results) console.log(`${ok ? '  ok ' : '  ✗  '} ${m}`);
  const failed = results.filter(r => !r[0]).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  return failed ? 1 : 0;
}
