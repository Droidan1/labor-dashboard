#!/usr/bin/env bash
# Refuses a production `wrangler deploy` from a checkout that is not the code on GitHub.
#
# Wired in as the [build] command of wrangler.toml (top level, not staging) and of
# mcp/wrangler.toml. Wrangler runs it before it bundles anything, and a non-zero exit
# aborts the deploy before any upload (checked for wrangler 4.80 and 4.165):
#   deploy, versions upload, preview   checked
#   deploy --dry-run                   skipped: it uploads nothing, and sessions dry-run dirty trees
#   dev, types                         skipped
#
# WHY: `wrangler deploy` ships whatever worker.js sits in the folder it runs in, with no
# branch awareness. That reverted production on 2026-07-28, 2026-11-09 and 2026-11-19; the
# last was a bare deploy from a Desktop `main` 44 commits behind origin, which stripped all
# E-Commerce worker code for 62 s.
#
# It refuses when:
#   1. a merge, rebase, cherry-pick or revert is in progress;
#   2. a tracked file differs from HEAD. Untracked files are ignored on purpose: nothing
#      bundles them unless tracked code imports them, and scanning for them in the
#      iCloud Desktop checkout takes minutes;
#   3. HEAD does not contain origin/main, fetched fresh. Being AHEAD of main is fine (a pushed
#      branch deployed before its merge); being behind it or diverged from it is not;
#   4. the fetch fails or times out. Fail closed: "could not check" is not "ok".
#
# EMERGENCY OVERRIDE: it still lists every problem, then lets the deploy ship this tree as is.
#   ALLOW_STALE_DEPLOY=1 npx wrangler deploy
#
# Bash 3.2 compatible (macOS /bin/bash): no `"${arr[@]}"` on empty arrays, no mapfile.
set -o pipefail

say() { printf '%s\n' "$*" >&2; }   # wrangler shows our stderr in red under [custom build]

case "${WRANGLER_COMMAND:-}" in
  dev|types) exit 0 ;;
esac

# The wrangler CLI process that ran us: our parent, or its parent when a shell sat in between,
# and only when wrangler set WRANGLER_COMMAND. It is recognised by its SCRIPT argument
# (`node [flags] <path>/wrangler-dist/cli.js <command> <flags>`), not by any mention of
# wrangler, because a shell line such as `zsh -c "... wrangler deploy --dry-run"` contains
# the same words. Anything unrecognised (wrangler moves its CLI file, a path with spaces)
# means dry runs get CHECKED, never that a real deploy gets skipped.
wrangler_args=""
pid=$PPID
set -f
[ -n "${WRANGLER_COMMAND:-}" ] && for _ in 1 2; do
  case "$pid" in ''|0|1) break ;; esac
  args=$(ps -ww -o args= -p "$pid" 2>/dev/null) || break
  set -- $args
  [ $# -gt 0 ] && shift                        # the executable (node)
  while [ $# -gt 0 ]; do case "$1" in -*) shift ;; *) break ;; esac; done   # its flags
  case "${1:-}" in */wrangler-dist/cli.js) shift; wrangler_args=" $* "; break ;; esac
  pid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')
done
set +f

case "$wrangler_args" in
  *" --dry-run false "*|*" --dry-run=false "*|*" --dryRun false "*|*" --dryRun=false "*|*" --no-dry-run "*) ;;
  *" --dry-run "*|*" --dry-run=true "*|*" --dryRun "*|*" --dryRun=true "*)
    echo "predeploy-check: dry run, nothing is uploaded, check skipped."
    exit 0 ;;
esac

