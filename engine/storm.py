"""The storm layer.

A geomagnetic storm is the scenario's alibi: it degrades exactly the things an
attack degrades, so every seat has to decide whether it is being attacked or
merely being rained on. The layer does four things:

1. carries a Kp/Dst time series for a named profile;
2. multiplies each seat's `sensor_confidence` and `comms_bandwidth`;
3. draws safe-mode entries per asset class, scaled by severity;
4. opens and closes tracking-degradation and conjunction-screening-suspension
   windows.

Numbers come from `calib/storm_effects.csv` when Agent 2 has published it, and
from the placeholder curves below when it has not. Every placeholder is tagged
`TODO_CALIB` in `profile.sources`, and `engine.storm_check` prints the tags, so
"where did that number come from" is always answerable.

`calib/storm_effects.csv` is read in Agent 2's long format — one cited row per
measurement, `profile, metric, asset_class, value, unit, ...` — and the metrics
this module consumes are:

    peak_kp, min_dst, noaa_g_scale, storm_duration_g1_plus,
    ring_current_recovery, tracking_degradation, screening_suspension,
    satellites_lost, safe_mode_events_documented (per asset_class)

A wide-format file (one row per profile, one column per field) is also accepted,
because that was the shape the engine assumed first and a fallback costs nothing.
Anything missing falls back to a placeholder tagged `TODO_CALIB`.

Kp and Dst series come from `calib/series/kp_<profile>.csv` and
`calib/series/dst_<profile>.csv` (columns `utc_start`, `kp` / `dst_nt`), or from
a single `calib/kp_<profile>.csv` with `time_s` or `hours`. Series times are
converted to sim seconds from the first sample, so a profile starts at t=0 and
`storm.onset_sim_time_s` shifts it.
"""

from __future__ import annotations

import csv
import datetime as dt
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from engine.contracts import SEATS

__all__ = ["StormLayer", "StormProfile", "load_profile", "placeholder_profile"]

TODO_CALIB = "TODO_CALIB"

#: Peak Kp by NOAA G-scale. Placeholder until calib/storm_effects.csv lands.
PEAK_KP: dict[str, float] = {
    "quiet": 2.0,
    "G1": 5.0,
    "G2": 6.0,
    "G3": 7.0,
    "G4": 8.0,
    "G5": 9.0,
    "carrington": 9.0,
}
MIN_DST: dict[str, float] = {
    "quiet": -15.0,
    "G1": -50.0,
    "G2": -80.0,
    "G3": -130.0,
    "G4": -200.0,
    "G5": -410.0,
    "carrington": -850.0,
}

#: Kp -> multiplier. Interpolated linearly between the knots.
SENSOR_CONFIDENCE_KNOTS: tuple[tuple[float, float], ...] = (
    (0.0, 1.00),
    (4.0, 0.97),
    (5.0, 0.90),
    (6.0, 0.80),
    (7.0, 0.68),
    (8.0, 0.52),
    (9.0, 0.35),
)
COMMS_BANDWIDTH_KNOTS: tuple[tuple[float, float], ...] = (
    (0.0, 1.00),
    (4.0, 0.98),
    (5.0, 0.92),
    (6.0, 0.84),
    (7.0, 0.72),
    (8.0, 0.55),
    (9.0, 0.38),
)

#: Safe-mode hazard at peak (Kp 9), per hour. Constellations are per member.
SAFE_MODE_PEAK_RATE: dict[str, float] = {
    "heo_node": 0.015,
    "constellation": 0.0040,
    "pass_sensor": 0.010,
}

#: How exposed each seat's picture is to the storm. A seat living off its own
#: spacecraft telemetry is hit harder than one living off diplomatic traffic.
#: Applied as multiplier ** exposure, so 1.0 is the published degradation.
SEAT_EXPOSURE: dict[str, float] = {
    "northcom": 1.15,
    "usspacecom": 1.00,
    "nsc": 0.55,
    "norway": 1.05,
    "northern_fleet": 1.00,
    "kremlin": 0.50,
    "china": 0.80,
    "starlink": 1.20,
    "iridium": 1.10,
}

