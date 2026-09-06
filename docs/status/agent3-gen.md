# agent3-gen
state: IN_PROGRESS
branch: agent3-gen
last_commit:
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
