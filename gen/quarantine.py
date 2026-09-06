"""Runtime guard: quarantined material must never reach a model.

`scripts/check_quarantine.sh` blocks quarantined strings at commit time, but the
generation prompt is assembled at *run* time out of files this workstream does not own
— specs, exemplar cards, inject scenarios. A spec that arrives with a quarantined
incident in its backstory would put that incident in every prompt built from it.

So the same patterns are enforced again on the assembled prompt. They are parsed out of
the shell script rather than retyped here: that script is the single source of truth,
and it is the only file exempt from itself, so a copy of the list in a .py file would
fail its own pre-commit hook.

**Separator normalisation.** agent7-ui found that the hook's patterns match the
hyphenated and space-separated spellings only, not the underscored lowercase asset-id
form — which is exactly the shape an engine, a spec or a log uses, and one got past the
hook on their branch. This module normalises every run of `[-_ .]` to a single space on
both the pattern and the text before matching, so the hyphenated, spaced, underscored
and run-together spellings of a name are all one name. That makes the runtime guard
strictly stronger than the commit hook rather than an exact copy of it; the hook's own
fix is proposed in ui/QUESTIONS.md section 1.

No example of a quarantined name appears in this file, including in the prose above.
Writing one out to illustrate the spellings is itself a copy of the material — the
widened matcher caught exactly that in an earlier draft of this docstring.
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


#: Runs of these are all the same separator as far as a quarantined name is concerned.
SEPARATORS = re.compile(r"[-_ .]+")


def _normalise(text: str) -> str:
    return SEPARATORS.sub(" ", text).casefold()


@lru_cache(maxsize=1)
def _regex() -> re.Pattern[str]:
    # Patterns are normalised the same way the text is, then rejoined with a separator
    # class, so one compiled expression covers every spelling of every name.
    alternatives = []
    for pattern in patterns():
        words = [re.escape(word) for word in _normalise(pattern).split()]
        alternatives.append(r"[-_ .]*".join(words))
    return re.compile("|".join(alternatives), re.IGNORECASE)


def find(text: str) -> list[str]:
    """Every quarantined string present in `text`, deduplicated, in first-seen order.

    Matches across separator spellings: the hyphenated, spaced, underscored and
    run-together forms of a name are all the same name.
    """
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
