#!/usr/bin/env bash
# The whole test suite. `npm test` from anywhere in the repo.
#
# WHY THIS EXISTS rather than `for f in scripts/test-*; do node "$f"; done`:
#   1. That loop exits with the LAST suite's status, so a failure in any
#      earlier suite was silently swallowed — the loop reported success.
#   2. A suite that crashes before its first assertion looked exactly like a
#      suite that passed. test-migration-029.js did precisely that for months
#      (an undefined REPO threw at the first readFileSync) while appearing in
#      the suite list. A suite that exits 0 having asserted NOTHING is now a
#      failure, not a pass.
#
# Suites resolve repo files as `path.join(process.argv[2] || '.', ...)`, so they
# must run with the repo root as cwd. That is what the cd below guarantees.
set -uo pipefail
cd "$(dirname "$0")/.."

green=$'\033[32m'; red=$'\033[31m'; yellow=$'\033[33m'; dim=$'\033[2m'; off=$'\033[0m'

total=0
failed=()
empty=()
suites=0

for f in scripts/test-*.mjs scripts/test-*.js; do
  [ -e "$f" ] || continue
  suites=$((suites + 1))
  name=$(basename "$f")

  out=$(node "$f" 2>&1)
  code=$?

  # Two reporters live in this repo: per-assertion "  PASS  <name>" lines, and
  # a single "<n> passed, <m> failed" tally. Count whichever the suite emits.
  n=$(printf '%s\n' "$out" | grep -cE '^[[:space:]]*PASS[[:space:]]')
  tally=$(printf '%s\n' "$out" | grep -oE '[0-9]+ passed' | tail -1 | grep -oE '^[0-9]+')
  [ -n "${tally:-}" ] && n=$((n + tally))

  if [ "$code" -ne 0 ]; then
    failed+=("$name")
    printf '  %sFAIL%s   %-30s %sexit=%s%s\n' "$red" "$off" "$name" "$dim" "$code" "$off"
    printf '%s\n' "$out" | sed 's/^/         /'
  elif [ "$n" -eq 0 ]; then
    empty+=("$name")
    printf '  %sEMPTY%s  %-30s %sexited 0 but asserted nothing%s\n' "$yellow" "$off" "$name" "$dim" "$off"
    printf '%s\n' "$out" | sed 's/^/         /'
  else
    total=$((total + n))
    printf '  %sok%s     %-30s %s%s assertions%s\n' "$green" "$off" "$name" "$dim" "$n" "$off"
  fi
done

echo
if [ ${#failed[@]} -eq 0 ] && [ ${#empty[@]} -eq 0 ]; then
  printf '%s%s assertions across %s suites — all passed%s\n' "$green" "$total" "$suites" "$off"
  exit 0
fi

[ ${#failed[@]} -gt 0 ] && printf '%s%s suite(s) failed:%s %s\n' "$red" "${#failed[@]}" "$off" "${failed[*]}"
[ ${#empty[@]} -gt 0 ] && printf '%s%s suite(s) asserted nothing:%s %s\n' "$yellow" "${#empty[@]}" "$off" "${empty[*]}"
exit 1
