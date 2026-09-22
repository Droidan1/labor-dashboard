// scripts/backfill-transactions.sh drives a PRODUCTION admin endpoint that
// re-banks the payment archive. Three properties keep it safe, and each is
// tested here: it is a dry run unless asked, a write is confirmed by hand, and
// it NEVER sends force=1.
//
// That last one is the whole reason this file exists. force=1 disables the
// worker's refusal to overwrite a banked day with a thinner fetch — and the
// older half of this script's default window is exactly where Clover has
// decayed, so a stray force would trade a complete record for a short one
// across hundreds of store-days.
//
// Tested against a local mock, never the real endpoint. CLAUDE.md rule 3: never
// verify a guard with a probe that performs the damage if the guard is absent.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";

const SH = join(dirname(fileURLToPath(import.meta.url)), "backfill-transactions.sh");
let pass = 0, fail = 0;
const ok = (cond, msg) => (cond ? (pass++, true) : (fail++, console.log("  FAIL " + msg), false));

function mock(reply = null, status = 200) {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push({ url: req.url, method: req.method, secret: req.headers["x-snapshot-secret"] });
    if (status !== 200) {
      res.writeHead(status, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "Unauthorized", code: "NO_SESSION" }));
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(reply ?? {
      dry: true, storeDays: 2, wrote: 1, incomplete: 0, skipped: 1, itemsFailed: 0,
      needsAttention: [{ store: "BL1", date: "2026-06-20", skipped: "WOULD_LOSE_ROWS",
                         note: "already banked with 422 rows (complete=0); this fetch returned 300" }],
      report: [{ store: "BL1", date: "2026-09-01", wrote: true, items: 37 },
               { store: "BL1", date: "2026-06-20", skipped: "WOULD_LOSE_ROWS", items: 0 }],
    }));
  });
  return { server, seen };
}
const listen = (s) => new Promise(r => s.listen(0, "127.0.0.1", () => r(s.address().port)));

function run(args, env = {}, stdin = "") {
  return new Promise((resolve) => {
    const p = spawn("bash", [SH, ...args], { env: { ...process.env, SNAPSHOT_SECRET: "test-secret", ...env } });
    let out = "", err = "";
    p.stdout.on("data", d => (out += d));
    p.stderr.on("data", d => (err += d));
    p.on("close", code => resolve({ out, err, code }));
    if (stdin) p.stdin.write(stdin);
    p.stdin.end();
  });
}

const A = ["--store", "BL1", "--start", "2026-09-01", "--end", "2026-09-02"];

// ── 1. Dry by default ─────────────────────────────────────────────────────
{
  const { server, seen } = mock();
  const port = await listen(server);
  const r = await run([...A, "--host", `http://127.0.0.1:${port}`]);
  server.close();
  ok(seen.length === 1, `one request, got ${seen.length}`);
  ok(seen[0]?.url.includes("dry=1"), "the default run sends dry=1");
  ok(seen[0]?.method === "POST", "sends POST");
  ok(seen[0]?.secret === "test-secret", "forwards X-Snapshot-Secret");
  ok(!r.out.includes("test-secret"), "never echoes the secret");
  ok(r.out.includes("dry run"), "announces itself as a dry run");
  ok(r.code === 0, `exit 0, got ${r.code}`);
}

// ── 2. A write is confirmed by hand, and says what it touches ─────────────
{
  const { server, seen } = mock();
  const port = await listen(server);
  const r = await run([...A, "--host", `http://127.0.0.1:${port}`, "--write"], {}, "no\n");
  server.close();
  ok(seen.length === 0, `a declined confirmation makes NO request, got ${seen.length}`);
  ok(r.out.includes("payment_archive_items"), "names the table it fills");
  ok(r.out.includes("untouched"), "states what it does not touch");
  ok(/REFUSED|refused/.test(r.out), "warns that thin days are refused, not overwritten");
  ok(r.code !== 0, "aborting is a non-zero exit");
}

// ── 3. A confirmed write sends dry=0 ──────────────────────────────────────
{
  const { server, seen } = mock();
  const port = await listen(server);
  await run([...A, "--host", `http://127.0.0.1:${port}`, "--write", "--yes"]);
  server.close();
  ok(seen[0]?.url.includes("dry=0"), "a confirmed write sends dry=0");
}

