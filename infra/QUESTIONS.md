# QUESTIONS — agent8-infra

## Q1: Three modules claim to be the one storage helper, and they disagree on the default backend. Which one wins?

**Context:**
`contracts/s3_layout.md` §6 asks for exactly one helper "so the switch is a single
environment variable, not a code path per module". Three landed:

| helper | env switch | value that means S3 | **default when unset** |
|---|---|---|---|
| `infra/storage.py` (merged `bf0403f`) | `WARGAME_STORAGE` | anything but `local` | **s3** |
| `engine/storage.py` (merged `c0a3d46`) | `WARGAME_STORAGE` | `s3` exactly | **local** |
| `gen/storage.py` (branch `agent3-gen`) | `WARGAME_BACKEND` | `s3` exactly | **local** |

Two of them read the *same variable with opposite defaults*. The repo `.env` sets
`WARGAME_BUCKET` and `AWS_PROFILE` and neither switch, so **today, right now**: Gen
writes `lake/` to `.wargame-local`, Engine writes `logs/` to `.wargame-local`, and
anything going through `infra.storage` writes to the bucket. The bucket holds six
`.keep` markers and nothing else; `Panoptes/.wargame-local` holds 24 files.

Two consequences, both real rather than theoretical:

1. **The join breaks.** `episode_id` is the join key between `logs/` and `lake/`
   (§3). Split across backends, Eval and the UI find lake records whose logs are on
   someone's laptop.
2. **`.wargame-local` is per-worktree.** There are eight worktrees. A local default
   does not give the agents a shared local lake; it gives each agent a private one.
   The bucket is the only storage this project actually shares.

There is also no single variable assignment that puts all three on S3:
`WARGAME_STORAGE=s3` moves Engine and infra but leaves Gen local.

Two smaller divergences worth settling at the same time:
- Engine and Gen write the local sidecar as `<key>.meta.json` *inside* the mirror;
  `infra.storage` writes it to `_meta/<key>.json` outside the tree. The sidecars are
  not in the §3 key templates, so a mirror that is ever `aws s3 sync`-ed up puts
  objects in the bucket that `train/filter.py` would then read as lake records.
- `engine/storage.py` calls `boto3.client("s3")` with no profile, so it uses the
  default credentials rather than `AWS_PROFILE=panoptes` (AGENTS.md: AWS via the CLI
  profile). It also defaults every object's content type to `application/x-ndjson`
  and permits `metadata=None`, which §4 calls out of contract.

**Options:**
1. **`infra.storage` is the implementation; Engine and Gen keep their public function
   names as thin shims over it.** One code path, three familiar call sites.
2. **Keep all three, unify only the switch.** Cheapest; leaves three metadata
   implementations to drift.
3. **Engine's or Gen's helper wins and `infra.storage` is deleted.** Also fine in
   principle, but `infra.storage` is the one with the prefix guard, the profile
   pinning, the suffix-driven content types and the `require()` gate, so the others
   would have to grow those.

**My recommendation:** option 1, with **`s3` as the default when nothing is set** —
not as a preference but because eight worktrees means eight private mirrors, so
`local` as a default silently produces a lake nobody else can read. Local stays a
one-variable opt-in for offline work and is what the tests use.

Gen's `Store` has one thing mine lacked and should keep: it remembers the `VersionId`
of what it wrote so a transient part can be hard-deleted rather than left as a
noncurrent version (versioning is on because `infra/bootstrap.py` enabled it).

**What I did meanwhile:** I did not touch `engine/` or `gen/` — not my directory. In
`infra/storage.py` I made the merge cost as close to zero as I can from my side:

- `resolve_backend()` accepts **both** `WARGAME_STORAGE` and `WARGAME_BACKEND`,
  rejects an unknown value, and raises if the two are set and disagree rather than
  silently splitting a run. Adopting it is a one-line change in either module.
- S3 writes outside the six contract prefixes now raise, quoting §1. This is live:
  `.wargame-local` already contains `smoke/` and `tmp/` keys that would become a
  seventh and eighth bucket prefix the day someone flips the backend.
- 51 tests pass, including the ambiguity and prefix cases.

Whoever ratifies this should tell agent1-engine and agent3-gen; I have written the
adjudication to `docs/HANDOFFS.md` so both see it on their next sync.

## Answer

## Q2: `.wargame-local/` is ignored only through `.git/info/exclude`, not `.gitignore`

**Context:** `contracts/s3_layout.md` §6 says the local mirror "needs a line in the
root `.gitignore`" and `contracts/QUESTIONS.md` flagged it. It still is not there;
`git check-ignore -v` attributes the ignore to `.git/info/exclude`, which is
per-clone and is not committed. A fresh clone, or CI, will see 24 untracked files
under `Panoptes/.wargame-local` — episode logs and smoke artefacts — and a `git add
-A` commits them.

**My recommendation:** add `.wargame-local/` to the root `.gitignore`. Humans own
that file, so I have not edited it.

**What I did meanwhile:** nothing that touches it. The risk is bounded while the
exclude file exists in this clone.

## Answer
