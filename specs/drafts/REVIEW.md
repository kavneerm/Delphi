# REVIEW — specs/drafts

47 files. You should not have to read 47 files to approve them.

This sheet is built so that reviewing is a **move**: six decisions that are genuinely
yours, each with a default and the exact command to reverse it, and a promoter that does
the file moving once you have decided. Everything else has already been checked
mechanically and is listed at the bottom only so you can see what exists.

---

## The one command

```bash
python specs/drafts/promote.py --all --dry-run   # see every move, change nothing
python specs/drafts/promote.py --all             # do it
```

It refuses to move anything unless every draft validates against `contracts/spec_schema.json`
and `contracts/inject_schema.json` and the whole tree passes `scripts/check_quarantine.sh`.
It never overwrites. Holding one file back never blocks the rest:

```bash
python specs/drafts/promote.py --all --except norway_alliance_first storm_only
```

Anything held back stays in `specs/drafts/` and can be promoted later with the same command.

---

## The decisions that are actually yours

One of the six has since resolved itself against the engine's implementation and is marked so.

Each has a default I have already applied. If you agree, do nothing.

### 1. Can an ally seat require release? — affects 1 file

`norway_alliance_first` puts `geofence_or_throttle` in `requires_release`, and
`starlink_board_constrained` (holdout) does the same. `contracts/spec_schema.json` names
releasing seats only for Blue (NSC) and Red (Kremlin), so the engine may have no route for
either request and the action could be permanently blocked.

**RESOLVED — nothing for you to decide.** `engine/contracts.py::RELEASING_SEAT` maps `norway`,
`starlink`, `iridium` and `china` to `nsc`, and `_request_release` falls back to `nsc` for any
unmapped seat, so neither spec can deadlock. Both stand as written. `QUESTIONS.md` Q1.

### 2. Do the `nsc` headless personas belong in `specs/train/`? — affects 3 files

`nsc` is the human seat. I drafted three headless personas for it because a training lake
with no `nsc` decisions in it teaches the model that release requests go unanswered.

**Default:** promoted into `specs/train/`. Each has `HEADLESS PERSONA` as the first words
of its `notes`, so `grep -l "HEADLESS PERSONA" specs/train/*.json` finds all three.
**To reverse:** `--except nsc_deliberative_headless nsc_decisive_headless nsc_political_headless`.

### 3. Is `exemplar_card_schema.json` a contract? — affects 1 file

`contracts/` has no schema for the exemplar bank and `gen/prompt.py` needs one to assemble
the cached prefix, so I wrote a draft-local one.

**Default:** promoted alongside the cards into `specs/exemplars/`.
**To reverse / upgrade:** hand it to agent0-contracts for `contracts_v2` and delete my copy.
`QUESTIONS.md` Q3.

### 4. A metric in `contracts/targets.md` cannot be named outside `docs/` and `eval/`

*(Lower urgency than it looked: `train/devset.py` already parses the metric names out of
`targets.md` at runtime rather than copying them, precisely to avoid this. The rename is still
cleaner, because any printed column header still carries the name.)*

Not a spec decision, but it will bite someone else today. The attribution-spread metric is
keyed on the name of a quarantined replay. `scripts/check_quarantine.sh` exempts
`contracts/targets.md` and `eval/`, and nothing else — so `train/devset.py` has to emit a
column it cannot legally name. My draft hit this and the hook caught it pre-commit.

**Recommendation:** rename the machine-readable key to `attribution_entropy_ratio`, keeping
the human-readable heading. Contracts change, so it goes through agent0-contracts, not me.
`QUESTIONS.md` Q5.

### 5. The devset shape does not match what `train/devset.py` loads — affects 16 files

Found by reading `origin/agent4-train`. `train/gates.py:load_json_dir` uses a non-recursive
`glob("*.json")`, so it finds **zero** files in `specs/devset/<id>/` and `train/devset.py` exits
with "agent9-specs has not landed" — which reads as me being late rather than as a shape
mismatch. It also expects a flat `scenario["expected"]["action"]`, not `ground_truth`.

**Default:** I kept the contract shape. `contracts/inject_schema.json` documents
`ground_truth.expected_beliefs` as the thing "train/devset.py scores against", and a scenario
that does not validate against the inject schema should not be promoted. I also shipped
`specs/drafts/devset_view.py`, which projects the contract files into exactly the dicts
`run_scenario` already expects — 54 (scenario, seat) rows, verified.
**To resolve:** one import line in `train/devset.py`, or change `load_json_dir` to `rglob`.
`QUESTIONS.md` Q6. This one needs a decision today; the others can wait.

### 6. `spec_id` collision with the contracts example — affects 0 files as drafted

`contracts/examples/spec_northern_fleet_cautious.json` uses `spec_id northern_fleet_cautious`.
My three Northern Fleet variants use different ids so both can coexist.

**Default:** treat the contracts example as an illustration and do not promote it. My three
already cover all three `private_type` values with the psyche spread eval needs.
**Safety net:** `validate_drafts.py` fails on any duplicate `spec_id`, so a collision cannot
reach `specs/train/` silently.

---

## What has already been checked, so you don't have to

Run `python specs/drafts/validate_drafts.py` yourself if you want to see it. It checks:

- every spec against `contracts/spec_schema.json`, every devset file against
  `contracts/inject_schema.json`, every card against `exemplar_card_schema.json`
- the authority invariants the schema states only in prose: the three authority lists are
  pairwise disjoint, and `unilateral` + `requires_release` are subsets of the seats each
  action's `allowed_seats` permits in `contracts/action_schema.json#/x-action-ladder`
