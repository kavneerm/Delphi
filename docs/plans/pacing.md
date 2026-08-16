# Pacing — faster traversal, faster reveals, a scroll cue

**Ask:** "could you make scrolling through it faster? Make everything pop faster onto the
screen" and "on the initial page, could you add something to say *keep scrolling*".

Two separate changes that read as one: how much scrolling the piece costs, and how quickly
copy arrives once you get there.

---

## 1. The knobs, and which ones are actually orthogonal

There are four ways to make this feel faster, and two of them are the same knob wearing a
different hat:

| knob | what it changes | keep? |
| --- | --- | --- |
| `SCROLL_VH` | how many viewport-heights the whole piece costs | **yes** |
| Lenis `duration` | how long the view takes to catch up to your input | **yes** |
| Lenis `wheelMultiplier` | how much progress one wheel tick buys | **no** |
| copy `reveal.over` | how much progress a block takes to arrive | **yes** |

`wheelMultiplier` is redundant with `SCROLL_VH` — both change progress-per-tick, and
turning both compounds into a number neither of them describes. One knob for distance, one
for latency, one for reveals. Nothing multiplies with anything else.

### Chosen values

- **`SCROLL_VH` 700 → 420.** At a 900px viewport the *scrollable distance* — the number the
  reader's wheel actually has to cover, `(SCROLL_VH/100 - 1) x height` — goes from 5400px to
  2880px. That is 47% less scrolling, not 40%: the sticky stage eats one viewport height at
  each end, so shortening the container shortens the travel by proportionally more.
  Measured, not derived: `check:pace` reads it off `scrollHeight` (2880 / 3277 / 2701px at
  the three viewports). Each act transition still gets ~55vh of travel, which is enough for
  the eight-slot stagger to read as a stagger rather than a cut.
- **Lenis `duration` 1.05 → 0.65.** This is the one that feels like lag rather than length.
  Lenis' own default is 1.2; 0.65 is snappy while still being smoothed.
- **Copy `reveal.over` roughly halved** — see §2, which has a constraint attached.

## 2. Reveal windows have a constraint, and it is not obvious

`src/copy.ts`'s header states it: **no §6 checkpoint may fall inside a reveal window.**
Mid-reveal, a block and its scrim are both at partial opacity by design, so no pixel
reaches `#F5F0E8` and a contrast ratio measured there is meaningless. That looked like a
scrim defect twice before the cause was pinned.

Shrinking `over` while holding `at` fixed is safe by construction — the new window is a
subset of the old one, which already contained no checkpoint. Same for `outOver` against
`out`. So: **hold every `at` and `out`, shrink only `over` and `outOver`.** No window moves;
they only get shorter.

New values — headings `over: 0.02`, bodies `0.03`, the Act IV statement/CTA `0.025`, every
`outOver: 0.03`. Verified against `CHECKPOINTS` mechanically rather than by eye (§4).

Word stagger in `copyLayer.ts` tightens too: the spread across a line goes 0.55 → 0.35 and
each word's own window 0.45 → 0.65, so the sweep still reads but the line lands sooner.

## 3. The scroll cue

`.scroll-cue` already exists in `styles.css`, and `reduced.ts` already strips it — the
architecture anticipated this and the block was never written. Adding it back rather than
inventing a parallel mechanism.

- A new `Column` variant, `'cue'`, so the block gets its own bottom-centre positioning
  instead of being appended to Act I's centre column. In flow it would sit under a
  paragraph that is ~600px tall at 390×844, which is not where a scroll affordance goes.
- **Complete at `p = 0`**, like the headline. An affordance that fades in after the reader
  has already decided what to do is not an affordance.
- **Leaves by `p = 0.06`.** Once scrolling starts it has done its job.
- **Keeps the standard `.copy-block` scrim.** That scrim is the project's 4.5:1 contrast
  guarantee, and Act I's sand behind the bottom of the frame is light — `#F5F0E8` on it
  unscrimmed would not clear the floor. Restyled as a compact pill so it reads as UI, not
  as a copy card.
- The chevron animates on the compositor (transform + opacity only) and is disabled under
  `prefers-reduced-motion`. It does not schedule a JS frame, so the single-write-pass rule
  in `main.ts` is intact.

## 4. Verification — `npm run check:pace`

A new script, wired into `npm run check`. Per viewport, measured off the live DOM rather
than derived from the constants it is checking:

- [x] Max scroll distance equals `(SCROLL_VH/100 - 1) x height`, within a pixel — proves
      `SCROLL_VH` actually reached the page rather than just the module.
- [x] Every reveal window is bounded in **pixels of scroll**, not in `p`. `p` is meaningless
      to a reader; the budget is `over x maxScroll <= 0.22 x viewport height`.
- [x] Each block reads opacity ~0 at `at` and ~1 at `at + over` in the browser, so the
      declared window is the real one.
- [x] The cue is present, opaque, in-viewport and reads "Keep scrolling" at `p = 0`, and is
      gone by `p = 0.10`.
- [x] **No `CHECKPOINTS` entry falls inside any reveal or exit window** — the §2 constraint,
      as a regression guard, since this change edits exactly those numbers.

