"""The storm layer, the attack layer, the physics and the utility function."""

from __future__ import annotations

import math

from conftest import make_config, run

from engine.attacks import AttackLayer, load_attribution_lags
from engine.contracts import OPERATOR_SEATS
from engine.orbits import apply_impulse, elements_to_state, ground_track, state_to_elements
from engine.rng import RngBook
from engine.specs import load_pool
from engine.storm import TODO_CALIB, StormLayer, load_profile, placeholder_profile
from engine.storm_check import storm_report
from engine.utility import NEGATED, TERMS, SeatTally, episode_utilities, utility_from_terms
from engine.world import World

MOLNIYA = {
    "a_km": 26560.0,
    "e": 0.72,
    "inc_deg": 63.4,
    "raan_deg": 30.0,
    "argp_deg": 270.0,
    "m0_deg": 0.0,
    "epoch_s": 0.0,
}


# --- physics ------------------------------------------------------------------


def test_elements_round_trip_through_a_state_vector() -> None:
    r, v = elements_to_state(MOLNIYA, 3600.0)
    back = state_to_elements(r, v, 3600.0)
    for key in ("a_km", "e", "inc_deg", "raan_deg"):
        assert math.isclose(back[key], MOLNIYA[key], rel_tol=1e-6, abs_tol=1e-6)


def test_a_prograde_burn_raises_the_orbit_and_spends_propellant() -> None:
    raised = apply_impulse(MOLNIYA, 0.0, 50.0, "prograde")
    assert raised["a_km"] > MOLNIYA["a_km"]
    world = World()
    before = world.asset("asbm_1")["delta_v_budget_mps"]
    result = world.maneuver("asbm_1", 25.0, 3600, "prograde")
    assert result["ok"] and result["delta_v_mps"] == 25.0
    assert world.asset("asbm_1")["delta_v_budget_mps"] == before - 25.0


def test_propellant_is_finite() -> None:
    world = World()
    budget = world.asset("asbm_1")["delta_v_budget_mps"]
    world.maneuver("asbm_1", budget, 0, "prograde")
    assert world.maneuver("asbm_1", 10.0, 0, "prograde")["ok"] is False


def test_a_molniya_apogee_sits_over_the_north() -> None:
    """Sanity, not precision: the Arctic node must be over the Arctic."""
    at_apogee = ground_track(MOLNIYA, 21600.0)
    assert at_apogee["lat_deg"] > 60.0
    assert at_apogee["alt_km"] > 30_000.0


def test_a_pass_sensor_sees_in_lumps() -> None:
    world = World()
    seen = [world.pass_open("vardo_radar", t) for t in range(0, 10800, 300)]
    assert any(seen) and not all(seen)


# --- storm --------------------------------------------------------------------


def test_multipliers_fall_monotonically_with_kp() -> None:
    layer = StormLayer(placeholder_profile("G5"))
    previous_sensor, previous_comms = 1.01, 1.01
    for kp in [float(k) for k in range(10)]:
        layer.kp = kp
        payload = layer.update(0)
        layer.kp = kp  # update recomputes from the curve; force the sweep
        from engine.storm import COMMS_BANDWIDTH_KNOTS, SENSOR_CONFIDENCE_KNOTS, _interp

        sensor = _interp(SENSOR_CONFIDENCE_KNOTS, kp)
        comms = _interp(COMMS_BANDWIDTH_KNOTS, kp)
        assert sensor <= previous_sensor and comms <= previous_comms
        previous_sensor, previous_comms = sensor, comms
        assert 0.0 <= payload["sensor_confidence_multiplier"] <= 1.0


def test_severity_orders_the_storms() -> None:
    peaks = []
    for severity in ("quiet", "G1", "G3", "G5"):
        layer = StormLayer(placeholder_profile(severity))
        peaks.append(max(layer.update(t * 3600)["kp"] for t in range(72)))
    assert peaks == sorted(peaks)


def test_windows_open_and_close_with_hysteresis() -> None:
    layer = StormLayer(placeholder_profile("G5"))
    for t in range(0, 72 * 3600, 3600):
        layer.update(t)
    layer.close_windows(72 * 3600)
    assert layer.window_hours("tracking", 72 * 3600) > 0
    # Screening suspends at a higher Kp than tracking degrades, so it is shorter.
    assert layer.window_hours("screening", 72 * 3600) <= layer.window_hours("tracking", 72 * 3600)


def test_safe_mode_hazard_rises_with_severity_and_is_zero_when_quiet() -> None:
    quiet = StormLayer(placeholder_profile("quiet"))
    severe = StormLayer(placeholder_profile("G5"))
    for t in range(0, 24 * 3600, 3600):
        quiet.update(t)
        severe.update(t)
    assert quiet.safe_mode_hazard("constellation", 1.0) == 0.0
    assert severe.safe_mode_hazard("constellation", 1.0) > 0.0


def test_per_seat_exposure_differentiates_the_degradation() -> None:
    layer = StormLayer(placeholder_profile("G5"))
    layer.update(8 * 3600)
    operator = layer.seat_multipliers("starlink")["sensor_confidence"]
    diplomat = layer.seat_multipliers("nsc")["sensor_confidence"]
    assert operator < diplomat, "the seat living off spacecraft telemetry is hit harder"


