"""`python -m engine.storm_check --profile may2024` — the env-lock numbers.

Prints what a storm profile does to the world, so a human can hold it against
`calib/storm_effects.csv` and the operator record before freezing `env_v1`. This
is the `env_lock` gate in `docs/COORDINATION.md` §9.

    python -m engine.storm_check --profile may2024
    python -m engine.storm_check --profile may2024 --seeds 20 --severity G5

Two blocks come out. The **curve** is deterministic: Kp, Dst, the two
multipliers, and when the tracking-degradation and screening-suspension windows
open and close. The **draws** are stochastic, so they are reported across seeds
with a median and a range — a single seed's safe-mode count is not a number
anyone should be checking against a real storm.

Every figure says where it came from. `TODO_CALIB` means the engine is running
on a placeholder curve because `calib/storm_effects.csv` has no row for this
profile yet, and a number sourced from a placeholder is not evidence.
"""

from __future__ import annotations

import argparse
import statistics
from typing import Any

from engine.config import DEFAULT_ENGINE_PARAMS
from engine.rng import RngBook
from engine.storm import TODO_CALIB, StormLayer, load_profile
from engine.world import World

__all__ = ["main", "storm_report"]


def storm_report(
    profile_name: str,
    *,
    severity: str | None = None,
    hours: float = 72.0,
    seeds: int = 10,
    interval_s: int = 3600,
) -> dict[str, Any]:
    """Run the storm layer alone, without seats or attacks, across seeds."""
    profile = load_profile(profile_name, severity)
    if severity:
        profile.severity = severity
    duration_s = int(hours * 3600)
    params = dict(DEFAULT_ENGINE_PARAMS)

    # --- the curve, which does not depend on the seed ------------------------
    curve_layer = StormLayer(profile, params=params)
    curve: list[dict[str, Any]] = []
    for t in range(0, duration_s + 1, interval_s):
        curve.append({"sim_time_s": t, **curve_layer.update(t)})
    curve_layer.close_windows(duration_s)
    peak = max(curve, key=lambda row: float(row["kp"]))

    # --- the draws, which do -------------------------------------------------
    safe_modes: list[int] = []
    per_class: dict[str, list[int]] = {"heo_node": [], "constellation": [], "pass_sensor": []}
    for seed in range(seeds):
        rng = RngBook(seed)
        layer = StormLayer(profile, params=params)
        world = World(params)
        counts = {"heo_node": 0, "constellation": 0, "pass_sensor": 0}
        for t in range(0, duration_s + 1, interval_s):
            layer.update(t)
            hours_step = interval_s / 3600.0
            for asset_id in world.all_asset_ids():
                asset = world.asset(asset_id) or {}
                klass = str(asset.get("asset_class"))
                if klass not in counts:
                    continue
                hazard = layer.safe_mode_hazard(klass, hours_step)
                if hazard <= 0:
                    continue
                if klass == "constellation":
                    active = int(asset.get("members_active", 0))
                    drawn = min(active, rng.poisson(f"safemode:{asset_id}:{t}", active * hazard))
                    if drawn:
                        counts[klass] += drawn
                        asset["members_active"] = active - drawn
                        asset["members_safe_mode"] = int(asset.get("members_safe_mode", 0)) + drawn
                elif not asset.get("safe_mode") and rng.chance(f"safemode:{asset_id}:{t}", hazard):
                    counts[klass] += 1
                    asset["safe_mode"] = True
        for klass, value in counts.items():
            per_class[klass].append(value)
        safe_modes.append(sum(counts.values()))

    return {
        "profile": profile.name,
        "severity": profile.severity,
        "hours": hours,
        "seeds": seeds,
        "sources": dict(profile.sources),
        "placeholder": profile.is_placeholder,
        "has_series": bool(profile.series),
        "peak_kp": peak["kp"],
        "peak_at_hours": round(peak["sim_time_s"] / 3600.0, 2),
        "min_dst_nt": min(float(row["dst_nt"]) for row in curve),
        "min_sensor_confidence_multiplier": min(
            float(row["sensor_confidence_multiplier"]) for row in curve
        ),
        "min_comms_bandwidth_multiplier": min(
            float(row["comms_bandwidth_multiplier"]) for row in curve
        ),
        "tracking_degraded_hours": curve_layer.window_hours("tracking", duration_s),
        "screening_suspended_hours": curve_layer.window_hours("screening", duration_s),
        "tracking_windows": curve_layer.tracking_windows,
        "screening_windows": curve_layer.screening_windows,
        "safe_mode_median": statistics.median(safe_modes) if safe_modes else 0,
        "safe_mode_min": min(safe_modes) if safe_modes else 0,
        "safe_mode_max": max(safe_modes) if safe_modes else 0,
        "safe_mode_by_class": {
            klass: {
                "median": statistics.median(values) if values else 0,
                "min": min(values) if values else 0,
                "max": max(values) if values else 0,
            }
            for klass, values in sorted(per_class.items())
        },
        "curve": curve,
        "calibration_claim": {
            "tracking_degradation_hours": profile.tracking_degradation_hours,
            "screening_suspension_hours": profile.screening_suspension_hours,
            "satellites_lost": profile.satellites_lost,
        },
    }


