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

## 3. RESOLVED — Generation cost check

`python -m gen.cost_check` made no API call. For ten representative 72-hour
checkpoint episodes (396 decisions each), it estimates 3,960 calls, 3,500 prompt
tokens/call, and reserves 4,096 completion plus 4,096 hidden-reasoning tokens/call.
At the currently configured conservative rates this caps the live check at
**$341.73**. The live checker will report provider-observed reasoning tokens.

The user approved Terra and the live ten-episode check completed under
`GEN_MODEL=gpt-5.6-terra`, low reasoning effort and flex tier. It made 90 calls
(one sealed decision for each of nine seats per episode): 1,421,936 prompt tokens,
1,027,120 cached prompt tokens, 52,159 output tokens, and 6,313 provider-reported
reasoning tokens; there were zero failures, zero schema retries, and zero transport
retries. At $2/M uncached input, $0.20/M cached input, and $12/M output, observed
cost was **$1.62**.

**Recommendation:** retain Terra for quality-sensitive generation and judging.
The next gate is `sample_review`; do not launch a full lake until the human approves
the episode/sample count and reviewed outputs.

## 4. RESOLVED — initial lake budget

The human approved an initial generation ceiling of **$1,500**. The prior 130-episode
proposal is not conservative enough: without prompt caching it projects to $1,985.
The run is therefore capped at 36 continuous-clock episodes (about 36,288 decisions),
which meets the 30–50k workstream target and projects to $1,398 without cache using
the observed live Terra token mix. The runner limits concurrency to eight and writes
each completed episode with full provenance before starting the next.
