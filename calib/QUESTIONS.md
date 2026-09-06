# agent2-calib — questions

## Q1. `attribution_lags.csv` reports two regimes. The engine uses the derived one.

**The problem.** The public record measures one thing: the gap between an effect and a
*state publicly naming an actor*. Fitted to 18 non-quarantined incidents, those medians are
74 days for jamming and 747 days for ground cyber. An episode is 72 hours. Feeding those
medians to `engine/attacks.py` would mean 3.4% of jamming and effectively 0% of cyber
attacks are ever attributed in-episode — no attribution dynamics, and
`belief_lag_injects` and `response_match` in `contracts/targets.md` become unreachable.

**What I did.** The file carries both. `median_hours`, `sigma` and `floor_hours` — the
columns Engine reads — describe *first-indication* attribution: the point at which a seat
can tell the effect is hostile and name a likely source. The measured public-attribution
figures sit beside them in `public_attribution_median_hours`,
`public_attribution_median_days` and `public_p_attributed_within_72h`, so nothing is
hidden and Eval can still check the model against the real record.

- `sigma` is **fitted** from the incidents (`sigma_basis = fitted_from_incidents`), except
  dazzle, which has no attributed case anywhere in the record and uses an assumed 1.2.
- `median_hours` is a **modelling choice** (`median_basis = derived_modeling_first_indication`).
  The *ordering* it preserves is measured — kinetic same-day, then rpo, then jam, then
  ground_cyber — but the *level* is mine: 1 h / 6 h / 18 h / 96 h / 240 h.

**Recommendation.** Approve the levels at the `env_lock` gate alongside the storm numbers,
or overwrite them with your own. They are one column in one CSV; nothing else changes.
Every parameter is regenerable with `python calib/fit_attribution_lags.py`.

**Meanwhile.** Engine loads the file as-is and its 66 tests pass.

## Answer
<!-- a human answers here -->

## Q2. `attribution_incidents.csv` is a table I built; it exists nowhere upstream.

No published dataset gives effect-to-attribution lags for counterspace events. The 19 rows
are assembled from SWF and CSIS narrative text plus dated public statements, each row
citing report and page. Three consequences worth a human eye:

- **Censoring is real and under-counted.** Only one row is marked censored (RAF Cyprus,
  1383 days and still unattributed). Incidents that were *never* attributed mostly never
  enter the reports at all, so the fitted medians are optimistic.
- **Not all attributions are equal.** `attribution_strength` separates a state's
  evidence-backed accusation from a vendor report, a commission report, a legislator's
  remark and an NGO's analysis. The fastest cyber case (72 days) is a legislator's remark,
  not a formal US government attribution.
- **`effect_date` is coarse for the cyber rows.** Two are known only to the year, which
  makes those lags upper bounds. `effect_date_precision` records this per row.

## Answer
<!-- a human answers here -->