TRACKING_DEGRADE_ON_KP = 6.0
TRACKING_DEGRADE_OFF_KP = 5.5
SCREENING_SUSPEND_ON_KP = 7.0
SCREENING_SUSPEND_OFF_KP = 6.5


def _interp(knots: tuple[tuple[float, float], ...], x: float) -> float:
    if x <= knots[0][0]:
        return knots[0][1]
    if x >= knots[-1][0]:
        return knots[-1][1]
    for (x0, y0), (x1, y1) in zip(knots, knots[1:], strict=False):
        if x0 <= x <= x1:
            span = x1 - x0
            return y0 if span == 0 else y0 + (y1 - y0) * (x - x0) / span
    return knots[-1][1]  # pragma: no cover


def calib_dir() -> Path:
    here = Path(__file__).resolve()
    for parent in here.parents:
        if (parent / "calib").is_dir():
            return parent / "calib"
    return Path("calib")


@dataclass
class StormProfile:
    """One storm: its shape, its hazards, and where each number came from."""

    name: str
    severity: str
    peak_kp: float
    min_dst_nt: float
    onset_hours: float
    plateau_hours: float
    decay_hours: float
    safe_mode_rates: dict[str, float]
    tracking_degradation_hours: float
    screening_suspension_hours: float
    satellites_lost: int = 0
    series: list[tuple[float, float, float]] = field(default_factory=list)
    sources: dict[str, str] = field(default_factory=dict)

    @property
    def is_placeholder(self) -> bool:
        return any(v == TODO_CALIB for v in self.sources.values())

    def kp_at(self, t_s: float, onset_s: float = 0.0) -> tuple[float, float]:
        """(Kp, Dst) at a sim time. Series if we have one, curve if we do not."""
        if self.series:
            return self._series_at(t_s - onset_s)
        return self._curve_at(t_s - onset_s)

    def _series_at(self, dt_s: float) -> tuple[float, float]:
        if dt_s <= self.series[0][0]:
            return self.series[0][1], self.series[0][2]
        if dt_s >= self.series[-1][0]:
            return self.series[-1][1], self.series[-1][2]
        for (t0, kp0, dst0), (t1, kp1, dst1) in zip(self.series, self.series[1:], strict=False):
            if t0 <= dt_s <= t1:
                span = t1 - t0
                if span == 0:
                    return kp0, dst0
                f = (dt_s - t0) / span
                return kp0 + (kp1 - kp0) * f, dst0 + (dst1 - dst0) * f
        return self.series[-1][1], self.series[-1][2]  # pragma: no cover

    def _curve_at(self, dt_s: float) -> tuple[float, float]:
        """Ramp, plateau, exponential recovery. Quiet background of Kp 2."""
        quiet_kp, quiet_dst = 2.0, -12.0
        hours = dt_s / 3600.0
        if hours < 0:
            return quiet_kp, quiet_dst
        if hours < self.onset_hours:
            f = hours / max(1e-9, self.onset_hours)
        elif hours < self.onset_hours + self.plateau_hours:
            f = 1.0
        else:
            past = hours - self.onset_hours - self.plateau_hours
            f = math.exp(-past / max(1e-9, self.decay_hours / 2.0))
        kp = quiet_kp + (self.peak_kp - quiet_kp) * f
        dst = quiet_dst + (self.min_dst_nt - quiet_dst) * f
        return max(0.0, min(9.0, kp)), dst


