# agent2-calib
state: DONE
branch: agent2-calib
last_commit:
interfaces_ready: [calib/red_action_rates.csv, calib/attribution_lags.csv, calib/attribution_incidents.csv, calib/storm_effects.csv, calib/series/, calib/holdout_2025_2026.csv (eval only), calib/calibration.md]
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
  2026-09-05 — DONE. holdout_2025_2026.csv (30 rows, same grid and columns as
  red_action_rates.csv, window disjoint at 2025-01-01), chmod 444, plus
  scripts/check_holdout_isolation.sh wired into pre-commit — it fails any commit where
  source outside eval/ names the file, verified in both directions. calibration.md and
  REPORT.md written. Ran engine/storm_check.py against the real tables end to end:
  "Every field is calibrated. Ready for the env_lock gate." Two things need a human at
  env_lock, both written up: the attribution median LEVEL is my modelling choice
  (QUESTIONS.md Q1), and my cited tracking/screening hours for May 2024 disagree with
  the engine's curve-derived figures by 2-3x — storm_check prints both rather than
  reconciling them. Biggest holdout signal: North Korean EW goes 0.143/yr -> 1.0/yr.
