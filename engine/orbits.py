"""Two-body propagation and impulsive maneuvers.

Deliberately small: classical elements in, position and velocity out, plus an
impulsive burn that changes the elements. No perturbations, no conjunction
analysis — `docs/agent_workstreams.md` rules both out. What this has to be is
*deterministic* and good enough to draw a ground track and to make propellant a
finite, spendable thing.
"""

from __future__ import annotations

import math
from typing import Any

MU_EARTH = 398600.4418  # km^3/s^2
R_EARTH = 6378.137  # km
EARTH_ROT_RAD_S = 7.2921159e-5

__all__ = [
    "MU_EARTH",
    "R_EARTH",
    "apply_impulse",
    "elements_to_state",
    "ground_track",
    "period_s",
    "propagate",
    "state_to_elements",
]


def period_s(a_km: float) -> float:
    return 2.0 * math.pi * math.sqrt(a_km**3 / MU_EARTH)


def _solve_kepler(mean_anomaly: float, e: float, tol: float = 1e-11) -> float:
    """Newton on M = E - e sin E. Fixed iteration cap keeps it deterministic."""
    m = math.fmod(mean_anomaly, 2 * math.pi)
    ecc = m if e < 0.8 else math.pi
    for _ in range(60):
        f = ecc - e * math.sin(ecc) - m
        fp = 1.0 - e * math.cos(ecc)
        step = f / fp
        ecc -= step
        if abs(step) < tol:
            break
    return ecc


def _rotate(vec: tuple[float, float, float], elements: dict[str, float]) -> list[float]:
    """Perifocal -> ECI through argp, inclination, RAAN."""
    argp = math.radians(elements["argp_deg"])
    inc = math.radians(elements["inc_deg"])
    raan = math.radians(elements["raan_deg"])
    x, y, _ = vec
    cw, sw = math.cos(argp), math.sin(argp)
    ci, si = math.cos(inc), math.sin(inc)
    co, so = math.cos(raan), math.sin(raan)
    x1 = x * cw - y * sw
    y1 = x * sw + y * cw
    z1 = 0.0
    y2 = y1 * ci - z1 * si
    z2 = y1 * si + z1 * ci
    return [x1 * co - y2 * so, x1 * so + y2 * co, z2]


def elements_to_state(elements: dict[str, Any], t_s: float) -> tuple[list[float], list[float]]:
    """Position and velocity in ECI (km, km/s) at epoch + `t_s` seconds."""
    a = float(elements["a_km"])
    e = float(elements["e"])
    n = math.sqrt(MU_EARTH / a**3)
    m = math.radians(float(elements["m0_deg"])) + n * (t_s - float(elements.get("epoch_s", 0.0)))
    ecc = _solve_kepler(m, e)
    nu = 2.0 * math.atan2(
        math.sqrt(1 + e) * math.sin(ecc / 2.0), math.sqrt(1 - e) * math.cos(ecc / 2.0)
    )
    r = a * (1 - e * math.cos(ecc))
    p = a * (1 - e * e)
    r_pf = (r * math.cos(nu), r * math.sin(nu), 0.0)
    factor = math.sqrt(MU_EARTH / p)
    v_pf = (-factor * math.sin(nu), factor * (e + math.cos(nu)), 0.0)
    return _rotate(r_pf, elements), _rotate(v_pf, elements)