def placeholder_profile(severity: str = "G5", name: str | None = None) -> StormProfile:
    """Curves to run against until `calib/storm_effects.csv` exists."""
    sev = severity if severity in PEAK_KP else "G5"
    shape = {
        "quiet": (2.0, 6.0, 6.0),
        "G1": (4.0, 4.0, 12.0),
        "G2": (4.0, 5.0, 14.0),
        "G3": (5.0, 6.0, 18.0),
        "G4": (6.0, 8.0, 24.0),
        "G5": (6.0, 12.0, 30.0),
        "carrington": (4.0, 20.0, 48.0),
    }[sev]
    scale = 1.0 if sev != "carrington" else 2.2
    return StormProfile(
        name=name or f"synthetic_{sev.lower()}",
        severity=sev,
        peak_kp=PEAK_KP[sev],
        min_dst_nt=MIN_DST[sev],
        onset_hours=shape[0],
        plateau_hours=shape[1],
        decay_hours=shape[2],
        safe_mode_rates={k: v * scale for k, v in SAFE_MODE_PEAK_RATE.items()},
        tracking_degradation_hours=0.0,  # derived from the curve, not asserted
        screening_suspension_hours=0.0,
        satellites_lost=0,
        sources={
            "peak_kp": TODO_CALIB,
            "min_dst_nt": TODO_CALIB,
            "shape": TODO_CALIB,
            "safe_mode_rates": TODO_CALIB,
        },
    )


def _series_paths(profile_name: str) -> tuple[Path, Path]:
    root = calib_dir()
    return root / "series" / f"kp_{profile_name}.csv", root / "series" / f"dst_{profile_name}.csv"


def _parse_utc(value: str) -> float | None:
    """Seconds since the epoch from an RFC 3339 stamp, or None."""
    text = (value or "").strip().replace("Z", "+00:00")
    if not text:
        return None
    try:
        return dt.datetime.fromisoformat(text).timestamp()
    except ValueError:
        return None


def _read_column(path: Path, column: str) -> list[tuple[float, float]]:
    """(epoch seconds, value) from one of Agent 2's series files."""
    if not path.is_file():
        return []
    out: list[tuple[float, float]] = []
    with path.open(newline="") as handle:
        for row in csv.DictReader(handle):
            when = _parse_utc(row.get("utc_start") or row.get("utc") or "")
            raw = row.get(column)
            if when is None or raw in (None, ""):
                continue
            try:
                out.append((when, float(raw)))
            except ValueError:
                continue
    return sorted(out)


def _series_origin(kp: list[tuple[float, float]]) -> float:
    """Where t=0 sits in a recorded series: the storm's onset, not the file's start.

    A NOAA series covers days of quiet either side of the event. Anchoring on
    the first sample would put the peak somewhere past the end of a 72-hour
    episode; anchoring on the last quiet sample before the peak makes
    `onset_sim_time_s` mean what its name says. Samples before that point keep
    negative times and read as the quiet background.
    """
    peak_index = max(range(len(kp)), key=lambda i: kp[i][1])
    index = peak_index
    while index > 0 and kp[index - 1][1] >= 4.0:
        index -= 1
    # One sample further back, so an episode opens on the quiet before the rise
    # rather than halfway up it.
    return kp[max(0, index - 1)][0]


def _read_series(profile_name: str) -> tuple[list[tuple[float, float, float]], str]:
    """A merged Kp/Dst series in sim seconds from the profile start.

    Prefers Agent 2's `calib/series/` pair; falls back to a single
    `calib/kp_<profile>.csv` carrying `time_s`/`hours`, `kp` and `dst_nt`.
    """
    kp_path, dst_path = _series_paths(profile_name)
    kp = _read_column(kp_path, "kp")
    dst = _read_column(dst_path, "dst_nt")
    if kp:
        origin = _series_origin(kp)
        dst_lookup = dict(dst)
        dst_times = sorted(dst_lookup)
        merged: list[tuple[float, float, float]] = []
        for when, value in kp:
            if when in dst_lookup:
                dst_value = dst_lookup[when]
            elif dst_times:
                nearest = min(dst_times, key=lambda t: abs(t - when))
                dst_value = dst_lookup[nearest]
            else:
                dst_value = 0.0
            merged.append((when - origin, value, dst_value))
        return merged, f"calib/series/kp_{profile_name}.csv"

    flat = calib_dir() / f"kp_{profile_name}.csv"
    if not flat.is_file():
        return [], ""
    series: list[tuple[float, float, float]] = []
    with flat.open(newline="") as handle:
        for row in csv.DictReader(handle):
            if row.get("time_s"):
                t = float(row["time_s"])
            elif row.get("hours"):
                t = float(row["hours"]) * 3600.0
            else:
                continue
            series.append((t, float(row.get("kp") or 0.0), float(row.get("dst_nt") or 0.0)))
    return sorted(series), f"calib/kp_{profile_name}.csv"