def test_a_profile_with_no_calibration_says_so() -> None:
    profile = load_profile("no_such_profile", "G5")
    assert profile.is_placeholder
    assert TODO_CALIB in profile.sources.values()
    report = storm_report("no_such_profile", severity="G5", hours=12, seeds=2)
    assert report["placeholder"] is True


def test_storm_check_reports_the_numbers_the_env_lock_gate_needs() -> None:
    report = storm_report("synthetic", severity="G5", hours=72, seeds=3)
    for field in (
        "peak_kp",
        "min_dst_nt",
        "tracking_degraded_hours",
        "screening_suspended_hours",
        "safe_mode_median",
        "sources",
    ):
        assert field in report
    assert report["safe_mode_max"] >= report["safe_mode_median"] >= report["safe_mode_min"]


# --- attacks ------------------------------------------------------------------


def test_each_attack_type_produces_an_effect_with_a_lag_and_a_signature() -> None:
    rng = RngBook(3)
    layer = AttackLayer(load_attribution_lags())
    for action_type, params in (
        ("jam", {"target_asset_id": "starlink_arctic", "duration_minutes": 60}),
        ("dazzle", {"target_asset_id": "gssap_analog_1", "duration_minutes": 30}),
        ("ground_cyber", {"target_system": "gateway", "effect": "degrade"}),
        ("counter_rpo", {"target_asset_id": "rf_inspector_1", "standoff_km": 20}),
    ):
        effect = layer.launch(
            action_type=action_type, actor="northern_fleet", params=params, now_s=0, rng=rng
        )
        assert effect.end_s > effect.start_s
        assert effect.attribution_time_s > effect.start_s
        assert effect.signature != "natural"
        assert effect.cause.startswith("hostile_")


def test_attribution_lag_orders_the_attack_types() -> None:
    """Cyber is named slowest; that is the shape the public record has."""
    profiles = load_attribution_lags()
    assert profiles["ground_cyber"].median_hours > profiles["dazzle"].median_hours
    assert profiles["dazzle"].median_hours > profiles["jam"].median_hours


def test_a_natural_outage_looks_the_same_but_signs_itself_honestly() -> None:
    layer = AttackLayer()
    natural = layer.natural(
        now_s=0,
        duration_s=3600,
        target_asset_id="starlink_arctic",
        magnitude=0.5,
        description="safe mode",
    )
    assert natural.signature == "natural"
    assert natural.cause == "natural_space_weather"
    operator = natural.observable_for("usspacecom", 100)
    bystander = natural.observable_for("nsc", 100)
    assert operator["telemetry_signature"] == "natural"
    assert bystander["telemetry_signature"] == "unknown"
    assert operator["severity"] == bystander["severity"], "the outage itself is not hidden"


def test_only_operator_seats_are_the_contract_operator_seats() -> None:
    assert OPERATOR_SEATS == {
        "usspacecom",
        "norway",
        "starlink",
        "iridium",
        "northern_fleet",
    }


# --- utility ------------------------------------------------------------------


def test_the_sign_convention_is_fixed_by_the_engine() -> None:
    spec = load_pool()["nsc"]
    neutral = dict.fromkeys(TERMS, 0.0)
    baseline = utility_from_terms(spec, neutral)
    for term in TERMS:
        moved = dict(neutral)
        moved[term] = 1.0
        score = utility_from_terms(spec, moved)
        if spec["utility_weights"][term] == 0:
            continue
        if term in NEGATED:
            assert score < baseline, f"{term} is negated and must lower utility"
        else:
            assert score > baseline, f"{term} is positive and must raise utility"


def test_utility_is_normalised_so_seats_are_comparable() -> None:
    specs = load_pool()
    world = World()
    tallies = {seat: SeatTally(seat=seat) for seat in specs}
    utilities, terms = episode_utilities(
        specs=specs,
        world=world,
        tallies=tallies,
        storm=None,
        duration_hours=72,
        initial_capacity_gbps=world.arctic_capacity_gbps(),
    )
    assert set(utilities) == set(specs)
    for value in utilities.values():
        assert -1.0 <= value <= 1.0
    for seat_terms in terms.values():
        assert all(0.0 <= v <= 1.0 for v in seat_terms.values())


def test_red_scores_alliance_cohesion_upside_down() -> None:
    """seats.md: for Red, the value is in splitting them."""
    specs = load_pool()
    world = World()
    tallies = {seat: SeatTally(seat=seat) for seat in specs}
    _, terms = episode_utilities(
        specs=specs,
        world=world,
        tallies=tallies,
        storm=None,
        duration_hours=72,
        initial_capacity_gbps=world.arctic_capacity_gbps(),
    )
    blue = terms["norway"]["alliance_cohesion"]
    red = terms["northern_fleet"]["alliance_cohesion"]
    assert math.isclose(blue + red, 1.0, abs_tol=1e-6)


def test_utilities_land_on_the_episode_end_line() -> None:
    episode = run(make_config())
    end = episode.log.lines[-1]["payload"]
    assert set(end["utilities"]) == set(episode.specs)
    assert all(isinstance(v, float) for v in end["utilities"].values())
