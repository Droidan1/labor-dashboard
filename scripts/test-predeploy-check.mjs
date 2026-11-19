// scripts/predeploy-check.sh — the [build] command that stops `wrangler deploy` shipping a
// stale or dirty checkout to production (three reverts: 2026-07-28, -11-09, -11-19).
//
// Every case builds real git repos in a temp dir: a bare "origin", a "seed" clone that
// moves origin/main, and the "deployer" clone the guard runs in. The deployer never
// fetches on its own, so a "behind" case is only caught if the guard's own fetch works.
//
// The last section drives a REAL `wrangler deploy` (not a dry run) through the command
// copied from wrangler.toml. 🔑 It cannot upload anything even if the guard were gone: the
// temp config's `main` does not exist, so wrangler dies at its entry-point check right after
// the build step, and the API token is a dummy. The guard's verdict shows up as WHICH of
// those two errors wrangler prints.
import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = path.join(repo, 'scripts/predeploy-check.sh');
let pass = 0, fail = 0;
const ok = (c, m, detail) => {
  if (c) { pass++; return; }
  fail++;
  console.log('  FAIL: ' + m);
  if (detail) console.log(String(detail).replace(/^/gm, '        '));
};

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'predeploy-')));
const hooks = path.join(tmp, 'no-hooks');
fs.mkdirSync(hooks);
const gitconfig = path.join(tmp, 'gitconfig');
fs.writeFileSync(gitconfig, `[init]\n\tdefaultBranch = main\n[user]\n\tname = Test\n\temail = test@example.invalid\n[commit]\n\tgpgsign = false\n[core]\n\thooksPath = ${hooks}\n[advice]\n\tdetachedHead = false\n`);

// A clean environment: nothing from the caller's git, wrangler or override settings leaks in.
const baseEnv = {};
for (const [k, v] of Object.entries(process.env)) {
  if (k.startsWith('GIT_') || k.startsWith('WRANGLER_') || k.startsWith('CLOUDFLARE_')) continue;
  if (k === 'ALLOW_STALE_DEPLOY' || k === 'PREDEPLOY_FETCH_TIMEOUT') continue;
  baseEnv[k] = v;
}
Object.assign(baseEnv, { GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: '1' });

