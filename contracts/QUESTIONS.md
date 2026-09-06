# QUESTIONS — agent0-contracts

Nothing here blocked me; I made a call on each and shipped it. All of these are cheap to change now and expensive to change after Wave 1 starts, so they want ten minutes of human attention before the merge.

---

## Q1: `targets.md` and `seats.md` still say DRAFT, and my new files copy that convention

**Context:** `AGENTS.md` says a contract file containing `DRAFT` is not approved. `REPO_SETUP.md` §3 says the human deletes the `DRAFT` lines from every contract file at merge. I added the same marker to all seven new files: a `"$comment": "DRAFT until a human deletes this line."` at the top of each JSON, and a `DRAFT until a human deletes this line.` on the heading of each markdown.

**Options:** (a) delete the seven markers at merge along with the two existing ones; (b) leave them until after env lock.

**My recommendation:** (a). Wave 1 cannot start against files that announce they are unapproved, and the schemas are what the whole dependency order hangs off.

**What I did meanwhile:** Marked them all and kept the marker in a place that does not affect validation — `$comment` is ignored by JSON Schema, so deleting the line is a one-line edit per file with no functional risk.

---

## Q2: no `pyproject.toml` at the repo root

**Context:** `AGENTS.md` requires Python 3.12, `ruff` clean, `pytest`. `.superset/setup.sh` does `if [ -f pyproject.toml ]; then pip install -e ".[dev]"`, so it currently installs nothing and every workspace comes up bare. `REPO_SETUP.md` puts root files under human ownership, so I did not create one.

**Options:** (a) a human adds a root `pyproject.toml` with `jsonschema`, `referencing`, `pytest`, `ruff`, `boto3` and `requires-python = ">=3.12"`; (b) each agent installs ad hoc and the workspaces drift.

**My recommendation:** (a), before Wave 1 launches. It is five minutes now and nine agents' worth of "works on my worktree" later. Set `line-length` explicitly while you are in there — I formatted my test file at ruff's default 88.

**What I did meanwhile:** Built a local `.venv` on 3.12 with `jsonschema`, `referencing`, `pytest`, `ruff` and ran the suite green. `.venv/` is already gitignored.

---

## Q3: `WARGAME_LOCAL_ROOT` needs a line in the root `.gitignore`

**Context:** `s3_layout.md` §6 defines a local mirror at `$WARGAME_LOCAL_ROOT`, default `./.wargame-local`, so agents can develop offline against the same key layout. The root `.gitignore` is human-owned and does not cover it.

**Options:** (a) add `.wargame-local/` to `.gitignore`; (b) drop the local-mirror convention.

**My recommendation:** (a). One line. Without it the first agent to run offline commits a directory of episode logs.

**What I did meanwhile:** Documented the path and pointed at this question from `s3_layout.md` §6 rather than editing a file I do not own.

---

## Q4: enum values I had to invent, because the plan names the field but not its values

**Context:** The launch prompt specifies `risk_posture (enum)` and `time_horizon (enum)` without listing members. Both are load-bearing: `risk_posture` is one of the two fields flipped to build counterfactual pairs, and `counterfactual_sensitivity ≥ 0.90` in `targets.md` is measured across those flips.

**What I chose:**
- `risk_posture`: `risk_averse | cautious | balanced | assertive | risk_acceptant` — five, ordered, so a flip can be one step or polar and Agent 9 can vary temperament without changing psyche.
- `time_horizon`: `immediate | days | weeks | months | years`, where `immediate` means inside the 72-hour episode and anything past `days` means the persona will trade in-episode cost for later position.
- `information.clearance`: `open | commercial_proprietary | restricted | secret | top_secret_sci`, ordered, with `commercial_proprietary` added because three of the twelve seats are companies and their information ceiling is not a government one.
- `message.channel`: `diplomatic | mil_to_mil | liaison | commercial | press | internal | back_channel | hotline`. Channel drives delivery delay and who else observes the traffic, so this list is really an engine parameter table; Agent 1 should push back if it wants different ones.

**My recommendation:** Accept, or tell me which to change. If `risk_posture` should be three values rather than five, now is the moment — Agent 9 drafts 30 specs against it in Wave 1.

**What I did meanwhile:** Documented the intended meaning of each value in the schema `description` so Agent 9 is not guessing.

---

## Q5: `utility_weights` are magnitudes, and the engine owns the signs

**Context:** The eight weights are listed without a sign convention. If specs carry signs, two personas can express the same preference in two ways and no filter or judge can compare them.

**What I chose:** all eight are in `[0,1]`, and `engine/utility.py` applies a fixed convention — `asset_loss`, `escalation_risk` and `liability` are negated; the other five are positive. It is written into the schema `description` for `utility_weights`.

**My recommendation:** Accept, and have Agent 1 implement exactly that. If Engine wants signed weights instead, say so before Agent 9 writes 30 specs.

**What I did meanwhile:** Wrote the convention into the schema and into the example spec's `notes`.

---

## Q6: `hacktivist` can use `public_attribution`, which is not really attribution

**Context:** The hacktivist seat needs a signalling move or it is just a cyber effect generator. I gave it rung 3 to mean a public *claim of responsibility*, true or false — which is how deniable actors actually muddy attribution.

**Risk:** `control_false_positive_rate` in `targets.md` counts controls "attributed to an adversary". If that metric is computed over all seats, a hacktivist false claim on the Galaxy 15 control would score as a false positive when it is in fact correct adversary behaviour.

**My recommendation:** Agent 6 computes `control_false_positive_rate` over **Blue and ally seats only** (`northcom`, `usspacecom`, `nsc`, `norway`, `nato`). Confirm and I will write it into `targets.md`, or tell me to drop rung 3 from the hacktivist's `allowed_seats`.

**What I did meanwhile:** Noted the dual meaning in the rung's `notes` field so Agent 6 sees it when implementing the metric.

---

## Q7: `ground_truth.real_responses` accepts two shapes

**Context:** The launch prompt writes `real_responses: {seat: action}`. A bare action name loses when it happened and who really did it, which `eval/replay_table.py` needs for the attribution-lag table.

**What I chose:** `oneOf` — a bare action-type string, or an object `{action, sim_time_s, real_actor, notes, source_url}`. Agent 10 can write the short form where the record is thin and the long form where it is not.

**My recommendation:** Accept. If you would rather have one shape, make it the object form and I will tighten it.

**What I did meanwhile:** Both shapes are covered by the schema and the long form is documented as preferred.

---

## Q8: things I deliberately did **not** put in the contracts

Flagging these so nobody assumes they exist:

- **No release-mechanism schema.** `authority.requires_release` says an action needs release; it does not say what a release message looks like. I left that to Agent 1, since it is engine state, not an interface between agents. If Gen needs to *see* pending releases in `filtered_state`, that is a contract change.
- **No `filtered_state` inner shape.** `lake_record_schema.json` names six keys Engine should populate and lets Engine own the rest. Freezing it now, before `engine/world.py` exists, would freeze the wrong thing.
- **No judge rubric.** `judge_scores` fixes the four dimensions and the 1–5 range; the rubric text is Agent 3's and versioned as `judge_vN`.
- **I did not touch `targets.md` or `seats.md`.** I found no errors in either. The only thing I would change is the metric scope in Q6, and that is a human call.
