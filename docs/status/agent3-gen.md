# agent3-gen
state: IN_PROGRESS
branch: agent3-gen
last_commit: 8a9ec9d
interfaces_ready: []
needs: [engine.agent_api (agent1-engine), specs/train + specs/exemplars (humans/agent9-specs), calib/* (agent2-calib)]
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