const git = (cwd, ...args) => execFileSync('git', args, { cwd, env: baseEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const tryGit = (cwd, ...args) => spawnSync('git', args, { cwd, env: baseEnv, encoding: 'utf8' });
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

let n = 0;
function fresh() {
  const dir = path.join(tmp, `r${++n}`);
  const origin = path.join(dir, 'origin.git');
  const seed = path.join(dir, 'seed');
  const dep = path.join(dir, 'deployer');
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '--quiet', '--bare', origin);
  git(dir, 'clone', '--quiet', origin, seed);
  write(path.join(seed, 'worker.js'), 'export default {}\n');
  write(path.join(seed, 'wrangler.toml'), 'name = "x"\nmain = "worker.js"\n');
  git(seed, 'add', '-A');
  git(seed, 'commit', '--quiet', '-m', 'base');
  git(seed, 'push', '--quiet', 'origin', 'main');
  git(dir, 'clone', '--quiet', origin, dep);
  return { dir, origin, seed, dep };
}
let bump = 0;
function advanceOrigin(r, count = 1) {
  for (let i = 0; i < count; i++) {
    fs.appendFileSync(path.join(r.seed, 'history.txt'), `change ${++bump}\n`);
    git(r.seed, 'add', 'history.txt');
    git(r.seed, 'commit', '--quiet', '-m', `change ${bump}`);
  }
  git(r.seed, 'push', '--quiet', 'origin', 'main');
}

// The guard as wrangler runs it: `bash <script>` with WRANGLER_COMMAND set.
function guard(cwd, { env = {}, command = 'deploy' } = {}) {
  const e = { ...baseEnv, ...env };
  if (command !== null) e.WRANGLER_COMMAND = command;
  const t = Date.now();
  const r = spawnSync('bash', [GUARD], { cwd, env: e, encoding: 'utf8', timeout: 60000 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), ms: Date.now() - t };
}

// A stand-in for wrangler's CLI process (node .../wrangler-dist/cli.js), so the guard sees
// a parent with the same signature and args as the real one.
// `shells` puts that many `sh -c` layers between it and the guard (wrangler itself uses one,
// which sh usually execs away; `; exit $?` stops that so the layer really exists).
const fakeBin = path.join(tmp, 'bin');
write(path.join(fakeBin, 'wrangler-dist', 'cli.js'), '#!/usr/bin/env bash\nbash "$GUARD"\nexit $?\n');
function viaWrangler(cwd, args, { shells = 0, env = {} } = {}) {
  const inner = path.join(fakeBin, 'wrangler-dist', 'cli.js');
  const e = { ...baseEnv, GUARD, WRANGLER_COMMAND: 'deploy', ...env };
  let r;
  if (shells === 0) {
    r = spawnSync('bash', [inner, ...args], { cwd, env: e, encoding: 'utf8', timeout: 60000 });
  } else {
    // Layers: wrangler(args) -> sh -c -> ... -> bash guard. Built explicitly so the
    // args the guard can see are exactly the ones on the outer "wrangler" process.
    let cmd = `bash "${GUARD}"; exit $?`;
    for (let i = 1; i < shells; i++) cmd = `/bin/sh -c '${cmd.replace(/'/g, `'\\''`)}'; exit $?`;
    write(path.join(fakeBin, 'layered', 'wrangler-dist', 'cli.js'), `#!/usr/bin/env bash\n/bin/sh -c '${cmd.replace(/'/g, `'\\''`)}'\nexit $?\n`);
    r = spawnSync('bash', [path.join(fakeBin, 'layered', 'wrangler-dist', 'cli.js'), ...args], { cwd, env: e, encoding: 'utf8', timeout: 60000 });
  }
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

// ── the four cases the guard exists for ──────────────────────────────────────
{
  const r = fresh();
  const g = guard(r.dep);
  ok(g.code === 0, 'up to date and clean -> allowed', g.out);
  ok(/predeploy-check: ok\./.test(g.out), 'up to date and clean -> says ok, with the origin/main it checked', g.out);
}
{
  const r = fresh();
  advanceOrigin(r, 2);
  ok(git(r.dep, 'rev-list', '--count', 'HEAD..origin/main') === '0', 'setup: the deployer\'s own origin/main does not know it is behind');
  const g = guard(r.dep);
  ok(g.code === 1, 'behind origin/main -> refused (the guard fetched it fresh)', g.out);
  ok(/missing 2 commit\(s\) that are on origin\/main/.test(g.out), 'behind -> says how many commits', g.out);
  ok(/ALLOW_STALE_DEPLOY=1 npx wrangler deploy/.test(g.out), 'a refusal names the emergency override', g.out);
}
{
  const r = fresh();
  fs.appendFileSync(path.join(r.dep, 'worker.js'), '// local edit\n');
  const g = guard(r.dep);
  ok(g.code === 1, 'dirty (unstaged edit to a tracked file) -> refused', g.out);
  ok(/1 tracked file\(s\) differ from HEAD.*worker\.js/.test(g.out), 'dirty -> names the file', g.out);
}
{
  const r = fresh();
  git(r.dep, 'checkout', '--quiet', '-b', 'other');
  fs.appendFileSync(path.join(r.dep, 'worker.js'), '// theirs\n');
  git(r.dep, 'commit', '--quiet', '-am', 'theirs');
  git(r.dep, 'checkout', '--quiet', 'main');
  fs.appendFileSync(path.join(r.dep, 'worker.js'), '// ours\n');
  git(r.dep, 'commit', '--quiet', '-am', 'ours');
  ok(tryGit(r.dep, 'merge', 'other').status !== 0, 'setup: the merge stops on a conflict');
  const g = guard(r.dep);
  ok(g.code === 1, 'mid-merge (conflicted) -> refused', g.out);
  ok(/a merge is in progress/.test(g.out), 'mid-merge -> says a merge is in progress', g.out);
}

// ── more shapes of "dirty" and "in progress" ─────────────────────────────────
{
  const r = fresh();
  fs.appendFileSync(path.join(r.dep, 'worker.js'), '// staged\n');
  git(r.dep, 'add', 'worker.js');
  const g = guard(r.dep);
  ok(g.code === 1, 'staged-only change -> refused', g.out);
}
{
  const r = fresh();
  write(path.join(r.dep, 'notes.txt'), 'scratch\n');
  const g = guard(r.dep);
  ok(g.code === 0, 'untracked file only -> allowed (never bundled unless tracked code imports it)', g.out);
}
{
  const r = fresh();
  git(r.dep, 'checkout', '--quiet', '-b', 'side');
  git(r.dep, 'commit', '--quiet', '--allow-empty', '-m', 'side');
  git(r.dep, 'checkout', '--quiet', 'main');
  git(r.dep, 'merge', '--quiet', '-s', 'ours', '--no-commit', '--no-ff', 'side');
  ok(tryGit(r.dep, 'diff', '--quiet', 'HEAD').status === 0, 'setup: a merge in progress with a tree identical to HEAD');
  const g = guard(r.dep);
  ok(g.code === 1 && /a merge is in progress/.test(g.out) && !/tracked file/.test(g.out),
    'mid-merge with a clean tree -> refused on the merge alone', g.out);
}
{
  const r = fresh();
  git(r.dep, 'checkout', '--quiet', '-b', 'feature');
  fs.appendFileSync(path.join(r.dep, 'worker.js'), '// feature\n');
  git(r.dep, 'commit', '--quiet', '-am', 'feature');
  fs.writeFileSync(path.join(r.seed, 'worker.js'), 'export default { conflicting: 1 }\n');
  git(r.seed, 'commit', '--quiet', '-am', 'conflicting');
  git(r.seed, 'push', '--quiet', 'origin', 'main');
  git(r.dep, 'fetch', '--quiet', 'origin');
  ok(tryGit(r.dep, 'rebase', 'origin/main').status !== 0, 'setup: the rebase stops on a conflict');
  git(r.dep, 'checkout', '--quiet', '--ours', 'worker.js'); // resolve the file, stay mid-rebase
  const g = guard(r.dep);
  ok(g.code === 1 && /a rebase is in progress/.test(g.out), 'mid-rebase -> refused', g.out);
}
{
  const r = fresh();
  git(r.dep, 'checkout', '--quiet', '-b', 'pick');
  fs.writeFileSync(path.join(r.dep, 'worker.js'), 'export default { pick: 1 }\n');
  git(r.dep, 'commit', '--quiet', '-am', 'pick');
  git(r.dep, 'checkout', '--quiet', 'main');
  fs.writeFileSync(path.join(r.dep, 'worker.js'), 'export default { main: 1 }\n');
  git(r.dep, 'commit', '--quiet', '-am', 'main side');
  ok(tryGit(r.dep, 'cherry-pick', 'pick').status !== 0, 'setup: the cherry-pick stops on a conflict');
  const g = guard(r.dep);
  ok(g.code === 1 && /a cherry-pick is in progress/.test(g.out), 'mid-cherry-pick -> refused', g.out);
}

// ── ahead, diverged, worktrees ───────────────────────────────────────────────
{
  const r = fresh();
  advanceOrigin(r);
  git(r.dep, 'fetch', '--quiet', 'origin');
  git(r.dep, 'checkout', '--quiet', '-b', 'deploy-ahead', 'origin/main');
  fs.appendFileSync(path.join(r.dep, 'worker.js'), '// fix shipped before its merge\n');
  git(r.dep, 'commit', '--quiet', '-am', 'fix');
  const g = guard(r.dep);
  ok(g.code === 0, 'a branch AHEAD of origin/main (deploy before merge) -> allowed', g.out);
}
{
  const r = fresh();
  fs.appendFileSync(path.join(r.dep, 'worker.js'), '// local only\n');
  git(r.dep, 'commit', '--quiet', '-am', 'local only');
  advanceOrigin(r);
  const g = guard(r.dep);
  ok(g.code === 1 && /missing 1 commit/.test(g.out), 'diverged from origin/main -> refused', g.out);
}
{
  const r = fresh();
  const wt = path.join(r.dir, 'wt');
  git(r.dep, 'worktree', 'add', '--quiet', '--detach', wt, 'origin/main');
  ok(guard(wt).code === 0, 'a clean, current git worktree -> allowed');
  advanceOrigin(r);
  ok(guard(wt).code === 1, 'the same worktree once origin moves -> refused');
  git(wt, 'fetch', '--quiet', 'origin');
  git(wt, 'checkout', '--quiet', '-b', 'wt-a', 'origin/main');
  fs.appendFileSync(path.join(wt, 'worker.js'), '// a\n');
  git(wt, 'commit', '--quiet', '-am', 'a');
  git(wt, 'checkout', '--quiet', '-b', 'wt-b', 'HEAD~1');
  fs.appendFileSync(path.join(wt, 'worker.js'), '// b\n');
  git(wt, 'commit', '--quiet', '-am', 'b');
  tryGit(wt, 'merge', 'wt-a');
  const g = guard(wt);
  ok(g.code === 1 && /a merge is in progress/.test(g.out), 'mid-merge inside a worktree (per-worktree MERGE_HEAD) -> refused', g.out);
  ok(guard(r.dep).code === 1 && !/merge is in progress/.test(guard(r.dep).out),
    'the worktree\'s merge is not reported for the main checkout');
}

// ── fail closed when it cannot check ─────────────────────────────────────────
{
  const r = fresh();
  git(r.dep, 'remote', 'set-url', 'origin', path.join(r.dir, 'no-such-origin.git'));
  const g = guard(r.dep);
  ok(g.code === 1 && /could not fetch origin\/main/.test(g.out), 'fetch fails (offline) -> refused, not waved through', g.out);
  const o = guard(r.dep, { env: { ALLOW_STALE_DEPLOY: '1' } });
  ok(o.code === 0 && /could not fetch/.test(o.out) && /ALLOW_STALE_DEPLOY=1 is set/.test(o.out),
    'offline + ALLOW_STALE_DEPLOY=1 -> allowed, still printing the problem', o.out);
}
{
  const r = fresh();
  git(r.dep, 'config', 'protocol.ext.allow', 'always');
  git(r.dep, 'remote', 'set-url', 'origin', 'ext::sleep 6');
  const g = guard(r.dep, { env: { PREDEPLOY_FETCH_TIMEOUT: '1' } });
  ok(g.code === 1 && /no answer within 1s/.test(g.out), 'a fetch that hangs -> refused after the timeout', g.out);
  ok(g.ms < 5000, `a hanging fetch does not hold the deploy past its timeout (took ${g.ms} ms)`);
}
{
  const dir = path.join(tmp, 'not-a-repo');
  fs.mkdirSync(dir);
  const g = guard(dir);
  ok(g.code === 1 && /not a git checkout/.test(g.out), 'not a git checkout -> refused', g.out);
}

// ── the override, and which wrangler commands are checked ────────────────────
{
  const r = fresh();
  advanceOrigin(r);
  const o = guard(r.dep, { env: { ALLOW_STALE_DEPLOY: '1' } });
  ok(o.code === 0 && /missing 1 commit/.test(o.out) && /deploying this tree anyway/.test(o.out),
    'behind + ALLOW_STALE_DEPLOY=1 -> allowed, with the problem and a warning printed', o.out);
  ok(guard(r.dep, { env: { ALLOW_STALE_DEPLOY: 'true' } }).code === 1, 'ALLOW_STALE_DEPLOY must be exactly 1');
  ok(guard(r.dep, { command: 'versions upload' }).code === 1, '`versions upload` is checked');
  ok(guard(r.dep, { command: null }).code === 1, 'no WRANGLER_COMMAND (run by hand) is checked');
  ok(guard(r.dep, { command: 'dev' }).code === 0, '`wrangler dev` is not checked');
  ok(guard(r.dep, { command: 'types' }).code === 0, '`wrangler types` is not checked');

  // Dry runs, read from the wrangler process's own args.
  const dry = viaWrangler(r.dep, ['deploy', '--dry-run']);
  ok(dry.code === 0 && /dry run, nothing is uploaded/.test(dry.out), 'deploy --dry-run -> skipped', dry.out);
  ok(viaWrangler(r.dep, ['deploy', '--dry-run', '--outdir', 'dist']).code === 0, 'deploy --dry-run --outdir -> skipped');
  ok(viaWrangler(r.dep, ['deploy']).code === 1, 'the same "wrangler" without --dry-run -> refused');
  ok(viaWrangler(r.dep, ['deploy', '--dry-run=false']).code === 1, 'deploy --dry-run=false -> refused');
  ok(viaWrangler(r.dep, ['deploy', '--dry-run', 'false']).code === 1, 'deploy --dry-run false -> refused');
  ok(viaWrangler(r.dep, ['deploy', '--dry-run'], { shells: 1 }).code === 0, 'a dry run is still seen through the one shell wrangler uses');
  ok(viaWrangler(r.dep, ['deploy', '--dry-run'], { shells: 2 }).code === 1,
    'a "--dry-run" further up the tree than wrangler\'s own process does not excuse a deploy');
  ok(viaWrangler(r.dep, ['deploy', '--dry-run'], { env: { WRANGLER_COMMAND: '' } }).code === 1,
    'no WRANGLER_COMMAND -> not run by wrangler, so a parent\'s --dry-run does not count');
  // Found 2026-11-19: run from `zsh -c "...guard...; npx wrangler deploy --dry-run"`, the
  // first version read that SHELL as wrangler and skipped the check.
  const shellLine = spawnSync('/bin/sh', ['-c', `bash "${GUARD}"; exit $? # npx wrangler deploy --dry-run`],
    { cwd: r.dep, env: { ...baseEnv, WRANGLER_COMMAND: 'deploy' }, encoding: 'utf8' });
  ok(shellLine.status === 1, 'a shell whose command line says "wrangler deploy --dry-run" is not wrangler -> checked',
    (shellLine.stdout || '') + (shellLine.stderr || ''));
}

// ── -c from another folder checks the checkout that is actually bundled ──────
{
  const stale = fresh();
  advanceOrigin(stale);
  const current = fresh();
  const a = viaWrangler(stale.dep, ['deploy', '-c', path.join(current.dep, 'wrangler.toml')]);
  ok(a.code === 0, '-c <current checkout> run from a stale folder -> allowed (checks the -c checkout)', a.out);
  const b = viaWrangler(current.dep, ['deploy', '--config', path.join(stale.dep, 'wrangler.toml')]);
  ok(b.code === 1 && b.out.includes(stale.dep), '--config <stale checkout> run from a current folder -> refused, naming the stale one', b.out);
  const c = viaWrangler(current.dep, ['deploy', `--config=${path.join(stale.dep, 'wrangler.toml')}`]);
  ok(c.code === 1, '--config=<stale checkout> -> refused', c.out);
  const d = viaWrangler(current.dep, ['deploy', '-c', 'nowhere/wrangler.toml']);
  ok(d.code === 1 && /cannot find the config file/.test(d.out), '-c <missing file> -> refused', d.out);
}

// ── the wiring in this repo ──────────────────────────────────────────────────
function sections(toml) {
  const out = { '': [] };
  let cur = '';
  for (const line of toml.split('\n')) {
    const h = line.match(/^\s*\[\[?([^\]]+)\]\]?\s*$/);
    if (h) { cur = h[1].trim(); out[cur] = out[cur] || []; continue; }
    out[cur].push(line);
  }
  return out;
}
const buildCommand = (sec) => {
  const line = (sec || []).find(l => /^\s*command\s*=/.test(l));
  if (!line) return null;
  const v = line.replace(/^\s*command\s*=\s*/, '').trim();
  return v.startsWith("'") ? v.slice(1, v.lastIndexOf("'")) : JSON.parse(v);
};
const main = sections(fs.readFileSync(path.join(repo, 'wrangler.toml'), 'utf8'));
const mcp = sections(fs.readFileSync(path.join(repo, 'mcp/wrangler.toml'), 'utf8'));
const prodCmd = buildCommand(main.build);
ok(prodCmd && prodCmd.includes('scripts/predeploy-check.sh'), 'wrangler.toml: the production [build] runs the guard', prodCmd);
ok(buildCommand(mcp.build) === prodCmd, 'mcp/wrangler.toml: the MCP worker runs the same guard');
ok('env.staging.build' in main && buildCommand(main['env.staging.build']) === null,
  'wrangler.toml: staging has its own empty [env.staging.build], so it does not inherit the guard');
ok(!Object.keys(main).some(k => k.startsWith('env.') && k !== 'env.staging' && !k.startsWith('env.staging.')),
  'wrangler.toml: no other named env that would inherit the guard unnoticed');
// Wrangler rewrites and deletes its own .wrangler/ cache. A TRACKED file in there turns every
// checkout dirty after a deploy, so the guard refuses the next one (found 2026-11-19: the
// account cache was re-added by a "restore 65 files" commit and showed as deleted on Desktop).
{
  const r = spawnSync('git', ['ls-files', '--', '.wrangler', 'mcp/.wrangler'], { cwd: repo, encoding: 'utf8' });
  ok(r.status === 0 && r.stdout.trim() === '', 'nothing under .wrangler/ is tracked (wrangler writes there)', r.stdout || r.stderr);
}

// ── a real `wrangler deploy` through that exact command ──────────────────────
const wranglers = [];
if (spawnSync('sh', ['-c', 'command -v wrangler'], { env: baseEnv }).status === 0) wranglers.push(['wrangler']);
if (spawnSync('npx', ['--no-install', 'wrangler', '--version'], { env: baseEnv, encoding: 'utf8', timeout: 60000 }).status === 0) wranglers.push(['npx', '--no-install', 'wrangler']);
if (!wranglers.length) console.log('  note: no wrangler installed, skipping the real-wrangler checks');
for (const bin of wranglers) {
  const label = bin.join(' ');
  const r = fresh();
  fs.rmSync(path.join(r.seed, 'worker.js'));
  write(path.join(r.seed, 'wrangler.toml'),
    `name = "predeploy-guard-e2e"\nmain = "not-here.js"\ncompatibility_date = "2024-01-01"\n\n[build]\ncommand = '${prodCmd}'\n`);
  write(path.join(r.seed, 'scripts/predeploy-check.sh'), fs.readFileSync(GUARD, 'utf8'));
  git(r.seed, 'add', '-A');
  git(r.seed, 'commit', '--quiet', '-m', 'e2e config');
  git(r.seed, 'push', '--quiet', 'origin', 'main');
  git(r.dep, 'pull', '--quiet', '--ff-only', 'origin', 'main');
  const env = { ...baseEnv, CLOUDFLARE_API_TOKEN: 'not-a-real-token', CLOUDFLARE_ACCOUNT_ID: '00000000000000000000000000000000', WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1' };
  const run = (...args) => {
    const x = spawnSync(bin[0], [...bin.slice(1), ...args], { cwd: r.dep, env, encoding: 'utf8', timeout: 120000 });
    return { code: x.status, out: (x.stdout || '') + (x.stderr || '') };
  };
  const entryMissing = /not-here\.js.{0,40}was not found/s;

  const okRun = run('deploy');
  ok(/predeploy-check: ok\./.test(okRun.out) && entryMissing.test(okRun.out),
    `${label} deploy: current + clean -> the guard passes and wrangler goes on (to the missing entry point)`, okRun.out);
  advanceOrigin(r);
  const stale = run('deploy');
  ok(stale.code !== 0 && /refusing to deploy/.test(stale.out) && /Running custom build .* failed/.test(stale.out) && !entryMissing.test(stale.out),
    `${label} deploy: behind origin -> wrangler aborts at the guard, before anything after the build`, stale.out);
  const dry = run('deploy', '--dry-run');
  ok(/dry run, nothing is uploaded/.test(dry.out) && entryMissing.test(dry.out),
    `${label} deploy --dry-run: behind origin -> the guard steps aside`, dry.out);
  const override = spawnSync(bin[0], [...bin.slice(1), 'deploy'], { cwd: r.dep, env: { ...env, ALLOW_STALE_DEPLOY: '1' }, encoding: 'utf8', timeout: 120000 });
  const oOut = (override.stdout || '') + (override.stderr || '');
  ok(/ALLOW_STALE_DEPLOY=1 is set/.test(oOut) && entryMissing.test(oOut),
    `${label} deploy: ALLOW_STALE_DEPLOY=1 reaches the guard through wrangler`, oOut);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
