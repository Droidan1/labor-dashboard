#!/usr/bin/env bash
#
# Bank the payment archive, and the receipt that now hangs off it.
#
# The archive already holds every transaction back to 2026-06-18. What it does
# NOT hold is line items — migration-064 added that table, and the days banked
# before it have no receipt. This re-banks them to fill it in.
#
# 🔑 IT IS A DRY RUN UNLESS YOU PASS --write.
#
#    The endpoint itself defaults to dry (`dry` must be explicitly "0" to write),
#    so a mistake here fails safe in the same direction the server does.
#
# 🛑 RE-BANKING IS A RE-PULL, and this repo has lost production data to those
#    three times. Two things make this one safe, and neither is optional:
#
#    * The worker refuses any fetch that returns FEWER rows than the day already
#      has banked (WOULD_LOSE_ROWS) — regardless of whether that day is marked
#      complete. Clover degrades at its retention edge by returning less, so the
#      older half of this window WILL come back short, and those days are meant
#      to be skipped rather than overwritten. Expect skips; they are the guard
#      working, not a failure.
#    * --force exists and is NOT used here. It disables that refusal. Do not
#      reach for it to "fix" a skipped day: a skipped day keeps the richer
#      record it already had.
#
#    A day that skips keeps its payments and simply gets no receipt. That is the
#    correct trade — the payments are the financial record.
#
# Usage:
#   SNAPSHOT_SECRET=... bash scripts/backfill-transactions.sh                 # dry run
#   SNAPSHOT_SECRET=... bash scripts/backfill-transactions.sh --write         # bank for real
#   SNAPSHOT_SECRET=... bash scripts/backfill-transactions.sh --store BL1     # one store
#   SNAPSHOT_SECRET=... bash scripts/backfill-transactions.sh --start 2026-08-01
#
#   --start/--end default to the last 90 days ending yesterday, which is the
#   whole span Clover can still be asked about — and, as it happens, the exact
#   span the archive covers.
#   --host defaults to api.retjghub.com; pass api-staging.retjghub.com to rehearse.
#
# The secret is read from the environment and passed to curl. It is never
# echoed, logged, or written anywhere.
#
set -uo pipefail

HOST="api.retjghub.com"
STORES="BL1 BL2 BL4 BL8 BL14 BL16"   # matches the worker's ALL_STORES. BL12
                                     # (Wyoming, closed) is not in it.
# Each store-day costs ~3 Clover subrequests. The worker refuses past 400
# store-days per invocation, but the subrequest budget bites first: 30 days a
# call is what the September backfill actually sustained, 18 calls, all 200.
CHUNK=30
WRITE=0
ASSUME_YES=0
START=""
END=""

while [ $# -gt 0 ]; do
  case "$1" in
    --write)  WRITE=1; shift ;;
    --yes|-y) ASSUME_YES=1; shift ;;
    --store)  STORES="$2"; shift 2 ;;
    --start)  START="$2";  shift 2 ;;
    --end)    END="$2";    shift 2 ;;
    --host)   HOST="$2";   shift 2 ;;
    -h|--help) sed -n '2,44p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [ -z "${SNAPSHOT_SECRET:-}" ]; then
  cat >&2 <<'MSG'
SNAPSHOT_SECRET is not set.

It is a Cloudflare Worker secret and is deliberately absent from wrangler.toml,
which is tracked in a public repo. Export it for this command only:

    SNAPSHOT_SECRET='...' bash scripts/backfill-transactions.sh
MSG
  exit 1
fi

# ── Dates, portably ─────────────────────────────────────────────────────────
# 🛑 NOT `date -d`. That is GNU-only: macOS ships BSD date, where -d means
# something else entirely and this script dies on its first line of arithmetic.
# BSD's equivalent (-j -v+30d -f %Y-%m-%d) shares no syntax with it, so rather
# than branch on which date is installed — and ship a branch that cannot be
# tested from the machine that wrote it — the arithmetic goes through python3,
# which this script already requires for its JSON summaries.
#
# ISO-8601 dates also compare correctly as plain strings, which is why the loop
# below uses `<` on them instead of converting to epochs at all.
d_shift() {   # $1 = YYYY-MM-DD, $2 = days (may be negative) -> YYYY-MM-DD
  python3 -c 'import sys,datetime;print(datetime.date.fromisoformat(sys.argv[1])+datetime.timedelta(days=int(sys.argv[2])))' "$1" "$2"
}
d_span() {    # inclusive day count between two YYYY-MM-DD
  python3 -c 'import sys,datetime;a,b=(datetime.date.fromisoformat(x) for x in sys.argv[1:3]);print((b-a).days+1)' "$1" "$2"
}
d_le() { [ "$1" = "$2" ] || [ "$1" \< "$2" ]; }

[ -n "$END" ]   || END=$(d_shift "$(date -u +%F)" -1)
[ -n "$START" ] || START=$(d_shift "$END" -88)

SPAN=$(d_span "$START" "$END")
[ "$SPAN" -gt 0 ] || { echo "end ($END) is before start ($START)" >&2; exit 2; }

