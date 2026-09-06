# REPORT — agent9-specs

## What I built

47 draft files for human promotion, plus the two tools that make promoting them a command
rather than a reading exercise.

- **`specs/drafts/*.json` — 25 train specs**, covering all nine seats in `contracts/seats.md`:
  three temperaments each for `northcom`, `usspacecom`, `nsc`, `norway`, `northern_fleet`,
  `kremlin` and `china`; two each for `starlink` and `iridium`. Authority envelopes are fixed
  per seat and derived from `contracts/seats.md` and the ladder's `allowed_seats`; temperament
  varies utility weights, thresholds, feed confidence and clock. The three `nsc` specs are
  headless personas for runs with no human at the release seat.
- **`specs/drafts/holdout/*.json` — 4 held-out specs**, one Blue, one ally, one Red, one
  commercial. Each is held out on a *field combination* the train pool does not contain, so
  `train/gates.py` measures generalisation rather than paraphrase.
- **`specs/drafts/exemplars/*.json` — 10 historical decision cards**, every one from the
  allowed list in `docs/quarantine.md`, plus `exemplar_card_schema.json` (draft-local; see
  QUESTIONS.md Q3).
- **`specs/drafts/devset/<id>/{scenario,expected}.json` — 8 synthetic scenarios** with ground
  truth, per-seat belief bands and forbidden-action lists.
- **`specs/drafts/validate_drafts.py`** — validates everything and checks the invariants the
  schemas state only in prose.
- **`specs/drafts/promote.py`** — moves approved drafts into `specs/train|holdout|exemplars|devset`.
- **`specs/drafts/REVIEW.md`** — the review sheet: five decisions with defaults and the command
  to reverse each, rather than 47 files to read.
- **`specs/drafts/QUESTIONS.md`** — five open questions, each with a recommendation and what I
  did meanwhile.

## How to run it

```bash
python specs/drafts/validate_drafts.py            # validate every draft
python specs/drafts/promote.py --all --dry-run    # show every move, change nothing
python specs/drafts/promote.py --all              # promote
python specs/drafts/promote.py --all --except <id> [<id>...]   # hold specific files back
```

`promote.py` runs both gates (validation, quarantine) before moving anything, never
overwrites an existing file, and leaves anything held back in `specs/drafts/` for later.

## Tests (command + result)

```
$ python specs/drafts/validate_drafts.py
specs 25 | holdout 4 | devset files 16 | exemplars 10
OK

$ python specs/drafts/promote.py --all --dry-run
gate: drafts validate            -> OK
gate: no quarantined material    -> pass
dry run: 56 file(s) would move, 0 held back. Nothing changed.

$ python specs/drafts/promote.py --group train devset --except norway_alliance_first storm_only --dry-run
dry run: 38 file(s) would move, 3 held back. Nothing changed.
```

What `validate_drafts.py` asserts, beyond the JSON Schemas: the three authority lists are
pairwise disjoint; `unilateral` and `requires_release` are subsets of each action's
`allowed_seats` in `contracts/action_schema.json#/x-action-ladder`; the three priors sum to
1.0 within 0.01; no duplicate `spec_id`; and `scripts/check_quarantine.sh` passes over the
whole draft tree.

Coverage checked by hand: all three `northern_fleet` private types, all three `china` private
types, and all four `psyche` values appear in the **train** pool, so `eval/holdout_mix.py` can
sweep the psyche axis without reading `specs/holdout/`.

## Versions produced (env / spec / lake / filter / judge)

`spec_v1` — every spec and every exemplar card carries it. Devset scenarios carry
`replay_version: v1` per `contracts/inject_schema.json`. No env, lake, filter or judge version
is produced by this workstream. A row belongs in `docs/VERSIONS.md` when a human promotes the
pool; I did not add one because `docs/VERSIONS.md` is outside my directory.

## Untested / known gaps

- **Nothing has been run through the engine.** Every spec validates statically; none has
  produced a decision. Feed latencies, `deliberation_minutes` and `poll_minutes` are reasoned
  from the seat descriptions, not tuned against episode behaviour, and I expect the clock
  numbers to be the first thing that needs revision once `gen/run.py` produces real episodes.
- **The devset belief bands are authored, not calibrated.** They encode what I think competent
  behaviour looks like. `storm_plus_real_isr` is the one I would most expect to be argued with
  and it is flagged in REVIEW.md as such.
- **Two specs put an action in `requires_release` on seats with no defined releasing seat**
  (`norway_alliance_first`, `starlink_board_constrained`). This may deadlock; QUESTIONS.md Q1
  carries the fallback.
- **`exemplar_card_schema.json` is mine, not a contract.** If `gen/prompt.py` wants a different
  prefix shape, the cards are cheap to reshape; the sourcing is the expensive part and it is done.
- **No test lives in `tests/agent9-specs/`.** `validate_drafts.py` is the test and it runs
  standalone. If a human wants it in CI, it wraps in a `pytest` file in a few lines.

## Quarantine check (what I searched for, what I found)

Searched by delegating to `scripts/check_quarantine.sh` — the single source of the banned list
— over every draft file, at authoring time as part of `validate_drafts.py`, again as a gate in
`promote.py`, and again by the pre-commit hook on every commit. The exemplar bank is drawn
exclusively from the allowed line in `docs/quarantine.md`.

**Two findings, both mine, both caught before anything was committed:**

1. My first `validate_drafts.py` hardcoded the quarantined strings as a literal list so it could
   grep for them. The hook blocked the commit, correctly: a copy of the list is a copy of the
   material. The validator now shells out to `scripts/check_quarantine.sh` instead.
2. A `notes` field in `china_amplifier.json` referred to the attribution-spread metric in
   `contracts/targets.md` by its machine-readable key, which is built on a quarantined replay
   name. The hook blocked it; the reference is now generic.

Finding 2 is not only mine. `scripts/check_quarantine.sh` exempts `contracts/targets.md` and
`eval/` and nothing else, so `train/devset.py` has to emit a results column it cannot legally
name. Raised as QUESTIONS.md Q5 with a recommended rename (`attribution_entropy_ratio`) for
agent0-contracts. I did not touch `contracts/`.

No quarantined incident appears in any spec, card, scenario or tool in this workstream.

## Handoffs made

- **`specs/drafts/` is ready for promotion** — `agent3-gen` samples `specs/train/`,
  `agent4-train` reads `specs/holdout/` for gates and `specs/devset/` for the metrics table,
  `gen/prompt.py` reads `specs/exemplars/` for the cached prefix. All four are unblocked the
  moment a human runs `promote.py`, and can read `specs/drafts/` directly before that if the
  coordinator would rather not wait.
- **Note for `agent7-ui`:** `engine/samples/stub_run.jsonl` (c9809b4) seeds `spec_version:
  spec_v0` with placeholder ids of the form `<seat>_placeholder`. Real `spec_v1` ids are one
  file per `spec_id` in this tree; persona cards should not hardcode the placeholders.
- I have not appended to `docs/HANDOFFS.md`: AGENTS.md limits me to my own status file. These
  handoffs are recorded in `interfaces_ready` in `docs/status/agent9-specs.md` and relayed in my
  end-of-turn lines.
