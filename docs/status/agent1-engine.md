# agent1-engine
state: IN_PROGRESS
branch: agent1-engine
last_commit: 2733730
interfaces_ready: [engine/samples/stub_run.jsonl, engine.agent_api, engine.human_agent]
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
  - 2026-09-05 — human_agent.py, storm_check and the real calib loader landed. The human seat
    blocks act() on an external channel and the clock genuinely stops while it waits, because the
    engine is single-threaded and sim time is the event queue rather than the wall — so a
    human-played episode is still reproducible. Surprising and worth knowing: agent2-calib's
    storm_effects.csv is LONG format (profile, metric, asset_class, value + a citation per row),
    not the wide shape I had assumed, and the Kp/Dst series live in calib/series/ keyed on UTC
    timestamps. The loader now reads both, and anchors a recorded series on storm ONSET rather
    than the file's first sample — otherwise the May 2024 Kp 9 peak lands three days past the end
    of a 72-hour episode. Verified against agent2's committed files: may2024 loads clean with no
    TODO_CALIB left. Handoffs published for agent7-ui (stub_run.jsonl) and agent2-calib (columns).
    Next: finish the test suite, REPORT.md, then the env_lock gate.

