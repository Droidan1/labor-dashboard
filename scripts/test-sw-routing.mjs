// Which requests does the service worker answer, and which does it leave to the page?
//
// 🛑 THIS EXISTS BECAUSE THE WORKER ANSWERED THE LABEL PRINTER'S PROBE. Every GET that was not
// an API or CDN host fell into the app-shell branch, including the page's probe of the Zebra
// Browser Print agent at http://127.0.0.1:9100/available. The worker then re-issued that
// request itself, and Chrome only lets a WORKER reach loopback if the site already holds the
// local-network permission — a worker cannot ask for it, only a page can. On the first
// Windows PC that had never granted it, the worker's fetch failed, the app-shell branch
// answered with its own offline 503, and the probe died parsing "Network error — offline" as
// JSON. The Mac that had granted it printed fine, which is why it looked like a Windows bug.
//
// Drives the REAL fetch listener from sw.js in a vm with stubbed caches/fetch, rather than
// grepping it: what matters is whether respondWith() is called, and only running it shows that.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log(`  FAIL: ${msg}`); } };
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${a}, want ${b})`);

const sw = fs.readFileSync(path.join(repo, 'sw.js'), 'utf8');

// Loads sw.js as if registered from `origin`. The network is down and the cache is empty, so
// anything the worker answers comes back as its own offline fallback — the thing the printer
// probe was handed.
function load(origin) {
  const listeners = {};
  class Res {
    constructor(body, init = {}) { this.body = body; this.status = init.status ?? 200; this.ok = this.status >= 200 && this.status < 300; }
    clone() { return this; }
    async text() { return String(this.body); }
  }
  const ctx = {
    self: {
      location: new URL('/sw.js', origin),
      registration: { scope: origin + '/' },
      addEventListener: (type, fn) => { listeners[type] = fn; },
      skipWaiting() {},
      clients: { claim() {} },
    },
    URL, Request: class { constructor(u) { this.url = new URL(u, origin).href; } },
    Response: Res,
    caches: { open: async () => ({ match: async () => undefined, put: async () => {} }), keys: async () => [], delete: async () => true },
    fetch: async () => { throw new TypeError('Failed to fetch'); },
    clients: {},
  };
  vm.createContext(ctx);
  vm.runInContext(sw, ctx, { filename: 'sw.js' });
  // Returns the worker's answer, or null when it left the request to the browser.
  return async (url, method = 'GET') => {
    let answered = null;
    listeners.fetch({ request: { url, method }, respondWith: (p) => { answered = p; }, waitUntil() {} });
    return answered ? await answered : null;
  };
}

console.log('Service worker routing');

{
  const get = load('https://www.retjghub.com');

  // The reproduction. Before the fix this was a 503 whose body starts "Network er".
  const probe = await get('http://127.0.0.1:9100/available');
  eq(probe && `${probe.status} ${await probe.text()}`, null,
     '🛑 the printer probe is left to the page — the worker must not answer it');
  for (const u of ['http://localhost:9100/available', 'http://[::1]:9100/available',
                   'https://127.0.0.1:9101/available', 'http://127.0.0.2:9100/available']) {
    eq(await get(u), null, `…nor any other loopback address (${u})`);
  }
  eq(await get('http://127.0.0.1:9100/write', 'POST'), null, '…and the label write stays untouched too');

  // Loopback is an address, not a substring. A public host that merely starts with 127 is
  // still somebody else's origin and falls through like any other.
  ok(await get('http://127.example.com/x') !== null, 'a public host that starts with "127." is not loopback');

  // What the worker is FOR must survive the exemption.
  const shell = await get('https://www.retjghub.com/index.html');
  eq(shell?.status, 503, 'the app shell is still the worker\'s — offline fallback intact');
  eq(await get('https://api.retjghub.com/?action=auth-me'), null, 'the API still bypasses the worker');
  ok(await get('https://fonts.gstatic.com/s/x.woff2').catch(() => 'rejected') !== null,
     'fonts are still cache-first through the worker');
}

{
  // The browser tests serve the app itself from 127.0.0.1. Its OWN shell must still be
  // cached there, or every SW-dependent browser test would quietly stop testing the worker.
  const get = load('http://127.0.0.1:8095');
  eq((await get('http://127.0.0.1:8095/index.html'))?.status, 503,
     'an app served from loopback still has its own shell handled by the worker');
  eq(await get('http://127.0.0.1:9100/available'), null,
     '…while the printer agent, a different origin on the same machine, is still left alone');
}

{
  // 🔑 THE CLASS, NOT THE INSTANCE. Every absolute URL index.html fetches must be something
  // the worker deliberately leaves alone. A live-data request to someone else's origin that
  // falls into the app-shell branch is answered from Cache Storage — stale by design, and
  // out of reach of the page's cache:'no-store' — or, when the worker's own fetch fails, with
  // a 503 the page never sent for.
  const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  const targets = [...new Set([...html.matchAll(/fetch\(\s*['"`](https?:\/\/[^'"`\s]+)/g)].map(m => m[1]))];
  ok(targets.some(t => t.startsWith('http://127.0.0.1:9100/')), `index.html's fetch targets were read (${targets.length})`);
  const get = load('https://www.retjghub.com');
  for (const t of targets) {
    eq(await get(t), null, `index.html fetches ${t} — the worker must leave it to the page`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
