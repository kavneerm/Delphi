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
use different ids (`northern_fleet_correct_procedure`, `_initiative`, `_covered_action`) so the
example can be promoted alongside them without a collision, but a human should decide whether the
contracts example is part of the pool or only an illustration.

**Recommendation:** treat it as an illustration and do not promote it; my three cover the same
`private_type` space with the psyche spread `eval/holdout_mix.py` needs.

**What I did meanwhile:** `validate_drafts.py` fails on any duplicate `spec_id` within the drafts
tree, so a collision cannot reach `specs/train/` silently.