def _long_format_rows(path: Path, name: str) -> list[dict[str, str]]:
    with path.open(newline="") as handle:
        rows = list(csv.DictReader(handle))
    if not rows or "metric" not in rows[0]:
        return []
    return [r for r in rows if (r.get("profile") or "").strip() == name]


def _apply_long_format(base: StormProfile, rows: list[dict[str, str]]) -> None:
    """Fold Agent 2's cited measurements into a profile.

    Only the metrics the engine actually consumes are read; the rest of the
    table is calibration evidence for other consumers and for a human at the
    env_lock gate.
    """
    safe_mode_counts: dict[str, float] = {}
    duration_hours: float | None = None
    recovery_hours: float | None = None
    for row in rows:
        metric = (row.get("metric") or "").strip()
        raw = (row.get("value") or "").strip()
        cite = (row.get("source_url") or "calib/storm_effects.csv").strip()
        asset_class = (row.get("asset_class") or "").strip()
        if not raw:
            continue
        try:
            number = float(raw)
        except ValueError:
            number = float("nan")
        if metric == "peak_kp" and number == number:
            base.peak_kp = number
            base.sources["peak_kp"] = cite
        elif metric == "min_dst" and number == number:
            base.min_dst_nt = number
            base.sources["min_dst_nt"] = cite
        elif metric == "noaa_g_scale":
            base.severity = raw
            base.sources["severity"] = cite
        elif metric == "tracking_degradation" and number == number:
            base.tracking_degradation_hours = number
            base.sources["tracking_degradation_hours"] = cite
        elif metric == "screening_suspension" and number == number:
            base.screening_suspension_hours = number
            base.sources["screening_suspension_hours"] = cite
        elif metric == "satellites_lost" and number == number:
            base.satellites_lost = int(number)
            base.sources["satellites_lost"] = cite
        elif metric == "safe_mode_events_documented" and number == number:
            safe_mode_counts[asset_class or "unspecified"] = number
            base.sources["safe_mode_rates"] = cite
        elif metric == "storm_duration_g1_plus" and number == number:
            duration_hours = number
            base.sources["shape"] = cite
        elif metric == "ring_current_recovery" and number == number:
            recovery_hours = number
            base.sources["shape"] = cite

    if duration_hours is not None:
        # Split the observed G1+ duration into the ramp and the plateau; the
        # decay comes from the ring-current recovery when we have it.
        base.onset_hours = max(1.0, round(duration_hours * 0.15, 2))
        base.plateau_hours = max(1.0, round(duration_hours * 0.35, 2))
    if recovery_hours is not None:
        base.decay_hours = max(2.0, recovery_hours)

    if safe_mode_counts:
        # Documented safe-mode events over the storm, turned into a per-hour
        # hazard at peak. `population` is how many units of that class the
        # observed count was drawn from; the engine's own fleet is much smaller,
        # so the rate, not the count, is what transfers.
        window = max(1.0, (duration_hours or 24.0))
        population = {
            "leo_constellation": 5000.0,
            "science_leo": 40.0,
            "leo_200_400km": 5000.0,
            "unspecified": 100.0,
        }
        rates = dict(base.safe_mode_rates)
        for asset_class, count in sorted(safe_mode_counts.items()):
            size = population.get(asset_class, 100.0)
            per_unit_hour = count / (size * window)
            if "constellation" in asset_class:
                rates["constellation"] = per_unit_hour
            else:
                rates["heo_node"] = max(rates.get("heo_node", 0.0), per_unit_hour * 4.0)
                rates["pass_sensor"] = max(rates.get("pass_sensor", 0.0), per_unit_hour * 2.0)
        base.safe_mode_rates = rates


