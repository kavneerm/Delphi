"""The live bridge: one seat, one client, over a real socket.

The property that matters is the leak guard — a live operator must see their own
filtered view and never the god's-eye log. `test_bridge_never_streams_the_answer`
is the one to keep.
"""

from __future__ import annotations

import asyncio
import json

import pytest
from conftest import make_config

from engine.bridge import PUBLIC_EVENTS, Bridge, _safe_event


def _config():
    return make_config(
        duration_s=6 * 3600,
        clock_mode={
            "mode": "checkpoint",
            "schedule_type": "fixed",
            "interval_s": 3600,
            "seal_decisions": True,
        },
        release_policy={
            "policy": "human",
            "pause_clock": True,
            "on_timeout": "deny",
            "route_to_seat": "nsc",
        },
    )


async def _drive(bridge: Bridge, host: str = "127.0.0.1", port: int = 8791) -> list[dict]:
    """Run the TCP transport, answer every prompt, collect what came back."""
    from engine.bridge import _serve_tcp

    bridge.themeloop = asyncio.get_running_loop()
    bridge.outbox = asyncio.Queue()
    server = asyncio.create_task(_serve_tcp(bridge, host, port))
    await asyncio.sleep(0.2)

    reader, writer = await asyncio.open_connection(host, port)
    received: list[dict] = []
    try:
        while True:
            raw = await asyncio.wait_for(reader.readline(), timeout=30)
            if not raw:
                break
            message = json.loads(raw)
            received.append(message)
            if message["type"] == "ended":
                break
            if message["type"] == "prompt":
                if message["kind"] == "decision":
                    writer.write(
                        json.dumps(
                            {
                                "type": "decision",
                                "decision": {
                                    "beliefs": {
                                        "hostile": 0.4,
                                        "natural": 0.4,
                                        "unknown": 0.2,
                                        "per_actor": {},
                                    },
                                    "messages": [],
                                    "action": {"type": "hold", "params": {}},
                                    "reasoning": "Operator holds pending better information.",
                                },
                            }
                        ).encode()
                        + b"\n"
                    )
                else:
                    writer.write(
                        json.dumps(
                            {
                                "type": "release",
                                "release_id": message["request"]["release_id"],
                                "granted": False,
                                "rationale": "Operator withholds release.",
                            }
                        ).encode()
                        + b"\n"
                    )
                await writer.drain()
    finally:
        writer.close()
        server.cancel()
    return received


@pytest.mark.asyncio
async def test_bridge_runs_an_episode_with_an_operator_in_the_seat() -> None:
    bridge = Bridge(_config(), seat="nsc")
    received = await _drive(bridge, port=8791)
    kinds = [m["type"] for m in received]
    assert kinds[0] == "hello"
    assert kinds[-1] == "ended"
    assert "prompt" in kinds, "the operator must actually be asked for something"
    hello = received[0]
    assert hello["seat"] == "nsc"
    assert hello["release_policy"] == "human"
    assert hello["menu"] and hello["ladder"]
    # Every prompt was answered, so the episode reached its end.
    assert received[-1]["summary"]["reason"] in ("time_limit", "terminal_action")


@pytest.mark.asyncio
async def test_bridge_never_streams_the_answer() -> None:
    """The event log is the god's-eye record. A live operator gets their view."""
    bridge = Bridge(_config(), seat="nsc")
    received = await _drive(bridge, port=8792)
    for message in received:
        if message["type"] != "event":
            continue
        event = message["event"]
        assert event["type"] != "attribution_revealed", "the reveal must never stream live"
        if event["type"] not in PUBLIC_EVENTS:
            assert event["seat"] == "nsc", "only this seat's own traffic streams"

    # Nothing sent to the client may carry the hidden affiliation or another
    # seat's private type.
    assert bridge.episode is not None
    secrets = [bridge.episode.hacktivist.affiliation]
    secrets += [
        str(spec["private_type"])
        for spec in bridge.episode.specs.values()
        if spec.get("private_type")
    ]
    live = json.dumps([m for m in received if m["type"] != "ended"])
    for secret in secrets:
        assert secret not in live, f"the bridge leaked {secret!r} to a live operator"


@pytest.mark.asyncio
async def test_a_malformed_message_is_an_error_not_the_end_of_the_episode() -> None:
    from engine.bridge import _serve_tcp

    bridge = Bridge(_config(), seat="nsc")
    bridge.themeloop = asyncio.get_running_loop()
    bridge.outbox = asyncio.Queue()
    server = asyncio.create_task(_serve_tcp(bridge, "127.0.0.1", 8793))
    await asyncio.sleep(0.2)
    reader, writer = await asyncio.open_connection("127.0.0.1", 8793)
    try:
        await asyncio.wait_for(reader.readline(), timeout=10)  # hello
        writer.write(b"{not json\n")
        writer.write(json.dumps({"type": "nonsense"}).encode() + b"\n")
        writer.write(json.dumps({"type": "decision", "decision": "oops"}).encode() + b"\n")
        await writer.drain()
        errors = 0
        for _ in range(12):
            message = json.loads(await asyncio.wait_for(reader.readline(), timeout=10))
            if message["type"] == "error":
                errors += 1
            if errors >= 3:
                break
        assert errors >= 3, "each malformed message must come back as an error"
        assert bridge.episode is None or not bridge._done.is_set()
    finally:
        writer.close()
        server.cancel()


def test_the_event_filter_is_conservative() -> None:
    for kind in ("state_change", "attribution_revealed"):
        assert not _safe_event({"type": kind, "seat": None}, "nsc")
    assert not _safe_event({"type": "action", "seat": "kremlin"}, "nsc")
    assert _safe_event({"type": "action", "seat": "nsc"}, "nsc")
    assert _safe_event({"type": "storm_update", "seat": None}, "nsc")
    assert _safe_event({"type": "release_requested", "seat": "usspacecom"}, "nsc")
