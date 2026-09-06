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

## GPU provisioning — SKIPPED, nothing is billing

```
aws service-quotas get-service-quota --service-code ec2 --quota-code L-DB2E81BA
→ Quota.Value = 0.0   ("Running On-Demand G and VT instances", vCPUs)
```

The value is 0, so per the brief **no instance was provisioned**. No EC2 instance, no
EBS volume, no elastic IP exists under this project; `./infra/teardown.sh` reports an
empty compute footprint.

**Pending increase request: `312f3b0f78754d25920d9b0f6482d2feWs3fPUjY`**
— status `CASE_OPENED`, desired value 48 vCPU (one `g5.12xlarge`), support case
`178865548000820`, opened 2026-09-05 20:44 EDT by `arn:aws:iam::944002752544:user/pubdef-dev`.

```bash
aws service-quotas get-requested-service-quota-change \
  --request-id 312f3b0f78754d25920d9b0f6482d2feWs3fPUjY --profile panoptes
```

`infra/gpu_setup.sh` and `infra/serve_vllm.sh` are written and syntax-checked but have
**never been executed against a live instance**, because there is no instance to run
them on. If the quota is granted, `./infra/provision_gpu.sh --launch` re-reads it,
launches one `g5.12xlarge` off the Deep Learning OSS Nvidia AMI with the instance
profile attached, tags everything `project=svalbard`, and runs `gpu_setup.sh` as
user-data. Until then, Train and Selfplay should stay on
`train/serve.py --backend fireworks`, which is the default.

## Endpoints

None. No compute is running, so there is no endpoint to publish. When a GPU box
exists, `serve_vllm.sh` prints `http://<instance-ip>:8000/v1` with the adapter name to
pass as the `model` field.

## Tests (command + result)

```
$ python -m pytest tests/agent8-infra -q
35 passed

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
JSONL is `application/x-ndjson`), the local-mirror round trip, and the guardrails in
the shell scripts (strict mode, `--yes` opt-in, tag filters, the quota gate).

## Versions produced (env / spec / lake / filter / judge)

None. Infra produces no versioned artefacts; it provides the bucket the versions are
written into. `infra/storage.py` writes `contracts-version=contracts_v1` on every
object and refuses writes whose required version strings are empty.

## Untested / known gaps

- `gpu_setup.sh` and `serve_vllm.sh` have never run on a real GPU — quota is 0. Their
  package pins are best-effort; the first real run will likely need a version nudge.
- `provision_gpu.sh --launch` is untested past the quota gate for the same reason. It
  uses the default VPC's default security group and relies on SSM for access; if the
  quota lands, someone should confirm SSM works before assuming there is a way in.
- The bucket has no logging or replication. For a hackathon that is the right amount.
- Deleting a *managed* IAM policy is impossible for this identity, so `teardown.sh`
  removes the inline policy with the role; there is no managed policy to leak.
- `bootstrap.py` cannot recover if a bucket of that name exists in another account —
  it raises a clear error rather than retrying.

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
- `interfaces_ready: [s3_bucket, infra.storage]` in `docs/status/agent8-infra.md`.
