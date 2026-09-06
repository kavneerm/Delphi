# ui/data/

Playback material for the console. Everything here is **real engine output** —
there is no synthetic log generator in `ui/` any more.

| file | produced by |
|---|---|
| `run_seed1_continuous.jsonl` | `python -m engine.run --seed 1 --storm G5 --stubs --hours 72 --scenario g5_ambiguous_signature --clock continuous --out ui/data/run_seed1_continuous.jsonl --no-publish` |
| `run_seed7_human.jsonl` | `python -m engine.run --seed 7 --storm G4 --storm-profile may2024 --stubs --hours 72 --scenario g4_storm_only --clock checkpoint --schedule variable_tempo --release human --out ui/data/run_seed7_human.jsonl --no-publish` |

The third run in `runs.json` is `engine/samples/stub_run.jsonl`, which
`agent1-engine` publishes and owns; this directory does not copy it.

`run_seed1_continuous.jsonl` is deliberately **the same seed and scenario** as
`engine/samples/stub_run.jsonl`, which is checkpoint/adaptive. That pair is what
the Clock-compare view shows side by side: one seed, one spec set, two clocks.

`run_seed7_human.jsonl` runs under `release_policy: human`, so its
`release_granted` / `release_denied` lines carry `decided_by: "human"` (with a
few `"model"` where the timeout fell through). It is the run the human-seat panel
demonstrates against.

## Other files

* `assets.json` — the spacecraft catalogue, copied verbatim from
  `engine.world.initial_state()`. `tests/agent7-ui/test_assets_match_engine.py`
  fails if the engine changes an orbit and this file does not follow.
* `arctic.json` — coastlines and the ground segment. Hand-simplified for drawing;
  not survey data.
* `heatmap.csv`, `final_report.md` — placeholders so the Validation view has
  something to render before `agent6-eval` writes the real
  `validation/heatmap.csv` and `validation/final_report.md`. The UI prefers
  `validation/` and falls back to these; the view says which it is showing.
