// scripts/backfill-item-hours.sh drives a PRODUCTION admin endpoint that writes
// KV. The property that keeps it safe is that it is a dry run unless you ask
// otherwise — so that property is the one worth a test.
//
// It is tested against a local mock of the endpoint, never against the real
// one. CLAUDE.md rule 3: never verify a guard with a probe that performs the
// damage if the guard is absent. A test that confirmed "dry by default" by
// calling production would bank ~700 store-days the one time it was wrong.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SH = join(dirname(fileURLToPath(import.meta.url)), "backfill-item-hours.sh");

let pass = 0, fail = 0;
const ok = (cond, msg) => (cond ? (pass++, true) : (fail++, console.log("  FAIL " + msg), false));

// A stand-in for ?action=backfill-item-hours that records what it was asked.
function mock(reply = null) {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push({ url: req.url, method: req.method, secret: req.headers["x-snapshot-secret"] });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(reply ?? {
      dry: true, storeDays: 2,
      banked: [{ store: "BL1", date: "2026-09-01" }],
      skipped: [{ store: "BL1", date: "2026-06-01", why: "does not reconcile",
                  expect: 350, got: 100, delta: -250 }],
      errors: [],
    }));
  });
  return { server, seen };
}

const listen = (server) => new Promise((r) => server.listen(0, "127.0.0.1", () => r(server.address().port)));

function run(args, env = {}, stdin = "") {
  return new Promise((resolve) => {
    const p = spawn("bash", [SH, ...args], {
      env: { ...process.env, SNAPSHOT_SECRET: "test-secret", ...env },
    });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.stdin.end(stdin);
    p.on("close", (code) => resolve({ code, out, err }));
  });
}

const A = ["--start", "2026-09-01", "--end", "2026-09-02", "--store", "BL1"];

// ── 1. dry by default ────────────────────────────────────────────────────────
{
  const { server, seen } = mock();
  const port = await listen(server);
  const r = await run([...A, "--host", `http://127.0.0.1:${port}`]);
  server.close();

  ok(seen.length === 1, `one request, got ${seen.length}`);
  ok(seen[0]?.url.includes("dry=1"), "default run sends dry=1");
  ok(seen[0]?.method === "POST", "sends POST");
  ok(seen[0]?.secret === "test-secret", "forwards X-Snapshot-Secret");
  ok(r.out.includes("dry run"), "announces itself as a dry run");
  ok(!r.out.includes("test-secret"), "never echoes the secret");
  ok(r.code === 0, `exit 0, got ${r.code}`);
}

// ── 2. --write alone still does not write: it asks first ─────────────────────
{
  const { server, seen } = mock();
  const port = await listen(server);
  const r = await run([...A, "--host", `http://127.0.0.1:${port}`, "--write"], {}, "no\n");
  server.close();

  ok(seen.length === 0, `declined confirmation makes NO request, got ${seen.length}`);
  ok(r.out.includes("item-hours:"), "names the keys it would write");
  ok(r.out.includes("untouched"), "states what it does not touch");
  ok(r.code !== 0, "aborting is a non-zero exit");
}

// ── 3. --write --yes drops dry=1 ─────────────────────────────────────────────
{
  const { server, seen } = mock();
  const port = await listen(server);
  await run([...A, "--host", `http://127.0.0.1:${port}`, "--write", "--yes"]);
  server.close();

  ok(seen.length === 1, `one request, got ${seen.length}`);
  ok(!seen[0]?.url.includes("dry=1"), "an confirmed write omits dry=1");
}

// ── 4. no secret → refuses, and makes no request ─────────────────────────────
{
  const { server, seen } = mock();
  const port = await listen(server);
  const r = await run([...A, "--host", `http://127.0.0.1:${port}`], { SNAPSHOT_SECRET: "" });
  server.close();

  ok(r.code === 1, `exit 1 without a secret, got ${r.code}`);
  ok(seen.length === 0, "makes no request without a secret");
}

// ── 5. chunking respects BACKFILL_HOURS_MAX_STORE_DAYS ───────────────────────
{
  const { server, seen } = mock();
  const port = await listen(server);
  // 130 days for one store => 120 + 10, two invocations.
  await run(["--start", "2026-05-01", "--end", "2026-09-07", "--store", "BL1",
             "--host", `http://127.0.0.1:${port}`]);
  server.close();

  ok(seen.length === 2, `130 days chunks into 2 calls, got ${seen.length}`);
  const spans = seen.map((s) => new URL("http://x" + s.url).searchParams);
  ok(spans[0].get("start") === "2026-05-01" && spans[0].get("end") === "2026-08-28",
     `first chunk is 120 days, got ${spans[0]?.get("start")}..${spans[0]?.get("end")}`);
  ok(spans[1].get("start") === "2026-08-29" && spans[1].get("end") === "2026-09-07",
     `second chunk is the remainder, got ${spans[1]?.get("start")}..${spans[1]?.get("end")}`);
  ok(seen.every((s) => s.url.includes("dry=1")), "every chunk stays dry by default");
}

// ── 6. BL12 is not in the default roster ─────────────────────────────────────
{
  const { server, seen } = mock();
  const port = await listen(server);
  await run(["--start", "2026-09-01", "--end", "2026-09-01",
             "--host", `http://127.0.0.1:${port}`]);
  server.close();

  const stores = seen.map((s) => new URL("http://x" + s.url).searchParams.get("store"));
  ok(stores.length === 6, `default roster is 6 stores, got ${stores.length}`);
  ok(!stores.includes("BL12"), "BL12 is absent — the worker's ALL_STORES excludes it");
  ok(["BL1", "BL2", "BL4", "BL8", "BL14", "BL16"].every((s) => stores.includes(s)),
     `roster matches ALL_STORES, got ${stores.join(",")}`);
}

// ── 7. the summary reports a reconcile rate, not just counts ─────────────────
{
  const { server } = mock({
    dry: true, storeDays: 4,
    banked: [{ store: "BL1", date: "2026-09-01" }, { store: "BL1", date: "2026-09-02" }],
    skipped: [
      { store: "BL1", date: "2026-06-01", why: "does not reconcile", expect: 350, got: 100, delta: -250 },
      { store: "BL1", date: "2026-09-12", why: "already banked" },
    ],
    errors: [],
  });
  const port = await listen(server);
  const r = await run([...A, "--host", `http://127.0.0.1:${port}`]);
  server.close();

  // 2 banked of 3 eligible (the already-banked day is not eligible) = 66.7%
  ok(/reconcile rate\s+66\.7%/.test(r.out), `reports 66.7%, got:\n${r.out}`);
  ok(r.out.includes("already banked"), "breaks out already-banked separately");
  ok(r.out.includes("does not reconcile"), "lists the skip reason");
  ok(r.out.includes("2026-06-01"), "names the earliest day that would not reconcile");
  ok(/delta\s+-250/.test(r.out), "shows the shortfall");
}

// scripts/test.sh counts either "  PASS <name>" lines or an "<n> passed" tally.
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