# `-c <file>` from another folder bundles THAT file's checkout, so check that one.
config="" want=""
set -f
for tok in $wrangler_args; do
  if [ -n "$want" ]; then config=$tok; want=""; continue; fi
  case "$tok" in
    -c|--config) want=1 ;;
    -c=*|--config=*) config=${tok#*=} ;;
  esac
done
set +f
if [ -n "$config" ]; then
  if [ ! -f "$config" ]; then
    say "✘ predeploy-check: cannot find the config file \"$config\" from $PWD, so cannot tell which"
    say "  checkout is being deployed. Run the deploy from inside the checkout: cd <checkout> && npx wrangler deploy"
    exit 1
  fi
  cd "$(dirname "$config")" || exit 1
fi

if ! top=$(git rev-parse --show-toplevel 2>/dev/null) || ! git rev-parse --verify --quiet HEAD >/dev/null; then
  say "✘ predeploy-check: $PWD is not a git checkout with a commit, so there is no way to tell"
  say "  what this deploy would ship. Deploy from a checkout of the repo."
  [ "${ALLOW_STALE_DEPLOY:-}" = 1 ] && { say "⚠ ALLOW_STALE_DEPLOY=1 is set: deploying anyway."; exit 0; }
  exit 1
fi
cd "$top" || exit 1

problems=""
add() { problems="${problems}  • $*"$'\n'; }

for p in MERGE_HEAD:merge rebase-merge:rebase rebase-apply:rebase CHERRY_PICK_HEAD:cherry-pick REVERT_HEAD:revert; do
  if [ -e "$(git rev-parse --git-path "${p%%:*}")" ]; then
    add "a ${p##*:} is in progress here. Finish or abort it first."
  fi
done

if ! git diff --quiet HEAD -- 2>/dev/null; then
  changed=$(git diff --name-only HEAD -- 2>/dev/null)
  n=$(printf '%s\n' "$changed" | grep -c .)
  add "$n tracked file(s) differ from HEAD, so this would ship uncommitted code: $(printf '%s\n' "$changed" | head -5 | tr '\n' ' ')"
fi

# A cold fetch from this Mac has taken 11 s (warm: 0.3 s), so leave plenty of room.
timeout_s=${PREDEPLOY_FETCH_TIMEOUT:-60}
errf=$(mktemp "${TMPDIR:-/tmp}/predeploy-fetch.XXXXXX")
GIT_TERMINAL_PROMPT=0 git fetch --quiet --no-tags origin +refs/heads/main:refs/remotes/origin/main >/dev/null 2>"$errf" &
fpid=$!
ticks=0 timed_out=""
while kill -0 "$fpid" 2>/dev/null; do
  if [ "$ticks" -ge $((timeout_s * 10)) ]; then kill "$fpid" 2>/dev/null; timed_out=1; break; fi
  sleep 0.1
  ticks=$((ticks + 1))
done
wait "$fpid"
frc=$?
ferr=$(head -3 "$errf" | tr '\n' ' ')
rm -f "$errf"

if [ -n "$timed_out" ] || [ "$frc" -ne 0 ]; then
  why=${ferr:-exit $frc}
  [ -n "$timed_out" ] && why="no answer within ${timeout_s}s"
  add "could not fetch origin/main ($why), so there is no proof this checkout is current."
elif ! git merge-base --is-ancestor refs/remotes/origin/main HEAD 2>/dev/null; then
  behind=$(git rev-list --count HEAD..refs/remotes/origin/main 2>/dev/null)
  add "HEAD is missing $behind commit(s) that are on origin/main, so this would put production back on older code."
fi

where="$top ($(git rev-parse --abbrev-ref HEAD) @ $(git rev-parse --short HEAD))"
if [ -z "$problems" ]; then
  echo "predeploy-check: ok. $where is clean and contains origin/main ($(git rev-parse --short refs/remotes/origin/main))."
  exit 0
fi

say "✘ predeploy-check: refusing to ${WRANGLER_COMMAND:-deploy} from $where"
printf '%s' "$problems" >&2
say "  Fix: commit or stash, then  git -C \"$top\" pull --ff-only origin main"
say "       or deploy from an up-to-date worktree:  cd <worktree> && npx wrangler deploy"
if [ "${ALLOW_STALE_DEPLOY:-}" = 1 ]; then
  say "⚠ ALLOW_STALE_DEPLOY=1 is set: deploying this tree anyway. Redeploy from an up-to-date main soon."
  exit 0
fi
say "  Emergency only (ships this tree as it is):  ALLOW_STALE_DEPLOY=1 npx wrangler deploy"
exit 1
