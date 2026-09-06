# contracts/ — the frozen interfaces. DRAFT until a human deletes this line.

Everything in this directory is read by every agent and written by none of them. A change goes through `<your-dir>/QUESTIONS.md` and a human, per `AGENTS.md`. While a file still contains the word `DRAFT`, code against it but expect it to move.

| file | what it fixes |
|---|---|
| `spec_schema.json` | a persona spec: seat, authority envelope, information feeds, clock, utility weights, hidden type, psyche, priors, voice, backstory |
| `action_schema.json` | the 14-rung action ladder (`x-action-ladder`) **and** the structured decision every seat emits (the root schema) |
| `event_log_schema.json` | one JSON line per event in an episode log |
| `inject_schema.json` | a scenario or replay: the inject timeline and the ground-truth scoring key |
| `lake_record_schema.json` | one decision with the metadata needed to filter it, train on it and reproduce it |
| `s3_layout.md` | bucket, prefixes, key templates, version tags, object metadata |
| `seats.md` | the 12 LLM personas and 5 rule actors |
| `targets.md` | the numeric pass conditions |
| `examples/` | one spec and one decision that validate, committed so a change that breaks them fails a test |

## How the files fit together

```
spec_schema  ──ok, seat/actor enums──▶  every other schema
action_schema ──action_type, action, message, decision──▶  event_log, inject, lake_record
inject_schema ──inject, cause──▶  event_log, lake_record
lake_record   ── output = action_schema#/$defs/decision, injects_seen = inject_schema#/$defs/inject
```

The schemas `$ref` each other **by bare filename** (`spec_schema.json#/$defs/seat`). That keeps them readable, but it means a validator needs a registry that knows those filenames. Six lines:

```python
import json
from pathlib import Path
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

CONTRACTS = Path("contracts")
NAMES = ["spec_schema.json", "action_schema.json", "event_log_schema.json",
         "inject_schema.json", "lake_record_schema.json"]

registry = Registry()
for name in NAMES:
    schema = json.loads((CONTRACTS / name).read_text())
    resource = Resource.from_contents(schema)
    registry = registry.with_resource(name, resource)          # how they $ref each other
    registry = registry.with_resource(schema["$id"], resource)  # canonical URI

def validator(name: str) -> Draft202012Validator:
    return Draft202012Validator(json.loads((CONTRACTS / name).read_text()), registry=registry)

validator("action_schema.json").validate(decision)
```

`tests/agent0-contracts/test_contracts.py` is the reference implementation; copy the fixture rather than reinventing it.

## Reading the ladder

`x-action-ladder` is **data**, not schema. JSON Schema validators ignore unknown `x-` keywords, so `action_schema.json` still validates a decision when used directly as a schema, while the same file carries the menu table. Read it as:

```python
LADDER = json.loads(Path("contracts/action_schema.json").read_text())["x-action-ladder"]
ALLOWED = {e["type"]: set(e["allowed_seats"]) for e in LADDER}
RUNG = {e["type"]: e["rung"] for e in LADDER}
IRREVERSIBLE = {e["type"] for e in LADDER if e["irreversible"]}
```

Rung index is meaningful and ordered: `RUNG[a] > RUNG[b]` means `a` is higher on the ladder, and eval reports modal rung and rung deltas on that ordering.

## Three rules that are easy to get wrong

1. **`allowed_seats` is the menu; a spec's `authority` is the envelope inside it.** `unilateral` and `requires_release` must be subsets of what `allowed_seats` permits for that seat. `recommend_only` is deliberately unconstrained — NORTHCOM can recommend a kinetic action it can never execute.

2. **`irreversible` means what `targets.md` counts**, which is `kinetic`, `terrestrial_response`, `counter_rpo` — and *not* `public_attribution` or `disclose_incident`, which are unrecallable but not scored under `irreversible_action_rate_replays`. Per-rung `notes` says so where it matters. Don't let Engine and Eval disagree about this.

3. **`filtered_state` on a lake record must contain nothing the seat could not know.** No ground truth, no other seat's `private_type`, no undelivered message. It becomes the user turn of a training example; a leak there trains the model to know things it will not know at evaluation.

## Versions

`contracts_v1`. Registered in `docs/VERSIONS.md`. Any change to a schema bumps it and gets a row there, and every S3 object carries `contracts-version` in its metadata per `s3_layout.md`.