def _apply_wide_format(base: StormProfile, row: dict[str, str]) -> None:
    """The one-row-per-profile shape, kept as a fallback."""
    cited = str(row.get("source_url") or "calib/storm_effects.csv")
    if row.get("severity"):
        base.severity = str(row["severity"]).strip()

    def take(column: str, key: str, cast: Any = float) -> None:
        value = row.get(column)
        if value not in (None, ""):
            setattr(base, key, cast(value))
            base.sources[key] = cited

    take("peak_kp", "peak_kp")
    take("min_dst_nt", "min_dst_nt")
    take("onset_hours", "onset_hours")
    take("plateau_hours", "plateau_hours")
    take("decay_hours", "decay_hours")
    take("tracking_degradation_hours", "tracking_degradation_hours")
    take("screening_suspension_hours", "screening_suspension_hours")
    take("satellites_lost", "satellites_lost", int)
    rates = dict(base.safe_mode_rates)
    mapping = {
        "safe_mode_heo_node_per_hour": "heo_node",
        "safe_mode_constellation_per_member_hour": "constellation",
        "safe_mode_pass_sensor_per_hour": "pass_sensor",
    }
    hit = False
    for column, klass in mapping.items():
        if row.get(column):
            rates[klass] = float(row[column])
            hit = True
    base.safe_mode_rates = rates
    if hit:
        base.sources["safe_mode_rates"] = cited


def load_profile(name: str, severity: str | None = None) -> StormProfile:
    """A profile from `calib/`, falling back to placeholders field by field."""
    base = placeholder_profile(severity or "G5", name=name)
    path = calib_dir() / "storm_effects.csv"
    if path.is_file():
        long_rows = _long_format_rows(path, name)
        if long_rows:
            _apply_long_format(base, long_rows)
        else:
            with path.open(newline="") as handle:
                for candidate in csv.DictReader(handle):
                    if (candidate.get("profile") or "").strip() == name:
                        _apply_wide_format(base, candidate)
                        break
    if severity:
        base.severity = severity
    series, source = _read_series(name)
    if series:
        base.series = series
        base.sources["series"] = source
    return base


