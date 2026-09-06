# agent1-engine
state: IN_PROGRESS
branch: agent1-engine
last_commit:
interfaces_ready: []
needs: [calib/storm_effects.csv, calib/attribution_lags.csv, specs/train/*.json]
awaiting_human:
updated: 2026-09-05
notes:
  - 2026-09-05 — read AGENTS.md, COORDINATION.md, agent_workstreams.md and all of contracts_v1
    (nine-seat fold, clock_mode, release_policy). Branch agent1-engine cut from main at 71a19d5.
    Starting the engine skeleton: contracts loader, deterministic RNG streams, env config.
