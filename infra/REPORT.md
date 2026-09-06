# REPORT — agent8-infra

## What I built

**Storage (live).** `s3://svalbard-wargame` in `us-east-1`, converged by
`infra/bootstrap.py` and conformant with `contracts/s3_layout.md`:

| what | state |
|---|---|
| **bucket ARN** | `arn:aws:s3:::svalbard-wargame` |
| region / account | `us-east-1` / `944002752544` |
| prefixes | `specs/ lake/ runs/ checkpoints/ validation/ logs/` — the six of §1, no seventh |
| versioning | Enabled (an accidental overwrite is recoverable) |
| encryption | SSE-S3 (AES256) by default |
| public access | all four blocks on; no bucket policy is written by anything in `infra/` |
| lifecycle | `abort-incomplete-multipart-7d`, `expire-noncurrent-30d` — neither expires a live object |
| tags | `project=svalbard`, `managed-by=infra/bootstrap.py` |

**IAM (live).**

| what | state |
|---|---|
| **role ARN** | `arn:aws:iam::944002752544:role/pubdef-svalbard-wargame-node` |
| instance profile | `pubdef-svalbard-wargame-node` (same name) |
| grant | inline policy `svalbard-wargame-s3-rw`: list/read/write on `arn:aws:s3:::svalbard-wargame` and `/*` only, with an explicit `Deny` on `s3:DeleteBucket`, `s3:PutBucketPolicy`, `s3:PutBucketPublicAccessBlock` |
| trust | `ec2.amazonaws.com` and principals in this account |
| tags | `project=svalbard` |

The role exists for future EC2/GPU nodes. **Agents do not need it today** — the
`panoptes` CLI profile already writes to the bucket directly.

Two names surprised me and are worth knowing before anyone renames anything: the
`panoptes` identity has `PowerUserAccess` **plus** `pubdef-iam-scoped`, which permits
IAM writes only on `pubdef-*` roles and instance profiles, and permits *inline* role
policies but **not** managed ones (no `iam:CreatePolicy`). Hence the `pubdef-` prefix
and the inline grant. A role named without that prefix fails with `AccessDenied`; a
test pins the prefix so the failure happens in CI rather than against AWS.

**Files.**

| file | what it does |
|---|---|
| `infra/bootstrap.py` | idempotent converge of bucket + IAM. `--dry-run`, `--verify`, `--no-iam`, `--no-markers` |
| `infra/storage.py` | the single S3-or-local-mirror helper `contracts/s3_layout.md` §6 asks for; enforces the §4 metadata and the `project=svalbard` tag on every write |
| `infra/teardown.sh` | tag-keyed teardown; dry-run until `--yes`; stages `--compute`, `--data`, `--iam`, `--all` |
| `infra/provision_gpu.sh` | self-gating GPU launcher: reads the quota and refuses to spend when it is 0 |
| `infra/gpu_setup.sh` | node bring-up: CUDA check, venv, torch/PEFT/TRL/Unsloth/vLLM/bitsandbytes, GPU visibility assertion |
| `infra/serve_vllm.sh <checkpoint_s3_uri>` | pulls an adapter from S3 and serves it as a named LoRA on an OpenAI-compatible endpoint; `--down` stops it |

## Adjudication: three storage writers, one contract

Asked to settle the two-writers claim, I found three. `contracts/s3_layout.md` §6 asks
for one helper; `infra/storage.py`, `engine/storage.py` and `gen/storage.py` each open
by claiming to be it, and they do not agree on what the switch is or what it defaults to:

| helper | env switch | S3 when | default unset |
|---|---|---|---|
| `infra/storage.py` (merged `bf0403f`) | `WARGAME_STORAGE` | anything but `local` | **s3** |
| `engine/storage.py` (merged `c0a3d46`) | `WARGAME_STORAGE` | `s3` exactly | **local** |
| `gen/storage.py` (branch `agent3-gen`) | `WARGAME_BACKEND` | `s3` exactly | **local** |

Two modules read the same variable with opposite defaults, and no single assignment
puts all three on S3. The repo `.env` sets neither switch, so as merged: Engine writes
`logs/` locally, Gen writes `lake/` locally, `infra.storage` writes to the bucket. The
bucket holds six `.keep` markers; `Panoptes/.wargame-local` holds 24 files. Since
`episode_id` is the join key between `logs/` and `lake/` (§3), a split backend breaks
the join — and because each agent has its own worktree, `local` does not mean a shared
lake, it means eight private ones.

