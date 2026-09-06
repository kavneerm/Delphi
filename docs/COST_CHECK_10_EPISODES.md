# Terra cost check — 10 episodes

Run date: 2026-09-05

Purpose: measure real provider token usage before full lake generation. This was
a sparse, sealed-checkpoint probe: each 72-hour episode woke each of the nine
seats once. It is a cost measurement, not part of the training lake.

## Episode manifest

| episode | seed | scenario id | clock | release policy | decisions | result |
|---:|---:|---|---|---|---:|---|
| 1 | 1 | `cost_check_1` | checkpoint / fixed / sealed | auto | 9 | completed |
| 2 | 2 | `cost_check_2` | checkpoint / fixed / sealed | auto | 9 | completed |
| 3 | 3 | `cost_check_3` | checkpoint / fixed / sealed | auto | 9 | completed |
| 4 | 4 | `cost_check_4` | checkpoint / fixed / sealed | auto | 9 | completed |
| 5 | 5 | `cost_check_5` | checkpoint / fixed / sealed | auto | 9 | completed |
| 6 | 6 | `cost_check_6` | checkpoint / fixed / sealed | auto | 9 | completed |
| 7 | 7 | `cost_check_7` | checkpoint / fixed / sealed | auto | 9 | completed |
| 8 | 8 | `cost_check_8` | checkpoint / fixed / sealed | auto | 9 | completed |
| 9 | 9 | `cost_check_9` | checkpoint / fixed / sealed | auto | 9 | completed |
| 10 | 10 | `cost_check_10` | checkpoint / fixed / sealed | auto | 9 | completed |

## Provider usage

| metric | total |
|---|---:|
| API calls / decisions | 90 |
| Prompt tokens | 1,421,936 |
| Cached prompt tokens | 1,027,120 |
| Output tokens | 52,159 |
| Hidden reasoning tokens | 6,313 |
| Schema retries | 0 |
| Transport retries | 0 |
| Failures | 0 |
| Mean latency | 6.07 seconds |
| Cache-hit rate | 72.23% |
| Observed Terra cost | $1.62 |

Model configuration: `gpt-5.6-terra`, flex tier, `reasoning.effort=low`.

The probe retained aggregate usage only; it intentionally did not write model
decisions to the lake or preserve reviewable decision text. The active full
generation run writes replayable logs and lake records after every completed
episode for the later 50-high / 50-low sample review.
