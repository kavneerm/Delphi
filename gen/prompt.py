"""Prompt assembly: a stable cached prefix, then the variable suffix.

The whole cost model of this workstream is in the split.

    Block A  universal   the brief, the full action ladder, the output contract, the
                         exemplar bank. Byte-identical for every call in a run.
    Block B  per persona the spec: authority, feeds, clock, weights, voice, backstory.
                         Byte-identical for every decision this persona ever makes.
    Block C  variable    filtered state, injects seen, messages seen, belief table,
                         the menu the engine will actually accept right now.

OpenAI prompt caching keys on the longest common *prefix*, so the order is load-bearing:
universal first, so every persona shares that cache; persona second, so all ~40 decision
points in an episode share it; variable last, because it changes every call. Reordering
these blocks does not change the model's output much and changes the bill a great deal.

`prompt_cache_key` routes calls for one persona to the same cache node.

Two hard guards run on every assembled prompt:

* **Quarantine.** `gen.quarantine.assert_clean` over the whole rendered text. Specs and
  scenarios come from other agents; a quarantined incident in a backstory would be in
  every prompt built from it and would poison the lake invisibly.
* **Leakage.** `filtered_state` is rendered as-is, so anything the engine wrongly put in
  it reaches the model. `assert_no_hidden_fields` refuses the well-known ground-truth
  keys outright rather than trusting the engine.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

from gen.config import GenConfig
from gen.contracts import action_types, ladder, menu_for_seat
from gen.engine_api import SeatView
from gen.quarantine import assert_clean
from gen.version import PROMPT_VERSION

#: Keys that must never appear anywhere in a filtered state. `private_type` and `psyche`
#: are another seat's hidden fields; the rest are engine or scenario ground truth.
#: contracts/README.md rule 4.
FORBIDDEN_STATE_KEYS = frozenset(
    {
        "private_type",
        "psyche",
        "ground_truth",
        "responsible_actor",
        "cause",
        "hacktivist_affiliation",
        "affiliation",
        "truthful",
        "red_private_type",
    }
)


class LeakageError(RuntimeError):
    """A filtered state carried something the seat could not know."""


def assert_no_hidden_fields(state: Any, *, where: str, path: str = "filtered_state") -> None:
    if isinstance(state, dict):
        for key, value in state.items():
            if key in FORBIDDEN_STATE_KEYS:
                raise LeakageError(
                    f"{where}: {path}.{key} is ground truth or another seat's hidden field. "
                    "A lake record's filtered_state becomes the user turn of a training "
                    "example (contracts/README.md rule 4); this would teach the model to "
                    "know things it will not know at evaluation."
                )
            assert_no_hidden_fields(value, where=where, path=f"{path}.{key}")
    elif isinstance(state, list):
        for index, value in enumerate(state):
            assert_no_hidden_fields(value, where=where, path=f"{path}[{index}]")


# --------------------------------------------------------------------------
# Block A — universal
# --------------------------------------------------------------------------

BRIEF = """\
You are one seat in a real-time crisis simulation set in the European Arctic.

The situation: a severe geomagnetic storm has coincided with a Russian naval exercise in
the Barents. Satellite communications over Svalbard and the northern approaches have
degraded badly. Nobody yet knows whether the degradation is the storm, a technical
failure, deliberate interference, or several of those at once. Every seat sees a
different, delayed, partial slice of it.

The episode runs for 72 simulated hours. You will be woken repeatedly. At each decision
point you see only what your own feeds have delivered by then, and you emit exactly one
decision.

How to play your seat:

1. **Reason only from what you can see.** Your feeds have latency and your instruments
   have error. If a fact is not in your filtered state, in an inject you received, or in
   a message delivered to you, you do not know it. Do not infer another actor's hidden
   intentions as though you had been told them. Being uncertain in writing is correct.
2. **Stay inside your authority.** Your available actions are listed at every decision
   point; that list is the action menu intersected with your authority envelope. Actions
   in your `recommend_only` set you may argue for in a message and never execute.
3. **Hold is a real choice and it is not free.** The outage continues while you wait, and
   your utility function scores that. Choose it deliberately, not by default.
4. **Move up the ladder in proportion to your evidence and your risk posture**, not in
   proportion to how much pressure you are under.
5. **Write in your own voice.** Your reasoning is read by people assessing whether this
   persona is coherent. It is not a report to a superior unless your persona would write
   one.
"""

OUTPUT_CONTRACT = """\
Emit one decision object with four parts.

- `beliefs` — your current read of the cause. `hostile`, `natural` and `unknown` are
  probabilities that must sum to 1.0. `unknown` is not a residual: you can be 0.8 unknown
  and 0.1 hostile at the same time, and early in an unresolved incident you usually
  should be. `per_actor` splits responsibility across candidate actors *conditional on
  hostile*; leave it empty when hostile is low, and never let it total more than 1.
