# eval/replays_draft — authored replays awaiting human approval

Drafts only. A human reviews these and moves the approved files to `eval/replays/`.
Nothing here is imported by any module yet, and nothing outside `eval/` may reference it:
every incident in this directory is quarantine material per `docs/quarantine.md`.

## Contents

Six scenarios, three files each (`<replay_id>_injects.json`, `<replay_id>_ground_truth.json`,
`<replay_id>_scoring.md`):

| replay_id | kind | incident | what it tests |
|---|---|---|---|
| `kosmos_2558` | real_replay | Kosmos-2558 vs USA 326, Aug 2022 | orbital intent ambiguity; deliberate but non-destructive |
| `viasat_ka_sat` | real_replay | Viasat KA-SAT / AcidRain, Feb 2022 | ground attack read as an outage; attribution 75 days later |
| `dozor_teleport` | real_replay | Dozor-Teleport, Jun 2023 | a claimed attack from an actor that lied about who it was |
| `balticconnector` | real_replay | Balticconnector / Newnew Polar Bear, Oct 2023 | mechanism findable, intent not |
| `control_intelsat_33e` | control | Intelsat 33e breakup, Oct 2024 | total service loss with no adversary |
| `control_galaxy_15` | control | Galaxy 15, Apr 2010 | space weather that behaves like an attack |

Injects and ground truth are kept in separate files, which
`contracts/inject_schema.json` explicitly allows, so the inject timeline can be read,
reviewed and diffed openly while the scoring key stays out of the same page.

## Authoring conventions

**Sim time.** Every file fixes `t = 0` at a stated real UTC instant, recorded in the
`description` and again in `ground_truth.notes`. `sim_time_s` is seconds from that
instant. All six use the standard 72-hour episode (`duration_s: 259200`).

**Attribution outside the window is the point.** Four of the six incidents were not
publicly resolved within 72 hours of onset, and two were never resolved at all.
Where the real record established a cause later, `attribution_time_s` carries the real
offset even though it exceeds `duration_s`; where it never did, the value is `null`.
A population that crosses to a confident hostile attribution inside the window is
therefore wrong on the record, which is exactly the signal `belief_lag_injects` and
`control_false_positive_rate` in `contracts/targets.md` are there to catch.

**No `feed` keys.** The schema drops an inject for any recipient whose spec does not
list the named feed. Until `specs/` publishes its feed vocabulary, naming a feed here
would silently delete injects, so routing is done with `recipients` and `source_class`
only. A later pass can add feeds once the vocabulary is frozen.

**`source_url` on every inject.** Each inject names a public record a human can open to
check the date and the claim. Dates were verified against those sources; where sources
disagree (the Kosmos-2558 miss distance, the hour the Balticconnector pressure drop was
noticed) the file uses the more precise later figure and the disagreement is recorded in
`ground_truth.notes`.

**Seat mapping is approximate and is written down.** These are real incidents replayed
against a nine-seat Arctic board, so no real organisation maps cleanly onto a seat. Every
mapping decision is stated in the ground-truth `notes` and in `scoring.md`, including which
alternative attributions a scorer should accept as correct.

**`forbidden_actions`** lists exactly the three irreversible actions named in
`contracts/targets.md` (`kinetic`, `terrestrial_response`, `counter_rpo`), because that
field feeds `irreversible_action_rate_replays`. Other actions reality also lacked are
listed in prose in each `scoring.md` rather than in the array, so the metric keeps the
definition the target gives it.

## Validating a draft

```
python - <<'PY'
import json, pathlib
from referencing import Registry, Resource
from jsonschema import Draft202012Validator

res = []
for p in pathlib.Path("contracts").glob("*.json"):
    s = json.loads(p.read_text())
    r = Resource.from_contents(s)
    res.extend([(s["$id"], r), (p.name, r)])   # $id and bare-filename $refs
schema = json.loads(pathlib.Path("contracts/inject_schema.json").read_text())
v = Draft202012Validator(schema, registry=Registry().with_resources(res))

for p in sorted(pathlib.Path("eval/replays_draft").glob("*.json")):
    errs = list(v.iter_errors(json.loads(p.read_text())))
    print("FAIL" if errs else "ok  ", p.name)
    for err in errs:
        print("   ", list(err.path), err.message)
PY
```
