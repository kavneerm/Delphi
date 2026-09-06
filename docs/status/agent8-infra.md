# agent8-infra
state: IN_PROGRESS
branch: agent8-infra
last_commit:
interfaces_ready: [s3_bucket]
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
  Next: teardown.sh, storage helper, gpu/vllm scripts, tests, REPORT.md.
  GPU quota L-DB2E81BA = 0 → no instance provisioned, per brief.
