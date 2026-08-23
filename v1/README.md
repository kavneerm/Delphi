# v1 — the original scroll-driven build

Archived on 2026-08-23. This is the implementation that shipped to
https://inevitablefrontier.org: one continuous world transforming across four acts,
scroll-pinned, painted into palette-indexed pixel buffers rather than composed from
assets.

It is kept whole and runnable so a rewrite has something to diff against — the pixel
substrate, the eight-slot depth model, and the check harness all encode decisions that
were expensive to reach and are not obvious from the output.

## Running it

Dependencies resolve from the repo root's `node_modules`, so no separate install is
needed:

    cd v1
    npm run dev            # vite dev server
    npm run build          # typecheck + production build into v1/dist
    npm run check          # the gating suite — all six checks
    CHECK_PORT=4451 npm run check    # when running two suites at once

## What lives here vs. at the repo root

This folder holds one *implementation*. What the site **is** — the argument it makes and
the art it is measured against — stays at the repo root, because it outlives any single
frontend:

| Repo root | Why it is not in here |
|---|---|
| `docs/copy-deck.md` | The argument itself. `check:deck` reads it from `../docs/`. |
| `docs/art-direction.md`, `docs/asset-contract.md` | The visual spec. |
| `docs/reference-envelope.json`, `Object Reference/` | Reference art and the envelope derived from it. `check:refmatch` grades against these. |
| `docs/review-checklist.md` | How a build is judged. |
| `docs/plans/deploy-aws.md` | The S3 + CloudFront setup, which the bucket outlives. |
| `infra/` | Terraform for that bucket and distribution. `npm run deploy` reads `../infra/`. |

`scripts/lib.ts` exports `REPO` for exactly this: a check that read the spec from its own
folder would grade a rewrite against a stale copy that shipped with the old code.

## State at archival

`npm run check` — all green:

    horizon / vanishing-point invariant   511 assertions, 0 failures
    parallax contract                    2378 assertions, 0 failures
    pixel register (allowance 0%)          18 assertions, 0 failures
    rise / extrude travel                  39 assertions, 0 failures
    copy deck consistency                  25 assertions, 0 failures
    pacing                                408 assertions, 0 failures

`npm run check:refmatch` — **1 of 36 failing**, pre-existing and not chased:

    ✗ 390x844 The Frontier (p=0.06, vs Act 1): detail too coarse —
      runP25 is 1.54% of width, want <= 0.99%

Mobile art at the Act I hold is coarser than the reference envelope allows. The source is
byte-identical to commit `005f928`, so this predates the archival move; the committed
`dist/` was stale, which is why a green run was last seen against different bytes.

## Known open problems

These are the reasons a rewrite was wanted. They are documented, not fixed:

- **Fast scrolling on mobile glitches.** A crossfade needs both acts resident, which
  composites ~404MB of device-resolution canvas at 390x844. Down from 861MB via
  `display: none` on non-visible acts and disabling aberration plates on mobile, but not
  solved.
- **Cropping rasters to their drawn bounds is the fix, and it does not work.** Measured
  the largest win of any change — mobile transition 404MB → 115MB, `check:perf` green at
  all three viewports — but `check:invariant` failed because `mix-blend-mode` makes an
  element's *bounds* load-bearing, not just its pixels. Shrinking a blended layer leaves a
  hard step at the crop edge. Written up in `docs/plans/perf-check.md` §8, including what
  a blend-aware version would have to do.
- **`check:perf` is marginal**, ~16.3ms worst frame at 1440x900 against a 16.7ms budget.
- **Act-to-act choreography was never revised** — easing, stagger, and palette bridging
  are untouched from the original build.
