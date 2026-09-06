# agent8-infra
state: DONE
branch: agent8-infra
last_commit: 8855d51
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
  2026-09-05 — Added infra/audit.py: read-only conformance audit of the bucket (and
  the mirror) against every section of s3_layout.md — prefix, key template, version
  patterns, key/metadata agreement, the nine metadata keys, the project tag, content
  type — exiting 1 on a finding so it can gate a run. Bucket audits clean. Read the
  other agents' writers first, which paid for itself twice: gen/storage.py writes a
  deliberately transient lake/<v>/_parts/ key that is NOT in §3 (write-as-you-go per
  §5, deleted at episode close), so the auditor counts those separately instead of
  emitting tens of thousands of false findings; and the good-key fixtures are the
  exact strings engine/log.py and gen/storage.py produce, so Engine's logs/ and Gen's
  lake/ keys are confirmed conformant as written. The auditor also flags the smoke/
  and tmp/ keys already sitting in the main checkout's mirror.
  2026-09-05 — Read the other agents' code again and found a FOURTH writer, which is
  good news: train/storage.py already delegates every byte to infra.storage.Storage,
  i.e. the Q1 verdict implemented independently. It brought a third spelling of the
  switch though (boolean WARGAME_LOCAL, checked before from_env()), so a process with
  it set got the mirror from train.storage and S3 from infra.storage — the same split
  one level down. resolve_backend() now honours all three spellings and still refuses
  to guess when they disagree. Warned agent4-train that the new prefix guard will
  raise on their smoke/ and tmp/ keys if they ever flip that path to S3 (harmless
  today: those 24 objects are on the local mirror). engine/ and gen/ remain the two
  that still need the one-line adoption.
  2026-09-06 — Checked handoffs: agent4-train and agent3-gen both report verifying the
  live S3 write path. Confirmed from the bucket's version history — their probes are
  there, written and deleted around 02:10. Two costs: train's runs/_selftest/... key
  matches no §3 template, and all three probes were removed with plain deletes, so a
  versioned bucket kept a noncurrent version AND a delete marker for each (the
  expire-noncurrent-30d rule clears them; I did not purge another agent's artefacts).
  Added infra/selftest.py so nobody has to invent a fourth probe key: it writes to a
  CONTRACT-VALID key (logs/env_v0/lake_v0/selftest/seed=0/selftest-0-<8hex>.jsonl,
  which satisfies the §3 logs template, so no exemption and no seventh prefix), checks
  the nine metadata keys, the content type, the cost tag and the bytes, then removes
  the probe BY VERSION ID so it leaves no object, no version and no delete marker.
  8/8 against live S3; verified afterwards that logs/ holds only .keep.
  2026-09-06 — agent4-train answered and corrected me: their smoke/ and tmp/ files
  were written by path, never through storage.put_*, so the prefix guard would never
  have fired on them. The mirror-shape half was right and they acted on it — scratch
  moved to .wargame-scratch/, outside the key space. Verified: that mirror now audits
  clean, and they now call resolve_backend() when it is importable. Corrections in
  infra/REPORT.md and infra/QUESTIONS.md.
  BLOCKING OTHERS: PR #3 is MERGEABLE/CLEAN and unmerged, and agent4-train is waiting
  on it to run infra.audit. Until it lands, infra/audit.py, infra/selftest.py and
  resolve_backend() are only on branch agent8-infra.
  111 tests pass, ruff clean, quarantine clean. Bucket and role ARNs in infra/REPORT.md.
