#!/usr/bin/env bash
#
# Bank the hourly buckets for days that predate nightly banking.
#
# Hours live only in Clover's raw orders. Clover keeps ~90 days and decays
# continuously, so every day before nightly banking started (2026-09-12) is a
# window closing one day at a time. This walks it.
#
# 🔑 IT IS A DRY RUN UNLESS YOU PASS --write.
#
#    A dry run fetches from Clover, builds the hour buckets, reconciles them
#    against the existing day snapshot, and reports — writing nothing. That
#    report is the point: it tells you how far back Clover can still reproduce
#    a day EXACTLY, which nobody knows in advance and which is not 90 days
#    just because the retention notionally is.
#
# 🛑 WHAT THIS DOES NOT DO — and why that matters here.
#
#    It writes `item-hours:` keys and nothing else. It never touches the
#    `items:` day snapshot and never touches D1. That distinction is the whole
#    reason this exists instead of `?action=resnapshot-clienttime`, which walks
#    a date range and banks hours too, but ALSO re-writes `daily_sales` and the
#    day snapshot. Pointing that at ~90 healthy days is the re-pull this repo
#    has lost production data to three times: Clover degrades by returning
#    LESS, so refunds that have aged out would silently vanish from days that
#    were correct when they were written.
#
#    Per-day it also refuses to bank anything that does not reconcile to the
#    cent against the day snapshot. A day Clover can no longer reproduce is a
#    day we decline to bank — leaving the hourly view absent is recoverable,
#    leaving it quietly disagreeing with the daily view everyone reads is not.
#
# Usage:
#   SNAPSHOT_SECRET=... bash scripts/backfill-item-hours.sh                 # dry run
#   SNAPSHOT_SECRET=... bash scripts/backfill-item-hours.sh --write         # bank for real
#   SNAPSHOT_SECRET=... bash scripts/backfill-item-hours.sh --store BL1     # one store
#   SNAPSHOT_SECRET=... bash scripts/backfill-item-hours.sh --start 2026-06-17
#
#   --start/--end default to the last 120 days ending yesterday.
#   --host defaults to api.retjghub.com; pass api-staging.retjghub.com to rehearse.
#
# The secret is read from the environment and passed to curl. It is never
# echoed, logged, or written anywhere.
#
set -uo pipefail

HOST="api.retjghub.com"
STORES="BL1 BL2 BL4 BL8 BL14 BL16"   # matches the worker's ALL_STORES.
                                     # BL12 is NOT in it, so the endpoint cannot
                                     # reach Wyoming; its history stops
                                     # 2026-06-15 and is past the cliff anyway.
CAP=120                              # BACKFILL_HOURS_MAX_STORE_DAYS, per invocation.
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
    -h|--help) sed -n '2,50p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [ -z "${SNAPSHOT_SECRET:-}" ]; then
  cat >&2 <<'MSG'
SNAPSHOT_SECRET is not set.

It is a Cloudflare Worker secret and is deliberately absent from wrangler.toml,
which is tracked in a public repo. Export it for this command only:

    SNAPSHOT_SECRET='...' bash scripts/backfill-item-hours.sh
MSG
  exit 1
fi

[ -n "$END" ]   || END=$(date -u -d 'yesterday'   +%F)
[ -n "$START" ] || START=$(date -u -d "$END - 119 days" +%F)

days_between() { echo $(( ( $(date -u -d "$2" +%s) - $(date -u -d "$1" +%s) ) / 86400 + 1 )); }
SPAN=$(days_between "$START" "$END")

if [ "$SPAN" -le 0 ]; then echo "end ($END) is before start ($START)" >&2; exit 2; fi

echo "host    $HOST"
echo "window  $START -> $END  ($SPAN days)"
echo "stores  $STORES"
echo "mode    $([ "$WRITE" = 1 ] && echo 'WRITE — will bank item-hours: keys' || echo 'dry run — writes nothing')"
echo

# Rule 7: a write gets an explicit confirmation naming exactly what it touches.
if [ "$WRITE" = 1 ] && [ "$ASSUME_YES" != 1 ]; then
  n_stores=$(echo $STORES | wc -w)
  cat <<MSG
This will WRITE to production KV.

  namespace   SALES_SNAPSHOTS
  keys        item-hours:<store>:<date>
  affected    up to $(( SPAN * n_stores )) store-days ($n_stores stores x $SPAN days)
  untouched   items:<store>:<date> day snapshots, and all of D1

Days that do not reconcile to the cent are skipped, not banked. Days already
banked are skipped at zero Clover cost.

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
  # Walk the window in chunks that respect the per-invocation subrequest cap.
  chunk_start="$START"
  while [ "$(date -u -d "$chunk_start" +%s)" -le "$(date -u -d "$END" +%s)" ]; do
    chunk_end=$(date -u -d "$chunk_start + $((CAP - 1)) days" +%F)
    [ "$(date -u -d "$chunk_end" +%s)" -gt "$(date -u -d "$END" +%s)" ] && chunk_end="$END"

    # $HOST may carry its own scheme (a local mock server in the tests does).
    case "$HOST" in *://*) base="$HOST" ;; *) base="https://$HOST" ;; esac
    url="$base/?action=backfill-item-hours&store=$store&start=$chunk_start&end=$chunk_end"
    [ "$WRITE" = 1 ] || url="$url&dry=1"

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
b, s, e = len(d.get("banked", [])), len(d.get("skipped", [])), len(d.get("errors", []))
print(f"banked {b:3d}  skipped {s:3d}  errors {e:3d}")
PY
    fi

    chunk_start=$(date -u -d "$chunk_end + 1 day" +%F)
  done
done

echo
echo "───── summary ─────"
python3 - "$TMP" <<'PY'
import json, glob, os, sys, collections
tot = collections.Counter()
why = collections.Counter()
nonrec = []
for f in sorted(glob.glob(os.path.join(sys.argv[1], "*.json"))):
    try: d = json.load(open(f))
    except Exception: continue
    if not isinstance(d, dict) or "banked" not in d: continue
    tot["banked"]  += len(d.get("banked", []))
    tot["skipped"] += len(d.get("skipped", []))
    tot["errors"]  += len(d.get("errors", []))
    for s in d.get("skipped", []):
        why[s.get("why", "?")] += 1
        if s.get("why") == "does not reconcile":
            nonrec.append(s)

considered = tot["banked"] + tot["skipped"] + tot["errors"]
already    = why.get("already banked", 0)
eligible   = considered - already
print(f"store-days considered   {considered}")
print(f"  already banked        {already}   (skipped at zero Clover cost)")
print(f"  banked / bankable     {tot['banked']}")
print(f"  skipped               {tot['skipped'] - already}")
print(f"  errors                {tot['errors']}")
if eligible:
    print(f"\nreconcile rate          {tot['banked'] / eligible * 100:.1f}%  "
          f"({tot['banked']}/{eligible} of days not already banked)")
if why:
    print("\nskip reasons:")
    for k, v in why.most_common():
        print(f"  {v:5d}  {k}")
if nonrec:
    nonrec.sort(key=lambda s: s.get("date", ""))
    print(f"\nearliest / latest day that would NOT reconcile:")
    for s in (nonrec[0], nonrec[-1]):
        print(f"  {s.get('store')} {s.get('date')}  expect {s.get('expect')}  "
              f"got {s.get('got')}  delta {s.get('delta')}")
PY

exit $FAILED
