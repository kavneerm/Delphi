# COORDINATION.md — how parallel agents stay in sync

Superset gives each agent its own git worktree and branch. Nothing crosses between worktrees automatically — not files, not env vars, not another agent's progress. Everything crosses through **git** and through **markdown on `main`**. This is the protocol.

## 1. Status board — `docs/status/`
One file per agent (`docs/status/agent1-engine.md`, …), pre-created from `docs/templates/STATUS_TEMPLATE.md`. Fields: `state` (NOT_STARTED | IN_PROGRESS | BLOCKED | AWAITING_HUMAN | DONE), `branch`, `last_commit`, `interfaces_ready`, `needs`, `updated`, `notes`.

- Update your own file at every milestone and every 15–20 minutes while running.
- Your status file is the **only** file you may edit outside your own directory.
- Commit status changes on their own: `[agent1-engine] status: IN_PROGRESS — loop + replay done`.

## 2. Sync cadence
Before starting and every 30–45 minutes:
```
git fetch origin
git rebase origin/main
```
This pulls in approved contracts, other agents' merged interfaces, answered questions, and the status board. If the rebase conflicts on a file outside your directory, you edited something you shouldn't — take `origin/main`'s version. Inside your directory, resolve and continue.

After each sync, read `docs/status/*.md` and `docs/HANDOFFS.md`. If an interface you depend on is listed as ready, replace your mock with the real import.

## 3. Interfaces and mocks — never wait
Every cross-agent dependency is either a **contract** (`contracts/`) or a **published interface** named in a status file. Until the real one is on `main`, code against a mock that satisfies the contract:
- `engine/agent_api.py` — Gen, Train, Eval mock it until `agent1-engine` lists `agent_api` under `interfaces_ready`.
- `calib/*.csv` — Engine and Gen ship placeholder values marked `TODO_CALIB` until `agent2-calib` is DONE.
- `contracts/event_log_schema.json` — UI generates stub logs from the schema until Engine publishes `engine/samples/stub_run.jsonl`.
- `train/serve.py` — Selfplay and Eval mock the served endpoint until `agent4-train` publishes it.

Mock, proceed, swap later. An agent idle on a dependency is the one failure mode this protocol exists to prevent.

## 4. Merging to `main`
- One PR per agent per milestone, titled `[agentN-name] <summary>`. Small PRs merge faster and conflict less.
- A human merges (or the coordinator agent, if one is running with merge rights — by default it does not).
- Merge order when several are ready: contracts → engine → calib → gen → train → selfplay → eval. UI, infra, pitch, specs drafts, and replay drafts touch nothing shared and can merge any time.
- After your PR merges, rebase again so your worktree matches `main`.

## 5. Handoffs
When your work unblocks another agent, do all three:
1. Add the interface to `interfaces_ready` in your status file.
2. Append one line to `docs/HANDOFFS.md`: `2026-09-05 19:40 agent1-engine → agent3-gen: agent_api merged in a1b2c3d; import engine.agent_api.Agent`.
3. Mention it in your `COMPLETE:` / `PROGRESS:` line. A coordinator agent (if running) relays it to the dependent agent's terminal with `superset terminals send`; otherwise a human does.

## 6. Reports and questions
- `<your-dir>/REPORT.md` when done — template in `docs/templates/`. What you built, how to run it, versions produced, what's untested, quarantine check, handoffs made.
- `<your-dir>/QUESTIONS.md` when blocked on a decision — one question per heading with your recommendation and what you did meanwhile. Humans answer under `## Answer` and push; you pick it up on your next sync.

## 7. Structured end-of-turn lines
End every turn with exactly one of these so a coordinator can parse it:
```
COMPLETE: <agentN-name> | branch=<b> | commit=<h> | pr=<url|none> | interfaces_ready=<list> | notes=<one line>
BLOCKED:  <agentN-name> | branch=<b> | commit=<h> | needs=<what> | see=<path>/QUESTIONS.md
PROGRESS: <agentN-name> | branch=<b> | commit=<h> | next=<one line>
AWAITING_HUMAN: <agentN-name> | gate=<env_lock|cost_check|sample_review|candidate_final|eval_trigger> | see=<path>
```

## 8. Versioning
Any change to a config that feeds generation, training, or evaluation bumps a version string and gets a row in `docs/VERSIONS.md`: `env_vN`, `spec_vN`, `lake_vN`, `filter_vN`, `judge_vN`. Every S3 object and every results table carries the versions it was produced under. A result without versions is not a result.

## 9. Human gates — agents stop here
| gate | who waits | what the human checks |
|---|---|---|
| env_lock | agent1-engine | storm check numbers vs. `calib/storm_effects.csv`; then bump `env_v1` |
| cost_check | agent3-gen | `gen/cost_check` output; touch `gen/APPROVED` |
| sample_review | agent3-gen → agent4-train | the 50/50 markdown; re-judge if fooled |
| candidate_final | agent4-train | `train/summary.md`; mark the checkpoint |
| eval_trigger | agent6-eval | run `eval/report.py --human-approved` exactly once |

## 10. Things that go wrong, and the fix
- Two agents edit the same file → one of them is outside its directory; revert that one.
- An agent "helpfully" edits a contract → reject the PR; the change goes through QUESTIONS.md.
- Results can't be reproduced → a version string was missing; find it in `VERSIONS.md` or the run is discarded.
- An agent idles waiting for another → it should have mocked; tell it to read §3.
- A quarantined incident shows up in an exemplar → remove, flag in REPORT.md, note in HANDOFFS.md so Gen re-checks the lake.
