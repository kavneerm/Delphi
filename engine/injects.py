"""Injects: scheduled information, rule actors, and deniable noise.

Three sources, all producing the same shape (`inject_schema.json#/$defs/inject`)
so nothing downstream has to know which one it came from:

* **replay files** — `contracts/inject_schema.json` documents, loaded from disk
  and emitted on schedule. Files under `eval/replays/` are quarantine material;
  this module loads them and nothing in `specs/`, `gen/` or the lake may.
* **rule actors** — the six scripted actors in `contracts/seats.md`. They emit on
  a clock and never take menu actions.
* **`hacktivist_injects`** — the deniable-claims actor, with a hidden
  affiliation drawn once per run from the master seed. The affiliation is ground
  truth: it never appears in any seat's filtered view and is revealed only on the
  `attribution_revealed` event at episode end.

A claim may be true, false, or true about something nobody has noticed yet.
That third case is the one that makes attribution hard.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

from engine.contracts import validate

__all__ = ["HacktivistInjects", "RuleActors", "load_replay", "synthetic_timeline"]

AFFILIATIONS = ("freelance", "opportunistic", "russian_directed")


def load_replay(path: str | Path) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    """Load a scenario or replay file. Returns (injects, ground_truth)."""
    data = json.loads(Path(path).read_text())
    validate("inject_schema.json", data)
    injects = sorted(
        (copy.deepcopy(i) for i in data.get("injects") or []),
        key=lambda i: (float(i["sim_time_s"]), str(i.get("inject_id") or "")),
    )
    for index, inject in enumerate(injects):
        inject.setdefault("inject_id", f"{data['replay_id']}-{index:03d}")
    return injects, data.get("ground_truth")


def synthetic_timeline(
    *, seed_rng: Any, duration_s: int, severity: str, red_is_acting: bool
) -> list[dict[str, Any]]:
    """A baseline ambiguity scenario, for when no replay file is given.

    The storm arrives first and the anomalies arrive under it, which is the
    whole design: every early inject is compatible with both explanations. It is
    synthetic, not historical, and carries nothing from `docs/quarantine.md`.
    """
    hour = 3600
    injects: list[dict[str, Any]] = [
        {
            "inject_id": "syn-000",
            "sim_time_s": 0,
            "recipients": ["all"],
            "content": (
                f"Space weather bulletin: a {severity}-class geomagnetic storm is forecast to "
                "reach the Arctic within hours. Expect HF and satellite link degradation at high "
                "latitudes and possible spacecraft anomalies."
            ),
            "confidence": 0.9,
            "source": "NOAA SWPC bulletin",
            "source_class": "space_weather",
            "feed": "space_weather",
        },
        {
            "inject_id": "syn-001",
            "sim_time_s": 2 * hour,
            "recipients": ["starlink", "iridium", "norway"],
            "content": (
                "Customer reports of intermittent Arctic service loss north of 74N. Pattern is "
                "not yet distinguishable from scintillation."
            ),
            "confidence": 0.55,
            "source": "operations desk",
            "source_class": "customer",
            "feed": "customer_reports",
        },
        {
            "inject_id": "syn-002",
            "sim_time_s": 4 * hour,
            "recipients": ["northcom", "usspacecom", "norway"],
            "content": (
                "Arctic operational picture degraded: downlink slots at the Svalbard station are "
                "returning partial passes. Cause not established."
            ),
            "confidence": 0.6,
            "source": "JTF-North watch floor",
            "source_class": "internal",
            "feed": "own_telemetry",
        },
        {
            "inject_id": "syn-003",
            "sim_time_s": 7 * hour,
            "recipients": ["usspacecom", "northern_fleet", "china"],
            "content": (
                "Catalogue update: a Northern Fleet space object has changed its orbit. The "
                "manoeuvre is small and consistent with either station-keeping under storm "
                "conditions or a repositioning."
            ),
            "confidence": 0.7,
            "source": "space surveillance catalogue",
            "source_class": "osint",
            "feed": "ssa_catalog",
        },
        {
            "inject_id": "syn-004",
            "sim_time_s": 11 * hour,
            "recipients": ["all"],
            "content": (
                "Press: Arctic communications outages reported by shipping and by two research "
                "stations on Svalbard. Officials decline to say whether the cause is the storm."
            ),
            "confidence": 0.5,
            "source": "wire service",
            "source_class": "media",
            "feed": "media",
        },
    ]
    if red_is_acting:
        injects.append(
            {
                "inject_id": "syn-005",
                "sim_time_s": 14 * hour,
                "recipients": ["usspacecom", "norway"],
                "content": (
                    "Signature analysis: the interference on the affected uplink has a structure "
                    "inconsistent with ionospheric scintillation. Single source, not yet "
                    "corroborated."
                ),
                "confidence": 0.65,
                "source": "signature analysis cell",
                "source_class": "sigint",
                "feed": "sigint",
                "is_knife_inject": True,
            }
        )
    else:
        injects.append(
            {
                "inject_id": "syn-005",
                "sim_time_s": 14 * hour,
                "recipients": ["usspacecom", "norway"],
                "content": (
                    "Signature analysis: the interference on the affected uplink is consistent "
                    "with severe scintillation, though the analysts note they cannot exclude a "
                    "deliberate source at this confidence."
                ),
                "confidence": 0.6,
                "source": "signature analysis cell",
                "source_class": "sigint",
                "feed": "sigint",
                "is_knife_inject": True,
            }
        )
    injects.append(
        {
            "inject_id": "syn-006",
            "sim_time_s": 20 * hour,
            "recipients": ["nsc", "northcom", "usspacecom", "norway"],
            "content": (
                "Allied consultation request: Norway asks for a common assessment before any "
                "public statement is made."
            ),
            "confidence": 0.8,
            "source": "liaison, allied headquarters",
            "source_class": "liaison",
            "feed": "liaison_norway",
        }
    )
    extra_hours = sorted({int(seed_rng.uniform("timeline", 24, max(25, duration_s / 3600 - 6)))})
    for index, at_h in enumerate(extra_hours):
        injects.append(
            {
                "inject_id": f"syn-1{index:02d}",
                "sim_time_s": at_h * hour,
                "recipients": ["all"],
                "content": (
                    "Update: some Arctic capacity has been restored; the pattern of restoration "
                    "does not match the pattern of loss."
                ),
                "confidence": 0.55,
                "source": "operations desk",
                "source_class": "internal",
                "feed": "media",
            }
        )
    return [i for i in injects if int(i["sim_time_s"]) < duration_s]


class RuleActors:
    """The five scripted, non-hacktivist rule actors.

    They emit inject-shaped information on a clock. `swpc` is the one that
    matters most: it is the *seat-visible* version of the storm, with a per-run
    accuracy draw, so what a seat believes about space weather may lag or
    disagree with what the storm layer is actually doing.
    """

    def __init__(self, rng: Any, params: dict[str, Any]) -> None:
        self.rng = rng
        self.params = params
        low, high = params.get("swpc_accuracy_range", [0.55, 0.95])
        #: Drawn once per run: how good the forecast is this time.
        self.swpc_accuracy = round(self.rng.uniform("swpc_accuracy", float(low), float(high)), 4)
        self._counter = 0

    def _id(self, prefix: str) -> str:
        self._counter += 1
        return f"{prefix}-{self._counter:03d}"

    def swpc_bulletin(self, now_s: int, storm_payload: dict[str, Any]) -> dict[str, Any]:
        """A forecast, not the truth. Kp is reported with the run's error."""
        true_kp = float(storm_payload["kp"])
        error = (1.0 - self.swpc_accuracy) * 3.0
        reported = max(0.0, min(9.0, true_kp + self.rng.uniform(f"swpc:{now_s}", -error, error)))
        severity = storm_payload["severity"]
        degraded = (
            "Tracking and screening products are degraded. "
            if storm_payload.get("tracking_degraded")
            else ""
        )
        return {
            "inject_id": self._id("swpc"),
            "sim_time_s": int(now_s),
            "recipients": ["all"],
            "content": (
                f"SWPC bulletin: estimated Kp {reported:.1f}, storm class {severity}. "
                f"{degraded}"
                "High-latitude link degradation and spacecraft anomalies remain likely."
            ),
            "confidence": round(self.swpc_accuracy, 3),
            "source": "NOAA SWPC bulletin",
            "source_class": "space_weather",
            "feed": "space_weather",
            "actor": "swpc",
        }

    def media_pressure(self, now_s: int, level: float) -> dict[str, Any]:
        """Public and allied expectation, rising over time.

        This is where the folded NATO seat's consultative pressure lives, per
        `contracts/seats.md`.
        """
        if level < 0.35:
            body = "Coverage is thin and technical: a storm story with an outage in it."
        elif level < 0.7:
            body = (
                "Coverage has turned: commentators are asking why no one will say whether this "
                "is weather or an attack, and allied capitals are asking the same thing privately."
            )
        else:
            body = (
                "Coverage is now the story: editorials demand attribution, allied governments "
                "want a common line today, and silence is being read as either incompetence or "
                "concealment."
            )
        return {
            "inject_id": self._id("media"),
            "sim_time_s": int(now_s),
            "recipients": ["all"],
            "content": f"Media and allied pressure at {level:.2f}. {body}",
            "confidence": 0.9,
            "source": "press summary",
            "source_class": "media",
            "feed": "media",
            "actor": "media_clock",
        }

    def osint_post(self, now_s: int, observed: list[str]) -> dict[str, Any]:
        """The reason a covert action has a deadline."""
        if observed:
            what = "; ".join(observed[:3])
            content = (
                f"Open-source trackers have published: {what}. The posts are being amplified "
                "faster than any official assessment."
            )
            confidence = 0.6
        else:
            content = (
                "Open-source trackers report nothing anomalous beyond storm effects, which "
                "several of them are now saying is itself suspicious."
            )
            confidence = 0.35
        return {
            "inject_id": self._id("osint"),
            "sim_time_s": int(now_s),
            "recipients": ["all"],
            "content": content,
            "confidence": confidence,
            "source": "open-source trackers",
            "source_class": "osint",
            "feed": "osint",
            "actor": "osint_clock",
        }

    def civilians(self, now_s: int, capacity_ratio: float) -> dict[str, Any]:
        if capacity_ratio > 0.85:
            body = "Svalbard stations report inconvenience, not disruption."
        elif capacity_ratio > 0.55:
            body = (
                "Research stations have lost bulk data return; the fishing fleet is on voice "
                "only; two cruise operators have altered routing."
            )
        else:
            body = (
                "Safety-of-life traffic is affected: the fishing fleet north of Svalbard is "
                "without reliable position reporting and Barentsburg has intermittent contact."
            )
        return {
            "inject_id": self._id("civ"),
            "sim_time_s": int(now_s),
            "recipients": ["norway", "starlink", "iridium", "northcom", "nsc"],
            "content": body,
            "confidence": 0.8,
            "source": "civil authorities, Svalbard",
            "source_class": "customer",
            "feed": "customer_reports",
            "actor": "civilians",
        }

    def insurer_reprice(self, now_s: int, trigger: str) -> dict[str, Any]:
        return {
            "inject_id": self._id("ins"),
            "sim_time_s": int(now_s),
            "recipients": ["starlink", "iridium", "norway"],
            "content": (
                f"Underwriters have issued a repricing notice following {trigger}. Counsel notes "
                "the war-risk exclusion may be invoked if the loss is attributed to a state act; "
                "an attribution you make yourselves is an attribution they can cite."
            ),
            "confidence": 0.85,
            "source": "lead underwriter",
            "source_class": "commercial_telemetry",
            "feed": "insurer",
            "actor": "insurer",
        }

    def snapshot(self) -> dict[str, Any]:
        return {"swpc_accuracy": self.swpc_accuracy, "counter": self._counter}

    def restore(self, snap: dict[str, Any]) -> None:
        self.swpc_accuracy = float(snap["swpc_accuracy"])
        self._counter = int(snap["counter"])