Plus the existing `npm run check` (typecheck, invariant, parallax, register) unchanged.

## 5. Tasks

- [x] `config.ts` — `SCROLL_VH`, `SCROLL_SMOOTH_S`
- [x] `main.ts` — Lenis duration from the constant
- [x] `copy.ts` — shrink windows, add `'cue'` column, add the cue block
- [x] `copyLayer.ts` — tighten word stagger and block rise
- [x] `styles.css` — `.col-cue`, `.scroll-hint`, chevron `.scroll-cue`
- [x] `reduced.ts` — strip the hint, not just the cue glyph
- [x] `scripts/pace.ts` + `package.json` wiring
- [x] Run `npm run check` and `npm run check:pace`, show output
- [x] Adversarial review in a fresh subagent against this file — §6
- [x] Act II slot 5 travel + `check:travel` — §7

---

## 6. Adversarial review log

A fresh subagent reviewed this file against the code, with mutation testing. It restored the
tree byte-for-byte afterwards (verified). Three findings, all real, all fixed.

**F1 — the container height is not the travel, and I used them interchangeably.** The stage
is `position: sticky` at `100vh`, so the reader's wheel covers `(SCROLL_VH/100 - 1) x h`, one
viewport height less than the container. Every derived figure I quoted was inflated by
4.2/3.2: "3780px of travel" (2880), "38 wheel ticks" (29), "0.03 of progress is 113px" (86).

The load-bearing one was the **"~55vh per transition floor"**, which is false twice over.
Actual transition travel is 0.13 x 2880 = 374px = **41.6vh**, and 38.4vh for Act III→IV — 25%
under the number I claimed to be honouring. Worse, *I invented the floor*. I never measured
what distance a transition needs; I wrote a plausible number and then asserted the design met
it. Corrected in `config.ts` to the measured figures, and the fabricated floor is gone rather
than restated — the transitions were verified by looking at them (§7), which is the evidence
that actually exists.

**F2 — `check:pace` had no coverage of the four `byWord` blocks, which is what the change
edited.** `copyLayer.ts` writes container opacity as `min(entered * 5, 1) * (1 - left)`, which
saturates at 20% of the window, and the check read only the container. Mutation: breaking the
stagger so it sums to 1.20 left the LCP headline's last word at **0.862** and Act IV's
statement tail at **0.786** — permanently, through the whole hold, not mid-reveal — and the
check reported PASS. Nothing else in the tree would catch it either; every other check runs
`?nocopy=1`. Fixed by reading `.word` opacity; re-mutated and it now fails.

**F3 — the reveal budget guarded `SCROLL_VH`, not the reveal windows.** At `0.22 x h` the
bound reduced to `over <= 0.06875`, which every value in the deck cleared *before* the change.
Tightened to `0.12 x h` → `over <= 0.0375` against a largest actual of 0.03. Mutation:
`act1-body` back to 0.05 now fails at all three viewports.

Tightening it exposed a flaw in my own assertion: `act1-h1` "failed" a 144px cost it never
charges, because its window `[-0.05, 0]` closes before the page starts. The budget now bills
only the on-page span, `max(0, at+over) - max(0, at)`.

Clean on review: the checkpoint constraint (verified independently, and the exclusive
comparison is the correct semantics), `EDGE` quantisation (16x margin, six bit-identical
runs), the `cue` column cascade (0.0px off centre at all three viewports), contrast
(**7.58 / 7.58 / 6.52:1**, against 1.82:1 unscrimmed at 390 — the scrim is load-bearing, as
claimed), and reduced motion.

## 7. Act II's skyscrapers rose from the middle of the frame

Reported separately by the client: Act II's monoliths popped in mid-screen instead of rising
from the ground. The verb was already right — `rise`, `clipBottom: horizon`. The **travel**
was not.

`rise` hides a slot by translating it down behind a static clip, and holds `opacity: 1`
throughout. So travel shorter than the art's extent above the clip line does not fade — it
stands there. The monoliths are drawn from `top = -bleed` to the horizon, so they need
`horizon + bleed` = **588px** at 1440x900. `travelPx: h * 0.3` gave **270px**. At the start of
the transition both towers sat at full opacity with a hard flat top a quarter of the way down
the frame.

Fixed by deleting the override; `Stage.defaultTravel` returns exactly 588px.

**This is the third sighting of the same bug.** `docs/review-checklist.md` §7 names the
failure mode verbatim. Act III had the identical `h * 0.3`, found to be 2.2x short, and its
fix was *a comment* — so the bug survived in the act next door with the same constant and the
same 2.2x ratio. A comment does not stop a copied constant.

`npm run check:travel` (new) rasters every `rise`/`extrude` slot in all four acts, reads the
drawn extent off `Buf.drawnBox()`, and asserts travel clears it. Results: Act II slot 5 now
588/588; Act I and IV's mesa overrides are genuinely fine (+33px, +29px), not merely
less-obviously-wrong. Nine slots paint nothing — Act I slots 2-3 and Act IV slot 3, where the
houses were removed — and are reported as vacuous rather than failed, since a slot with no art
has nothing to clear.