class StormLayer:
    """Storm state over one episode."""

    def __init__(
        self,
        profile: StormProfile,
        *,
        onset_sim_time_s: float = 0.0,
        params: dict[str, Any] | None = None,
    ) -> None:
        self.profile = profile
        self.onset_s = float(onset_sim_time_s)
        self.params = dict(params or {})
        self.kp: float = 0.0
        self.dst_nt: float = 0.0
        self.sensor_confidence_multiplier: float = 1.0
        self.comms_bandwidth_multiplier: float = 1.0
        self.tracking_degraded: bool = False
        self.screening_suspended: bool = False
        #: Closed windows, as (start_s, end_s). The open one has end None.
        self.tracking_windows: list[list[float | None]] = []
        self.screening_windows: list[list[float | None]] = []
        self.safe_mode_entries: int = 0
        self.update(0)

    @property
    def severity(self) -> str:
        return self.profile.severity

    def update(self, sim_time_s: int) -> dict[str, Any]:
        """Advance the storm to `sim_time_s` and return the `storm_update` payload."""
        kp, dst = self.profile.kp_at(float(sim_time_s), self.onset_s)
        self.kp = round(kp, 3)
        self.dst_nt = round(dst, 2)
        self.sensor_confidence_multiplier = round(_interp(SENSOR_CONFIDENCE_KNOTS, self.kp), 4)
        self.comms_bandwidth_multiplier = round(_interp(COMMS_BANDWIDTH_KNOTS, self.kp), 4)
        self._window(
            self.tracking_windows,
            "tracking_degraded",
            TRACKING_DEGRADE_ON_KP,
            TRACKING_DEGRADE_OFF_KP,
            sim_time_s,
        )
        self._window(
            self.screening_windows,
            "screening_suspended",
            SCREENING_SUSPEND_ON_KP,
            SCREENING_SUSPEND_OFF_KP,
            sim_time_s,
        )
        return self.payload()

    def _window(
        self,
        windows: list[list[float | None]],
        flag: str,
        on_kp: float,
        off_kp: float,
        sim_time_s: int,
    ) -> None:
        active = bool(getattr(self, flag))
        if not active and self.kp >= on_kp:
            setattr(self, flag, True)
            windows.append([float(sim_time_s), None])
        elif active and self.kp < off_kp:
            setattr(self, flag, False)
            if windows and windows[-1][1] is None:
                windows[-1][1] = float(sim_time_s)

    def close_windows(self, sim_time_s: int) -> None:
        for windows in (self.tracking_windows, self.screening_windows):
            if windows and windows[-1][1] is None:
                windows[-1][1] = float(sim_time_s)

    def payload(self) -> dict[str, Any]:
        return {
            "severity": self.severity,
            "kp": self.kp,
            "dst_nt": self.dst_nt,
            "sensor_confidence_multiplier": self.sensor_confidence_multiplier,
            "comms_bandwidth_multiplier": self.comms_bandwidth_multiplier,
            "tracking_degraded": self.tracking_degraded,
            "screening_suspended": self.screening_suspended,
            "profile": self.profile.name,
        }

    # --- per-seat effect -----------------------------------------------------

    def seat_multipliers(self, seat: str) -> dict[str, float]:
        """This seat's `sensor_confidence` and `comms_bandwidth` right now.

        Exposure raises or lowers the published degradation: NSC reads cables,
        Starlink reads spacecraft.
        """
        exposure = SEAT_EXPOSURE.get(seat, 1.0)
        return {
            "sensor_confidence": round(self.sensor_confidence_multiplier**exposure, 4),
            "comms_bandwidth": round(self.comms_bandwidth_multiplier**exposure, 4),
        }

    def all_seat_multipliers(self) -> dict[str, dict[str, float]]:
        return {seat: self.seat_multipliers(seat) for seat in SEATS}

    # --- hazards -------------------------------------------------------------

    def safe_mode_hazard(self, asset_class: str, hours: float) -> float:
        """Probability one unit of this class safes in the next `hours`.

        Quadratic in Kp above the quiet floor, which is the shape the operator
        reports imply and a placeholder until `calib/storm_effects.csv` says
        otherwise.
        """
        rate = self.profile.safe_mode_rates.get(asset_class, 0.0)
        scaled = rate * max(0.0, (self.kp - 4.0) / 5.0) ** 2
        return 1.0 - math.exp(-scaled * max(0.0, hours))

    def window_hours(self, which: str, now_s: float) -> float:
        windows = self.tracking_windows if which == "tracking" else self.screening_windows
        total = 0.0
        for start, end in windows:
            total += (float(end) if end is not None else float(now_s)) - float(start)
        return round(total / 3600.0, 3)

    # --- snapshot ------------------------------------------------------------

    def snapshot(self) -> dict[str, Any]:
        return {
            "kp": self.kp,
            "dst_nt": self.dst_nt,
            "sensor_confidence_multiplier": self.sensor_confidence_multiplier,
            "comms_bandwidth_multiplier": self.comms_bandwidth_multiplier,
            "tracking_degraded": self.tracking_degraded,
            "screening_suspended": self.screening_suspended,
            "tracking_windows": [list(w) for w in self.tracking_windows],
            "screening_windows": [list(w) for w in self.screening_windows],
            "safe_mode_entries": self.safe_mode_entries,
            "onset_s": self.onset_s,
        }

    def restore(self, snap: dict[str, Any]) -> None:
        self.kp = float(snap["kp"])
        self.dst_nt = float(snap["dst_nt"])
        self.sensor_confidence_multiplier = float(snap["sensor_confidence_multiplier"])
        self.comms_bandwidth_multiplier = float(snap["comms_bandwidth_multiplier"])
        self.tracking_degraded = bool(snap["tracking_degraded"])
        self.screening_suspended = bool(snap["screening_suspended"])
        self.tracking_windows = [list(w) for w in snap["tracking_windows"]]
        self.screening_windows = [list(w) for w in snap["screening_windows"]]
        self.safe_mode_entries = int(snap["safe_mode_entries"])
        self.onset_s = float(snap["onset_s"])