- `messages` — outbound messages this decision point, zero to six. Each names a
  recipient and a channel; the channel decides how fast it arrives and who else sees it.
  An empty list is common and correct.
- `action` — exactly one action from your available list, with its parameters. To do
  nothing, use `hold` with empty params.
- `reasoning` — why, in your persona's voice. Say what you are uncertain about.

Set only the parameters your chosen action needs; leave every other parameter null.
"""


def render_ladder() -> str:
    """The full 14-rung menu as a table. Universal: every seat sees the whole ladder."""
    lines = [
        "The action ladder, rung 0 to rung 13. Rung order is meaningful: a higher rung is",
        "a bigger step. Costs are relative, in [0,1].",
        "",
        "| rung | action | irreversible | signaling | political | who may execute it |",
        "|---|---|---|---|---|---|",
    ]
    for entry in ladder():
        seats = ", ".join(entry["allowed_seats"])
        lines.append(
            f"| {entry['rung']} | `{entry['type']}` | "
            f"{'yes' if entry['irreversible'] else 'no'} | "
            f"{entry['costs']['signaling']} | {entry['costs']['political']} | {seats} |"
        )
    lines.append("")
    for entry in ladder():
        note = f" {entry.get('notes', '')}".rstrip()
        lines.append(f"- `{entry['type']}` — {entry['description']}{note}")
    return "\n".join(lines)


@lru_cache(maxsize=8)
def load_exemplars(root: str) -> list[tuple[str, str]]:
    """The exemplar bank: `specs/exemplars/*.md`, sorted, as (id, text).

    Human-authored historical analogues from the allowed list in `docs/quarantine.md`.
    Each one is checked against the quarantine at load time, because the bank is exactly
    where a quarantined incident would be most tempting to put.
    """
    directory = Path(root)
    if not directory.is_dir():
        return []
    out = []
    for path in sorted(directory.glob("*.md")):
        text = path.read_text().strip()
        if not text:
            continue
        assert_clean(text, where=f"exemplar {path}")
        out.append((path.stem, text))
    return out


def render_exemplars(exemplars: list[tuple[str, str]]) -> str:
    if not exemplars:
        return (
            "TODO_EXEMPLARS: no exemplar bank is loaded for this run. Reason from the "
            "brief and from your persona alone."
        )
    blocks = [
        "Historical analogues, for calibration only. They are not this scenario and the "
        "actors are not these actors. Use them for how decisions of this kind actually "
        "went, not for what to do here.",
        "",
    ]
    for name, text in exemplars:
        blocks.append(f"### {name}\n{text}")
    return "\n\n".join(blocks)


def universal_block(config: GenConfig) -> str:
    exemplars = load_exemplars(str(config.specs_root / "exemplars"))
    return "\n\n".join(
        [
            BRIEF,
            "## The action ladder\n\n" + render_ladder(),
            "## What you emit\n\n" + OUTPUT_CONTRACT,
            "## Exemplars\n\n" + render_exemplars(exemplars),
        ]
    )


# --------------------------------------------------------------------------
# Block B — the persona
# --------------------------------------------------------------------------

_WEIGHT_SIGN = {
    "asset_loss": "-",
    "escalation_risk": "-",
    "liability": "-",
    "alliance_cohesion": "+",
    "domestic_political": "+",
    "reputation_resolve": "+",
    "revenue": "+",
    "career": "+",
}

_PRIVATE_TYPE_TEXT = {
    "storm_reposition": (
        "You are repositioning assets out of the charging environment. That is all you "
        "are doing. It will look like something else."
    ),
    "opportunistic_isr": (
        "You are collecting, because the window opened and the other side's coverage is "
        "degraded. You did not create the window and you are not trying to cause an "
        "incident."
    ),
    "action_under_cover": (
        "You are conducting a deliberate effect under cover of the storm. Attribution is "
        "expected to be slow and contested. Nothing goes on the record."
    ),
    "honest_broker": (
        "You genuinely want the ambiguity resolved, and you will share what you have to resolve it."
    ),
    "opportunistic_amplifier": (
        "You want to be seen helping, in a way that leaves the ambiguity wider than you found it."
    ),
    "coordinated_with_russia": (
        "Your help is shaped by an understanding you will never acknowledge."
    ),
}

_PSYCHE_TEXT = {
    "revisionist": (
        "You are trying to change the settled order, patiently, and you think time is on your side."
    ),
    "revanchist": "You are recovering something you believe was taken. The grievance is the point.",
    "opportunistic_cautious": (
        "You take what is cheap and available and you do not take risks for it."
    ),
    "regime_survival": "Every question is really a question about who survives in post.",
}


def render_persona(spec: dict[str, Any]) -> str:
    authority = spec["authority"]
    feeds = "\n".join(
        f"  - `{f['name']}` — {f['latency_minutes']:g} min behind the world, "
        f"confidence x{f['confidence_scale']:g}"
        for f in spec["information"]["feeds"]
    )
    weights = "\n".join(
        f"  - {name} ({_WEIGHT_SIGN[name]}): {value:g}"
        for name, value in sorted(spec["utility_weights"].items(), key=lambda kv: -kv[1])
    )
    priors = spec.get("priors", {})
    prior_lines = "\n".join(
        f"  - {k}: {v}" for k, v in priors.items() if not isinstance(v, (dict, list))
    )
    trust = priors.get("trust") or {}
    trust_lines = (
        "\n".join(f"  - {actor}: {value:g}" for actor, value in sorted(trust.items()))
        if trust
        else "  - not specified"
    )

    parts = [
        f"# You are the `{spec['seat']}` seat",
        f"\n{spec['backstory']}",
        f"\n## Voice\n\n{spec['voice']}",
        "\n## Your authority",
        f"\n- Execute on your own authority: {_fmt_actions(authority['unilateral'])}",
        f"- Execute only after release is granted: {_fmt_actions(authority['requires_release'])}",
        f"- May recommend but never execute: {_fmt_actions(authority['recommend_only'])}",
        f"\n## Your information\n\nClearance ceiling: `{spec['information']['clearance']}`.\n"
        f"Feeds, and nothing else:\n{feeds}",
        f"\n## Your clock\n\n"
        f"- You are woken every {spec['decision_clock']['poll_minutes']:g} sim minutes"
        + (
            " and immediately whenever something arrives for you."
            if spec["decision_clock"]["wake_on_inject"]
            else ", and not by arriving traffic."
        )
        + f"\n- Anything you decide takes {spec['decision_clock']['deliberation_minutes']:g} "
        "sim minutes to take effect.",
        f"\n## What you are scored on\n\nWeights, sign fixed by the engine "
        f"(- means more is worse):\n{weights}",
        f"\n- Risk posture: **{spec['risk_posture']}**"
        f"\n- Time horizon: **{spec['time_horizon']}** — the horizon over which you judge "
        "an outcome good.",
        f"\n## Your starting beliefs\n\n{prior_lines}\n\nHow far you trust what you are "
        f"told, by actor:\n{trust_lines}",
    ]
    if spec.get("private_type"):
        parts.append(
            f"\n## What only you know\n\n{_PRIVATE_TYPE_TEXT[spec['private_type']]}\n\n"
            "No other seat knows this. Do not state it, and do not write as though "
            "anyone else has inferred it."
        )
    if spec.get("psyche"):
        parts.append(f"\n## Your disposition\n\n{_PSYCHE_TEXT[spec['psyche']]}")
    return "\n".join(parts)


def _fmt_actions(names: list[str]) -> str:
    return ", ".join(f"`{n}`" for n in names) if names else "nothing"


# --------------------------------------------------------------------------
# Block C — the variable suffix
# --------------------------------------------------------------------------


def _json_block(obj: Any) -> str:
    return json.dumps(obj, indent=2, sort_keys=True, default=str)


def render_beliefs_table(spec: dict[str, Any], last_beliefs: dict[str, Any] | None) -> str:
    if last_beliefs is None:
        priors = spec.get("priors", {})
        return (
            "You have not recorded a belief yet this episode. Your priors are "
            f"hostile {priors.get('p_hostile_prior', '?')}, "
            f"natural {priors.get('p_natural_prior', '?')}, "
            f"unknown {priors.get('p_unknown_prior', '?')}. "
            "Start from those and update on what you have actually received."
        )
    per_actor = last_beliefs.get("per_actor") or {}
    actors = (
        ", ".join(f"{a} {p:g}" for a, p in sorted(per_actor.items(), key=lambda kv: -kv[1]))
        if per_actor
        else "no mass assigned to any actor"
    )
    return (
        "Your belief at your last decision point:\n"
        f"  - hostile {last_beliefs.get('hostile')}, natural {last_beliefs.get('natural')}, "
        f"unknown {last_beliefs.get('unknown')}\n"
        f"  - conditional on hostile: {actors}\n\n"
        "Update it on what has arrived since. Moving is fine; moving without new "
        "information is not."
    )


def render_injects(injects: list[dict[str, Any]]) -> str:
    if not injects:
        return "Nothing has reached you yet."
    lines = []
    for inject in injects:
        hours = inject["sim_time_s"] / 3600.0
        lines.append(
            f"- **T+{hours:05.2f}h** ({inject['source']}, stated confidence "
            f"{inject['confidence']:g}): {inject['content']}"
        )
    return "\n".join(lines)


def render_messages(messages: list[dict[str, Any]]) -> str:
    if not messages:
        return "Nobody has sent you anything."
    lines = []
    for entry in messages:
        message = entry["message"]
        hours = entry["delivered_at_sim_time_s"] / 3600.0
        lines.append(
            f"- **T+{hours:05.2f}h** from `{entry['from']}` on `{message['channel']}`: "
            f"{message['text']}"
        )
    return "\n".join(lines)


def render_available(seat: str, spec: dict[str, Any], state: dict[str, Any]) -> str:
    available = state.get("available_actions") or menu_for_seat(seat, spec["authority"])
    unknown = [a for a in available if a not in action_types()]
    if unknown:
        raise ValueError(f"{seat}: engine offered actions not on the ladder: {unknown}")
    requires_release = set(spec["authority"].get("requires_release", []))
    lines = []
    for name in available:
        suffix = " *(needs release before it executes)*" if name in requires_release else ""
        lines.append(f"- `{name}`{suffix}")
    return "\n".join(lines)


def variable_block(
    view: SeatView, spec: dict[str, Any], last_beliefs: dict[str, Any] | None
) -> str:
    state = view.filtered_state
    clock = state.get("clock", {})
    header = f"# Decision point — T+{view.sim_time_s / 3600.0:05.2f}h" + (
        f", checkpoint {view.checkpoint_index}" if view.checkpoint_index is not None else ""
    )
    return "\n\n".join(
        [
            header,
            f"{clock.get('sim_hours_remaining', '?')} sim hours remain in the episode.",
            "## What has reached you\n\n" + render_injects(view.injects_seen),
            "## Messages delivered to you\n\n" + render_messages(view.messages_seen),
            "## Your assets\n\n" + _json_block(state.get("own_assets", [])),
            "## What you can observe\n\n" + _json_block(state.get("observed_effects", [])),
            "## Space weather, as your feed reports it\n\n"
            + _json_block(state.get("space_weather", {})),
            "## The ladder, as far as you have seen it\n\n"
            + _json_block(state.get("ladder_state", {})),
            "## Release requests you are party to\n\n"
            + _json_block(state.get("pending_releases", [])),
            "## Your beliefs\n\n" + render_beliefs_table(spec, last_beliefs),
            "## Actions the engine will accept from you now\n\n"
            + render_available(view.seat, spec, state),
            "Emit one decision.",
        ]
    )


# --------------------------------------------------------------------------


@dataclass
class Prompt:
    """One assembled prompt, ready for the Responses API."""

    instructions: str
    input: list[dict[str, Any]]
    cache_key: str
    prompt_version: str = PROMPT_VERSION
    #: Rendered blocks, kept for token accounting and for sample_review.
    blocks: dict[str, str] = field(default_factory=dict)

    @property
    def text(self) -> str:
        parts = [self.instructions]
        for message in self.input:
            for item in message["content"]:
                parts.append(item["text"])
        return "\n\n".join(parts)


def build(
    config: GenConfig,
    view: SeatView,
    spec: dict[str, Any],
    last_beliefs: dict[str, Any] | None = None,
) -> Prompt:
    """Assemble the prompt for one decision point.

    `instructions` carries the universal block, which the Responses API places ahead of
    everything in `input` — the natural home for the part that never changes.
    """
    assert_no_hidden_fields(view.filtered_state, where=f"{view.episode_id}/{view.seat}")

    universal = universal_block(config)
    persona = render_persona(spec)
    variable = variable_block(view, spec, last_beliefs)

    prompt = Prompt(
        instructions=universal,
        input=[
            {"role": "system", "content": [{"type": "input_text", "text": persona}]},
            {"role": "user", "content": [{"type": "input_text", "text": variable}]},
        ],
        cache_key=f"{PROMPT_VERSION}:{spec['spec_version']}:{spec['spec_id']}",
        blocks={"universal": universal, "persona": persona, "variable": variable},
    )
    assert_clean(prompt.text, where=f"prompt for {view.episode_id}/{view.seat}")
    return prompt


def retry_note(errors: list[str]) -> dict[str, Any]:
    """The corrective turn appended when a completion fails the contract schema."""
    listed = "\n".join(f"- {e}" for e in errors[:8])
    return {
        "role": "user",
        "content": [
            {
                "type": "input_text",
                "text": (
                    "Your previous decision did not satisfy the decision contract:\n\n"
                    f"{listed}\n\n"
                    "Emit the decision again, corrected. Keep your reasoning and your "
                    "chosen action unless the error was the action itself."
                ),
            }
        ],
    }
