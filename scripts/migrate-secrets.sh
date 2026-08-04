#!/usr/bin/env bash
#
# Phase A of the credential migration: move the credentials that are currently
# PLAINTEXT [vars] in wrangler.toml into Cloudflare Worker secrets.
#
# Context: wrangler.toml is tracked in a PUBLIC repo, so every Clover API token
# and the SNAPSHOT_SECRET have been world-readable at
#   https://raw.githubusercontent.com/Droidan1/labor-dashboard/main/wrangler.toml
# since 2026-04-08.
#
# 🔑 THIS SCRIPT MOVES THE EXISTING VALUES UNCHANGED. It does not rotate them.
#    That is deliberate and it is what makes this step safe:
#      - Cloudflare does not document which wins when a name exists as both a
#        [vars] entry and a secret. Moving identical values makes that question
#        irrelevant — either way the worker sees the same string, so there is no
#        window in which production can break.
#      - Rotation (Phase B) happens AFTER the vars are gone, when only the
#        secret exists and there is no ambiguity left to trip over.
#
#    Moving alone stops FUTURE publication. It does not un-publish anything.
#    The tokens already out there stay valid until you rotate them in Clover.
#
# Values are read from the wrangler.toml you point at and piped straight into
# wrangler. They are never echoed, logged, or written anywhere else.
#
# Usage:  bash scripts/migrate-secrets.sh [path/to/wrangler.toml]
#
set -euo pipefail

TOML="${1:-wrangler.toml}"

if [ ! -f "$TOML" ]; then
  echo "error: $TOML not found. Run from the repo root, or pass the path." >&2
  exit 1
fi

# The credentials to move. Merchant IDs are deliberately NOT in this list —
# they are account identifiers, not secrets (they appear in Clover URLs and on
# receipts), and leaving them visible keeps wrangler.toml self-documenting about
# which store maps to which account, including the BL12/BL16 sharing.
NAMES=(
  BL1_API_TOKEN BL2_API_TOKEN BL4_API_TOKEN BL8_API_TOKEN
  BL12_API_TOKEN BL14_API_TOKEN BL16_API_TOKEN
  SNAPSHOT_SECRET
)

# Pull a value out of a specific [vars] table. Named environments do not inherit
# top-level [vars], so prod and staging each carry their own copy and each has
# to be read from its own section.
read_var() {
  local name="$1" section="$2"
  python3 - "$TOML" "$name" "$section" <<'PY'
import re, sys
toml, name, section = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(toml).read()
# isolate the requested table, up to the next [table] header
m = re.search(r'^\[' + re.escape(section) + r'\]\s*$(.*?)(?=^\[|\Z)', text, re.M | re.S)
if not m:
    sys.exit(0)
v = re.search(r'^' + re.escape(name) + r'\s*=\s*"([^"]*)"', m.group(1), re.M)
sys.stdout.write(v.group(1) if v else '')
PY
}

put() {                       # put <NAME> <VALUE> [--env staging]
  local name="$1" value="$2"; shift 2
  if [ -z "$value" ]; then
    echo "  ⚠ $name: no value found — skipping" >&2
    return
  fi
  # printf, not echo: no trailing newline, and the value never appears in argv
  # (where `ps` could see it) because wrangler reads it from stdin.
  printf '%s' "$value" | npx wrangler secret put "$name" "$@" >/dev/null 2>&1 \
    && echo "  ✓ $name${1:+ (staging)}" \
    || { echo "  ✗ $name${1:+ (staging)} FAILED" >&2; return 1; }
}

echo "Reading current values from $TOML (nothing is printed)."
echo
echo "── production (clover-sales-api) ──"
for n in "${NAMES[@]}"; do put "$n" "$(read_var "$n" vars)"; done

echo
echo "── staging (clover-sales-api-staging) ──"
for n in "${NAMES[@]}"; do put "$n" "$(read_var "$n" env.staging.vars)" --env staging; done

echo
echo "── verifying every secret landed ──"
verify() {
  local env_flag="${1:-}" label="${2:-production}"
  local have
  have=$(npx wrangler secret list $env_flag 2>/dev/null | python3 -c 'import json,sys
try: print(" ".join(s["name"] for s in json.load(sys.stdin)))
except Exception: print("")')
  local missing=()
  for n in "${NAMES[@]}"; do
    case " $have " in *" $n "*) ;; *) missing+=("$n");; esac
  done
  if [ ${#missing[@]} -eq 0 ]; then
    echo "  ✓ $label: all ${#NAMES[@]} present"
  else
    echo "  ✗ $label: MISSING ${missing[*]}" >&2
    return 1
  fi
}
ok=0
verify "" production || ok=1
verify "--env staging" staging || ok=1

echo
if [ $ok -ne 0 ]; then
  echo "🛑 Some secrets are missing. DO NOT deploy the stripped wrangler.toml —"
  echo "   with the vars removed and the secrets absent, the worker would lose"
  echo "   all Clover access. Fix the failures above and re-run."
  exit 1
fi

cat <<'DONE'
✅ Phase A step 1 complete. Both environments now hold these as secrets, with
   the same values the vars already had — so nothing has changed behaviourally
   and nothing can be broken yet.

Next, in order:
  2. Deploy the wrangler.toml that no longer contains them:
       npx wrangler deploy
       npx wrangler deploy --env staging
  3. Verify Clover access still works (this re-fetches live from Clover):
       curl -s -H "X-Snapshot-Secret: <secret>" \
         "https://api.retjghub.com/?action=sales-diag&store=BL1&date=$(date -v-2d +%F 2>/dev/null || date -d '2 days ago' +%F)" | head -c 300
     A JSON body with real totals means the secret path is live.
  4. THEN Phase B — rotate for real, one merchant account at a time, in Clover.
     Six unique accounts back the seven store keys (BL16 reuses BL12's).

DONE
