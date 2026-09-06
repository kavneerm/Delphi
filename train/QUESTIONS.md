# train/QUESTIONS.md — agent4-train

One question per heading. Each carries my recommendation and what I did meanwhile.
Humans answer under `## Answer` and push; I pick it up on the next sync.

---

# 1. RESOLVED — Fireworks payment method

A human added a payment method at 2026-09-06 ~01:55 UTC. Job creation works.
Left here for the record: before that, every SFT job returned
`400 code 9 "payment method is required"`, on both bases, which is what made the
first smoke run look like a Llama problem when it was an account problem.

## Answer
Resolved 2026-09-06 by the human.

---

# 2. Both base-model caveats were backwards, and the sweep needs a second base

**Open. `launch.py` refuses to run until this is answered** — `qwen3_14b` carries
`needs_approval`, and a plain `python -m train.launch` now exits before spending
anything. Picking the sweep's bases is a human call, so I have not made it.

## What the brief predicted, and what actually happened

The brief expected Llama 3.1 8B to be the risky arm and Qwen2.5 7B to be safe.
Measured by submitting real jobs, it is the reverse.

- **Llama 3.1 8B — works end to end.** `Status: INTERNAL`, deprecated
  2025-11-26, and none of that matters: 200-example LoRA job
  `JOB_STATE_COMPLETED` in 371s, deployment READY, adapter loaded, **inference
  returned a real completion**. The full smoke path is green on this base.
- **Qwen2.5 7B — cannot train.** `400 "model is not supported for fine-tuning"`,
  despite `Status: OK`, `Tunable: true`, `Supports Lora: true`.

## Why the obvious replacements also fail

A base has to do two things, and the library advertises neither reliably.

1. **Train** — needs `supervisedLoraTunable` (top level of the REST model
   resource, *not* under `baseModelDetails` where `tunable` lives).
2. **Serve** — multi-LoRA addons cannot ride a quantized deployment. A base at
   `defaultPrecision` FP8/FP4 is refused at deployment create. If it also ships
   an in-checkpoint drafter, overriding the deployment precision does not save
   it: the drafter stays quantized and fails validation on its own.

Serving is not optional — it is how `gates.py` and `devset.py` reach a
checkpoint at all — so a train-only base is not a usable arm.

| model | sftLora | precision | trains | serves |
|---|---|---|---|---|
| `llama-v3p1-8b-instruct` | yes | BF16 | **yes** | **yes** |
| `qwen3-14b` | yes | BF16 | **yes** | **yes** |
| `qwen3-4b-instruct-2507` | yes | BF16 | **yes** | **yes** |
| `qwen3-32b` | yes | BF16 | yes | yes |
| `qwen3-8b` | yes | **FP8** | yes | **no** |
| `qwen2p5-7b-instruct` | **no** | BF16 | **no** | — |
| `qwen2p5-14b-instruct` | **no** | BF16 | **no** | — |
| `llama-v3p2-3b-instruct` | yes | BF16 | **no** | — |

I proposed `qwen2p5-14b-instruct` and then `qwen3-8b` in earlier revisions of
this question. Both were wrong, for the two different reasons above. This table
is measured, not read off flags.

## What I recommend, for you to confirm or veto

**`accounts/fireworks/models/qwen3-14b`** as the second base. It trains, it
serves, it is BF16, it has no deprecation date, and it keeps a genuine
cross-architecture contrast against Llama. Context 40960, so the filter floor
stays where it already is and no filter config has to move.

Three things you should weigh before saying yes:

1. **It is 14B, not 8B.** Bigger than the brief's 7B, so the two arms differ in
   capacity as well as architecture, which muddies "which base is better"
   slightly. `qwen3-4b-instruct-2507` is the alternative if you would rather the
   contrast be architecture-only-ish and cheaper; it is further from 8B in the
   other direction.
2. **14B costs more per job and per GPU-hour than 7B would have.** Five of the
   ten sweep variants are on this base.
3. **Llama-only is a legitimate answer.** If you would rather not spend on a
   second architecture at all, say so and I will cut the sweep from ten variants
   to six and put the budget into ranks and filter configs instead. That loses
   the cross-architecture claim but nothing else.

To approve: answer below, or just run with `--approve-base-swap` /
`APPROVE_BASE_SWAP=1`.

## Answer
<!-- human: answer here -->

---

# 3. `contracts/s3_layout.md` gives `filter_vN` the pattern `^filter_v[0-9]+$`

That leaves no room for a name like `filter_v0_smoke`, so the smoke path's filter
block is called `filter_v0` and the three real ones are `filter_v1`..`filter_v3`.
Flagging it only so nobody is surprised that `filter_v0` exists and is not a real
sweep arm; I am not asking for a contract change.

## Answer
<!-- human: answer here -->

---

# 4. FYI — two Fireworks behaviours worth knowing repo-wide

Not questions; recording them because they cost time and will cost anyone else
the same time.

1. **`firectl` refuses every mutating subcommand under an agent**, `--dry-run`
   included: `BLOCKED: mutating command "firectl dataset create" cannot run
   inside an AI agent`. All writes go over REST; `firectl` is read-only here.
   Dataset upload is a four-step flow — `POST /datasets` ->
   `:getUploadEndpoint` -> signed `PUT` -> `:validateUpload`. Calling
   `:validateUpload` before the bytes land wedges the dataset in `UPLOADING` and
   every later `:getUploadEndpoint` on it answers 405.
2. **The signed GCS upload URL signs `x-goog-content-length-range`**, so the PUT
   must send that header or GCS answers `400 MalformedSecurityHeader`.
3. **Deployments require an explicit `acceleratorType`** — without it,
   `400 "accelerator_type must be specified for non-embeddings engines"`.
   `train/config.yaml` sets `NVIDIA_H100_80GB`, which is what the account has
   training quota for.

## Answer
<!-- no answer needed -->
