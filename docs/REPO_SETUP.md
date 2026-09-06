# REPO_SETUP — where everything goes and how to launch

## 1. Create the repo (5 min)
```
mkdir svalbard-wargame && cd svalbard-wargame && git init -b main
cp -r /path/to/repo_scaffold/repo/. .        # this folder mirrors the repo root
cp .env.example .env                          # fill in OPENAI_API_KEY, WARGAME_BUCKET, GEN_MODEL
git add -A && git commit -m "[human] scaffold: docs, contracts drafts, coordination protocol"
git remote add origin <github-remote> && git push -u origin main
```
Superset needs a remote for PRs. Set `WARGAME_BUCKET` before Agent 8 runs.

## 2. Open in Superset (2 min)
Add the repo as a project. `.superset/config.json` is committed, so every workspace runs `setup.sh` (venv, deps, copies `.env`). Enable **Settings → Experimental → Wait for workspace setup before starting agents**.

## 3. Launch order
1. **Agent 0** — workspace on branch `agent0-contracts`, agent = Codex, prompt = PREAMBLE + AGENT 0 block from `docs/superset_launch_prompts.md`. It finalizes the JSON schemas; `targets.md` and `seats.md` are already drafted here. Review its PR, delete the `DRAFT` lines from every contract file when you approve, merge.
2. **Wave 1** — create nine workspaces at once: `agent1-engine`, `agent2-calib`, `agent3-gen`, `agent4-train`, `agent7-ui`, `agent8-infra`, `agent9-specs`, `agent10-replays`, `agent11-pitch`. Paste PREAMBLE + the matching block into each.
3. **Wave 2** — `agent6-eval` can be created now (it builds on stubs and only *runs* when you trigger it). `agent5-selfplay` when `candidate_final` exists.
4. **Optional coordinator** — one more workspace running Claude Code or Codex with the `superset:orchestrate` skill: "Read docs/COORDINATION.md. Every 15 minutes: fetch, read docs/status/*.md and docs/HANDOFFS.md, relay new handoffs to dependent agents' terminals, and tell me when any agent reports BLOCKED or AWAITING_HUMAN. Do not merge PRs." Branch names: `agentN-name` exactly; the status board keys on them.

## 4. Your loop while agents run
- Sidebar shows which agents need attention; `docs/status/` shows the board.
- Merge PRs in the order in `docs/COORDINATION.md` §4.
- Answer `QUESTIONS.md` under `## Answer`, push. Agents pick it up on their next sync.
- Human gates in order: env_lock → cost_check → sample_review → candidate_final → eval_trigger.

## 5. File placement (this folder mirrors the repo root)
| file | goes to | who edits after launch |
|---|---|---|
| AGENTS.md, README.md, .gitignore, .env.example | repo root | humans |
| .superset/config.json, setup.sh, run.sh | .superset/ | humans |
| docs/project_brief.md, execution_plan_v2.md, agent_workstreams.md, superset_launch_prompts.md | docs/ | humans |
| docs/COORDINATION.md, REPO_SETUP.md | docs/ | humans |
| docs/HANDOFFS.md, VERSIONS.md | docs/ | any agent, append-only |
| docs/quarantine.md | docs/ | nobody |
| docs/status/*.md | docs/status/ | each agent, own file only |
| docs/templates/*.md | docs/templates/ | nobody |
| contracts/targets.md, seats.md | contracts/ | Agent 0 once, then humans |
| contracts/*.json, s3_layout.md | contracts/ | Agent 0 creates; then humans |
| engine/ gen/ train/ selfplay/ eval/ ui/ infra/ pitch/ calib/ specs/drafts/ | as named | the owning agent |
| specs/train|holdout|exemplars|devset/ | specs/ | humans move approved drafts in |
| eval/replays/ | eval/ | humans move approved drafts in |
