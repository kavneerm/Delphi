# Wargame integration — transition + military unit sprites

## Goal

1. The letter site hands off to the Svalbard wargame through the 3.7s intro clip, so the
   move reads as one continuous shot rather than a page load.
2. The wargame gains a full joint-force sprite vocabulary — sea, sub-surface, air, land,
   fixed installations — drawn in the same idiom as the satellites.
3. Units are placed on real Svalbard geography, coloured by owning actor, named on hover.

## Layout

    index.html              CTA -> overlay <video> -> /wargame/
    public/ (none)          video is referenced relatively so Vite fingerprints it
    media/intro.mp4         source; emitted as assets/intro-<hash>.mp4
    wargame/index.html      the simulator (was "New Website/wargame.html")
    vite.config.ts          + wargame input

## Sprite contract — must match the satellites

The satellites establish the idiom. Units follow it exactly or they will read as clip art
dropped onto a technical illustration:

- Inline SVG, centred origin, `viewBox="-56 -34 112 68"`.
- Per-instance gradient ids (`hull${i}`, `deck${i}`, ...) — ids are global in a document,
  so a shared id would make every sprite inherit the first one's gradient.
- Shared builders, as `panel()`/`cells()`/`box()`/`dish()` are for the satellites.
- A `shade${i}` overlay pass on every solid body. This is what gives the satellites form;
  without it the units look flat next to them.
- Muted, desaturated palette. Actor colour enters as a *marking* (pennant, roundel, hull
  stripe), never as the body fill — otherwise the map turns into confetti.

## Tasks

- [x] Move wargame + video into the repo; wire Vite input
- [x] `unitSVG(i, type)` — 32 types across SEA / SUB / AIR / LAND / BASE
- [x] `UNITS` — 34 units placed in image space, actor-coloured, hover names
- [x] Bridge transition via /enter/ (skippable, reduced-motion aware, no-JS safe)
- [x] Wargame fades in on arrival so the cut is continuous
- [x] Checks: content 49, layout 489, laydown 160, bridge 12 — all passing
- [x] Adversarial review in a fresh subagent — 12 findings, 10 fixed
- [ ] Deploy — BLOCKED: infra is inevitablefrontier.org, the request named .com

## Verification

`npm run check` must stay green (44 content + 448 layout assertions), `npm run build` must
exit 0, and a screenshot pass must show every unit distinguishable at its rendered size
(~44px) rather than only in the gallery.


## What changed from the plan

- **The bridge could not live on index.html.** `check:content` asserts that page ships no
  `<script>` at all, and the comment on that assertion says why: every bug in the previous
  version came from the one script on the page. The transition therefore got its own
  document at `/enter/`, which replaces itself in history so Back returns to the letter.

- **Unit coordinates are image-space, not element-space.** The map paints `center/cover`,
  so the element crops the plate by a margin that changes with the viewport — at 1920x1080
  only the middle 72% of the image's rows are on screen. A `top:45%` names a different
  fjord at every window size. `mapGeom()` now converts image fractions to element pixels
  and re-runs on resize.

- **Two new gates.** `check:laydown` samples the map's own pixels under every unit and
  fails if a sea unit is on land or a land unit is at sea — it caught 9 real placement
  errors and one class of silent bug (five rows written `x:.706` without a leading zero,
  which a coordinate-rewriting regex skipped). `check:bridge` walks the three-document
  journey with script, without script, and under reduced motion.

## Known issue, pre-existing — not introduced here

`gs-bjo` (the Bjørnøya ground station) is positioned at `top:94.5%` of the map element.
Bjørnøya sits at image row ~0.94, which `center/cover` crops away at every viewport the
theatre renders at, so the marker floats in open water south of Spitsbergen and its link
lines run to a point that is not the island. The three `.gs` markers still use
element-space percentages; converting them through `mapGeom()` would fix Ny-Ålesund and
Longyearbyen onto their towns and move Bjørnøya honestly off-screen. Left alone because it
is the user's scenario data, not this change's.


## Adversarial review — what it found, and what was done

Ten fixes, each verified by reproducing the failure first.

**Shipped-broken defects**
- Units fell outside the `center/cover` crop at ordinary sizes. On a maximised window on a
  1080p panel the Russian bomber and the unflagged trawler — two units the scenario leans
  on — were not on the page. Eleven units moved into the band that survives 1920x950,
  2560x1080 and 3440x1440.
- `rotate(90)` put each aircraft's wingspan on the viewBox's 68-unit axis instead of its
  112-unit one. The UAV lost 30% of its wing to a silent SVG clip and read as a bare bar.
  Span and scales retuned; wakes were overflowing the same edge and are now clamped.
- The arrival veil was removed only by script, so any JS error anywhere in a 900-line page
  left a solid black document where before there was at least a static simulator. A CSS
  keyframe now lifts it at 1.8s regardless. Verified by injecting a throw.
- The bridge watchdog tested `video.paused`, which goes false the moment `play()` resolves
  even if nothing ever buffers. A stalled clip meant six seconds of black. It now tests
  actual progress, plus a stall guard for a clip that starts and then freezes.
