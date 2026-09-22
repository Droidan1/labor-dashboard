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
# Usage — it ASKS for the secret, so there is nothing to paste wrong:
#
#   bash scripts/backfill-item-hours.sh                 # dry run
#   bash scripts/backfill-item-hours.sh --write         # bank for real
#
# Every flag below also works. SNAPSHOT_SECRET may be exported ahead of time for
# unattended runs; a real value, never the example text.
#
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

# 🛑 NO PLACEHOLDER TO MISPASTE. The secret is asked for, interactively, when it
# is not already in the environment. Two runs were lost to a usage line here
# being copied literally: first `SNAPSHOT_SECRET='...'`, which sent three dots
# and got NO_SESSION eighteen times, then `SNAPSHOT_SECRET=<the real value>`,
# where zsh read `<` as an input redirect and died with
# "no such file or directory: the" before bash ever started.
#
# Prompting also keeps the secret out of ~/.zsh_history, which the env form
# cannot do.
if [ -z "${SNAPSHOT_SECRET:-}" ] && [ -t 0 ]; then
  printf 'SNAPSHOT_SECRET (input hidden): ' >&2
  read -rs SNAPSHOT_SECRET
  printf '\n' >&2
fi

if [ -z "${SNAPSHOT_SECRET:-}" ]; then
  cat >&2 <<'MSG'
SNAPSHOT_SECRET is not set.

It is a Cloudflare Worker secret and is deliberately absent from wrangler.toml,
which is tracked in a public repo. Export it for this command only:

    SNAPSHOT_SECRET='...' bash scripts/backfill-item-hours.sh
MSG
  exit 1
fi

if [ "$SNAPSHOT_SECRET" = "..." ]; then
  echo "SNAPSHOT_SECRET is the literal '...' from the usage line above — replace it" >&2
  echo "with the real value. Nothing was sent." >&2
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
[ -n "$START" ] || START=$(d_shift "$END" -119)

SPAN=$(d_span "$START" "$END")

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
  while d_le "$chunk_start" "$END"; do
    chunk_end=$(d_shift "$chunk_start" $((CAP - 1)))
    d_le "$chunk_end" "$END" || chunk_end="$END"

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
      # 🛑 STOP ON THE FIRST REJECTION. A wrong secret fails identically on every
      # chunk, and repeating it 18 times buries the one fact that matters under
      # 18 copies of the same blob — which is exactly how the first real run of
      # this script read. The endpoint falls through to session auth when the
      # secret does not match, so the error says NO_SESSION rather than anything
      # about a secret; name it here instead of leaving that to be decoded.
      case "$code" in
        401|403)
          cat >&2 <<MSG

The endpoint rejected the secret (HTTP $code) and NOTHING was written.

  * A NO_SESSION error here means the X-Snapshot-Secret header did not match.
    The request then fell through to normal session auth, which a shell has no
    cookie for — so the message names the session, not the secret.
  * If you pasted the usage line as written, the secret is the literal "..."
    from the example.
  * The real value cannot be read back from Cloudflare. It is the same value
    the nightly auction feeder presents.

Stopping rather than repeating this for the remaining chunks.
MSG
          exit 1 ;;
      esac
      FAILED=1
    else
      python3 - "$TMP/$store-$chunk_start.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
b, s, e = len(d.get("banked", [])), len(d.get("skipped", [])), len(d.get("errors", []))
print(f"banked {b:3d}  skipped {s:3d}  errors {e:3d}")
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
