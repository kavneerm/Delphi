#!/usr/bin/env bash
#
# Fail a commit that puts quarantined material where it does not belong.
#
# docs/quarantine.md lists incidents reserved for final validation: they must never
# appear in specs, exemplars, prompts, engine code or training data, because every
# one of those paths eventually reaches a model. The subtle version of this leak is
# a JSON Schema `description` string — structured-output calls send description text
# to the model, so a quarantined name in contracts/*.json is a quarantined name in
# every generation prompt.
#
# Usage:
#   scripts/check_quarantine.sh [files...]   # defaults to the staged files
#
# Called by the `quarantine-grep` pre-commit hook, which passes staged filenames.

set -uo pipefail

# --- the quarantined strings, matched case-insensitively ---------------------
PATTERNS=(
  'Kosmos-2558'
  'Kosmos 2558'
  'USA 326'
  'KA-SAT'
  'AcidRain'
  'Dozor'
  'Balticconnector'
  'Newnew Polar Bear'
  'Intelsat-33e'
  'Intelsat 33e'
  'Galaxy 15'
)

# --- where the material is allowed to live -----------------------------------
# The first four are the quarantine itself and the code that runs against it.
# The last two are human-authored planning and scoring documents that name the
# incidents by design and are never sent to a model:
#   contracts/targets.md  names the controls and the replays as pass conditions
#   docs/                 the plan, the workstreams, the launch prompts, the status board
is_exempt() {
  case "$1" in
    docs/*|eval/*|calib/holdout_2025_2026.csv|scripts/check_quarantine.sh|contracts/targets.md)
      return 0 ;;
    *)
      return 1 ;;
  esac
}

# --- the files to check ------------------------------------------------------
files=()
if [ "$#" -gt 0 ]; then
  files=("$@")
else
  # bash 3.2 (the macOS default) has no mapfile, so read the list the long way.
  while IFS= read -r line; do
    [ -n "$line" ] && files+=("$line")
  done < <(git diff --cached --name-only --diff-filter=ACMR)
fi

[ "${#files[@]}" -eq 0 ] && exit 0

grep_args=()
for pattern in "${PATTERNS[@]}"; do
  grep_args+=(-e "$pattern")
done

status=0
for file in "${files[@]}"; do
  [ -f "$file" ] || continue
  is_exempt "$file" && continue

  # -I skips binary files, -n gives the line number, -i is the case-insensitive match.
  while IFS= read -r hit; do
    if [ "$status" -eq 0 ]; then
      echo "quarantined material found — see docs/quarantine.md" >&2
      echo >&2
    fi
    echo "  ${file}:${hit}" >&2
    status=1
  done < <(grep -Iin "${grep_args[@]}" -- "$file" 2>/dev/null)
done

if [ "$status" -ne 0 ]; then
  cat >&2 <<'MSG'

These incidents are reserved for final validation (Agent 6, run once). They must not
appear in specs, exemplars, prompts, engine code or training data.

Remove the reference and note it in your REPORT.md. If the file legitimately needs to
name them — a scoring document, not something a model will ever read — that is a
contract change: propose the exemption in your QUESTIONS.md rather than editing the
exemption list here.
MSG
fi

exit "$status"
