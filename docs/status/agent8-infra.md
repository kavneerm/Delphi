# agent8-infra
state: DONE
branch: agent8-infra
last_commit: d4e0f4b
interfaces_ready: [s3_bucket, infra.storage, infra.storage.resolve_backend, infra/teardown.sh]
needs: []
pr: https://github.com/kavneerm/Delphi/pull/3
awaiting_human: infra/QUESTIONS.md Q1 (which storage helper wins) and Q2 (.gitignore line) — recommendations given, not blocking
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
  2026-09-05 (later) — the quota moved 0.0 → 8.0 mid-session, but it counts vCPUs:
  g5.12xlarge needs 48, so the type in the brief still cannot start. Largest that
  fits is g5.2xlarge (1x A10G 24GB) — a different type from the authorized one, so I
  asked rather than substituted; the answer was DO NOT LAUNCH, stay on Fireworks.
  Nothing is billing. provision_gpu.sh now separates zero / partial grant / enough,
  and serve_vllm.sh derives tensor-parallel size from the GPUs actually present.
  2026-09-05 — infra/storage.py landed: the single S3-or-local-mirror helper
  contracts/s3_layout.md §6 asks for, enforcing the §4 metadata (all nine keys,
  seed stringified, JSONL as application/x-ndjson) and the project=svalbard tag on
  every write; require=(...) raises before an untraceable object reaches the bucket.
  2026-09-05 — DONE. Adjudicated the storage-writer claim: there are three helpers,
  not two, and infra/ + engine/ read the SAME variable with OPPOSITE defaults while
  gen/ reads a different variable — so as merged, with the repo .env, Engine writes
  logs/ and Gen writes lake/ to a worktree-private .wargame-local while infra writes
  to the bucket, and the episode_id join across logs/ and lake/ breaks. Verdict and
  options in infra/QUESTIONS.md Q1 (recommend: infra.storage is the implementation,
  s3 is the unset default, because eight worktrees means eight private mirrors).
  Did not touch engine/ or gen/. Shipped resolve_backend() accepting both spellings
  and refusing to guess when they disagree (a one-line adoption for either module),
  plus a hard refusal of S3 writes outside the six contract prefixes — the mirror
  already holds smoke/ and tmp/ keys that would have become prefixes seven and eight.
  agent1-engine's shared-checkout hazard: verified true, now resolved (eight
  worktrees). main is clean; 4b36e68 and 8acabb8 sit only on agent4-train and
  agent10-replays, and 4b36e68 also carries a foreign docs/status edit — both
  branches should rebase onto main and drop them before opening a PR.
  51 tests pass, ruff clean, quarantine clean. Bucket and role ARNs in infra/REPORT.md.
