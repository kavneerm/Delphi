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

## 3. Generation cost preflight — approval required before 3,960 live calls

`python -m gen.cost_check` made no API call. For ten representative 72-hour
checkpoint episodes (396 decisions each), it estimates 3,960 calls, 3,500 prompt
tokens/call, and reserves 4,096 completion plus 4,096 hidden-reasoning tokens/call.
At the currently configured conservative rates this caps the live check at
**$341.73**. The live checker will report provider-observed reasoning tokens.

**Recommendation:** approve the live ten-episode cost check only after
`GEN_MODEL` is explicitly present in the execution environment; then use its
observed token report to decide the full lake size. No large run should start
until that report is reviewed.
