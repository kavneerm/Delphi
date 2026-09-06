"""Promote reviewed drafts into the live spec tree.

The human decides what is approved; this script does the moving, so that accepting
forty-seven files is one command rather than forty-seven ``git mv`` invocations typed
by hand, and rejecting one file does not block the other forty-six.

    specs/drafts/*.json            -> specs/train/
    specs/drafts/holdout/*.json    -> specs/holdout/
    specs/drafts/exemplars/*.json  -> specs/exemplars/   (with the card schema)
    specs/drafts/devset/<id>/      -> specs/devset/<id>/

Run from anywhere::

    python specs/drafts/promote.py --dry-run                  # show every move, touch nothing
    python specs/drafts/promote.py --all
    python specs/drafts/promote.py --group train devset
    python specs/drafts/promote.py --all --except norway_alliance_first

Two gates run before anything moves: every draft must validate (validate_drafts.py)
and the whole tree must pass scripts/check_quarantine.sh. Nothing is ever overwritten;
anything held back stays in specs/drafts/ and can be promoted later with the same
command.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DRAFTS = REPO_ROOT / "specs" / "drafts"
GROUPS = ("train", "holdout", "exemplars", "devset")


def _planned_moves(groups: set[str]) -> list[tuple[Path, Path, str]]:
    """(source, destination, review name) for everything the selected groups cover."""
    moves: list[tuple[Path, Path, str]] = []

    if "train" in groups:
        for src in sorted(DRAFTS.glob("*.json")):
            if src.name.endswith("_schema.json"):
                continue
            moves.append((src, REPO_ROOT / "specs" / "train" / src.name, src.stem))

    if "holdout" in groups:
        for src in sorted((DRAFTS / "holdout").glob("*.json")):
            moves.append((src, REPO_ROOT / "specs" / "holdout" / src.name, src.stem))

    if "exemplars" in groups:
        for src in sorted((DRAFTS / "exemplars").glob("*.json")):
            moves.append((src, REPO_ROOT / "specs" / "exemplars" / src.name, src.stem))
        # the bank ships with the schema it validates against
        schema = DRAFTS / "exemplar_card_schema.json"
        if schema.exists():
            moves.append((schema, REPO_ROOT / "specs" / "exemplars" / schema.name, schema.stem))

    if "devset" in groups:
        for scenario_dir in sorted(p for p in (DRAFTS / "devset").iterdir() if p.is_dir()):
            for src in sorted(scenario_dir.glob("*.json")):
                dest = REPO_ROOT / "specs" / "devset" / scenario_dir.name / src.name
                moves.append((src, dest, scenario_dir.name))

    return moves


def _gate(label: str, argv: list[str]) -> bool:
    print(f"gate: {label}")
    result = subprocess.run(argv, cwd=REPO_ROOT)
    return result.returncode == 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--all", action="store_true", help="promote every group")
    parser.add_argument("--group", nargs="+", choices=GROUPS, default=[], metavar="GROUP")
    parser.add_argument(
        "--except",
        dest="excluded",
        nargs="+",
        default=[],
        metavar="NAME",
        help="hold these back by spec_id, exemplar_id or devset scenario id",
    )
    parser.add_argument("--dry-run", action="store_true", help="show the moves, change nothing")
    args = parser.parse_args()

    groups = set(GROUPS) if (args.all or (args.dry_run and not args.group)) else set(args.group)
    if not groups:
        parser.error("nothing selected; pass --all or --group <name...>")

    json_files = [str(p.relative_to(REPO_ROOT)) for p in sorted(DRAFTS.rglob("*.json"))]
    if not _gate("drafts validate", [sys.executable, str(DRAFTS / "validate_drafts.py")]):
        print("\nnothing promoted — fix the failures above and re-run.", file=sys.stderr)
        return 1
    if not _gate(
        "no quarantined material",
        [str(REPO_ROOT / "scripts" / "check_quarantine.sh"), *json_files],
    ):
        print("\nnothing promoted — see docs/quarantine.md.", file=sys.stderr)
        return 1
    print()

    excluded = set(args.excluded)
    moved = held = 0
    for src, dest, name in _planned_moves(groups):
        rel_src = src.relative_to(REPO_ROOT)
        rel_dest = dest.relative_to(REPO_ROOT)
        if name in excluded:
            print(f"  hold   {name}")
            held += 1
            continue
        if dest.exists():
            print(f"  SKIP   {name} — already exists at {rel_dest}", file=sys.stderr)
            held += 1
            continue
        if args.dry_run:
            print(f"  would  {rel_src} -> {rel_dest}")
        else:
            dest.parent.mkdir(parents=True, exist_ok=True)
            subprocess.run(["git", "mv", str(rel_src), str(rel_dest)], cwd=REPO_ROOT, check=True)
            print(f"  moved  {rel_dest}")
        moved += 1

    print()
    if args.dry_run:
        print(f"dry run: {moved} file(s) would move, {held} held back. Nothing changed.")
    else:
        print(f"{moved} file(s) promoted, {held} held back in specs/drafts/.")
        print("Check 'git status', then commit. Anything held back can be promoted later.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
