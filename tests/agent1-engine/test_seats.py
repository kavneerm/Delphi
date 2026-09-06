"""Filtered views: what a seat can see, and what it must never see.

`contracts/lake_record_schema.json` is explicit — `filtered_state` becomes the
user turn of a training example, so a leak here trains a model to know things it
will not know at evaluation. These are the tests that catch that.
"""

from __future__ import annotations

import json

from conftest import make_config, run

from engine.contracts import OPERATOR_SEATS, RUNG, SEATS


def _all_views(episode) -> dict[str, dict]:
    return {seat: episode.view(seat) for seat in episode.seats.played}


def test_no_view_contains_another_seats_private_type() -> None:
    episode = run(make_config())
    secrets = {
        seat: str(spec["private_type"])
        for seat, spec in episode.specs.items()
        if spec.get("private_type")
    }
    assert secrets, "the fixture must include at least one seat with a hidden type"
    for seat, view in _all_views(episode).items():
        blob = json.dumps(view)
        for owner, value in secrets.items():
            if owner == seat:
                continue
            assert value not in blob, f"{seat}'s view leaks {owner}'s private_type"


def test_no_view_contains_the_hacktivist_affiliation() -> None:
    """Ground truth, drawn per run, revealed only at episode end."""
    episode = run(make_config())
    affiliation = episode.hacktivist.affiliation
    for seat, view in _all_views(episode).items():
        assert affiliation not in json.dumps(view), f"{seat}'s view leaks the affiliation"
    reveal = [
        line
        for line in episode.log.lines
        if line["type"] == "attribution_revealed" and "private_types" in line["payload"]
    ]
    assert reveal, "the episode must reveal ground truth at the end"
    assert reveal[-1]["payload"]["private_types"]["hacktivist_injects"] == affiliation


def test_no_view_contains_the_true_storm_state() -> None:
    """A seat sees SWPC's forecast, which carries this run's error, not the truth."""
    episode = run(make_config())
    for seat in episode.seats.played:
        weather = episode.view(seat)["space_weather"]
        if not weather:
            continue
        assert "forecast_confidence" in weather
        assert set(weather) <= {
            "reported_kp",
            "severity",
            "as_of_sim_time_s",
            "forecast_confidence",
            "source",
        }


def test_a_view_carries_only_delivered_messages() -> None:
    episode = run(make_config())
    for seat in episode.seats.played:
        view = episode.view(seat)
        for entry in view["messages_seen"]:
            assert entry["delivered_at_sim_time_s"] <= episode.loop.sim_time_s


def test_only_operator_seats_read_the_telemetry_signature() -> None:
    episode = run(make_config())
    saw_a_real_signature = False
    for seat in episode.seats.played:
        for effect in episode.view(seat)["observed_effects"]:
            signature = effect["telemetry_signature"]
            if seat in OPERATOR_SEATS:
                if signature != "unknown":
                    saw_a_real_signature = True
            else:
                assert signature == "unknown", f"{seat} is not an operator seat"
    assert saw_a_real_signature, "an operator seat should read at least one real signature"


def test_available_actions_are_the_menu_intersected_with_authority() -> None:
    episode = run(make_config())
    for seat in episode.seats.played:
        menu = episode.view(seat)["available_actions"]
        authority = episode.specs[seat]["authority"]
        allowed = set(authority["unilateral"]) | set(authority["requires_release"]) | {"hold"}
        assert set(menu) <= allowed
        # recommend_only is never executable.
        assert not set(menu) & (set(authority["recommend_only"]) - allowed)
        assert menu == sorted(menu, key=lambda a: RUNG[a])


def test_a_seat_never_receives_an_inject_on_a_feed_it_does_not_have() -> None:
    episode = run(make_config())
    for seat in episode.seats.played:
        feeds = set(episode.seats[seat].feeds)
        for inject in episode.view(seat)["injects_seen"]:
            feed = inject.get("feed")
            if feed:
                assert feed in feeds, f"{seat} received an inject on a feed it does not have"


def test_injects_never_carry_their_scoring_keys_to_a_seat() -> None:
    """`truthful` and `is_knife_inject` are scoring fields, not seat-visible."""
    episode = run(make_config())
    for seat in episode.seats.played:
        for inject in episode.view(seat)["injects_seen"]:
            assert "truthful" not in inject
            assert "is_knife_inject" not in inject


def test_every_seat_gets_a_view_and_the_nine_seats_are_the_contract_seats() -> None:
    episode = run(make_config())
    assert set(episode.seats.played) == set(SEATS)
    for seat in SEATS:
        view = episode.view(seat)
        assert view["seat"] == seat
        assert "own_assets" in view and "clock" in view


def test_clearance_drops_a_message_the_recipient_cannot_read() -> None:
    episode = run(make_config())
    reason = episode.seats.drop_reason(
        "starlink",
        {"channel": "diplomatic", "classification": "top_secret_sci"},
        "top_secret_sci",
        1.0,
    )
    assert reason == "clearance"
    assert (
        episode.seats.drop_reason(
            "nsc", {"channel": "diplomatic", "classification": "secret"}, "secret", 1.0
        )
        is None
    )
