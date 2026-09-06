# QUESTIONS — agent9-specs

One question per heading. Each carries a recommendation and what I did in the meantime.
A human answers under `## Answer` and pushes; I pick it up on the next sync.

---

## 1. Can an ally seat (norway) put an action in `requires_release`?

`contracts/spec_schema.json#/properties/authority/requires_release` says a released action
is "executable only after a release message from a releasing seat (NSC for Blue, Kremlin for
Red)". Norway is an **ally** seat, not Blue, and no releasing seat is named for it.

`norway_alliance_first` is the one persona in the pool for which the alliance constraint should
have mechanical bite rather than only showing up in weights — the whole point of the temperament
is that it will not close the Svalbard downlink without allied cover. I put
`geofence_or_throttle` in its `requires_release`.

**Risk:** if `engine/release.py` has no route for an ally-seat request, that action is
permanently blocked and the persona degenerates into "norway that never geofences", which is
worse than not modelling the constraint at all.

**Recommendation:** route ally-seat release requests to `nsc` (the Blue releasing seat), same as
a Blue request. If that is not cheap, treat the list as advisory for ally seats and let the
action through after `deliberation_minutes`.

**What I did meanwhile:** kept the field as written and noted the fallback in the spec's `notes`.
The other two norway variants have an empty `requires_release`, so the seat is never wholly
blocked whichever way this lands.

---

## 2. Should `nsc` specs be sampled into `specs/train/` at all?

`nsc` is the human-playable seat. I have drafted three headless personas for it (`_headless`
suffix on the temperament) because `contracts/seats.md` says the seat "runs headless under an LLM
persona or an auto-approval rule" and the event log is identical either way — so the training lake
needs nsc decisions from somewhere.

**Recommendation:** sample them into `specs/train/` normally. They are the release-authority
distribution the rest of the board is reacting to, and a lake with no nsc decisions in it teaches
the model that release requests go unanswered.

**What I did meanwhile:** drafted all three in `specs/drafts/` (not `holdout/`), each with a
`notes` field that says HEADLESS PERSONA in the first line so a human sorting drafts can pull them
out in one grep if the answer is no.

---

## 3. Exemplar card format is a draft schema, not a contract

`specs/drafts/exemplar_card_schema.json` is mine, written because `contracts/` has no schema for
the exemplar bank and `gen/prompt.py` needs one to assemble the cached prefix.

**Recommendation:** if the format survives review, agent0-contracts should adopt it as
`contracts/exemplar_schema.json` at `contracts_v2` and I will drop my copy. Until then the field
names are stable and `$ref`s into `spec_schema.json` and `action_schema.json` resolve against
`contracts/`, so nothing downstream has to special-case it.

**What I did meanwhile:** kept it inside `specs/drafts/` and validated every card against it in
`specs/drafts/validate_drafts.py`.

---

## 4. `spec_id` collision with `contracts/examples/spec_northern_fleet_cautious.json`

The contracts example uses `spec_id: northern_fleet_cautious`. My three Northern Fleet variants
use different ids (`northern_fleet_procedural`, `_initiative`, `_covered_action`) so the
example can be promoted alongside them without a collision, but a human should decide whether the
contracts example is part of the pool or only an illustration.

**Recommendation:** treat it as an illustration and do not promote it; my three cover the same
`private_type` space with the psyche spread `eval/holdout_mix.py` needs.

**What I did meanwhile:** `validate_drafts.py` fails on any duplicate `spec_id` within the drafts
tree, so a collision cannot reach `specs/train/` silently.

---

## 5. The spread metric in `contracts/targets.md` cannot be named outside `docs/` and `eval/`

`contracts/targets.md` keys its attribution-spread metric on the name of one of the quarantined
replays. `scripts/check_quarantine.sh` exempts `contracts/targets.md` itself, but nothing else —
so a spec, a prompt, a devset scenario, or any file under `gen/` or `train/` that refers to that
metric **by its key** fails the pre-commit hook. Mine did, in a `notes` field; caught by the hook
before anything was committed, and noted here per AGENTS.md.

This is not only my problem: `train/devset.py` and `eval/report.py` both have to emit a column
with that name, and `eval/` is exempt but `train/` is not.

**Recommendation:** rename the machine-readable key to something incident-free —
`attribution_entropy_ratio` — keeping the human-readable heading as it is. That is a contracts
change, so it goes through agent0-contracts rather than through me.

**What I did meanwhile:** referred to it as "the end-of-episode attribution-entropy target in
contracts/targets.md" wherever a draft needs to point at it, and left `contracts/` untouched.

---

## 6. `train/devset.py` cannot load the devset as `contracts/inject_schema.json` describes it

Found by reading `origin/agent4-train`, not by anyone reporting it. Two mismatches, either of
which alone makes the dev set silently unusable:

1. `train/gates.py:load_json_dir` uses a **non-recursive** `path.glob("*.json")`. The devset is
   one directory per scenario (`specs/devset/<id>/{scenario,expected}.json`), so the loader
   finds zero files and `train/devset.py` exits with
   `"no dev scenarios in specs/devset; agent9-specs has not landed"` — which reads as my
   workstream being late rather than as a shape mismatch.
2. `run_scenario` reads a flat `scenario["expected"]["action"]` and tests
   `expected["cause"] == "natural"`. The contract puts the key in `ground_truth`, with a
   richer `cause` enum (`natural_space_weather`, `technical_failure`, ...) and per-seat
   `real_responses` rather than one action per scenario.

I have kept the contract shape. `contracts/inject_schema.json` describes the split
(`ground_truth.expected_beliefs` is documented as the thing "train/devset.py scores against"),
`kind: devset` is part of the enum, and a scenario file that does not validate against the
inject schema is not something a human should be promoting into `specs/devset/`.

**Recommendation, in order of preference.** (a) `train/devset.py` imports
`specs/drafts/devset_view.py::flat_scenarios`, which projects the contract files into exactly
the dicts `run_scenario` already expects — one row per (scenario, seat), with
`expected.action`, `expected.cause == "natural"` for controls, the belief band and the
forbidden-action list. That is a one-line change on their side and no change to the files.
(b) Failing that, change `load_json_dir` to `rglob` and read `ground_truth` directly.

**What I did meanwhile:** wrote `specs/drafts/devset_view.py` and verified it emits 54
(scenario, seat) rows across the eight scenarios. Also populated `ground_truth.real_responses`
in all eight `expected.json` files, which was empty before and meant `response_match` — one of
only four targets a synthetic dev set can honestly measure — had nothing to score against.
Seats expected to hold are deliberately absent from that map, which is what the contract says
an absent seat means.

**Note on Q5 above:** `train/devset.py` already parses the machine-readable table out of
`contracts/targets.md` at runtime rather than copying the metric names, specifically to avoid
naming a quarantined replay. That is a good workaround and it lowers the urgency of the
rename, but it does not remove the problem — any results table, column header or report that
prints the metric name still carries it.
