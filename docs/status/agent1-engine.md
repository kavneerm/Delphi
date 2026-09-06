# agent1-engine
state: IN_PROGRESS
branch: agent1-engine
last_commit: 2bb8372
interfaces_ready: []
needs: [calib/storm_effects.csv, calib/attribution_lags.csv, specs/train/*.json]
awaiting_human:
updated: 2026-09-05
notes:
  - 2026-09-05 — read AGENTS.md, COORDINATION.md, agent_workstreams.md and all of contracts_v1
    (nine-seat fold, clock_mode, release_policy). Branch agent1-engine cut from main at 71a19d5.
    Starting the engine skeleton: contracts loader, deterministic RNG streams, env config.
  - 2026-09-05 — loop/orbits/world/storm/attacks landed. Sim time is an INTEGER second quantised
    onto tick_s and ties break by (priority, insertion seq), which is what buys exact replay;
    events carry data not closures so snapshot()/fork() can round-trip a queue. Storm and attack
    numbers fall back to placeholder curves tagged TODO_CALIB when calib/ is absent, and the
    columns the engine reads are documented at the top of engine/storm.py and engine/attacks.py
    for agent2-calib.
  - 2026-09-05 — FULL EPISODE RUNS AND REPLAYS EXACTLY. `python -m engine.run --seed 1 --storm G5
    --stubs --hours 72` completes in ~6s (8142 log lines, 980 decisions) and `python -m
    engine.replay <log>` reproduces it byte-identically except wall_time. Checkpoint mode works on
    all three schedule types (fixed / variable_tempo / adaptive). Surprise worth flagging - the
    twelve agents are sharing ONE git checkout and one HEAD, not a worktree each: another agent
    checked out its branch mid-session and my two commits (4b36e68, 8acabb8) ended up on the
    branch that happened to be current. Content is intact and now rebuilt on agent1-engine as
    2bb8372, and I have moved to a dedicated worktree at ../Panoptes-agent1-engine so a branch
    switch elsewhere cannot displace me again. Next: samples/stub_run.jsonl + handoff for UI,
    human_agent.py, storm_check, tests.