def state_to_elements(r_vec: list[float], v_vec: list[float], t_s: float) -> dict[str, float]:
    """ECI state back to classical elements, with the epoch set to `t_s`."""
    rx, ry, rz = r_vec
    vx, vy, vz = v_vec
    r = math.sqrt(rx * rx + ry * ry + rz * rz)
    v2 = vx * vx + vy * vy + vz * vz
    h = [ry * vz - rz * vy, rz * vx - rx * vz, rx * vy - ry * vx]
    hn = math.sqrt(sum(c * c for c in h))
    node = [-h[1], h[0], 0.0]
    nn = math.sqrt(node[0] ** 2 + node[1] ** 2)
    rdotv = rx * vx + ry * vy + rz * vz
    e_vec = [
        ((v2 - MU_EARTH / r) * rx - rdotv * vx) / MU_EARTH,
        ((v2 - MU_EARTH / r) * ry - rdotv * vy) / MU_EARTH,
        ((v2 - MU_EARTH / r) * rz - rdotv * vz) / MU_EARTH,
    ]
    e = math.sqrt(sum(c * c for c in e_vec))
    energy = v2 / 2.0 - MU_EARTH / r
    a = -MU_EARTH / (2.0 * energy)
    inc = math.degrees(math.acos(max(-1.0, min(1.0, h[2] / hn))))
    raan = math.degrees(math.atan2(node[1], node[0])) % 360.0 if nn > 1e-9 else 0.0
    if nn > 1e-9 and e > 1e-9:
        argp = math.degrees(
            math.acos(max(-1.0, min(1.0, sum(node[i] * e_vec[i] for i in range(3)) / (nn * e))))
        )
        if e_vec[2] < 0:
            argp = 360.0 - argp
    else:
        argp = 0.0
    if e > 1e-9:
        nu = math.acos(max(-1.0, min(1.0, sum(e_vec[i] * r_vec[i] for i in range(3)) / (e * r))))
        if rdotv < 0:
            nu = 2 * math.pi - nu
    else:
        nu = math.atan2(ry, rx)
    ecc = 2.0 * math.atan2(math.sqrt(1 - e) * math.sin(nu / 2), math.sqrt(1 + e) * math.cos(nu / 2))
    m = ecc - e * math.sin(ecc)
    return {
        "a_km": a,
        "e": e,
        "inc_deg": inc,
        "raan_deg": raan,
        "argp_deg": argp,
        "m0_deg": math.degrees(m) % 360.0,
        "epoch_s": float(t_s),
    }


def propagate(elements: dict[str, Any], t_s: float) -> dict[str, Any]:
    """Advance the epoch without changing the orbit. Cheap and exact."""
    a = float(elements["a_km"])
    n = math.degrees(math.sqrt(MU_EARTH / a**3))
    dt = t_s - float(elements.get("epoch_s", 0.0))
    out = dict(elements)
    out["m0_deg"] = (float(elements["m0_deg"]) + n * dt) % 360.0
    out["epoch_s"] = float(t_s)
    return out


def apply_impulse(
    elements: dict[str, Any], t_s: float, delta_v_mps: float, direction: str = "prograde"
) -> dict[str, Any]:
    """An impulsive burn: instantaneous velocity change, new orbit.

    `direction` is one of prograde / retrograde / radial / normal. Anything else
    is treated as prograde, because a seat that asked for something exotic still
    spends the propellant.
    """
    r_vec, v_vec = elements_to_state(elements, t_s)
    dv_kms = float(delta_v_mps) / 1000.0
    vn = math.sqrt(sum(c * c for c in v_vec)) or 1e-9
    unit_v = [c / vn for c in v_vec]
    rn = math.sqrt(sum(c * c for c in r_vec)) or 1e-9
    unit_r = [c / rn for c in r_vec]
    if direction == "retrograde":
        axis = [-c for c in unit_v]
    elif direction == "radial":
        axis = unit_r
    elif direction == "normal":
        h = [
            r_vec[1] * v_vec[2] - r_vec[2] * v_vec[1],
            r_vec[2] * v_vec[0] - r_vec[0] * v_vec[2],
            r_vec[0] * v_vec[1] - r_vec[1] * v_vec[0],
        ]
        hn = math.sqrt(sum(c * c for c in h)) or 1e-9
        axis = [c / hn for c in h]
    else:
        axis = unit_v
    new_v = [v_vec[i] + axis[i] * dv_kms for i in range(3)]
    out = state_to_elements(r_vec, new_v, t_s)
    for key in ("name", "hosted_payload"):
        if key in elements:
            out[key] = elements[key]
    return out


def ground_track(elements: dict[str, Any], t_s: float) -> dict[str, float]:
    """Sub-satellite latitude, longitude and altitude. For the UI map."""
    r_vec, _ = elements_to_state(elements, t_s)
    x, y, z = r_vec
    r = math.sqrt(x * x + y * y + z * z)
    lat = math.degrees(math.asin(max(-1.0, min(1.0, z / r))))
    lon_inertial = math.degrees(math.atan2(y, x))
    lon = (lon_inertial - math.degrees(EARTH_ROT_RAD_S * t_s) + 180.0) % 360.0 - 180.0
    return {"lat_deg": round(lat, 4), "lon_deg": round(lon, 4), "alt_km": round(r - R_EARTH, 3)}
