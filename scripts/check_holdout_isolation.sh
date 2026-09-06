#!/usr/bin/env bash
#
# The held-out year must reach exactly one consumer.
#
# calib/holdout_2025_2026.csv is the 2025-2026 counterspace record. Agent 6 compares
# the trained population's action mix against it once, at the end, in
# eval/holdout_mix.py. If any other component reads it — the engine, the generator,
# a filter config, a spec, a prompt — the held-out year has leaked into the thing it
# is supposed to be measuring, and the final number means nothing.
#
# This checks the one thing a file permission cannot: that no *source* outside eval/
# names the file. Write protection (chmod 444) stops an accidental edit; this stops
# an accidental read.
#
# Usage:
#   scripts/check_holdout_isolation.sh [files...]   # defaults to the staged files
#
# Called by the `holdout-isolation` pre-commit hook.

set -uo pipefail

HOLDOUT_BASENAME='holdout_2025_2026'

# Where naming the holdout is legitimate:
#   eval/                     the one consumer
#   calib/                    the file itself, its generator, its documentation
#   docs/, scripts/           the plan, the status board, the hooks themselves
#   AGENTS.md, README.md,     project documentation whose whole purpose is to say
#   contracts/README.md       the file is off-limits
#
# Everything else is code or model-facing text, and a mention there is a leak.
is_exempt() {
  case "$1" in
    eval/*|calib/*|docs/*|scripts/*|.pre-commit-config.yaml)
      return 0 ;;
    AGENTS.md|README.md|contracts/README.md)
      return 0 ;;
    # The schema guard for the holdout itself: it asserts column compatibility with
    # red_action_rates.csv, the 2025-2026 window and that the file is still chmod 444.
    # It reads structure, never content, and no test file reaches a model.
    tests/agent2-calib/test_calib_schema.py)
      return 0 ;;
    *)
      return 1 ;;
  esac
}

files=()
if [ "$#" -gt 0 ]; then
  files=("$@")
else
  while IFS= read -r line; do
    [ -n "$line" ] && files+=("$line")
  done < <(git diff --cached --name-only --diff-filter=ACMR)
fi

[ "${#files[@]}" -eq 0 ] && exit 0

status=0
for file in "${files[@]}"; do
  [ -f "$file" ] || continue
  is_exempt "$file" && continue

  while IFS= read -r hit; do
    if [ "$status" -eq 0 ]; then
      echo "the held-out year is referenced outside eval/" >&2
      echo >&2
    fi
    echo "  ${file}:${hit}" >&2
    status=1
  done < <(grep -In "$HOLDOUT_BASENAME" -- "$file" 2>/dev/null)
done

if [ "$status" -ne 0 ]; then
  cat >&2 <<'MSG'

calib/holdout_2025_2026.csv is validation-only material: eval/holdout_mix.py compares
the trained population against it exactly once, in Phase 6. Anything else that reads it
contaminates the measurement — the population would be scored against a record it was
shaped by.

Use calib/red_action_rates.csv instead, which covers 2018-2024 and is what the engine
and the generator are meant to see. If a file outside eval/ genuinely needs to name the
holdout, raise it in your QUESTIONS.md rather than editing the exemption list here.
MSG
fi

exit "$status"
