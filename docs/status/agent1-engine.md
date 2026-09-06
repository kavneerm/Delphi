# agent1-engine
state: AWAITING_HUMAN: env_lock
branch: agent1-engine
last_commit: 36c55b0
interfaces_ready: [engine.agent_api, engine.human_agent, engine.run, engine.replay, engine.storm_check, engine/samples/stub_run.jsonl]
needs: [calib/storm_effects.csv and calib/series/ on main, calib/attribution_lags.csv, specs/train/*.json]
awaiting_human: env_lock — check the storm_check numbers against calib/storm_effects.csv, then freeze env_v1
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
    switch elsewhere cannot displace me again.
  - 2026-09-05 — human_agent.py, storm_check and the real calib loader landed. The human seat
    blocks act() on an external channel and the clock genuinely stops while it waits, because the
    engine is single-threaded and sim time is the event queue rather than the wall - so a
    human-played episode is still reproducible. Surprising and worth knowing: agent2-calib's
    storm_effects.csv is LONG format (profile, metric, asset_class, value + a citation per row),
    not the wide shape I had assumed, and the Kp/Dst series live in calib/series/ keyed on UTC
    timestamps. The loader now reads both, and anchors a recorded series on storm ONSET rather
    than the file's first sample - otherwise the May 2024 Kp 9 peak lands three days past the end
    of a 72-hour episode. Verified against agent2's committed files: may2024 loads clean with no
    TODO_CALIB left.
  - 2026-09-05 — test suite complete: 66 tests green. The ones that matter most are the leak
    guards in test_seats.py - no seat's filtered view may contain another seat's private_type, the
    hacktivist affiliation, the true storm state (as opposed to SWPC's forecast with this run's
    error), an undelivered message, an inject on a feed the seat does not have, or an inject's
    truthful/is_knife_inject scoring keys. Also asserted: both clock modes emit the same event
    types apart from `checkpoint`, no irreversible action lands without a granted release, and the
    three folded seat ids never reappear.
  - 2026-09-05 — DEFINITION OF DONE MET; STOPPING AT THE env_lock GATE. All four conditions pass:
    72h completes in both clock modes, replay reproduces each byte-identically, the published
    stub run demonstrates 112 release requests under release_policy auto (63 granted, 49 denied),
    and `python -m engine.storm_check --profile may2024` prints numbers. REPORT.md written.
    Handoffs published for agent7-ui (stub_run.jsonl), agent2-calib (CSV columns) and
    gen/train/selfplay/eval (engine.agent_api - stop mocking it). env_v1 is PROPOSED, not frozen:
    a row is in docs/VERSIONS.md marked NOT FROZEN. What the human needs to do at the gate is
    merge calib to main, rerun storm_check --profile may2024, compare peak Kp / minimum Dst /
    tracking and screening hours / safe-mode counts against the cited rows, and only then freeze.
    Against agent2's current committed CSV it already reports every field calibrated with no
    TODO_CALIB left. Also flagged, outside my directory: an agent0 test fixture spells a
    quarantined satellite in a form the pre-commit hook does not match - see docs/HANDOFFS.md.
