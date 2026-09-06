"""Fit `calib/attribution_lags.csv` from `calib/attribution_incidents.csv`.

The incident table is the evidence; this script is the only thing that turns it
into parameters, so a change to either is reproducible with one command:

    python calib/fit_attribution_lags.py

Two regimes live in the output and the distinction matters. The open record
measures *public* attribution — the gap between an effect and a state naming an
actor — and those medians run to months or years. An episode is 72 sim hours, so
feeding them to the engine would mean nothing is ever attributed in play. The
columns `engine/attacks.py` reads therefore describe *first-indication*
attribution, and the measured public figures ride alongside in their own columns
for eval. See `calib/QUESTIONS.md` Q1.
"""

from __future__ import annotations

import csv
import math
import pathlib
import statistics as st

CALIB = pathlib.Path(__file__).resolve().parent
SWF = "https://swfound.org/counterspace"
EPISODE_HOURS = 72.0

#: Engine-facing first-indication median and floor, in hours. The ordering is
#: measured — kinetic is same-day, cyber takes years — but the level is a
#: modelling choice awaiting the env_lock gate.
FIRST_INDICATION: dict[str, tuple[float, float]] = {
    "jam": (18.0, 1.0),
    "dazzle": (96.0, 6.0),
    "ground_cyber": (240.0, 12.0),
    "rpo": (6.0, 0.5),
    "kinetic": (1.0, 0.1),
}

#: dazzle has no attributed case anywhere in the record, so its shape is assumed.
SIGMA_ASSUMED: dict[str, float] = {"dazzle": 1.20}

NOTES: dict[str, str] = {
    "jam": (
        "Six public jamming incidents, one right-censored after 1383 days. Public median "
        "74 days; inside a 72-hour episode only 3.4% would ever be attributed. The engine "
        "median is first-indication attribution: geolocating an emitter takes hours, and "
        "the hard part in-episode is separating hostile jamming from storm interference, "
        "which the storm layer modulates."
    ),
    "dazzle": (
        "No publicly attributed satellite dazzle exists anywhere in the 2018-2024 open "
        "record, so there is nothing to fit. never_attributed_fraction is 1.0 on the "
        "public record. The engine median is set long deliberately: dazzle should usually "
        "stay unattributed inside an episode. sigma is assumed, not measured."
    ),
    "ground_cyber": (
        "Six incidents, public median 747 days, and not one is a formal same-state "
        "attribution: the fastest at 72 days was a legislator's remark, the rest a "
        "commission report, a vendor report and agency researchers. Public probability of "
        "attribution inside 72 hours rounds to zero. This is the rung an actor can use and "
        "deny, and the Turla case shows attribution being actively corrupted by false flag."
    ),
    "rpo": (
        "Four incidents spanning 4 to 285 days. The spread is not detection difficulty: "
        "every one was trackable in near real time, and the 285-day case was political "
        "decision time. The engine median is short because the seat sees the maneuver; "
        "what stays slow is calling it hostile."
    ),
    "kinetic": (
        "Same-day attribution in two of three cases, one self-declared. Debris, launch and "
        "intercept are unambiguous and immediate. Kinetic carries no ambiguity to exploit, "
        "which is why it sits at the top of the ladder and why targets.md caps its rate "
        "rather than its lag."
    ),
}

COLUMNS = [
    "attack_type",
    "distribution",
    "median_hours",
    "sigma",
    "floor_hours",
    "p_attributed_within_72h",
    "public_attribution_median_hours",
    "public_attribution_median_days",
    "public_p_attributed_within_72h",
    "n_incidents",
    "n_censored",
    "never_attributed_fraction",
    "median_basis",
    "sigma_basis",
    "fitted_from",
    "source_url",
    "source_page_or_section",
    "notes",
]


def fit_lognormal(lag_days: list[float]) -> tuple[float, float]:
    """Return (median in hours, sigma) of a lognormal fitted to the lags.

    Same-day attributions are floored at half a day so that log() is defined;
    they are real observations, not missing data.
    """
    logs = [math.log(max(0.5, d)) for d in lag_days]
    mu = st.fmean(logs)
    sigma = st.stdev(logs) if len(logs) > 1 else 1.0
    return math.exp(mu) * 24.0, sigma


def p_within(median_hours: float, sigma: float, horizon: float = EPISODE_HOURS) -> float:
    """Probability a lognormal draw resolves inside `horizon` hours."""
    z = (math.log(horizon) - math.log(median_hours)) / sigma
    return 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))


def build() -> list[dict[str, object]]:
    with (CALIB / "attribution_incidents.csv").open(newline="") as handle:
        incidents = list(csv.DictReader(handle))

    observed: dict[str, list[tuple[str, float]]] = {}
    for row in incidents:
        if row["censored"] == "yes" or not row["lag_days"]:
            continue
        observed.setdefault(row["attack_type"], []).append(
            (row["incident_id"], float(row["lag_days"]))
        )

    rows: list[dict[str, object]] = []
    for kind, (median_hours, floor_hours) in FIRST_INDICATION.items():
        seen = observed.get(kind, [])
        censored = sum(1 for r in incidents if r["attack_type"] == kind and r["censored"] == "yes")
        if seen:
            public_hours, sigma = fit_lognormal([d for _, d in seen])
            sigma = SIGMA_ASSUMED.get(kind, round(sigma, 3))
            public_p: object = round(p_within(public_hours, sigma), 4)
            public_days: object = round(public_hours / 24.0, 1)
            public_hours_out: object = round(public_hours, 1)
            sigma_basis = "fitted_from_incidents"
        else:
            sigma = SIGMA_ASSUMED[kind]
            public_p = public_days = public_hours_out = ""
            sigma_basis = "no_attributed_case_in_record"

        total = len(seen) + censored
        rows.append(
            {
                "attack_type": kind,
                "distribution": "lognormal",
                "median_hours": median_hours,
                "sigma": sigma,
                "floor_hours": floor_hours,
                "p_attributed_within_72h": round(p_within(median_hours, sigma), 4),
                "public_attribution_median_hours": public_hours_out,
                "public_attribution_median_days": public_days,
                "public_p_attributed_within_72h": public_p,
                "n_incidents": len(seen),
                "n_censored": censored,
                "never_attributed_fraction": round(censored / total, 3) if total else 1.0,
                "median_basis": "derived_modeling_first_indication",
                "sigma_basis": sigma_basis,
                "fitted_from": " ".join(i for i, _ in seen),
                "source_url": SWF,
                "source_page_or_section": (
                    "fitted from calib/attribution_incidents.csv; "
                    "per-incident citations in that file"
                ),
                "notes": NOTES[kind],
            }
        )
    return rows


def main() -> None:
    rows = build()
    out = CALIB / "attribution_lags.csv"
    with out.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=COLUMNS, quoting=csv.QUOTE_MINIMAL)
        writer.writeheader()
        writer.writerows(rows)

    header = f"{'type':13} {'med_h':>6} {'sig':>6} {'floor':>6} {'P<=72h':>7}  public_med_d"
    print(header)
    for row in rows:
        print(
            f"{row['attack_type']:13} {row['median_hours']:>6} {row['sigma']:>6} "
            f"{row['floor_hours']:>6} {row['p_attributed_within_72h']:>7}  "
            f"{row['public_attribution_median_days'] or '-'}"
        )


if __name__ == "__main__":
    main()
