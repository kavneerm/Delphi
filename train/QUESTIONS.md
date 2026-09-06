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

# 2. The Llama caveat was wrong, and the Qwen base is the one that cannot train

**Needs a decision: I have swapped the second base and want it confirmed or vetoed.**

The brief predicted Llama 3.1 8B would fail and Qwen2.5 7B would be the safe arm.
A 200-example job on each says the opposite.

| base | library flags | SFT job | outcome |
|---|---|---|---|
| `llama-v3p1-8b-instruct` | `Status: INTERNAL`, deprecated 2025-11-26 | accepted | **JOB_STATE_COMPLETED in 371s**, adapter produced |
| `qwen2p5-7b-instruct` | `Status: OK`, `Tunable: true`, `Supports Lora: true` | **refused** | `400 "model is not supported for fine-tuning"` |

So the deprecation warning cost nothing and the healthy-looking base is the dead
one. `qwen2p5-14b-instruct` is refused the same way, which rules out the
replacement I proposed in the previous version of this question.

**What actually predicts acceptance** is a field neither the brief nor I was
reading — `Supervised Lora Tunable`, which `firectl get model` prints only when
set:

| model | Tunable | Supports Lora | Rl Tunable | **Supervised Lora Tunable** | SFT job |
|---|---|---|---|---|---|
| `llama-v3p1-8b-instruct` | yes | yes | yes | **yes** | accepted |
| `qwen3-8b` | yes | yes | yes | **yes** | accepted |
| `qwen2p5-7b-instruct` | yes | yes | — | **no** | refused |
| `qwen2p5-14b-instruct` | yes | yes | yes | **no** | refused |

`train/fireworks.py` now reads that field in `Client.preflight()`, and every
entry point calls it before spending. It is a filter, not a proof — the proof is
still a 200-example job.

**What I did, and what I want confirmed.** `qwen2p5-7b-instruct` is not a
judgement call, it is a hard API rejection: leaving it in the sweep would
guarantee five of ten variants fail. I replaced it with
`accounts/fireworks/models/qwen3-8b` — accepted by the SFT API, `Status: OK`,
`Supervised Lora Tunable`, 8B-class, 40960 context. Two consequences worth your
eye before the sweep runs:

1. **The context floor moved from 32768 to 40960.** `filter.py` computes it from
   `BASE_MODELS` rather than a literal, and a test asserts config and code agree,
   so nothing silently truncates — but a filter config tuned to 32k now has 8k of
   slack it is not using.
2. **Qwen3-8B is itself past a deprecation date (2026-05-14)**, same as Llama. On
   this account that has turned out to be cosmetic, but both sweep bases are now
   deprecated models, which is worth knowing before results are quoted anywhere.
   `qwen2p5-7b-instruct` remains listed in `REJECTED_BASES` so a stale config
   fails with the reason rather than a `KeyError`.

If you would rather the sweep run Llama-only and spend the freed budget on ranks
and filter configs, say so and I will cut the ten variants to six.

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