class HacktivistInjects:
    """Claimed attacks and leaks, with a hidden affiliation drawn per run.

    Rule-based, not modelled: a Poisson claim rate, a truth probability, and an
    affiliation that shapes *what* gets claimed rather than *how much*. The
    affiliation is ground truth and never leaves this object until episode end.
    """

    def __init__(self, config: dict[str, Any], rng: Any) -> None:
        self.enabled = bool(config.get("enabled", True))
        self.claim_rate_per_hour = float(config.get("claim_rate_per_hour", 0.08))
        self.true_claim_probability = float(config.get("true_claim_probability", 0.35))
        weights = dict(
            config.get("affiliation_weights")
            or {"russian_directed": 0.3, "freelance": 0.5, "opportunistic": 0.2}
        )
        self.rng = rng
        #: Ground truth. Never in a filtered view; revealed at episode end.
        self.affiliation: str = rng.weighted_choice("hacktivist_affiliation", weights)
        self._counter = 0
        self.claims_made: list[dict[str, Any]] = []

    def tick(self, now_s: int, window_s: int, active_effects: list[Any]) -> list[dict[str, Any]]:
        """Claims arriving in this window. Empty most of the time, by design."""
        if not self.enabled:
            return []
        lam = self.claim_rate_per_hour * (window_s / 3600.0)
        count = self.rng.poisson(f"hacktivist_count:{now_s}", lam)
        out: list[dict[str, Any]] = []
        for index in range(count):
            self._counter += 1
            key = f"hacktivist:{now_s}:{index}"
            truthful = self.rng.chance(f"{key}:true", self.true_claim_probability)
            real = [e for e in active_effects if e.kind != "natural"]
            if truthful and real:
                effect = real[self.rng.book(f"{key}:pick").randrange(len(real))]
                target = effect.target_asset_id or effect.target_system or "an Arctic gateway"
                text = (
                    f"A group posting under a new banner claims responsibility for the "
                    f"disruption affecting {target}, and has published what it says is "
                    "operator-side data to prove it."
                )
                confidence = 0.45
            elif truthful:
                text = (
                    "A group claims it has been inside an Arctic ground segment for weeks and "
                    "says the current outages are its work, timed to the storm. It has published "
                    "a file listing that nobody has yet been able to disprove."
                )
                confidence = 0.4
            else:
                text = (
                    "A group claims responsibility for the Arctic outages and demands a policy "
                    "change on Svalbard. The claim contains a technical detail that operators "
                    "say is wrong."
                )
                confidence = 0.25
            flavour = {
                "russian_directed": (
                    " The account's earlier posts track a state media line closely enough that "
                    "two analysts have said so publicly."
                ),
                "freelance": (" The account has no history and is being amplified mostly by bots."),
                "opportunistic": (
                    " The same account claimed an unrelated outage last month, which turned out "
                    "to be a router failure."
                ),
            }[self.affiliation]
            claim = {
                "inject_id": f"hack-{self._counter:03d}",
                "sim_time_s": int(now_s),
                "recipients": ["all"],
                "content": text + flavour,
                "confidence": confidence,
                "source": "social media",
                "source_class": "osint",
                "feed": "osint",
                "actor": "hacktivist_injects",
                "truthful": truthful,
            }
            self.claims_made.append({"inject_id": claim["inject_id"], "truthful": truthful})
            out.append(claim)
        return out

    def snapshot(self) -> dict[str, Any]:
        return {
            "affiliation": self.affiliation,
            "counter": self._counter,
            "claims_made": copy.deepcopy(self.claims_made),
        }

    def restore(self, snap: dict[str, Any]) -> None:
        self.affiliation = str(snap["affiliation"])
        self._counter = int(snap["counter"])
        self.claims_made = copy.deepcopy(snap["claims_made"])
