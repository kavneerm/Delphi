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