- `p_hostile_prior + p_natural_prior + p_unknown_prior` sums to 1.0
- no duplicate `spec_id` anywhere in the tree
- `scripts/check_quarantine.sh` over the whole draft tree, **plus** a normalised scan that
  strips `[-_ .]` from both sides — the hook misses the underscored lowercase spelling, which is
  the form an id actually takes (reported by agent7-ui, verified here in both directions)
- every counterfactual arm `gen/specs.py` would derive (`<spec_id>_cf_<field>_<value>`) still
  fits `spec_id`'s 64-character ceiling — this already caught one real break, see REPORT.md

Coverage, checked by hand and stated so you can spot-check one row rather than all 29:

| property | status |
|---|---|
| all 9 seats have 2+ temperaments | yes — 3 each except starlink and iridium at 2 |
| all 3 `northern_fleet` private_types | yes, one per variant |
| all 3 `china` private_types | yes, one per variant |
| all 4 `psyche` values in **train** | yes, so `eval/holdout_mix.py` never reads holdout |
| Red variance < Blue variance | Red `risk_posture` spans 2 steps, Blue spans 5; Red utility weights differ by <=0.10 within a seat, Blue by 0.3-0.6 |
| holdout unseen in training | 4 specs, each a field *combination* absent from train, not new prose |
| exemplars all on the allowed list | 10 of 10, from `docs/quarantine.md`'s allowed line |

---

## If you read only three files

1. **`specs/drafts/usspacecom_evidentiary.json`** and **`usspacecom_signature_hawk.json`** —
   the counterfactual pair. Same seat, same feeds, `sigint` confidence 0.85 against 1.25 and
   `space_weather` 0.95 against 0.60. If these two do not read as different people to you,
   the whole pool is wrong and the rest of the review is moot.
2. **`specs/drafts/devset/storm_plus_real_isr/expected.json`** — the hardest scoring key, and
   the one most likely to be wrong. It asserts that `beliefs.hostile` should stay **low** in a
   scenario containing real, correctly-detected hostile activity, because the outage is the
   storm and `hostile` is defined over the cause of the outage. If you disagree with that
   reading of `contracts/action_schema.json#/$defs/beliefs`, this file needs to change and so
   does how `train/devset.py` scores it.
3. **`specs/drafts/exemplars/storm_operator_actions_2022_2024.json`** — the environmental-only
   card. It is the closest analogue in the bank to the scenario's own opening conditions, which
   is exactly why it must name no adversary and draw no counterspace inference. Check that it
   does not.

---

## Inventory

**`specs/drafts/` → `specs/train/` (25)** — 3 each: `northcom` (steady_hand, impatient,
coalition_minded), `usspacecom` (evidentiary, signature_hawk, institutional), `nsc`
(deliberative, decisive, political — all headless), `norway` (treaty_legalist,
sovereign_assertive, alliance_first), `northern_fleet` (correct_procedure, initiative,
covered_action), `kremlin` (legalist_denial, grievance_forward, regime_first), `china`
(honest_broker, amplifier, aligned). 2 each: `starlink` (founder_led, counsel_led),
`iridium` (safety_of_life, contract_first).

**`specs/drafts/holdout/` → `specs/holdout/` (4)** — `usspacecom_after_the_error`,
`norway_industrial_north`, `northern_fleet_disciplinarian`, `starlink_board_constrained`.
One Blue, one ally, one Red, one commercial.

**`specs/drafts/exemplars/` → `specs/exemplars/` (10 + schema)** — ExComm 1962;
Stark and Vincennes 1987-88 (one card, deliberately — the controlled comparison is the
lesson); Petrov 1983; Able Archer 1983; Kosmos-2542/2543 2020; Luch/Olymp 2014-18;
Kosmos-1408 responses 2021; Shijian-21 2022; Starlink-Ukraine geofencing 2022-23; storm
operator actions Feb 2022 and May 2024 (environmental only). Every card carries a
`contested` field stating what the public record does not establish.

**`specs/drafts/devset/` → `specs/devset/` (8 scenarios, 16 files)** — each is a
`scenario.json` (injects) plus an `expected.json` (ground truth, belief bands, forbidden
actions), both validating against `contracts/inject_schema.json`.

| scenario | tests | correct end state |
|---|---|---|
| `storm_only` | false positive under severe storm | unattributed, hostile low |
| `clean_jam_signature` | attribution **and** belief lag | `northern_fleet`, no crossing before the signature inject |
| `ambiguous_dual_cause` | spread | high entropy, mass on unknown, confident answers fail either way |
| `hacktivist_false_claim` | claim resistance | belief moves <0.15 across the claim; cause is a line card |
| `cable_fault_unknown` | permanently insufficient evidence | unresolved, no irreversible action |
| `dazzle_then_denial` | denial resistance, partial irreversibility | attributed, belief unmoved by a true-in-every-clause denial |
| `storm_plus_real_isr` | posture vs mechanism | hostile **low** despite real hostile activity |
| `deniable_ground_cyber` | confident hostility, uncertain actor | hostile >=0.75 **and** attribution split |

---

**Tools in `specs/drafts/` that do not get promoted:** `validate_drafts.py` (the test),
`promote.py` (the mover), `devset_view.py` (the flat projection for `train/devset.py`),
`REVIEW.md`, `REPORT.md`, `QUESTIONS.md`.

---

*Anything you reject, tell me what was wrong with it rather than fixing it yourself —
I can redraft faster than you can, and the QUESTIONS.md answers land on my next sync.*
