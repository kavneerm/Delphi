# agent2-calib
state: IN_PROGRESS
branch: agent2-calib
last_commit:
interfaces_ready: []
needs: []
awaiting_human:
updated: 2026-09-05
notes:
  2026-09-05 — Read AGENTS.md, COORDINATION.md, workstreams, quarantine, contracts
  (env_config_schema storm block, action_schema attack rungs, targets.md). Branch
  agent2-calib created. Now: sourcing SWF Global Counterspace 2018-2024 and CSIS Space
  Threat Assessment 2018-2024 for red_action_rates.csv.
  2026-09-05 — attribution_lags.csv + attribution_incidents.csv landed. No published
  dataset gives effect-to-attribution lags, so I built the evidence table first: 19
  non-quarantined incidents 2007-2024, each with effect date, attribution date, attributing
  party, attribution strength and a cited page; 1 right-censored. Fitted lognormals per
  attack type. The fit surfaced a real conflict: measured PUBLIC attribution medians are 74
  days (jam) and 747 days (ground_cyber), which inside a 72-hour episode means 3.4% and 0%
  ever attributed — targets.md belief_lag_injects and response_match would be unreachable.
  So the file carries both regimes: Engine reads first-indication medians (1/6/18/96/240 h
  for kinetic/rpo/jam/dazzle/ground_cyber) while the measured public figures sit beside them
  in their own columns for Eval. sigma is fitted from the incidents; the median LEVEL is my
  modelling choice and needs a human at env_lock — written up as calib/QUESTIONS.md Q1.
  Verified engine/attacks.py load_attribution_lags() reads the real file; all 66 engine
  tests still pass. Dazzle has no publicly attributed case anywhere in the record.
