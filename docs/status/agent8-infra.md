# agent8-infra
state: IN_PROGRESS
branch: agent8-infra
last_commit:
interfaces_ready: [s3_bucket, infra.storage]
needs: []
awaiting_human:
updated: 2026-09-05
notes: |
  2026-09-05 — S3 bucket svalbard-wargame (us-east-1) is live and conformant:
  six contract prefixes, versioning on, AES256, public access blocked, lifecycle
  (abort incomplete MPU 7d, expire noncurrent 30d), tagged project=svalbard.
  infra/bootstrap.py is idempotent (second run: 0 changes). IAM role
  pubdef-svalbard-wargame-node created with an inline bucket-scoped policy.
  Surprise: the panoptes identity cannot create managed policies or any role not
  named pubdef-*, so the role is prefixed and its grant is inline.
  2026-09-05 — Added infra/teardown.sh (tag-keyed, dry-run by default, stages
  --compute/--data/--iam/--all), infra/provision_gpu.sh (self-gating on the quota),
  infra/gpu_setup.sh and infra/serve_vllm.sh <checkpoint_s3_uri>.
  GPU quota L-DB2E81BA = 0.0 → provisioning SKIPPED, nothing launched, nothing
  billing. Pending request 312f3b0f78754d25920d9b0f6482d2feWs3fPUjY is CASE_OPENED
  for 48 vCPU (case 178865548000820). Train should stay on Fireworks.
  2026-09-05 — infra/storage.py landed: the single S3-or-local-mirror helper
  contracts/s3_layout.md §6 asks for, enforcing the §4 metadata (all nine keys,
  seed stringified, JSONL as application/x-ndjson) and the project=svalbard tag on
  every write; require=(...) raises before an untraceable object reaches the bucket.
  35 tests pass, ruff clean, quarantine clean; infra/REPORT.md written with both ARNs.
  Next: rebase on main, open the PR.
