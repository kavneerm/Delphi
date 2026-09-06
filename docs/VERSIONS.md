# VERSIONS
| version | what | commit | set by | when | note |
|---|---|---|---|---|---|
| env_v0 | placeholder storm/attack curves | — | scaffold | — | replaced by env_v1 at env_lock |
| contracts_v1 | frozen interfaces: spec/action/event_log/inject/lake_record/env_config schemas, s3_layout, seats | 7e00826 | agent0-contracts | 2026-09-05 | 77 tests green; DRAFT markers removed by a human at merge |
| contracts_v1 (rev) | nine-seat fold: nato/ksat/hacktivist folded; nsc human-playable; env_config adds clock_mode + release_policy; 5 new event types | 7660c65 | agent0-contracts | 2026-09-05 | human scope change, applied before merge and before any consumer, so a revision of v1 rather than a v2 |
| env_v1 (proposed) | engine, storm curves, attack parameters, engine_params defaults; 72-hour episode, both clock modes, both release policies | 1569ee0 | agent1-engine | 2026-09-05 | NOT FROZEN. Awaiting the env_lock human gate: run `python -m engine.storm_check --profile may2024` against a merged calib/storm_effects.csv and check the numbers before freezing. Until then the engine falls back to placeholder curves tagged TODO_CALIB and says so. |
