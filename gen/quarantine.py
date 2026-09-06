"""Runtime guard: quarantined material must never reach a model.

`scripts/check_quarantine.sh` blocks quarantined strings at commit time, but the
generation prompt is assembled at *run* time out of files this workstream does not own
— specs, exemplar cards, inject scenarios. A spec that arrives with a quarantined
incident in its backstory would put that incident in every prompt built from it.

So the same patterns are enforced again on the assembled prompt. They are parsed out of
the shell script rather than retyped here: that script is the single source of truth,
and it is the only file exempt from itself, so a copy of the list in a .py file would
fail its own pre-commit hook.
"""

from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path

from gen.config import REPO_ROOT

CHECKER = REPO_ROOT / "scripts" / "check_quarantine.sh"


class QuarantineError(RuntimeError):
    """Quarantined material found somewhere it must not be."""


@lru_cache(maxsize=1)
def patterns() -> tuple[str, ...]:
    """The quarantined strings, read out of `scripts/check_quarantine.sh`."""
    text = Path(CHECKER).read_text()
    block = re.search(r"^PATTERNS=\(\n(.*?)^\)", text, re.S | re.M)
    if block is None:  # pragma: no cover - only if the script is restructured
        raise QuarantineError(f"cannot parse the PATTERNS array out of {CHECKER}")
    return tuple(re.findall(r"'([^']+)'", block.group(1)))


@lru_cache(maxsize=1)
def _regex() -> re.Pattern[str]:
    return re.compile("|".join(re.escape(p) for p in patterns()), re.IGNORECASE)


def find(text: str) -> list[str]:
    """Every quarantined string present in `text`, deduplicated, in first-seen order."""
    seen: dict[str, None] = {}
    for match in _regex().finditer(text):
        seen.setdefault(match.group(0), None)
    return list(seen)


def assert_clean(text: str, *, where: str) -> None:
    """Raise if `text` carries quarantined material.

    Called on every assembled prompt. Failing the episode is the right response: a
    prompt that names a validation incident poisons the lake, and a poisoned lake is
    only discovered at the end of the training sweep.
    """
    hits = find(text)
    if hits:
        raise QuarantineError(
            f"quarantined material in {where}: {', '.join(sorted(hits))} "
            "— see docs/quarantine.md, remove it from the source file and note it in REPORT.md"
        )