**Verdict.** The duplication is the violation, not any one module. `infra.storage`
should be the implementation and the other two thin shims over it, with **`s3` as the
unset default** — an argument from the worktree layout, not taste. Full reasoning,
options and the two smaller divergences (sidecar placement inside vs. outside the
mirror; `boto3.client("s3")` ignoring `AWS_PROFILE=panoptes`) are in
`infra/QUESTIONS.md` Q1, for a human to ratify. Gen's `Store` has one thing worth
keeping in whatever survives: it remembers the `VersionId` it wrote, so a transient
part can be hard-deleted instead of lingering as a noncurrent version.

I did not touch `engine/` or `gen/`. What I did do, in my own directory, is make the
eventual merge cheap and make the current state safe:

- `resolve_backend()` accepts **both** spellings, rejects an unknown value, and raises
  when the two are set and disagree rather than silently splitting a run. Adopting it
  is a one-line change in either module.
- S3 writes outside the six contract prefixes now raise, quoting §1. Not hypothetical:
  the local mirror already contains `smoke/` and `tmp/` keys that would have become a
  seventh and eighth bucket prefix the first time someone flipped the backend.

**On agent1-engine's original hazard line, separately: it was true, and it is now
resolved.** `4b36e68` and `8acabb8` are reachable from `origin/agent4-train` and
`origin/agent10-replays` and from neither `origin/main` nor `origin/agent1-engine`, so
`main` is clean — the engine code on `main` arrived via `2bb8372`. One correction to
the claim: the content is *not* engine-only. `4b36e68` also edits
`docs/status/agent1-engine.md`, so a PR from either branch would carry another agent's
status file, which is the one file AGENTS.md says is off limits. Both branches should
rebase onto `main` and drop the two commits before opening a PR. There are now eight
worktrees, one per active agent, so the shared-HEAD failure cannot recur.

## How to run it

```bash
export AWS_PROFILE=panoptes WARGAME_BUCKET=svalbard-wargame

python -m infra.bootstrap --dry-run     # show the plan
python -m infra.bootstrap               # converge (safe to repeat)
python -m infra.bootstrap --verify      # current state as JSON

./infra/teardown.sh                     # inventory, deletes nothing
./infra/teardown.sh --all --yes         # destroys the lake; there is no undo
```

Writing an object, from any agent:

```python
from infra.storage import Storage, Versions

store = Storage.from_env()  # S3; WARGAME_STORAGE=local switches to the mirror
store.put_jsonl(
    f"lake/{lake_v}/{env_v}/{spec_v}/{scenario_id}/seed={seed}/{episode_id}.jsonl",
    records,
    versions=Versions(
        env_version=env_v,
        spec_version=spec_v,
        lake_version=lake_v,
        seed=seed,
        episode_id=episode_id,
    ),
    require=("env_version", "spec_version", "lake_version"),
)
```

`require=` raises before the write if a version string is empty, so an object that
could not be traced back to a run never reaches the bucket.

## GPU provisioning — NOT LAUNCHED, nothing is billing

The gate moved during the session, so both readings are recorded:

```
21:39 EDT  Quota.Value = 0.0    → skip entirely, per the brief
23:0x EDT  Quota.Value = 8.0    → partial grant, at ACCOUNT level
```

The quota is counted in **vCPUs, not instances**, so "greater than zero" is not the
same as "the instance the brief names will start". `g5.12xlarge` needs 48 vCPU; the
account now holds 8. The largest G instance that fits today is a `g5.2xlarge`
(8 vCPU, 1× A10G 24 GB) — a different instance type from the one authorized, and one
that cannot do a 4-GPU tensor-parallel run, so launching it is a spend decision rather
than an execution of the brief. **Asked, and the answer was not to launch: the project
stays on Fireworks.** No EC2 instance, EBS volume or elastic IP exists under this
project; `./infra/teardown.sh` reports an empty compute footprint.

**Pending increase request: `312f3b0f78754d25920d9b0f6482d2feWs3fPUjY`**
— status `CASE_OPENED`, desired value 48 vCPU (one `g5.12xlarge`), support case
`178865548000820`, opened 2026-09-05 20:44 EDT by `arn:aws:iam::944002752544:user/pubdef-dev`.
The 8 vCPU already granted appear to be a partial fulfilment; the case is still open
for the full 48.

```bash
aws service-quotas get-service-quota --service-code ec2 --quota-code L-DB2E81BA
aws service-quotas get-requested-service-quota-change \
  --request-id 312f3b0f78754d25920d9b0f6482d2feWs3fPUjY --profile panoptes
```

