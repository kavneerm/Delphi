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

Columns `engine/storm.py` reads from `calib/storm_effects.csv` (all optional;
anything missing falls back to a placeholder):

    profile, severity, peak_kp, min_dst_nt, onset_hours, plateau_hours,
    decay_hours, safe_mode_heo_node_per_hour,
    safe_mode_constellation_per_member_hour, safe_mode_pass_sensor_per_hour,
    tracking_degradation_hours, screening_suspension_hours, satellites_lost

and, if present, a per-profile series `calib/kp_<profile>.csv` with columns
`time_s, kp, dst_nt` (or `hours, kp, dst_nt`).
"""

from __future__ import annotations

import csv
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


def _read_series(profile_name: str) -> list[tuple[float, float, float]]:
    path = calib_dir() / f"kp_{profile_name}.csv"
    if not path.is_file():
        return []
    series: list[tuple[float, float, float]] = []
    with path.open(newline="") as handle:
        for row in csv.DictReader(handle):
            if "time_s" in row and row["time_s"]:
                t = float(row["time_s"])
            elif row.get("hours"):
                t = float(row["hours"]) * 3600.0
            else:
                continue
            series.append((t, float(row.get("kp") or 0.0), float(row.get("dst_nt") or 0.0)))
    return sorted(series)


def load_profile(name: str, severity: str | None = None) -> StormProfile:
    """A profile from `calib/`, falling back to placeholders field by field."""
    base = placeholder_profile(severity or "G5", name=name)
    path = calib_dir() / "storm_effects.csv"
    row: dict[str, str] | None = None
    if path.is_file():
        with path.open(newline="") as handle:
            for candidate in csv.DictReader(handle):
                if (candidate.get("profile") or "").strip() == name:
                    row = candidate
                    break
    if row is None:
        base.series = _read_series(name)
        if base.series:
            base.sources["series"] = f"calib/kp_{name}.csv"
        return base

    cited = str(row.get("source_url") or "calib/storm_effects.csv")

    def take(column: str, key: str, cast: Any = float) -> None:
        value = (row or {}).get(column)
        if value not in (None, ""):
            setattr(base, key, cast(value))
            base.sources[key] = cited

    if row.get("severity"):
        base.severity = str(row["severity"]).strip()
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
    base.series = _read_series(name)
    if base.series:
        base.sources["series"] = f"calib/kp_{name}.csv"
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
