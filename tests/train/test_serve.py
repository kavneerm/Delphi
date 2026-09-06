"""serve.py: the served agent against the REAL engine contract, and cost discipline.

`engine/agent_api.py` is on main, so these test the actual seam the engine will
drive rather than a local mock. No network: the Fireworks client is stubbed.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from engine.agent_api import Agent, WakePolicy, validate_decision
from train import filter as filt
from train import serve
from train.fireworks import FireworksError


class FakeClient:
    """Stands in for `train.fireworks.Client`. Records what it was asked."""

    def __init__(self, reply: Any = None, raises: Exception | None = None) -> None:
        self.reply = reply
        self.raises = raises
        self.calls: list[dict] = []
        self.account = "acct"
        self.deleted: list[str] = []

    def chat(self, model: str, messages: list[dict], **kw: Any) -> dict:
        self.calls.append({"model": model, "messages": messages, **kw})
        if self.raises:
            raise self.raises
        content = self.reply if isinstance(self.reply, str) else json.dumps(self.reply)
        return {"choices": [{"message": {"content": content}}]}

    def inference_ref(self, model: str, deployment: str) -> str:
        return f"{model}#{deployment}"

    def ensure_deployment_gone(self, deployment_id: str, **kw: Any) -> dict:
        self.deleted.append(deployment_id)
        return {"deployment": deployment_id, "deleted": True}


VALID = {
    "beliefs": {"hostile": 0.3, "natural": 0.5, "unknown": 0.2, "per_actor": {}},
    "messages": [],
    "action": {"type": "hold", "params": {}},
    "reasoning": "Waiting for the next pass.",
}

SPEC = {
    "spec_id": "norway_v1",
    "seat": "norway",
    "decision_clock": {"poll_minutes": 30, "wake_on_inject": True},
    "authority": {"unilateral": ["hold", "private_demarche"]},
}


def agent(reply: Any = VALID, raises: Exception | None = None) -> serve.ServedAgent:
    return serve.ServedAgent(
        "norway", "accounts/a/models/m", client=FakeClient(reply, raises), spec=SPEC
    )


# ------------------------------------------------------- the engine contract


def test_served_agent_satisfies_the_engine_protocol() -> None:
    assert isinstance(agent(), Agent)


def test_wake_policy_comes_from_the_spec() -> None:
    a = agent()
    assert isinstance(a.wake_policy, WakePolicy)
    assert a.wake_policy.poll_minutes == 30


def test_observe_before_bind_is_an_error_not_a_silent_empty_view() -> None:
    with pytest.raises(RuntimeError, match="not bound"):
        agent().observe()


def test_bind_wires_the_view_provider() -> None:
    a = agent()
    a.bind(lambda: {"own_assets": []})
    assert a.observe() == {"own_assets": []}


def test_act_returns_a_contract_valid_decision() -> None:
    decision = agent().act({"own_assets": []})
    assert validate_decision(decision) == []
    assert decision["action"]["type"] == "hold"


# ------------------------------------------- a drifting model costs one turn


def test_unparseable_output_becomes_a_hold_not_an_exception() -> None:
    """engine/agent_api.py: an invalid decision should cost one decision point,
    not a sweep cell."""
    a = agent(reply="I refuse to answer in JSON.")
    decision = a.act({})
    assert decision["action"]["type"] == "hold"
    assert validate_decision(decision) == []
    assert a.schema_failures == 1


def test_schema_invalid_output_becomes_a_hold() -> None:
    a = agent(reply={"beliefs": {}, "action": {"type": "nope"}})
    assert a.act({})["action"]["type"] == "hold"
    assert a.schema_failures == 1


def test_beliefs_that_do_not_sum_to_one_are_a_failure() -> None:
    bad = json.loads(json.dumps(VALID))
    bad["beliefs"]["hostile"] = 0.9
    a = agent(reply=bad)
    assert a.act({})["action"]["type"] == "hold"
    assert a.schema_failures == 1


def test_a_network_error_becomes_a_hold_too() -> None:
    a = agent(raises=FireworksError("connection reset"))
    decision = a.act({})
    assert decision["action"]["type"] == "hold"
    assert "did not answer" in decision["reasoning"]
    assert a.schema_failures == 1


def test_a_valid_decision_is_not_counted_as_a_failure() -> None:
    a = agent()
    a.act({})
    assert a.schema_failures == 0
    assert a.calls == 1


# --------------------------------------------------------------- the prompt


def test_the_served_prompt_matches_the_trained_prompt() -> None:
    """The system and user turns must render exactly as filter.py trained them,
    or the model meets a prompt shape it never saw."""
    a = agent()
    a.act({"own_assets": [{"asset_id": "sv-1"}]})
    sent = a.client.calls[0]["messages"]
    assert sent[0]["content"] == filt.render_spec(SPEC)
    assert "## FILTERED STATE" in sent[1]["content"]
    assert "## INJECTS SEEN" in sent[1]["content"]


def test_adapter_is_addressed_with_the_deployment_suffix() -> None:
    a = serve.ServedAgent(
        "norway", "accounts/a/models/m", deployment="dep-1", client=FakeClient(VALID)
    )
    assert a.adapter == "accounts/a/models/m#dep-1"


def test_an_already_qualified_ref_is_not_double_suffixed() -> None:
    a = serve.ServedAgent(
        "norway", "accounts/a/models/m#dep-1", deployment="dep-1", client=FakeClient(VALID)
    )
    assert a.adapter.count("#") == 1


# -------------------------------------------------------------- release path


def test_release_defaults_to_deny_when_the_model_is_unusable() -> None:
    granted, why = agent(reply="nonsense").decide_release({"action": "jam"}, {})
    assert granted is False
    assert why


def test_release_can_be_granted_with_a_rationale() -> None:
    a = agent(reply={"granted": True, "rationale": "Evidence is sufficient."})
    granted, why = a.decide_release({"action": "jam"}, {})
    assert granted is True
    assert why == "Evidence is sufficient."


def test_release_denies_when_the_answer_omits_the_field() -> None:
    granted, _ = agent(reply={"rationale": "hmm"}).decide_release({}, {})
    assert granted is False


# ------------------------------------------------------------ cost discipline


def test_parse_decision_recovers_json_from_surrounding_prose() -> None:
    assert serve.parse_decision('sure:\n{"a": 1}\nhope that helps')["a"] == 1


def test_parse_decision_returns_none_rather_than_raising() -> None:
    assert serve.parse_decision("not json at all") is None


def test_down_confirms_the_deployment_is_actually_gone(tmp_path: Path) -> None:
    """Teardown that reports success without checking is how a GPU gets left up."""
    config = filt.load_config()
    client = FakeClient()
    result = serve.down(sweep_id="sweep-1", base="llama31_8b", config=config, client=client)
    assert result["confirmed_gone"] is True
    assert client.deleted


def test_every_up_and_down_is_logged(tmp_path: Path) -> None:
    log = tmp_path / "VERSIONS.md"
    serve.log_deployment_event(
        "up", deployment="d", base="llama31_8b", sweep_id="s", detail="2 adapters", path=log
    )
    serve.log_deployment_event("down", deployment="d", base="llama31_8b", sweep_id="s", path=log)
    body = log.read_text()
    assert serve.DEPLOYMENT_LOG_HEADING in body
    assert body.count("| `d` |") == 2


def test_the_log_appends_rather_than_overwriting(tmp_path: Path) -> None:
    log = tmp_path / "VERSIONS.md"
    log.write_text("# VERSIONS\n\nexisting content\n")
    serve.log_deployment_event("up", deployment="d", base="b", sweep_id="s", path=log)
    assert "existing content" in log.read_text()
