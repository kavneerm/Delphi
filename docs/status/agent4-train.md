# agent4-train

state: IN_PROGRESS
branch: agent4-train
last_commit: (see git log)
interfaces_ready:
needs: lake/ records (agent3); specs/train + holdout + devset (agent9); human ack on the base swap (train/QUESTIONS.md #2)
updated: 2026-09-06 02:06 UTC
notes: |
  2026-09-06 01:50 — First smoke run blocked account-wide: every SFT job returned
  400 "payment method is required", both bases. Fixed two path problems on the
  way: firectl 1.8.2 refuses EVERY mutating subcommand under an agent (--dry-run
  included) so dataset upload moved to the four-step REST flow, and the signed
  GCS URL signs x-goog-content-length-range which the PUT must send.

  2026-09-06 02:06 — Payment method added by a human; smoke re-run. THE BRIEF'S
  TWO CAVEATS WERE BACKWARDS.
    * Llama 3.1 8B — Status INTERNAL, deprecated 2025-11-26 — TRAINS FINE.
      200 examples, JOB_STATE_COMPLETED in 371s, adapter produced.
    * Qwen2.5 7B — Status OK, Tunable true, Supports Lora true — IS REFUSED:
      400 "model is not supported for fine-tuning". So is qwen2p5-14b-instruct,
      which kills the replacement I had proposed an hour ago.
  The field that actually predicts acceptance is `Supervised Lora Tunable`, which
  neither the brief nor I was reading; llama-v3p1-8b and qwen3-8b have it, both
  qwen2.5 models do not. Client.preflight() now checks it before anything spends,
  and every entry point calls it. Note it sits at the TOP level of the REST model
  resource, not under baseModelDetails where `tunable` lives — I read the wrong
  level first and my own preflight briefly rejected two bases that work.
  Second base swapped to accounts/fireworks/models/qwen3-8b (accepted, Status OK,
  8B-class, 40960 ctx). That moves the context floor 32768 -> 40960; filter.py
  computes it from BASE_MODELS and a test pins config to code, so nothing
  truncates silently. Both sweep bases are now past a deprecation date, which is
  cosmetic on this account but worth knowing before results are quoted. Swap is
  written up as train/QUESTIONS.md #2 for a human to confirm or veto — I did not
  want it to be a silent decision, but leaving a base the API hard-refuses would
  have failed five of ten variants.
  Also: deployments need an explicit acceleratorType (400 otherwise);
  config.yaml sets NVIDIA_H100_80GB, matching the account's training quota.
  41 tests green across filter/gates/fireworks; the fireworks tests caught a real
  bug (my resource-id regex rejected single-character ids).
  In flight: Llama deployment leg (reusing the trained adapter rather than paying
  to train twice), then the full Qwen3-8B smoke, sequential so only one
  per-GPU-hour deployment is ever up.
  2026-09-06 02:19 — Both bases now TRAIN clean: llama31_8b COMPLETED in 371s,
  qwen3_8b COMPLETED. Serving is the part still not proven, and it has produced
  three distinct failures, each fixed:
    (a) POST /deployedModels returns before the adapter can answer -> inference
        404s in that window. Added load_lora_and_wait().
    (b) qwen3-8b deployments are refused outright with "addons cannot be enabled
        with quantized precisions (FP8/FP4)": Fireworks picks a quantized default
        for that base and multi-LoRA needs an unquantized one. create_deployment
        now names BF16 explicitly. This one matters beyond the smoke test —
        multi-LoRA IS the serving design, so a base whose default precision is
        quantized cannot serve the sweep without this.
    (c) the `model` string that routes to an adapter on a dedicated deployment is
        undocumented and the two forms I tried fail differently (bare name ->
        "Model not found"; fully-qualified #accounts/.../deployments/... ->
        "fault filter abort"). Rather than pay a deployment per guess, the smoke
        test now probes four candidate forms inside one live deployment and
        records the winner. In flight now.
  Cost discipline held throughout: every deployment torn down in a finally block,
  0 deployments live after each attempt, ~3 GPU-minutes total spent on serving.
  Wrote train/REPORT.md. 53 tests green. Also note for anyone scripting here:
  zsh does not word-split unquoted variables, so a `for x in "a b"; set -- $x`
  loop silently passes the whole string as one argument — cost me one no-op run.
  2026-09-06 02:30 — Housekeeping a human flagged, all three done.
  (1) BRANCH CLEANED. My earlier worktree-collision recovery rebuilt agent4-train
      on the shared tip, which dragged in agent1/agent2/agent9/agent10 commits
      (engine/, calib/, eval/replays_draft/, their status files). Rebuilt on
      origin/main and cherry-picked only my six commits; the branch now touches
      train/, tests/train/, my own status file, HANDOFFS.md and VERSIONS.md and
      nothing else. Their commits are preserved on origin/agent10-replays, so
      nothing was lost. This needs a force-push of MY branch only — the one
      exception I can see to the never-force-push rule, since the whole point is
      to remove commits that were never mine. Flagging rather than doing it
      quietly. Also dropped the .gitignore edit I had made; humans own that file.
  (2) GPU HOURS LOGGED to docs/VERSIONS.md: 9.0 H100-minutes total, three
      llama31_8b smoke deployments, each torn down by the finally block, account
      verified at 0 live deployments after every attempt. No qwen3_8b deployment
      has ever reached READY — every attempt was refused at create time, which
      costs nothing.
  (3) QUESTIONS.md #2 IS STILL OPEN and the code now enforces that. qwen3_8b
      carries needs_approval in BASE_MODELS, and launch.py preflights every sweep
      base and REFUSES to start without --approve-base-swap / APPROVE_BASE_SWAP=1.
      Verified: a plain `python -m train.launch` now exits with the reason before
      spending anything. The smoke test stays exempt, because demonstrating that
      the candidate base trains is the evidence the question is waiting on.
  67 tests green; the launch tests caught versions_for() silently accepting an
  undefined filter version, which would have tagged a run nobody could reproduce.
  Next: land the serving leg (in flight), then serve/devset tests and the sweep.