`infra/provision_gpu.sh` re-reads the quota on every run and now distinguishes three
cases: zero (skip, report the pending request), a partial grant (refuse, name the
largest type that would fit and the command to launch it), and enough (launch behind
`--launch`). It is the only thing in the repo that can start a GPU, and it will not do
so on its own.

`infra/gpu_setup.sh` and `infra/serve_vllm.sh` are written and syntax-checked but have
**never been executed against a live instance**, because none exists. `serve_vllm.sh`
now derives tensor-parallel size from the GPUs actually present rather than assuming
four, so it works unchanged on either instance type. Until a GPU exists, Train and
Selfplay stay on `train/serve.py --backend fireworks`, which is their default.

## Endpoints

None. No compute is running, so there is no endpoint to publish. When a GPU box
exists, `serve_vllm.sh` prints `http://<instance-ip>:8000/v1` with the adapter name to
pass as the `model` field.

## Tests (command + result)

```
$ python -m pytest tests/agent8-infra -q
51 passed

$ ruff check infra/ tests/agent8-infra/
All checks passed!
```

Idempotency was verified against live AWS, not mocked: a second `python -m
infra.bootstrap` immediately after the first reported **0 changed, 15 ok**, and a third
the same.

The tests deliberately touch no AWS. They cover the shape of the IAM policy (scoped to
one bucket ARN, S3 actions only, deny on bucket deletion), the prefix list parsed out
of `contracts/s3_layout.md` itself so contract drift fails a test, the §4 metadata
contract (all nine keys always present, `""` for not-applicable, seed stringified,
JSONL is `application/x-ndjson`), the local-mirror round trip, the backend-switch adjudication (both spellings, ambiguity refused, a seventh prefix
refused on S3 but allowed on the scratch mirror), and the guardrails in the shell
scripts (strict mode, `--yes` opt-in, tag filters, the quota gate).

## Versions produced (env / spec / lake / filter / judge)

None. Infra produces no versioned artefacts; it provides the bucket the versions are
written into. `infra/storage.py` writes `contracts-version=contracts_v1` on every
object and refuses writes whose required version strings are empty.

## Untested / known gaps

- `gpu_setup.sh` and `serve_vllm.sh` have never run on a real GPU — no instance was
  launched. Their package pins are best-effort; the first real run will likely need a
  version nudge.
- `provision_gpu.sh --launch` is untested past the quota gate for the same reason. It
  uses the default VPC's default security group and relies on SSM for access; if the
  quota lands, someone should confirm SSM works before assuming there is a way in.
- The bucket has no logging or replication. For a hackathon that is the right amount.
- Deleting a *managed* IAM policy is impossible for this identity, so `teardown.sh`
  removes the inline policy with the role; there is no managed policy to leak.
- `bootstrap.py` cannot recover if a bucket of that name exists in another account —
  it raises a clear error rather than retrying.
- The three-helper split is *adjudicated, not fixed*: `engine/storage.py` and
  `gen/storage.py` still default to the local mirror. Until someone ratifies
  `infra/QUESTIONS.md` Q1 and lands the one-line change in each, a run started with no
  `WARGAME_STORAGE` in the environment still writes its logs and its lake to a
  worktree-private directory.
- `.wargame-local/` is ignored only via `.git/info/exclude`, which is not committed.
  `infra/QUESTIONS.md` Q2; humans own `.gitignore`.

## Quarantine check

`docs/quarantine.md` lists incidents that must not appear in specs, exemplars,
prompts or training data. Infra writes no specs, prompts or training data — only
bucket configuration and shell scripts. I searched every file I wrote for each
quarantined incident name and for the general terms; no match. The repo's
`scripts/check_quarantine.sh` pre-commit hook passed on every commit on this branch.

## Handoffs made

- `docs/HANDOFFS.md`, 2026-09-05 → **agent3-gen, agent4-train, all agents**: the bucket
  is live with all six prefixes; write immediately, no waiting.
- `docs/HANDOFFS.md`, 2026-09-05 → **all agents**: `infra/storage.py` is the one helper
  for the S3/local-mirror switch and the §4 metadata contract.
- `docs/HANDOFFS.md`, 2026-09-05 → **agent1-engine, agent3-gen, coordinator**: the
  three-writers adjudication above, the `resolve_backend()` drop-in, and the two
  branches carrying agent1-engine's stray commits.
- `interfaces_ready: [s3_bucket, infra.storage]` in `docs/status/agent8-infra.md`.
