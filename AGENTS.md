# AGENTS.md — read this first

You are one of ~12 parallel coding agents (Codex, via Superset) building a real-time counterspace wargame for a hackathon due **Sunday 12:00 p.m.** Each agent works in its own git worktree on its own branch. You integrate through `main` only, via the protocol in `docs/COORDINATION.md`.

## Order of reading
1. This file.
2. `docs/COORDINATION.md` — how to sync, report, and hand off.
3. `docs/execution_plan_v2.md` and `docs/agent_workstreams.md` — the plan and your workstream.
4. `docs/superset_launch_prompts.md` — your specific brief (find your agent number).
5. Everything in `contracts/` — frozen interfaces. If a contract file contains the word `DRAFT`, it is not yet approved: read it, code against it, but expect it to change until a human removes the word. If `contracts/` has no JSON schemas at all, stop and report.

## Hard rules
- **Never edit** `contracts/`, `calib/holdout_2025_2026.csv`, `eval/replays/`, or `docs/quarantine.md`. Propose changes in `<your-dir>/QUESTIONS.md`; a human merges them.
- **Quarantine**: the incidents in `docs/quarantine.md` must not appear in specs, exemplars, prompts, or training data. If you find one, remove it and flag it in `REPORT.md`.
- Work only inside your workstream's directory (plus `tests/<your-dir>/`) and your own `docs/status/<agent>.md`. Do not touch other agents' directories.
- Python 3.12, type hints, `pyproject.toml`, `ruff` clean, `pytest`. No notebooks.
- Secrets from env only (`OPENAI_API_KEY`, `WARGAME_BUCKET`, `GEN_MODEL`, AWS via CLI profile). Never write keys to disk or commit `.env`.
- Every S3 object carries `env_version`, `spec_version`, `lake_version`, `seed` per `contracts/s3_layout.md`.
- Commit small and often; message prefix `[agentN-name]`. Push your branch after every meaningful milestone.
- Never work on `main`. Never force-push. Never merge your own PR.

## What "done" means
1. Your definition-of-done in `docs/agent_workstreams.md` is met and tests pass.
2. `<your-dir>/REPORT.md` exists (use `docs/templates/REPORT_TEMPLATE.md`).
3. `docs/status/<agentN-name>.md` says `DONE` with branch and commit hash.
4. You have pushed and opened a PR to `main` titled `[agentN-name] <summary>`.
5. You end your turn with the structured `COMPLETE:` line from `docs/COORDINATION.md` §7.

If blocked: write `<your-dir>/QUESTIONS.md`, set status to `BLOCKED`, push, end your turn with the `BLOCKED:` line. If you reach a human gate: set status to `AWAITING_HUMAN: <gate>` and end your turn.
