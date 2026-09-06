# agent3-gen
state: IN_PROGRESS
branch: agent3-gen
last_commit: 7d26315
interfaces_ready: []
needs: [specs/train + specs/exemplars (humans/agent9-specs), calib/attribution_lags.csv (agent2-calib)]
awaiting_human:
updated: 2026-09-06
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
  2026-09-06 00:10 — Rebased onto main; engine.agent_api, infra.storage and calib all
  landed, so the mocks come out. Read the real interfaces before touching anything and
  found three things that change my design:
  (1) engine.agent_api.Agent.act(view) is SYNCHRONOUS and Episode.run() is synchronous,
  while generation is async at concurrency 64. Plan: run each Episode in a worker thread
  and have the agent's sync act() bridge back to the one event loop, so N episodes block
  in threads while their API calls multiplex under a single semaphore.
  (2) engine.episode.Episode.decision_records already holds decision_id, seat, sim_time_s,
  filtered_state, injects_seen, messages_seen, output and schema_errors — agent1 built it
  for me explicitly, so gen/run.py re-derives nothing.
  (3) PREFIX HAZARD found for agent4 and written to HANDOFFS: s3_layout puts _judge/ inside
  the same lake/<lake_v>/ prefix as the base records and both are .jsonl, so
  train/filter.py:read_lake reading lake/lake_v1/ would read every decision twice, once
  unjudged and once scored. Benign under require_judged: true, silently doubles judged
  weight under false. Told agent4 to point at lake/lake_v1/_judge/judge_v1/, and gen/judge.py
  will write complete lake records there so that prefix stands alone.
  Also noted: infra.storage has no delete and does not return the VersionId, so my
  versioned-cleanup fix for transient _parts/ objects cannot go through it — raising in
  gen/QUESTIONS.md rather than editing another agent's file.
  Next: delete gen/mock_engine, gen/engine_api, gen/placeholder_specs, gen/scenario,
  gen/storage; rewrite gen/prompt against the real view; write gen/agent.py.
  2026-09-06 00:35 — Mocks deleted: gen/mock_engine, gen/engine_api, gen/placeholder_specs,
  gen/scenario, gen/storage are gone (~1500 lines). Replaced by gen/keys.py (the s3_layout
  key templates plus is_record_key/is_judged_key, which is what the agent4 hazard needs),
  gen/specs.py rewritten on engine.specs.load_pool with the holdout guard and the
  counterfactual arm builder kept, and gen/exemplars.py.
  Read agent9-specs before writing the exemplar loader and it changed the design: the bank
  is 10 structured JSON cards against their own exemplar_card_schema.json, not the .md files
  s3_layout implies, and each card carries analogous_seats "used to select cards per seat
  when the prefix budget is tight" — they built it for gen/prompt.py deliberately. Loader
  tested against their real petrov_1983 and starlink_ukraine cards. Keeping all cards in the
  universal block by default so the prefix stays byte-identical across all nine seats and the
  whole run shares one cache entry; per-seat selection is a flag, because it trades that cache
  sharing for a shorter prompt. Ten cards is ~8k tokens of prefix, which is the single biggest
  line in the cost check — measuring both ways there rather than guessing now.
  agent9 is AWAITING_HUMAN on promoting specs/drafts/ into specs/train|exemplars|devset
  (`python specs/drafts/promote.py --all`); until that lands, engine.specs falls back to nine
  placeholder specs and the full run stays blocked on real personas by design.
