"""The exemplar bank: historical decision cards for the cached prompt prefix.

agent9-specs writes these as structured JSON to `specs/exemplars/`, against its own
`exemplar_card_schema.json`, explicitly for this module. Every card comes from the
allowed list in `docs/quarantine.md`; each is re-checked here anyway, because the bank is
the single most likely place for a quarantined incident to be added by someone acting in
good faith.

`analogous_seats` lets a card be selected per seat. It is not used by default: including
every card keeps the universal block byte-identical across all nine seats, so the whole
run shares one cache prefix. Selecting per seat trades that cache sharing for a shorter
prompt, which is the right trade only once the bank is large.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from gen.quarantine import assert_clean

#: Fields rendered into the prompt, in order. `sources`, `notes` and `contested` are
#: deliberately excluded from the default rendering: sources are provenance for a human
#: reviewer, and `contested` is carried into the prompt separately as a caveat line.
_CARD_FIELDS = (
    ("date", "When"),
    ("decision_maker", "The seat"),
    ("situation", "Situation"),
    ("information_available", "What they actually had"),
    ("decision", "What they did"),
    ("why", "Why"),
    ("outcome", "Outcome"),
    ("transfer", "What this card is here to teach"),
)


@lru_cache(maxsize=8)
def load(root: str) -> tuple[dict[str, Any], ...]:
    """Every card in `specs/exemplars/`, sorted by `exemplar_id`.

    Tolerates both a populated bank and an empty directory; the schema file agent9
    ships alongside the cards is skipped.
    """
    directory = Path(root)
    if not directory.is_dir():
        return ()
    cards: list[dict[str, Any]] = []
    for path in sorted(directory.glob("*.json")):
        if path.name.endswith("_schema.json"):
            continue
        card = json.loads(path.read_text())
        if not isinstance(card, dict) or "exemplar_id" not in card:
            continue
        assert_clean(json.dumps(card), where=f"exemplar card {path}")
        cards.append(card)
    return tuple(sorted(cards, key=lambda c: str(c["exemplar_id"])))


def for_seat(cards: tuple[dict[str, Any], ...], seat: str) -> tuple[dict[str, Any], ...]:
    """Cards whose `analogous_seats` names this seat, or every card if none do."""
    selected = tuple(c for c in cards if seat in (c.get("analogous_seats") or []))
    return selected or cards


def render_card(card: dict[str, Any]) -> str:
    lines = [f"### {card.get('title') or card['exemplar_id']}"]
    for key, label in _CARD_FIELDS:
        value = card.get(key)
        if value:
            lines.append(f"**{label}.** {value}")
    rungs = card.get("ladder_rung") or []
    if rungs:
        lines.append("**Rung on this board.** " + ", ".join(f"`{r}`" for r in rungs))
    if card.get("contested"):
        lines.append(f"**Contested.** {card['contested']}")
    return "\n\n".join(lines)


def render(cards: tuple[dict[str, Any], ...]) -> str:
    if not cards:
        return (
            "TODO_EXEMPLARS: the exemplar bank is empty for this run. Reason from the "
            "brief and from your persona alone."
        )
    header = (
        "Historical decisions, for calibration only. None of them is this scenario and "
        "none of those actors is one of these actors. Read them for the *shape* of a "
        "decision taken under ambiguity — what was known at the moment of choice, what "
        "was chosen, and why — not for what to do here. Where a card says the record is "
        "contested, treat it as contested."
    )
    return "\n\n".join([header, *(render_card(card) for card in cards)])
