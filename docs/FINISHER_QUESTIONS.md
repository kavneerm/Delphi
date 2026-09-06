# Finisher decisions

## 1. RESOLVED — env_lock

**Evidence:** after integrating the engine and calibrated attribution tables,
the prior check reported 0.0 tracking hours and a median of 0 safe modes.
The fix now consumes calibrated density/drag terms and calibration-backed
persistence. The February rerun reports 36.0 tracking hours and a median of 28
safe modes; the May rerun clips its cited operational windows to the 72-hour
episode. Both clock modes replay byte-identically; 202 tests and quarantine pass.

The user approved the fix; `env_v1` is frozen and generation may proceed to its
required 10-episode cost check.

## 2. Holdout file admission before evaluation only

`agent2-calib` includes `calib/holdout_2025_2026.csv`; its committed hook refuses
to add or edit that frozen evaluation artifact without `ALLOW_HOLDOUT_EDIT=1`.
I did not bypass it.  The non-holdout calibration code, tables, citations and
tests are integrated.  Recommendation: admit the already-authored file unchanged
when evaluation is authorized, using the documented human override; it does not
block generation or training.