echo "host    $HOST"
echo "window  $START -> $END  ($SPAN days)"
echo "stores  $STORES"
echo "mode    $([ "$WRITE" = 1 ] && echo 'WRITE — will re-bank the archive' || echo 'dry run — writes nothing')"
echo

# Rule 7: a write gets an explicit confirmation naming exactly what it touches.
if [ "$WRITE" = 1 ] && [ "$ASSUME_YES" != 1 ]; then
  n_stores=$(echo $STORES | wc -w)
  cat <<MSG
This will WRITE to the production database.

  database    labor-dashboard-db
  tables      payment_archive_items   (filled in — this is the point)
              payment_archive         (re-written per Clover payment id)
              payment_archive_days    (ledger row per store-day re-written)
  affected    up to $(( SPAN * n_stores )) store-days ($n_stores stores x $SPAN days)
  untouched   daily_sales, every KV snapshot, everything else in D1

Any day where Clover now returns FEWER rows than are already banked is REFUSED,
not overwritten. Expect the older end of the window to skip — that is the guard.

MSG
  printf 'Type "bank" to proceed: '
  read -r reply
  [ "$reply" = "bank" ] || { echo "aborted."; exit 1; }
  echo
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
FAILED=0

for store in $STORES; do
  chunk_start="$START"
  while d_le "$chunk_start" "$END"; do
    chunk_end=$(d_shift "$chunk_start" $((CHUNK - 1)))
    d_le "$chunk_end" "$END" || chunk_end="$END"

    # $HOST may carry its own scheme (the mock server in the tests does).
    case "$HOST" in *://*) base="$HOST" ;; *) base="https://$HOST" ;; esac
    url="$base/?action=bank-transactions&store=$store&start=$chunk_start&end=$chunk_end"
    # The endpoint is dry unless dry=0. Say so explicitly either way rather than
    # relying on the default being the safe one.
    url="$url&dry=$([ "$WRITE" = 1 ] && echo 0 || echo 1)"

    printf '%-5s %s -> %s  ' "$store" "$chunk_start" "$chunk_end"
    code=$(curl -sS -X POST -o "$TMP/$store-$chunk_start.json" -w '%{http_code}' \
                 -H "X-Snapshot-Secret: $SNAPSHOT_SECRET" "$url")
    if [ "$code" != "200" ]; then
      echo "HTTP $code"
      sed -n '1,4p' "$TMP/$store-$chunk_start.json" | sed 's/^/        /'
      FAILED=1
    else
      python3 - "$TMP/$store-$chunk_start.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
rep = d.get("report", [])
items = sum(r.get("items") or 0 for r in rep)
print(f"wrote {d.get('wrote', 0):3d}  items {items:6d}  "
      f"incomplete {d.get('incomplete', 0):2d}  skipped {d.get('skipped', 0):3d}  "
      f"itemsFailed {d.get('itemsFailed', 0):2d}")
PY
    fi

    chunk_start=$(d_shift "$chunk_end" 1)
  done
done

echo
echo "───── summary ─────"
python3 - "$TMP" <<'PY'
import json, glob, os, sys, collections
tot = collections.Counter()
why = collections.Counter()
attention = []
for f in sorted(glob.glob(os.path.join(sys.argv[1], "*.json"))):
    try: d = json.load(open(f))
    except Exception: continue
    if not isinstance(d, dict) or "report" not in d: continue
    tot["storeDays"]   += d.get("storeDays", 0)
    tot["wrote"]       += d.get("wrote", 0)
    tot["incomplete"]  += d.get("incomplete", 0)
    tot["skipped"]     += d.get("skipped", 0)
    tot["itemsFailed"] += d.get("itemsFailed", 0)
    tot["items"]       += sum(r.get("items") or 0 for r in d.get("report", []))
    for a in d.get("needsAttention", []):
        why[a.get("skipped") or ("itemsError" if a.get("itemsError") else "incomplete")] += 1
        attention.append(a)

print(f"store-days considered   {tot['storeDays']}")
print(f"  banked                {tot['wrote']}")
print(f"  receipt lines         {tot['items']}")
print(f"  banked incomplete     {tot['incomplete']}")
print(f"  skipped               {tot['skipped']}")
print(f"  items write failed    {tot['itemsFailed']}")
if why:
    print("\nneeds attention, by reason:")
    for k, v in why.most_common():
        print(f"  {v:5d}  {k}")
    print("\n  WOULD_LOSE_ROWS is the guard doing its job: Clover now returns fewer")
    print("  rows for that day than are already banked, so it was left alone. Do")
    print("  NOT re-run those with --force; the banked record is the better one.")
if attention:
    attention.sort(key=lambda a: (a.get("date") or "", a.get("store") or ""))
    print(f"\nearliest / latest:")
    for a in (attention[0], attention[-1]):
        print(f"  {a.get('store')} {a.get('date')}  {a.get('skipped') or ''}  {a.get('note') or a.get('itemsError') or ''}")
PY

exit $FAILED
