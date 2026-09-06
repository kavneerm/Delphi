"""Schema contract for the calib/ tables.

Engine and Gen load these by column name, so a ragged row or a duplicated lookup
key is a break in their loader, not a cosmetic problem here. These tests are the
contract: every table parses to a fixed width, every row carries a citation, and
the documented primary key is actually unique.
"""

from __future__ import annotations

import csv
from pathlib import Path

CALIB = Path(__file__).resolve().parents[2] / "calib"

STORM_COLUMNS = [
    "profile",
    "metric",
    "asset_class",
    "value",
    "unit",
    "kind",
    "window_start_utc",
    "window_end_utc",
    "derivation",
    "source_url",
    "source_page_or_section",
    "notes",
]
STORM_KEY = ("profile", "metric", "asset_class")
STORM_KINDS = {"observed", "derived_from_series", "derived_from_source"}


def read(name: str) -> list[dict[str, str]]:
    with (CALIB / name).open(newline="") as fh:
        return list(csv.DictReader(fh))


def test_storm_effects_columns() -> None:
    rows = read("storm_effects.csv")
    assert rows, "storm_effects.csv is empty"
    assert list(rows[0]) == STORM_COLUMNS


def test_storm_effects_has_no_ragged_rows() -> None:
    # csv.DictReader parks overflow fields under the None key; an unquoted comma
    # in the trailing notes column shows up here and nowhere else.
    for row in read("storm_effects.csv"):
        assert None not in row, f"ragged row: {row.get('metric')}"
        assert all(v is not None for v in row.values())


def test_storm_effects_key_is_unique() -> None:
    keys = [tuple(r[c] for c in STORM_KEY) for r in read("storm_effects.csv")]
    assert len(keys) == len(set(keys)), "duplicate (profile, metric, asset_class)"


def test_storm_effects_kind_vocabulary() -> None:
    assert {r["kind"] for r in read("storm_effects.csv")} <= STORM_KINDS


def test_every_row_cites_a_source() -> None:
    for name in ("storm_effects.csv", "red_action_rates.csv"):
        for row in read(name):
            assert row["source_url"].startswith("http"), f"{name}: {row}"
            assert row["source_page_or_section"].strip(), f"{name}: {row}"


def test_red_action_rates_arithmetic() -> None:
    for row in read("red_action_rates.csv"):
        events = int(row["event_count"])
        years = int(row["years_observed"])
        assert years > 0
        assert abs(events / years - float(row["events_per_year"])) < 5e-4
        assert 0 <= int(row["destructive_event_count"]) <= events


def test_red_action_rates_window_excludes_the_holdout_years() -> None:
    for row in read("red_action_rates.csv"):
        assert row["window_start"] >= "2018-01-01"
        assert row["window_end"] <= "2024-12-31"


def test_series_files_parse_and_are_ordered() -> None:
    for stem in ("kp_may2024", "kp_feb2022", "dst_may2024", "dst_feb2022"):
        with (CALIB / "series" / f"{stem}.csv").open(newline="") as fh:
            rows = list(csv.DictReader(fh))
        assert rows, stem
        stamps = [r["utc_start"] for r in rows]
        assert stamps == sorted(stamps), f"{stem} is not in time order"
        assert all(r["source_url"].startswith("http") for r in rows), stem


LAG_COLUMNS_ENGINE_READS = ["attack_type", "median_hours", "sigma", "floor_hours", "source_url"]


def test_attribution_lags_has_the_columns_engine_reads() -> None:
    # engine/attacks.py:load_attribution_lags() reads exactly these by name.
    rows = read("attribution_lags.csv")
    assert rows
    for column in LAG_COLUMNS_ENGINE_READS:
        assert column in rows[0], column


def test_attribution_lags_cover_every_engine_attack_type() -> None:
    kinds = {r["attack_type"] for r in read("attribution_lags.csv")}
    assert {"jam", "dazzle", "ground_cyber", "rpo"} <= kinds


def test_attribution_lags_are_positive_and_ordered_by_difficulty() -> None:
    by = {r["attack_type"]: r for r in read("attribution_lags.csv")}
    for row in by.values():
        assert float(row["median_hours"]) > 0
        assert float(row["sigma"]) > 0
        assert 0 < float(row["floor_hours"]) <= float(row["median_hours"])
    # The one ordering the public record actually establishes: a kinetic event is
    # attributed same-day, cyber takes years, and rpo and jam sit between them.
    median = {k: float(v["median_hours"]) for k, v in by.items()}
    assert median["kinetic"] < median["rpo"] < median["jam"] < median["ground_cyber"]


def test_attribution_incidents_back_every_fitted_parameter() -> None:
    incidents = read("attribution_incidents.csv")
    ids = {r["incident_id"] for r in incidents}
    for row in read("attribution_lags.csv"):
        cited = row["fitted_from"].split()
        assert set(cited) <= ids, row["attack_type"]
        assert len(cited) == int(row["n_incidents"]), row["attack_type"]


def test_attribution_incidents_exclude_the_holdout_years() -> None:
    for row in read("attribution_incidents.csv"):
        assert row["effect_date"] < "2025-01-01", row["incident_id"]


def test_holdout_matches_red_action_rates_columns() -> None:
    # eval/holdout_mix.py compares the two directly; divergent columns break it.
    assert list(read("holdout_2025_2026.csv")[0]) == list(read("red_action_rates.csv")[0])


def test_holdout_window_is_disjoint_from_the_training_window() -> None:
    for row in read("holdout_2025_2026.csv"):
        assert row["window_start"] >= "2025-01-01", row
        assert row["window_end"] <= "2026-12-31", row


def test_holdout_is_write_protected() -> None:
    import stat

    mode = (CALIB / "holdout_2025_2026.csv").stat().st_mode
    assert not (mode & stat.S_IWUSR), "holdout must stay chmod 444"


def test_holdout_covers_the_same_grid() -> None:
    holdout = {(r["actor"], r["category"]) for r in read("holdout_2025_2026.csv")}
    train = {(r["actor"], r["category"]) for r in read("red_action_rates.csv")}
    assert holdout == train
