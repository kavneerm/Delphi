# agent2-calib — REPORT

**Branch** `agent2-calib` · **State** DONE (pending PR merge) · **Date** 2026-09-05

## What I built

The open counterspace record turned into five cited tables plus the series behind them.
Every row carries a URL and a page or section. Prose write-up in `calib/calibration.md`;
open judgement calls in `calib/QUESTIONS.md`.

| file | rows | consumer |
|---|---|---|
| `calib/red_action_rates.csv` | 30 | Gen (Red priors), `targets.md` red_kinetic_rate |
| `calib/attribution_lags.csv` | 5 | `engine/attacks.py` |
| `calib/attribution_incidents.csv` | 19 | the evidence the lags are fitted from |
| `calib/storm_effects.csv` | 32 | `engine/storm.py`, `engine/storm_check.py` |
| `calib/series/{kp,dst}_{may2024,feb2022}.csv` | 488 | the storm loader |
| `calib/holdout_2025_2026.csv` | 30 | `eval/holdout_mix.py` only — chmod 444 |
| `calib/fit_attribution_lags.py` | — | regenerates the lag parameters |
| `scripts/check_holdout_isolation.sh` | — | pre-commit hook: holdout stays in `eval/` |
| `tests/agent2-calib/test_calib_schema.py` | 17 tests | the column contract |

## How to run

```bash
python calib/fit_attribution_lags.py        # regenerate lag parameters from the incidents
pytest tests/agent2-calib -q                # 17 schema tests
python -m engine.storm_check --profile may2024   # end-to-end against the real tables
scripts/check_holdout_isolation.sh $(git ls-files)
```

## Sources

16 primary PDFs, text-extracted and page-indexed: SWF *Global Counterspace Capabilities*
2018–2024 and 2026, CSIS *Space Threat Assessment* 2018–2025. Plus GFZ (definitive Kp),
Kyoto WDC (hourly Dst), NOAA SWPC (G-scale), and the peer-reviewed storm literature.
Editions 2025 and 2026 were used **only** for the holdout table.

## Verified, not assumed

- `engine/attacks.py:load_attribution_lags()` reads the real file — checked directly.
- `engine/storm_check.py --profile may2024` reports "Every field is calibrated. Ready
  for the env_lock gate (TODO_CALIB absent)."
- Engine's full suite (66 tests) still passes with my tables in place; 79 with mine.
- The isolation hook was tested in both directions: clean on the tree, and failing on a
  probe that opens the holdout from `gen/`.

## What is untested or uncertain

1. **The attribution medians the engine uses are a modelling choice.** Measured
   ordering, chosen level — `QUESTIONS.md` Q1. Needs a human at `env_lock`.
2. **Two storm numbers disagree with the engine's own curve by 2–3×**
   (`tracking_degradation` 120 h vs 43 h, `screening_suspension` 72 h vs 34 h).
   Deliberately unreconciled; `storm_check` prints both. Settle at `env_lock`.
3. **`storm_check` draws ~40 safe modes for May 2024; the record documents 1.** The 40
   is the engine's population model, not a measurement — don't read it as one.
4. **Episode counts are floors.** One Russian EW row stands for ~10,000 incidents; two
   rows omit a quarantined incident each.
5. **Reporting bias is uncorrected.** Low rates for Iran and North Korea partly reflect
   how much attention the reports give them.
6. **n = 19 for attribution**, and dazzle has zero attributed cases anywhere.

## Quarantine check

Tables 1–3 exclude every incident in `docs/quarantine.md` and every 2025–26 event by
construction. `scripts/check_quarantine.sh` passes on every file I wrote. Two
`red_action_rates.csv` rows (Russian cyber, Russian RPO) are floors because a
quarantined incident was removed; both row notes say so. `holdout_2025_2026.csv` is
aggregate counts only — no incident is named — and is guarded by
`scripts/check_holdout_isolation.sh` against both reads outside `eval/` and any
modification. `chmod 444` is set as a convenience but does not survive a clone (git
stores the file `100644`), so the committed hook, not the file mode, is the protection.

## Handoffs made

- `docs/HANDOFFS.md`: storm + Red tables to Engine and Gen, with the full column contract.
- Correction filed for a stale Engine handoff that advertised a wide-format
  `storm_effects.csv`; Engine's code auto-detects the long format and works as shipped.

## Findings other agents should know

1. **Storm severity does not predict damage.** G5 May 2024 lost 0 satellites; G1
   February 2022 lost 38 with safe mode correctly entered. Don't scale harm off the
   G-scale alone (Engine).
2. **Capability and use are different axes.** Peresvet and Kalina are fielded with 0
   public uses; China has fielded ground-based lasers with 0 documented uses. Gate what
   Red *can* do on `capability_status`, how often on `events_per_year` (Gen).
3. **Attribution is bimodal by domain.** Kinetic is same-day and unambiguous; cyber has
   never once been attributed same-state and the fastest case took 72 days. Dazzle has
   never been publicly attributed at all. This ordering is what makes the lower rungs
   of the ladder attractive (Gen, Eval).
4. **North Korean EW jumps 7× between the training and holdout windows.** A population
   trained on 2018–2024 will under-predict it (Eval).
5. **`chmod 444` does not survive git.** The brief asked for the holdout to be
   write-protected by file mode; git stores only the executable bit, so a fresh clone
   or a rebase hands you a writable file. Verified directly. The durable protection is
   the committed pre-commit hook, which blocks both reading it outside `eval/` and
   modifying it at all. Anyone relying on the mode alone has no protection.
6. **Shared-checkout hazard, confirmed.** Twelve agents on one checkout: I ran
   `git reset --hard` in the primary directory and moved `agent4-train`'s branch
   pointer. Restored to `7603c89`, identical to origin, nothing lost. Work in
   `Panoptes-<agent>/`, and scope `git add` to your own paths.