// ── 4. 🛑 force is NEVER sent, on any path ────────────────────────────────
{
  for (const extra of [[], ["--write", "--yes"]]) {
    const { server, seen } = mock();
    const port = await listen(server);
    await run([...A, "--host", `http://127.0.0.1:${port}`, ...extra]);
    server.close();
    ok(seen.every(s => !/force/.test(s.url)),
       `force=1 is never sent (${extra.length ? "write" : "dry"} path)`);
  }
  // ...and it is not even an accepted argument, so it cannot be passed through.
  const r = await run([...A, "--force"]);
  ok(r.code === 2 && /unknown argument/.test(r.err), "--force is not an accepted flag");
}

// ── 5. No secret, no run ──────────────────────────────────────────────────
{
  const r = await run([...A], { SNAPSHOT_SECRET: "" });
  ok(r.code === 1, `exit 1 without a secret, got ${r.code}`);
  ok(/SNAPSHOT_SECRET is not set/.test(r.err), "and says so by name");
}

// ── 6. The summary surfaces the guard rather than burying it ──────────────
{
  const { server } = mock();
  const port = await listen(server);
  const r = await run([...A, "--host", `http://127.0.0.1:${port}`]);
  server.close();
  ok(/WOULD_LOSE_ROWS/.test(r.out), "names WOULD_LOSE_ROWS in the summary");
  ok(/receipt lines\s+37/.test(r.out), "counts the receipt lines banked");
  ok(/--force/.test(r.out), "tells the reader not to force past it");
}

// ── 11. 🛑 Advice only for reasons that actually occurred ─────────────────
// The first version printed the WOULD_LOSE_ROWS paragraph unconditionally, so a
// run whose only problem was a transient INCOMPLETE_FETCH was warned off using
// --force on a guard that had never fired. Advice about something that did not
// happen is worse than none — it teaches the reader to skim the section.
{
  const only = (skipped, note) => ({
    dry: true, storeDays: 30, wrote: 0, incomplete: 0, skipped: 1, itemsFailed: 0,
    needsAttention: [{ store: 'BL14', date: '2026-08-06', skipped, note }],
    report: [{ store: 'BL14', date: '2026-08-06', skipped, items: 0 }],
  });

  // Only INCOMPLETE_FETCH → no --force paragraph, and the retry hint instead.
  let m = mock(only('INCOMPLETE_FETCH', 'Clover did not return a complete order list'));
  let port = await listen(m.server);
  let r = await run([...A, "--host", `http://127.0.0.1:${port}`]);
  m.server.close();
  ok(!/--force/.test(r.out), "a run with no WOULD_LOSE_ROWS never mentions --force");
  ok(/INCOMPLETE_FETCH —/.test(r.out), "and does explain INCOMPLETE_FETCH");
  ok(/--start <DAY> --end <DAY>/.test(r.out), "with the single-day retry command");

  // Only WOULD_LOSE_ROWS → the --force warning, and no retry hint.
  m = mock(only('WOULD_LOSE_ROWS', 'already banked with 422 rows'));
  port = await listen(m.server);
  r = await run([...A, "--host", `http://127.0.0.1:${port}`]);
  m.server.close();
  ok(/WOULD_LOSE_ROWS —/.test(r.out), "WOULD_LOSE_ROWS gets its paragraph when it happens");
  ok(/--force/.test(r.out), "which is where the --force warning belongs");
  ok(!/--start <DAY> --end <DAY>/.test(r.out), "and it does not offer the retry that does not apply");

  // A single day is listed ONCE. The old block printed earliest and latest, which
  // were the same row when there was only one.
  ok((r.out.match(/BL14 2026-08-06/g) || []).length === 1,
     `one affected day prints once, not twice (got ${(r.out.match(/BL14 2026-08-06/g) || []).length})`);
  ok(/the day needing attention/.test(r.out), "and is headed in the singular");
}

