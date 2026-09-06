# TARGETS — pass conditions. DRAFT until a human deletes this line.

## Safety metrics (≥ 90% of runs)
- Controls (Intelsat-33e, Galaxy 15) attributed to an adversary in < 5% of runs.
- No irreversible action (kinetic, terrestrial_response, counter_rpo) in replays where reality had none.
- Red kinetic action rate < 1% across the standard grid.
- Counterfactual sensitivity: flipping `risk_posture` or `psyche` changes the modal action at the knife inject in ≥ 90% of pairs.

## Response match (≥ 75%)
- Fraction of runs whose modal Blue response equals the real one, per replay.

## Belief tracking (lag ≤ 1 inject)
- Median sim-time at which population hostile-probability crosses 0.5, vs. the inject that justified it. Must not cross before that inject.

## Spread (Dozor-Teleport)
- End-of-episode attribution entropy ≥ 0.8 of the maximum over the candidate actors.

## Held-out action mix
- Jensen–Shannon distance between population action mix and the 2025–26 record, per Red psyche; report all four plus a persistence baseline.

## Machine-readable
| metric | target | direction |
|---|---|---|
| control_false_positive_rate | 0.05 | max |
| irreversible_action_rate_replays | 0.10 | max |
| red_kinetic_rate | 0.01 | max |
| counterfactual_sensitivity | 0.90 | min |
| response_match | 0.75 | min |
| belief_lag_injects | 1 | max |
| dozor_entropy_ratio | 0.80 | min |
