# Finisher decisions

## 1. env_lock — fix the low-Kp / high-density storm failure before generation

**Evidence:** after integrating the engine and calibrated attribution tables,
`python -m engine.storm_check --profile feb2022 --seeds 20` reports 0.0 tracking
hours and a median of 0 safe modes.  The cited calibration rows report 36 tracking
hours and 38 satellites lost.  The engine currently keys this outcome to Kp and
does not consume the calibrated density/drag terms.  Both 72-hour clock modes
replay byte-identically; 201 tests and the quarantine check pass.

**Recommendation:** do the bounded engine fix now (density/drag hazard plus
calibration-backed persistence, and interval-extremum Dst sampling), rerun the
two storm checks, then approve `env_v1`.  This should take about an hour and
avoids producing a lake under a storm model that makes moderate-Kp damage strong
evidence of hostility.

**Fast alternative:** approve the current implementation as `env_v1` and accept
the stated February mismatch.  That unblocks the 10-episode generation cost check
immediately, but results will be tied to the known limitation.

## 2. Holdout file admission before evaluation only

`agent2-calib` includes `calib/holdout_2025_2026.csv`; its committed hook refuses
to add or edit that frozen evaluation artifact without `ALLOW_HOLDOUT_EDIT=1`.
I did not bypass it.  The non-holdout calibration code, tables, citations and
tests are integrated.  Recommendation: admit the already-authored file unchanged
when evaluation is authorized, using the documented human override; it does not
block generation or training.
