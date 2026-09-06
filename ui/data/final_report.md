# PLACEHOLDER — validation report

`agent6-eval` has not run yet. `eval/report.py` refuses to run without
`--checkpoint <id> --human-approved`, and refuses a second run if
`validation/final_report.md` already exists — so this file is deliberately in
`ui/data/`, not in `validation/`, and the console labels it as a placeholder.

This file exists so the Validation view can be built and demonstrated before the
real numbers exist. **Every value below is a zero or a dash.** Nothing here is a
result.

## Replay table

| replay | attributed by | truth | irreversible actions | verdict |
|---|---|---|---|---|
| replay_1 | — | — | 0 | — |
| replay_2 | — | — | 0 | — |
| replay_3 | — | — | 0 | — |
| replay_4 | — | — | 0 | — |
| control_1 | — | no adversary | 0 | — |
| control_2 | — | no adversary | 0 | — |

## Targets

| metric | target | observed | verdict |
|---|---|---|---|
| `control_false_positive_rate` | — | 0.000 | — |
| `red_kinetic_rate` | < 1% | 0.000 | — |
| `irreversible_action_rate_replays` | — | 0.000 | — |
| held-out action mix distance | — | — | — |
| perturbation delta | — | — | — |

## What the real report will carry

Per `docs/superset_launch_prompts.md`, `eval/report.py` produces this file plus
`validation/heatmap.csv` and PNGs, from `replay_table.py`, `holdout_mix.py`,
`perturb.py` and `baseline_prompted.py`. When it lands in `validation/`, the
console picks it up with no code change and the "PLACEHOLDER" label turns into
`reading validation/final_report.md`.