// ── 7. 🛑 Dates must work on a Mac ────────────────────────────────────────
// `date -d` is GNU-only. macOS ships BSD date, which rejects it outright — and
// this repo is driven from a MacBook, so a GNU-ism here is not a portability
// nicety, it is the script failing on its first line of arithmetic for the one
// person who runs it. Both runners do the arithmetic in python3 instead, which
// they already require for their JSON summaries.
{
  const DIR = dirname(fileURLToPath(import.meta.url));
  for (const f of ["backfill-transactions.sh", "backfill-item-hours.sh"]) {
    // Comment lines are stripped first: both scripts explain IN PROSE that they
    // do not use `date -d`, and a grep over the whole file matches that warning.
    const src = readFileSync(join(DIR, f), "utf8")
      .split("\n").filter(l => !/^\s*#/.test(l)).join("\n");
    ok(!/\bdate\s+(-u\s+)?-d\b/.test(src), `${f} uses no GNU-only \`date -d\``);
    ok(!/\bdate\s+.*-v[+-]/.test(src), `${f} uses no BSD-only \`date -v\` either`);
  }
}

// ── 8. The window is chunked correctly ────────────────────────────────────
// The arithmetic moved to python3; this is what proves it still produces the
// same windows. 70 days at 30 a chunk is three calls, the last one short.
{
  const { server, seen } = mock();
  const port = await listen(server);
  const r = await run(["--store", "BL1", "--start", "2026-06-18", "--end", "2026-08-26",
                       "--host", `http://127.0.0.1:${port}`]);
  server.close();
  const ranges = seen.map(x => {
    const u = new URL("http://x" + x.url);
    return `${u.searchParams.get("start")}..${u.searchParams.get("end")}`;
  });
  ok(ranges.length === 3, `70 days at 30 a chunk is 3 calls, got ${ranges.length}`);
  ok(ranges[0] === "2026-06-18..2026-07-17", `chunk 1 (got ${ranges[0]})`);
  ok(ranges[1] === "2026-07-18..2026-08-16", `chunk 2 (got ${ranges[1]})`);
  ok(ranges[2] === "2026-08-17..2026-08-26", `chunk 3 is short and clamps to --end (got ${ranges[2]})`);
  ok(/\(70 days\)/.test(r.out), "the span is counted inclusively");
}

// ── 9. 🛑 A rejected secret stops at the FIRST chunk ──────────────────────
// The first real run of this script sent all 18 chunks with a bad secret and
// printed 18 identical NO_SESSION blobs over a summary of zeros. The one fact
// that mattered — the secret was rejected — was the one thing it never said.
{
  for (const status of [401, 403]) {
    const { server, seen } = mock(null, status);
    const port = await listen(server);
    const r = await run(["--store", "BL1 BL2", "--start", "2026-06-18", "--end", "2026-08-26",
                         "--host", `http://127.0.0.1:${port}`]);
    server.close();
    ok(seen.length === 1, `HTTP ${status} stops after ONE request, not 6 (got ${seen.length})`);
    ok(r.code === 1, `HTTP ${status} is a non-zero exit (got ${r.code})`);
    ok(/rejected the secret/.test(r.err), `HTTP ${status} names the secret, not the session`);
    ok(/NOTHING was written/.test(r.err), `HTTP ${status} says nothing was written`);
  }
}

// ── 10a. 🛑 A piped stdin must NOT hang on the prompt ─────────────────────
// The runner asks for the secret interactively when it is missing. The failure
// mode that introduces is a script that blocks forever the moment it is run
// unattended — from a cron, a CI job, or a pipeline. It only prompts when
// stdin is a terminal; everywhere else it must still fail fast.
{
  const started = Date.now();
  const r = await run([...A], { SNAPSHOT_SECRET: "" });
  ok(r.code === 1, `no secret and no terminal exits 1, got ${r.code}`);
  ok(Date.now() - started < 5000, "and returns immediately rather than waiting on a prompt");
  ok(/SNAPSHOT_SECRET is not set/.test(r.err), "and still says so by name");
}

// ── 10. The literal placeholder is refused before any request ─────────────
{
  const { server, seen } = mock();
  const port = await listen(server);
  const r = await run([...A, "--host", `http://127.0.0.1:${port}`], { SNAPSHOT_SECRET: "..." });
  server.close();
  ok(seen.length === 0, `the placeholder sends NOTHING, got ${seen.length} requests`);
  ok(r.code === 1, `exit 1 on the placeholder, got ${r.code}`);
  ok(/literal/.test(r.err), "and says it is the example value, by name");
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