def _fmt_windows(windows: list[list[float | None]]) -> str:
    if not windows:
        return "none"
    parts = []
    for start, end in windows:
        finish = "open" if end is None else f"{float(end) / 3600:.1f}h"
        parts.append(f"{float(start) / 3600:.1f}h-{finish}")
    return ", ".join(parts)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="engine.storm_check",
        description="Storm-layer numbers for the env_lock gate.",
    )
    parser.add_argument("--profile", default="may2024")
    parser.add_argument("--severity", default=None, help="override the profile's G-scale")
    parser.add_argument("--hours", type=float, default=72.0)
    parser.add_argument("--seeds", type=int, default=10)
    parser.add_argument("--json", action="store_true", help="dump the whole report as JSON")
    args = parser.parse_args(argv)

    report = storm_report(args.profile, severity=args.severity, hours=args.hours, seeds=args.seeds)
    if args.json:
        import json

        print(json.dumps(report, indent=2, sort_keys=True))
        return 0

    print(f"storm profile        {report['profile']}  ({report['severity']})")
    print(f"episode              {report['hours']:.0f} sim hours, {report['seeds']} seeds")
    print(f"kp/dst series        {'from calib/' if report['has_series'] else 'from curve'}")
    print()
    print("CURVE (deterministic)")
    print(f"  peak Kp            {report['peak_kp']:.2f} at +{report['peak_at_hours']:.1f}h")
    print(f"  minimum Dst        {report['min_dst_nt']:.1f} nT")
    print(f"  sensor confidence  x{report['min_sensor_confidence_multiplier']:.3f} at worst")
    print(f"  comms bandwidth    x{report['min_comms_bandwidth_multiplier']:.3f} at worst")
    print(
        f"  tracking degraded  {report['tracking_degraded_hours']:.1f} h"
        f"   [{_fmt_windows(report['tracking_windows'])}]"
    )
    print(
        f"  screening susp.    {report['screening_suspended_hours']:.1f} h"
        f"   [{_fmt_windows(report['screening_windows'])}]"
    )
    print()
    print("SAFE MODES (drawn, across seeds)")
    print(
        f"  total              median {report['safe_mode_median']:.0f}"
        f"  range {report['safe_mode_min']}-{report['safe_mode_max']}"
    )
    for klass, stats in report["safe_mode_by_class"].items():
        print(f"  {klass:<17}  median {stats['median']:.0f}  range {stats['min']}-{stats['max']}")
    print()
    claim = report["calibration_claim"]
    print("CALIBRATION ROW (what calib/storm_effects.csv asserts for this profile)")
    print(f"  tracking hours     {claim['tracking_degradation_hours']}")
    print(f"  screening hours    {claim['screening_suspension_hours']}")
    print(f"  satellites lost    {claim['satellites_lost']}")
    print()
    print("SOURCES")
    for field, source in sorted(report["sources"].items()):
        print(f"  {field:<18} {source}")
    if report["placeholder"]:
        print()
        print("WARNING: at least one field is a TODO_CALIB placeholder. These numbers are the")
        print("engine's shape, not evidence. Do not freeze env_v1 on them — they need a row in")
        print("calib/storm_effects.csv first.")
    else:
        print()
        print(f"Every field is calibrated. Ready for the env_lock gate ({TODO_CALIB} absent).")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
