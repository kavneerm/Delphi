# Svalbard Commercial-LEO Blackout Wargame

Real-time, event-driven counterspace crisis simulation with a fine-tuned population of adversary, allied, commercial, and non-state personas. DNHacks 2026, Defense track.

**Agents: read `AGENTS.md` first.** Humans: `docs/execution_plan_v2.md` is the schedule, `docs/COORDINATION.md` is the protocol, `docs/REPO_SETUP.md` is how to launch.

## Layout
```
AGENTS.md        agent rules (Codex reads this in every worktree)
.superset/       workspace setup/run scripts
contracts/       frozen interfaces — humans only
docs/            plan, brief, prompts, coordination, status board, templates, quarantine
specs/           persona specs: train/ holdout/ exemplars/ devset/; drafts/ is agent output
calib/           calibration tables with citations; holdout_2025_2026.csv is eval-only
engine/          real-time event loop, world, storm, attacks, seats, log, stubs
gen/             frontier-model trajectory generation + judge
train/           filter, LoRA sweep, DPO, serve, gates, devset
selfplay/        round-2 generation from the fine-tuned model
eval/            replays (eval-only), runners, final report
ui/              demo front end (plays back logs)
infra/           AWS provisioning
pitch/           narrative, one-pager, answers
tests/
```
## Environment
`OPENAI_API_KEY`, `WARGAME_BUCKET`, `GEN_MODEL` (default `gpt-6-astra`, fallback `gpt-5.5`), AWS via CLI profile. Copy `.env.example` to `.env` at the repo root; `.superset/setup.sh` copies it into each worktree.
