// Does a change to the app shell actually reach the people running it?
//
// 🛑 THIS EXISTS BECAUSE I SHIPPED THE SAME OMISSION THREE TIMES IN ONE SESSION, including
// once in the commit immediately after writing the rule against it into tasks/lessons.md.
// sw.js serves index.html stale-while-revalidate, and the ONLY thing that makes a deploy
// land on the next launch rather than the one after is sw.js itself changing: a new
// CACHE_NAME installs a new worker, activate() drops the old cache, and the controllerchange
// listener reloads open clients. A byte-identical sw.js fires none of that, so a manager
// opens the app, does not see the change, and reasonably concludes the deploy failed.
//
// 🔑 IT PINS A PAIR, NOT A VALUE. The fixture records index.html's hash alongside the cache
// key in force when that hash was current. Change index.html and the hash check fails;
// fixing it means editing the fixture, and the message says to bump CACHE_NAME in the same
// breath. Bump CACHE_NAME without the fixture and the name check fails instead. Neither can
// be done silently, which is the entire failure mode — nobody ever DECIDED to skip the bump.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log(`  FAIL: ${msg}`); } };
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${a}, want ${b})`);

console.log('App shell cache');

const pin = JSON.parse(fs.readFileSync(path.join(repo, 'scripts/fixtures/shell-cache.json'), 'utf8'));
const sw = fs.readFileSync(path.join(repo, 'sw.js'), 'utf8');
const name = (sw.match(/const CACHE_NAME = '([^']+)'/) || [])[1];
const sha = crypto.createHash('sha256').update(fs.readFileSync(path.join(repo, 'index.html'))).digest('hex');

ok(name, 'sw.js declares a CACHE_NAME');
eq(name, pin.cache_name,
   'sw.js and the fixture name the same cache — bump one and you must update the other');
eq(sha, pin.index_sha256,
   'index.html matches the hash the current cache key was recorded against.\n'
   + '        → index.html changed. Bump CACHE_NAME in sw.js AND rerun:\n'
   + '          node -e "const c=require(\'crypto\'),f=require(\'fs\');const p=\'scripts/fixtures/shell-cache.json\';'
   + 'const j=JSON.parse(f.readFileSync(p));j.cache_name=f.readFileSync(\'sw.js\',\'utf8\').match(/CACHE_NAME = .([^\']+)/)[1];'
   + 'j.index_sha256=c.createHash(\'sha256\').update(f.readFileSync(\'index.html\')).digest(\'hex\');'
   + 'f.writeFileSync(p,JSON.stringify(j,null,2)+String.fromCharCode(10))"\n'
   + '        Shipping index.html without the bump means installed apps serve the OLD build for a launch');

// The mechanism the bump drives. If any of this is refactored away the pin above is
// pointless, so it is asserted here rather than assumed.
ok(/caches\.delete\(k\)/.test(sw), 'activate() still drops caches that are not the current one');
ok(/self\.skipWaiting\(\)/.test(sw), '…and the new worker still takes over immediately');
ok(/k !== CACHE_NAME/.test(sw), '…keyed on CACHE_NAME, which is what makes bumping it work');

// 🧱 EVERY PRECACHED PATH MUST EXIST AND SHIP. install() runs cache.addAll(), which is
// all-or-nothing: one 404 in PRECACHE_ASSETS rejects the whole install, the new worker never
// activates, and every installed app stays on its old build with no error anyone sees.
// build.sh is an explicit allowlist, so "committed" is not "shipped". This reads build.sh the
// way bash would run it: every `cp … dist/` with its globs expanded, plus tailwind's `-o`.
console.log('Precache paths ship');
const build = fs.readFileSync(path.join(repo, 'scripts/build.sh'), 'utf8').replace(/\\\n/g, ' ');
const shipped = new Set(), fromRepo = new Map();
const expand = src => {
  if (!src.includes('*')) return [src];
  const dir = path.posix.dirname(src), re = new RegExp('^' + path.posix.basename(src)
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$');
  return fs.readdirSync(path.join(repo, dir)).filter(f => re.test(f)).map(f => path.posix.join(dir, f));
};
for (const line of build.split('\n')) {
  // A `cp` that starts a command. The `find html … -exec cp` line is not one, and nothing
  // under html/ is precached.
  const m = line.match(/(?:^|&&\s*)cp\s+([^;&|]+)/);
  if (!m) continue;
  const args = m[1].trim().split(/\s+/).filter(a => !a.startsWith('-'));
  const dest = args.pop();
  if (!/^dist(\/|$)/.test(dest)) continue;
  for (const src of args.flatMap(expand)) {
    const out = path.posix.join(dest, path.posix.basename(src)).replace(/^dist\/?/, '');
    shipped.add(out); fromRepo.set(out, src);
  }
}
for (const m of build.matchAll(/\s-o\s+dist\/(\S+)/g)) shipped.add(m[1]);   // generated: tailwind.css
const precache = [...((sw.match(/const PRECACHE_ASSETS = \[([\s\S]*?)\];/) || [])[1] || '')
  .replace(/\/\/.*$/gm, '').matchAll(/'([^']+)'/g)].map(m => m[1]);

// The reader has to have found what it claims to read, or every check below passes on nothing.
ok(precache.length >= 5 && precache.includes('./index.html'), `PRECACHE_ASSETS was read (${precache.length} paths)`);
ok(shipped.has('index.html') && shipped.has('sw.js') && shipped.has('jsqr.min.js') && shipped.has('tailwind.css'),
   'build.sh was read: index.html, sw.js, jsqr.min.js and tailwind.css all ship');
for (const p of precache) {
  const rel = p.replace(/^\.\//, '') || 'index.html';   // './' is served as index.html
  ok(shipped.has(rel), `${p} is precached but build.sh never copies it to dist/, so every install would fail`);
  if (fromRepo.has(rel)) ok(fs.existsSync(path.join(repo, fromRepo.get(rel))), `${p} is precached but ${fromRepo.get(rel)} is not in the repo`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
