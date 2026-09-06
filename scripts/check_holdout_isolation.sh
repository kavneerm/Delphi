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
# This enforces two things, because a file permission enforces neither durably:
#
#   1. No *source* outside eval/ may name the file  — stops an accidental read.
#   2. No commit may modify the file itself         — stops an accidental write.
#
# `chmod 444` is deliberately NOT the mechanism. Git records only the executable
# bit (the holdout is stored 100644), so the read-only mode is local to one
# working tree and is gone the moment anyone clones or the branch is rebased.
# The mode is still applied as a convenience; this hook is the real guard.
#
# A human who genuinely needs to revise the held-out year sets ALLOW_HOLDOUT_EDIT=1.
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

# --- 2. the holdout itself is frozen -----------------------------------------
# Ask git what is actually being changed rather than trusting the argument list:
# pre-commit passes staged files, but a human running this over the whole tree
# passes the holdout too, and merely naming it is not modifying it.
if [ "${ALLOW_HOLDOUT_EDIT:-0}" != "1" ]; then
  if git diff --cached --name-only --diff-filter=ACMR 2>/dev/null \
       | grep -qx 'calib/holdout_2025_2026.csv'; then
    cat >&2 <<'MSG'
the held-out year is being modified

calib/holdout_2025_2026.csv is frozen. It is the record Agent 6 measures the trained
population against, once, in Phase 6. Editing it after training has begun invalidates
that measurement, and `chmod 444` cannot prevent this because git does not preserve
the mode across a clone or a rebase.

If you genuinely need to revise the held-out year, that is a human decision:

    ALLOW_HOLDOUT_EDIT=1 git commit ...

MSG
    exit 1
  fi
fi
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