- Two units sat on each other's centres, so hovering them showed the neighbour's name —
  and hover is the only way to identify a unit.
- `drop-shadow()` has no spread parameter; one invalid function voided the whole `filter`,
  so keyboard focus looked identical to hover while `outline` was suppressed.
- The wake gradient ran from the far tip inward: brightest at its outer point, invisible at
  the stern — the inverse of a real wake, and the exact ambiguity the code comment above it
  claimed to avoid.
- The contract requires a shade pass on every solid body; the fixed-wing planform and the
  UUV had none and read visibly flatter than the ships beside them.
- An actor marking in mid grey (Observer, `#7E94A9`) vanished against the hull. Markings
  now carry a dark keyline so any hue reads as deliberate.

**Both new checks were green while the thing was broken**
- `check:laydown` read `data-ix`/`data-iy` — the same literals the page had just written
  from. It verified the array and nothing about where sprites land: transposing `MAP_IMG`
  left it green with every unit displaced. It now derives the sample position from each
  unit's *rendered* box and the image's *own* natural size, sweeps four viewports for
  visibility, and checks resize stability. 160 assertions -> 266.
- `check:bridge`'s journey assertion was satisfied by the page's own 6s hard ceiling, so it
  passed with the video never playing. It now reads how far the clip actually got. It also
  raced the page's self-navigation and died with a stack trace instead of a named failure;
  that block reads the built markup instead.

Both fixes were confirmed by re-running the reviewer's exact sabotage and watching the
gates fail.

## Open, disclosed, not fixed

1. **`/wargame/` loads Google Fonts.** `wargame/index.html` pulls Roboto from
   `fonts.googleapis.com`. `check:layout` asserts of every page it covers: *"No external
   origins: no CDN fonts, no analytics, no third party able to observe who reads this."*
   The wargame is not in that page list, so it does not currently fail — but it will ship
   on the same domain as a letter arguing against concentrated control, while telling
   Google who reads it. Fix is a system font stack; it changes the typography, so it is a
   call to make rather than take.
2. **`/enter/` and `/wargame/` have no layout gate.** `scripts/layout.ts` still sweeps only
   `/`, `/writing/`, `/thanks/`. Adding the wargame would fail today on (1).
3. **34 tab stops.** Every unit is focusable, which is how a keyboard reader gets a name,
   but it puts 34 stops between the ground stations and the playback controls.
4. **`gs-bjo` floats in open water** — pre-existing, described above.


## Retirement — the site becomes the simulation

Both the Vite letter site and the never-deployed Next.js app were retired, and
inevitablefrontier.org is now the simulation and nothing else. Both codebases are
preserved on tags: `retired/vite-wargame-2026-09-06` and `retired/nextjs-2026-08-30`.

- `/` is the entrance — the intro clip, handing off to `/wargame/`. The letter, `/writing/`
  and `/thanks/` were removed from the build and deleted from S3 by hand, because
  `deploy.ts` syncs HTML *without* `--delete` and they would otherwise have stayed live
  forever.
- `check:content` and `check:layout` were removed rather than repointed. Their subject —
  the letter's copy deck, its `.hero-statement`/`.passage-head`/`.horizon-line` geometry —
  no longer ships. `check:shell` carries over the assertions that still mean something:
  no sideways overflow across eight widths, no third-party requests, every internal link
  resolves, and the entrance works without JavaScript.
- The simulation no longer loads Roboto from Google. It is the whole of a site whose
  argument is about who controls access to things; a webfont handed every reader's request
  to a third party to make the UI slightly nicer.

## Later changes

- **Chips fit.** The five feed filters overflowed their column and "Your actor" sat off the
  edge behind a hidden scrollbar. Smaller type, tighter padding, and wrapping instead of
  horizontal scroll.
- **`cover` -> `contain`.** The plate is now shown whole instead of cropped, which is the
  "zoom out" — open water on every side of Svalbard. It also fixes the pre-existing
  `gs-bjo` bug for free: Bjørnøya is on screen at last, and its ground station sits on the
  island rather than floating in the Norwegian Sea. `mapGeom` and `check:laydown` both
  switched from `Math.max` to `Math.min` to match.
- **Ownership is the whole body.** Actor colour was a pennant on a grey hull, which was
  legible only if you already knew to look. Every structural gradient stop is now mixed
  toward the owner's colour, so a Northern Fleet destroyer is visibly red and a KSAT
  station visibly green, while the light-to-dark ramp still gives each sprite its form.
- **Everything that can move, moves.** Ships, submarines and aircraft patrol a short leg
  along their own course and turn at each end. Motion follows the scenario clock, so the
  pause button pauses the fleet, and readers who ask for reduced motion get the static
  laydown.

The terrain classifier had to get smarter to keep up. Brightness alone cannot separate the
coastline from the map's own place-names — both are pale — and a patch wide enough to
outvote a letterform is wider than Kong Karls Land. It now tests brightness *and* warmth:
Svalbard is printed in cream (R-B of +18 to +33), the labels are neutral white (-5 to -34).
Both ends of every patrol leg are asserted, because a destroyer authored in open water can
still run aground thirty seconds later.
