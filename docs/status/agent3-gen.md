# agent3-gen
state: IN_PROGRESS
branch: agent3-gen
last_commit: a10ddfe
interfaces_ready: []
needs: [engine.agent_api (agent1-engine), specs/train + specs/exemplars (humans/agent9-specs), calib/attribution_lags.csv + storm_effects.csv (agent2-calib)]
awaiting_human:
updated: 2026-09-05
notes: |
  2026-09-05 21:40 — Read AGENTS.md, COORDINATION.md, workstreams, and all of contracts/.
  Starting gen/ scaffold: contracts loader + strict-mode projection of the decision schema,
  a contract-faithful mock of engine.agent_api, prompt assembly, async OpenAI client.
  Surprising: the primary worktree /Users/kavneerm/Desktop/Panoptes is checked out on
  agent2-calib and that agent is live in it, so I made my own worktree at
  ../Panoptes-agent3-gen rather than clobber its checkout. Also: OpenAI structured
  outputs run in strict mode, which rejects most of the keywords action_schema.json uses
  (oneOf, if/then, pattern, min/max, propertyNames, additionalProperties:true). Plan is a
  generated strict projection for the API plus validation of every completion against the
  real contract schema, with retry on failure — the projection is never the source of truth.
  2026-09-05 22:00 — Landed gen/config, gen/version, gen/contracts (registry + ladder +
  strict-mode projection of the decision schema), gen/quarantine (runtime prompt guard),
  gen/storage (S3 + local mirror, all version tags), gen/engine_api (the agent1 seam),
  gen/placeholder_specs (18 schema-valid TODO_SPECS personas, 2 temperaments x 9 seats).
  Next: synthetic scenario builder, the mock engine episode loop, prompt assembly.
  Surprising: gen/quarantine.py parses its pattern list out of scripts/check_quarantine.sh
  at runtime rather than holding a copy — a copy in a .py file would fail the very
  pre-commit hook it exists to reinforce.
  2026-09-05 22:25 — gen/specs.py (pool loader, counterfactual arm builder, hard
  HoldoutAccessError in front of specs/holdout/), gen/scenario.py (TODO_SCENARIO synthetic
  72h timelines from a grid cell, contract-valid injects, one is_knife_inject), and
  gen/mock_engine.py: deterministic priority-queue loop, both clock_modes, sealed
  checkpoints, release_policy auto, per-channel message delay + clearance drops, placeholder
  utility. Smoke run: 380 decisions across 9 seats in a 72h G5 episode, no ground-truth leak
  into any filtered_state (asserted). Surprising: episode_id is capped at 64 chars, and the
  obvious readable scenario_id spelled out from the seven grid dimensions was 67 on its own —
  scenario ids are now abbreviated (g5_ihi_auc_rvn_cr0_shr_ir1) with the full coordinates
  kept on every record's grid_cell. Next: gen/prompt.py, gen/llm.py, gen/agent.py.
  2026-09-05 22:50 — S3 went live, so I checked the storage layer I had written blind
  against it instead of trusting it. Round-trip on s3://svalbard-wargame (us-east-1) passes
  first try: all nine metadata keys survive head_object, empty-string values included,
  Tagging project=svalbard applies (IAM has PutObjectTagging), and application/x-ndjson
  survives for JSONL. All six contract prefixes exist and are empty — no real specs yet.
  Surprising and worth fixing: the bucket has versioning ENABLED with a 30-day
  noncurrent expiry. A plain delete of a transient lake/_parts/ object leaves both a
  noncurrent version and a delete marker, so ~50k decisions would have left ~100k dead
  objects behind. Store now records the VersionId it wrote and discard() deletes that
  exact version — verified to leave zero versions and zero delete markers. Writes are
  also offloaded with asyncio.to_thread so 64 in-flight episodes are not serialised
  behind a blocking socket. Then landed gen/prompt.py: universal block (brief, full
  ladder, output contract, exemplars) then persona then variable suffix, in that order
  because prompt caching keys on the longest common prefix — reordering the blocks barely
  changes the output and changes the bill a lot. 8.8k chars universal + 2.2k persona
  cacheable against 3.4k variable. Leakage guard refuses ground-truth keys in any
  filtered_state before the prompt is built. Next: gen/llm.py, gen/agent.py.
