# Inevitable Frontier — Brand & Design System

The reference for how IF looks and behaves. Everything here is taken from the
code, not from intent: if a value appears below, it is what actually ships.

Last audited: 2026-08-25

---

## 0. Lexicon

Names for the things that had none. Use these in conversation, in commits,
and in class names — an element nobody can name is an element nobody can
discuss.

### The palette

| Name | Value | |
|---|---|---|
| **Pitch** | `#0a0a0a` | The near-black ground |
| **Bone** | `#f0ede6` | The warm off-white |
| **Ember** | `#ff5c35` | The accent orange |

### The Field — the animated background

The whole moving scene behind every page (`app/components/Background.tsx`).

| Name | What it is |
|---|---|
| **Starfield** | The fixed points of light, each twinkling on its own cycle |
| **Blooms** | Seven vast, slow colour clouds — blue, ember, teal, gold, violet, magenta, cyan. They are what makes the background feel like weather rather than wallpaper. |
| **Motes** | The small particles that travel the flow field |
| **Wisps** | The fading trails the motes leave behind |
| **Sparks** | The glow where two motes pass close. Desktop only — the pairwise pass is the most expensive thing per frame. |
| **Vignette** | The darkening at the edges, set slightly right of centre so the left pane breathes |

### The surface

| Name | What it is |
|---|---|
| **3D Card** | The tilting, frosted panel. Blog tiles, Get Involved, each conversation. |
| **Glint** | The highlight that follows the cursor across a card |
| **Frost** | The 3px blur that lets the Field show through a card, softened |
| **Bob** | The slow idle float. Grids only — never content cards. |
| **Mesh** | The fine scanline texture over the homepage background |
| **Scrim** | The 10% black wash that sits under homepage content |
| **Portrait** | A speaker headshot frame — 14px corners, tighter than a card |
| **Cutout** | A background-removed portrait that bleeds off a card's bottom edge, unframed. Founders on `/team`. |
| **Halo** | The Bone radial glow behind a Cutout, separating hair from the Blooms |
| **Social row** | The three-icon strip on a Roster card: mail, X, LinkedIn, in that order |
| **Herald** | The full-width tile that carries the blog's empty state |
| **Tag** | A micro-caps label — uppercase, tracked wide, usually Ember |
| **The Split** | The homepage's two-pane layout: manifesto left, conversations right |
| **Arc** | The symbol — three arcs struck from a centre held off frame, with one Ember mote riding the middle arc |
| **Lockup** | The Arc beside the wordmark set on two lines, the square matched to the text block. What the nav carries. |
| **Roster** | The founder grid on `/team`. Content cards, so: gentle tilt, no Bob, neutral hover. |
| **Board** | The External Board Members grid under the Roster. Same card, half the weight: portrait beside the name, affiliation, no bio. |

Note: **Bob** is the idle float; **Motes** drift. Different motions, different
words, so "the drift" is never ambiguous. The CSS class is still
`.tilt-drift` — rename to `.tilt-bob` when convenient.

---

## 1. Colour

Declared as CSS custom properties in `app/globals.css` under `:root`.

| Token | Value | Role |
|---|---|---|
| `--bg` | `#0a0a0a` | **Pitch.** Page background. Near-black, never pure black. |
| `--fg` | `#f0ede6` | **Bone.** Primary text and hairline rules. Warm off-white, never `#fff`. |
| `--accent` | `#ff5c35` | **Ember.** The one accent. Dates, CTAs, live dot, section labels. |
| `--muted` | `#6a6560` | **Slate.** At-rest interactive text: nav links, ghost buttons. |
| `--ash` | `#a09a93` | **Ash.** Secondary prose: body copy and blog excerpts. |
| `--border` | `var(--fg)` | Structural rules between panes and rows. Derives from Bone. |

### The two greys

Two greys, both tokenised, with a role each:

| Token | Value | Role |
|---|---|---|
| `--muted` | `#6a6560` | **Slate** — at-rest interactive text that brightens on hover |
| `--ash` | `#a09a93` | **Ash** — secondary prose meant to be read, not clicked |

The distinction is *readability*, not decoration. Slate is dim because it sits
under a hover state that lifts it; Ash carries whole paragraphs and cannot
afford to be that dim. A third grey, `#c8c4bc`, appeared once on the copyright
line and has been folded into Ash.

**No raw grey hex belongs in a component.** Use the token.

### Surface alphas

Cards and frames are built from translucent layers over the animated
background, never from opaque fills:

| Value | Role |
|---|---|
| `rgba(240, 237, 230, 0.04)` | Card fill — 4% of `--fg` |
| `rgba(255, 255, 255, 0.15)` | Card and frame border at rest |
| `rgba(255, 255, 255, 0.3)` | Non-clickable card border on hover |
| `rgba(255, 92, 53, 0.55)` | Link card border on hover |
| `rgba(0, 0, 0, 0.45)` | Card shadow on hover |

### Icons

Inline SVG, never an icon font or an image file. Three glyphs do not justify
a request, and inline paths inherit `currentColor` — so a hover state is one
colour change rather than a swapped asset. Icons are drawn on a `0 0 20 20`
box at `stroke-width: 1.4` to sit with Space Grotesk's weight.

### The accent rule

`--accent` at **full strength** means one of three things:

1. **Static** — brand marking. Section labels, event dates, the live dot.
2. **On hover** — this element is a link.
3. **Static on a control that is nothing but a link.** The Roster's social
   buttons are lit at rest — Ember glyph, Ember border, a soft outer bloom.
   The rule exists so a surface never *promises* a click it cannot answer;
   a button whose entire purpose is to be clicked breaks nothing by saying so
   up front. Hover then widens the bloom and deepens the fill rather than
   changing hue: a control already lit needs a louder hover, not a different
   colour. Do not extend this to cards, rows, or anything with content in it.

A surface that is not clickable brightens its border to neutral white on
hover, never to orange. Blog tiles are links and earn the orange; the Get
Involved card and the conversation cards hold their own buttons and do not.
Breaking this makes cards look pressable when they are not.

Tinted accent (`rgba(255, 92, 53, 0.45)`) reads as a duller brick against the
near-black, not as a lighter orange. Use `#ff5c35` at full strength or use a
neutral — do not thin the accent.

---

## 2. Typography

Two families, loaded via `next/font/google` in `app/layout.tsx`.

### Fraunces — `var(--font-fraunces)`

Display serif. Weights 300/400/500/700/900, normal and italic.

Used at **weight 300, italic** for every headline: the manifesto, "Join the
Frontier.", blog tile titles, the empty-state line. Light italic serif at
large sizes is the single strongest signature the site has.

Letter-spacing tightens as size grows: `-0.015em` to `-0.02em`.

### Space Grotesk — `var(--font-space)`

Everything else. Weights 300–700. Body copy, nav, buttons, labels, metadata.

### The micro-caps pattern

The most repeated type treatment on the site — nav links, section labels,
button text, event dates:

```
font-family: var(--font-space);
font-size: 0.6rem – 0.85rem;
font-weight: 600;
letter-spacing: 0.02em – 0.15em;   /* wider as the text gets smaller */
text-transform: uppercase;
```

Smaller text takes more tracking. `0.15em` at `0.65rem` for section labels;
`0.02em` at `0.85rem` for nav.

**The nav links are the exception: weight 400, not 600.** Now that the Lockup
sits opposite them, 600 made the two ends of the bar compete — the links read
as loud as the logo. Everything else keeping the micro-caps pattern stays at
600.

### Scale in practice

| Size | Use |
|---|---|
| `clamp(2.5rem, 6vw, 4rem)` | Page headline |
| `clamp(1.5rem, 2.4vw, 2.1rem)` | Manifesto |
| `1.35rem` | Blog tile title |
| `1.05rem` | Event title |
| `0.9rem` | Body copy |
| `0.78rem` | Dense body (event descriptions) |
| `0.6–0.65rem` | Micro-caps labels |

Headlines use `clamp()` so they scale with the viewport. Body sizes are fixed.

---

## 2a. The logo

The nav carries the **Lockup**: the Arc symbol beside the wordmark set on two
lines, as `public/logo/if-lockup.svg`. The Arc is struck from the Field's own
geometry — the same off-frame centre and ring spacing `BackgroundArcs.tsx`
uses — so the mark and the background are one system rather than two things
that merely suit each other. One Ember mote rides the middle arc.

Every lockup, colourway and format is generated in the brand package repo
(`../if-brand`) from type outlines. **Do not edit the SVG in `public/logo/` by
hand** — regenerate it there and copy it across, or the two drift apart.

### Two lines, not one

Setting the wordmark on one line beside the symbol gives a 5.65:1 mark that
has to shrink to fit any bar, which is what drove the type down to 9.5px caps.
Stacking the two words squares the lockup to **3.16:1**: the same width then
carries far larger type, and the symbol can be exactly as tall as the text
block instead of towering over it. At 48px the lockup is only 152px wide with
12.2px caps — narrower *and* larger than the one-line version managed.

### Size it by height, never width

`.nav-logo` sets a height and lets width follow. The file carries its own
clear space, so only ~59% of its height is ink: a height that looks reasonable
as a number renders the type far smaller than the same nominal size did as
live text. The nav uses **48px desktop, 42px at ≤768px**.

`.nav-logo` also sets `flex-shrink: 0`. Without it the nav's flexbox squeezes
the image rather than the gap, and the mark renders at the wrong aspect ratio.

The `.nav-wordmark` class stays on the link even though it no longer sets
type — the mobile rules key off it for the 44px touch target.

At 320px the gap between the lockup and the nav links closes to 13px. It fits,
but that is the tightest point in the layout: anything added to the nav needs
checking there first.

## 3. Shape

| Radius | Use |
|---|---|
| **16px** | Every card — blog tiles, Get Involved, conversations, subscribe frame |
| **14px** | Portraits only — speaker headshots and founder portraits |
| **10px** | Social row buttons |

The split is deliberate: cards and photographs should not read as the same
kind of object. Keep photos tighter than the surfaces holding them, and the
controls tighter again — 16px card, 14px portrait, 10px button nest rather
than compete.

Borders are always **1px**. There are no heavier rules anywhere.

---

## 3a. Cutouts

The founder portraits on `/team` are **Cutouts**: background removed, no
frame, bleeding off the bottom edge of the card so the figure reads as
standing in it. Three rules, each of which is a real failure mode:

- **No frame, ever.** A cutout has no edge of its own. Putting one in a
  bordered box gives it a fake one and it reads as a sticker in a window —
  which is the entire reason not to use the 14px Portrait frame here.
- **`object-fit: contain`, anchored to the card's outer bottom corner.**
  Never `cover`: cover
  crops from the centre and takes the head off a standing figure. The bleed
  itself is a negative bottom margin cancelling the card's padding, plus
  `overflow: hidden` on the card to do the clipping.
- **Every cutout needs a Halo.** The Field behind is bright and moving, and
  dark hair with nothing behind it dissolves into a Bloom. The Halo is Bone
  at 7% fading to nothing by 68% — **never Ember**. A decorative accent glow
  would break the rule that Ember means "this is a link", and the Roster
  cards are not links.

A Cutout must be PNG or WebP. A `.jpg` has no alpha channel and renders as a
grey box in the card. See `public/team/README.md` for the crop brief.

Where there is no image — or the file 404s — the card falls back to the
framed initials and **collapses to a single column** (`.team-card-plain`),
so the text takes the full width instead of leaving a gutter where the figure
would have been. That shape change is why the load-failure state lives on the
card and not inside the Cutout: an image cannot restructure its own parent,
and left to itself it drops a monogram into the figure column where it floats
against the bottom-right corner. This fallback is what the page shows today.

## 4. The 3D card

The site's signature interaction. Implemented once in
`app/components/TiltCard.tsx`, used on blog tiles, Get Involved, and each
live conversation.

**At rest:** flat. A 1px hairline border, a 4% fill, and a 3px backdrop blur
so the animated background shows through, softly frosted.

**On hover:** tilts toward the cursor, lifts on a shadow, and a highlight
tracks the pointer across the surface.

| Property | Value |
|---|---|
| Max tilt | 7° blog tiles · 3.5° Get Involved · 2.5° conversations and Roster |
| Perspective | 900px small cards · 1400px large |
| Lift (`translateZ`) | 5–14px, scaled to card size |
| Highlight | `radial-gradient(circle 380px …)`, peak `rgba(255,255,255,0.075)` |
| Frost | `backdrop-filter: blur(3px)` |
| Transition | `transform 0.18s ease-out` |

### Rules that matter

- **Bigger card, gentler tilt.** The same angle across a wider surface reads
  as a lurch rather than a tilt.
- **The highlight has a fixed 380px radius.** It must not scale with the
  card — a light source does not grow because the surface under it is bigger.
- **Idle drift is for grids only.** Blog tiles float on staggered cycles.
  Content cards and anything in a scroll column stay still; a float there
  reads as instability.
- **Tilt freezes while a field has focus.** A card moving under a form being
  filled in is disorienting.
- **`backdrop-filter` + `transform-style: preserve-3d`** can render as an
  opaque box in some browsers. It is correct in Chrome; verify Safari before
  trusting it.

---

## 5. Motion

| Element | Timing |
|---|---|
| Card tilt | `0.18s ease-out` |
| Border, shadow, colour | `0.15s – 0.28s` |
| Idle drift (Bob) | 5.5–8.8s, staggered, **`linear`** over eight keyframes, 12px |
| Background canvas | Continuous, `requestAnimationFrame` |

Nothing on the site animates faster than `0.15s` or slower than `0.4s`,
excepting the drift and the background.

### The Bob is linear, and traces an ellipse

Two keyframes eased with `ease-in-out` is the obvious way to write a float and
the wrong one. The curve decelerates to a full stop at the top and bottom of
the travel and holds there, so the tile reads as a machine reaching the limit
of its stroke rather than as something drifting — and because the motion is
only 9px over four seconds, those dead ends are most of what the eye catches.
It reads as lag, though nothing is dropping frames: measured at 117–120fps
with zero frames over 20ms on a ten-tile grid.

**Speed is the other half, and the bigger half.** A 1px border moving slowly
does not glide — it holds one pixel row until its subpixel position crosses
the next threshold, then snaps. At the original 9px over 14s that happened
about twice a second, which the eye reads as stepping. The tell is that
zooming in makes it look smooth again: the same travel covers more device
pixels, so the steps get finer. That is a speed problem, not a jitter problem.
At 12px over 5.5–8.8s the edge crosses a row every 0.15–0.23s, which reads as
continuous.

The fix is to carry the curve in the keyframes and leave the timing function
`linear`, so velocity never reaches zero. Eight steps sample a sine closely
enough that linear interpolation between them shows no corners, and a small
horizontal component (±1.9px) on a different phase from the vertical keeps the
motion from reading as an elevator.

Use `translate3d`, not `translateY`. It holds the element on its own
compositor layer, so a 9px move over eleven seconds is interpolated in
subpixels on the GPU rather than being snapped to whole pixels.

### Non-negotiable opt-outs

- `@media (hover: none)` — no tilt, no drift, no highlight. Touch fires one
  synthetic mousemove on tap and would strand a card mid-tilt.
- `@media (prefers-reduced-motion: reduce)` — drift and transitions off. The
  background canvas also stops after one frame.

---

## 6. Components

| Class | Role |
|---|---|
| `.btn-solid` | Filled accent button. Primary action. |
| `.hero-cta-primary` / `.hero-cta-join` / `.hero-cta-secondary` | The three homepage hero actions. Primary is solid Ember; the other two share the outlined treatment. `.hero-cta-secondary` is the mobile-only scroll affordance and carries `display: none` above 768px — which is why Get involved needed its own class rather than reusing it. |
| `.btn-ghost` | Outlined, transparent. Secondary — social links. |
| `.email-input` | Signup field. Pairs flush with `.btn-solid`, no gap. |
| `.label` | Micro-caps section label, optional `.dot-accent` before it. |
| `.nav-bar` / `.nav-wordmark` / `.nav-links` | Nav. **Required on every page** — the mobile rules key off these class names, and a nav without them keeps desktop sizing on a phone. |
| `.tilt-card` | Shared 3D card behaviour. Pair with an appearance class. |
| `.nav-logo` | The Lockup in the nav bar. Sized by height — see §2a. |
| `.team-card` | Roster card appearance. `.team-portrait` is the 14px frame inside it. |
| `.team-social` | Mail / X / LinkedIn row on a Roster card. `.team-social-btn` is one 10px-cornered square, Ember-lit at rest. |

---

## 7. Layout

### The hero's vertical rhythm

The manifesto, the paragraph under it and the action row are three different
tiers, and the spacing has to say so. Both gaps were once effectively equal —
`32px` above the paragraph, `30px` above the buttons — and the block read as a
flat, undifferentiated stack: a 33.6px display headline and a 14.4px paragraph
sitting the same distance apart as the paragraph and a row of buttons.

Now it runs roughly **1:2** — `1.4rem` above the paragraph, `2.6rem` above the
actions. The headline and its paragraph group into one statement; the actions
read as a separate tier. Space follows relationship: keep the pair that
belongs together tighter than the gap to the thing that follows.

- **Desktop homepage:** two panes, `1fr 1fr`, split by a 1px `--fg` rule.
- **Blog:** `repeat(auto-fit, minmax(320px, 1fr))`. Tiles stay proportional,
  column count follows the viewport, a lone tile spans the full width.
- **Roster:** `1fr 1fr` with `align-items: stretch`, collapsing to one column
  at 768px. Stretch matters: the bios differ in length, and two cards of
  unequal height read as a layout bug rather than as two people. The height
  has to be carried by `.team-card-outer` as well, since the tilt lives on
  the inner element and only the wrapper is a grid item.
- **Board:** `repeat(auto-fit, minmax(260px, 1fr))` under the Roster, one
  column at 768px. The card lays the Portrait *beside* the name rather than
  above it, at 52px instead of 72px — stacking it would make every board card
  as tall as a founder's and flatten the hierarchy the section depends on.
- **Roster cards stack on mobile: copy full width on top, Cutout beneath it,
  still bleeding off the card floor.** Side by side does not survive a 340px
  card — the figure track leaves the bio a ~150px measure, which wraps it to
  six lines and builds a card far taller than the figure, so the figure sits
  at the bottom with 100px+ of empty card above it. Stacked, the bio runs
  three lines at full width, the portrait takes 72% of the card, and there is
  no dead space because nothing sits beside anything.
- **Equal height, no dead space, and side-by-side cannot all hold at once**
  for two differently-shaped photos in a fixed-width track. Forcing equal
  heights strands the shorter-framed portrait; letting each fill its track
  breaks the match. Stacking dissolves the conflict rather than trading one
  fault for another.
- **Roster cards carry no `min-height` on mobile.** The card has
  `overflow: hidden` for the bleed, so a fixed height shorter than the text
  silently clips the end of a bio — the height must follow the content. A
  280px card against a 297px text block was cutting off the last two lines.
- **Two flexbox traps in the mobile card**, both of which were real bugs:
  `align-self: end` is inherited from the desktop grid, where it aligns
  vertically; in the column flexbox it aligns *horizontally* and throws the
  figure to the card's right edge, away from the border it bleeds against.
  And flex items default to `min-height: auto`, which lets the image's
  intrinsic height override the aspect-ratio box and pulls the two portraits
  back to different heights. Both need explicit overrides.
- **The left pane is a column flexbox, so its children stretch to full width.**
  An `inline-flex` child does not shrink-wrap there — it takes the whole pane,
  and any border on it runs the full measure. `align-self: flex-start` is what
  actually shrink-wraps it.
- **Every direct `<p>` child of `.pane-left` gets a radial dim** from
  `.pane-left > p::before`, so anything added there picks up a shadow behind it
  whether or not that was intended.
- **`/team` is top-aligned, not centred.** Two sections outgrow the viewport,
  and a centred flex item that overflows is clipped at the top with no way to
  scroll to it.
- **Roster cards are `clamp(150px, 58%, 280px) 1fr`** inside a 1140px
  container. Cutout left, text right.
- **The figure track is a fixed length, never `auto`.** An `auto` track sizes
  to the image's max-content contribution, so a wide source claims a far
  wider column than a narrow one and crushes the bio beside it — two cards
  stop matching for a reason that has nothing to do with the design.
- **Size the track for the WIDEST portrait, not the narrowest.** Every figure
  is capped to the same height, so a wide-shouldered headshot needs more
  width than a tall narrow one to reach that height. Sizing the track to the
  narrow portrait is what leaves the wide one rendering two thirds as tall,
  and it is the reason the container had to grow from 900px to 1140px: at
  900px a 280px figure track left under 90px for the bio.
- **Equal height is the goal, not equal width.** Two portraits match when
  their figures are the same height; their widths differ because the photos
  do. Never crop a portrait to force the match — recrop changes how someone
  is framed, and that is theirs to decide, not a layout fix.
- A founder with no portrait gets `.team-card-plain`, which overrides the
  track to a single `1fr` so there is no empty gutter.
  **The Cutout goes on the outer edge, not the inner one.** A photograph
  cropped through the shoulder ends on a straight vertical line; against the
  card border that line is invisible, mid-card it reads as a slice through
  the person. Anchor `object-position` to the same side for the same reason —
  `contain` centres the figure otherwise and reopens the gap.
- **Mobile breakpoint:** `768px`. Above is `min-width: 769px`, below is
  `max-width: 768px`. Nothing sits between them.
- **Mobile nav height:** `--mobile-nav-height: 48px`, the single source for
  the bar, sticky offsets, and anchor scroll margins.

Inline styles are used heavily, so mobile overrides need `!important` to
outrank them. This is why class names on the nav are load-bearing.

### Touch targets

At `768px` and below, every interactive element clears **44px** of height --
the iOS and Android minimum. The rule is deliberately *not* to enlarge the
type: nav links, social buttons and CTAs keep their small-caps sizing and grow
their **hit area** instead, via `min-height: 44px` plus
`display: flex; align-items: center`.

Classes carrying this: `.nav-wordmark`, `.nav-links a`, `.social-row
.btn-ghost`, `.email-input`, `.btn-solid`, `.btn-ghost`, `.event-cta-btn`.
A new interactive class needs adding to that list.

Any flex item holding text also needs `min-width: 0`, or it refuses to shrink
below its intrinsic width and pushes its neighbour off the right edge. This is
what `.email-input` does; it is the reason the Get Involved form no longer
overflows at 320px.

---

## 8. Known drift

Real inconsistencies, worth fixing before the system grows:

0. **Roster bios and social links are placeholders.** Both bios read
   "(put bio here)", and `links` in `app/team/page.tsx` is empty for both
   founders. A button with no address renders identically to a live one and
   simply carries no href — dimming it made the row read as broken rather
   than as pending. Fill in the email address, X URL and LinkedIn URL per
   person and they become clickable with no other change.
0a. **The blog updates on a 30-minute delay.** `/blog` reads Substack's RSS
   feed with `revalidate: 1800`, so a new post appears within half an hour of
   publishing — and the first visitor after the window expires still sees the
   old page while the refetch runs behind them. Nothing updates at all until
   the site is deployed; there is no Vercel project yet.
1. **Forms do not save anything.** The homepage and Get Involved forms show a
   confirmation and reset. Only the Substack embed on `/blog` captures an
   address.
2. **Social links point to `#`** on both `/join` and the homepage.
2b. **`/join` is reachable only from the homepage.** Get Involved was moved
   out of the nav and onto the hero, so `/team`, `/blog` and `/join` itself
   have no link to it. Anyone landing on an inner page has to go home first.
2a. **The favicon is still Next's default.** The nav has the Lockup but the
   browser tab does not. `public/logo/if-symbol.svg` is in place for it, and
   the brand package has PNGs from 16px to 1024px.
3. **Event Zoom links are placeholders**, and the Substack URL is still
   `inevitablefrontier.substack.com`.
4. **The Team page has one portrait of two.** Nahom's Cutout ships;
   Kavneer's card still shows the framed-initials fallback. Drop
   `kavneer-majhail.png` into `public/team/` and it appears with no code
   change — see the README there for the crop brief.
5. **Both founder portraits are reconstructions.** Each supplied file had
   been flattened to RGB with the transparency baked in as white, so the
   mattes were keyed back out here. Nahom's holds at display size but fine
   curl edges keep a faint silver outline that keying cannot recover;
   Kavneer's is clean (short hair, dark suit against white). Replace either
   if the original with its alpha channel turns up. **Neither is cropped** —
   both are the full supplied frame, trimmed only of transparent padding.
6. **The Board is empty.** `board` in `app/team/page.tsx` has no entries, so
   the section does not render at all. Needs the real names and affiliations.

### Struck

- ~~Tokens are not used~~ — the 43 hardcoded `#f0ede6` are now `var(--fg)`.
  `--fg` is defined once and referenced everywhere.
- ~~Two muted greys~~ — resolved into `--muted` (Slate) and `--ash` (Ash),
  with the one-off `#c8c4bc` folded into Ash. See §1.
- ~~Two unused fonts~~ — Jechro and Robusta removed from `globals.css`, and
  the `.ttf` files deleted from `public/fonts/`.
- ~~The Team page is empty~~ -- the Roster ships: two founder cards, portrait
  frames with initials fallback, one column below 768px. The copy came back
  from `git show b1674a1:app/team/page.tsx`, not from a rewrite. The page is
  now structured as sections -- **Team**, then **External Board Members** --
  after ifp.org/about. The italic display line ("Students. Researchers.
  Radical Optimists.") was removed with it: the section headings carry the
  page, and a display headline above them competed for the same job.
- ~~Touch targets below 44px~~ — the nav, social buttons, event CTAs and form
  controls all clear 44px at 768px and below. See §7.

---

## 9. The background

One background, `app/components/BackgroundArcs.tsx`, mounted **once in
`app/layout.tsx`** and not by any page.

### Mount it in the layout, never in a page

A background rendered inside a page is unmounted and rebuilt on every route
change: the canvas is destroyed, a new one mounts blank, and the whole scene
has to be measured and rebuilt before the first frame lands. That reads as
the background flashing out between pages. The layout persists across route
changes, so the canvas mounts once and keeps running.

### Internal links must be `next/link`

This is the other half of the same problem, and the bigger one. A plain
`<a href="/team">` is a **full document load** -- it tears down the entire
page, layout included, so mounting the background in the layout achieves
nothing on its own. Every internal route link uses `next/link`.

Plain `<a>` is still correct for `#` anchors, external links, and downloads
(the `.ics` files). Adding a plain anchor to an internal route silently
reintroduces the flash.

### Size to `span`, never to `W`

Anything meant to cover the viewport -- Blooms, the Vignette, ring radii and
gaps -- is a fraction of `span = Math.max(W, H)`, not of `W`. Sized off `W`
it shrinks on a tall narrow screen: the largest Bloom covered 174% of the
viewport height on desktop but only 45% on a phone, so instead of a wash you
got discrete clusters of light. On a landscape desktop `span === W`, so this
costs nothing there.

### Recovering an earlier background

Earlier versions are not kept as files. They are in git:

```bash
# The Field -- flow-field Motes, fading Wisps, Sparks at crossings.
# The background the site ran on until 2026-08-26.
git show b4485ea:app/components/Background.tsx
```

Recover with `git show <commit>:<path> > <path>` rather than rebuilding from
a screenshot, and check it (`shasum -a 256`, `git diff`) before trusting it.
A reconstruction is not a revert.

`app/components/BackgroundTrajectories.tsx` is a third composition, built to
the 2026-08-26 brief and set aside: fourteen authored arcs, visible spans
solved at runtime, automatic near-parallel culling, nodes at closed-form
intersections, quiet zones from live DOM rects. Nothing imports it. Kept
because it is finished work -- see the parts bin.

### `/bg`

An unlinked workbench that renders the layout's background with no content
over it. **L** toggles the LCD texture, **S** the scrim, **H** the hint. Its
root must not set an opaque background or it covers the layout's canvas.

---

## 9a. The parts bin

Pieces that were built, worked, and are not currently in use. They are kept
so they can come back, and written down here so that bringing them back does
not mean rebuilding them from a screenshot. Nothing in this section is live.

### The Field — the previous background

**File:** `app/components/Background.tsx` (still in the repo, marked archived
at the top). **Retired:** 2026-08-26, replaced site-wide by the Rings.

The moving scene the site ran on until then. Named parts, which are the ones
§0 lists: **Starfield**, **Blooms**, **Motes**, **Wisps**, **Sparks**,
**Vignette**.

What made it work:

- Motes travel a **flow field** built from four stacked sines, so the drift
  has structure without ever repeating: `sin(x·0.0018 + t·0.25)·π·1.1` plus
  three more terms at falling amplitudes. That function is the whole
  character of the thing -- everything else is presentation.
- Each mote leaves a **Wisp**, drawn by fading the canvas 18% per frame
  rather than clearing it. Trails are a side effect of the fade, not objects.
- **Sparks** fire where two motes pass within 30px at more than ~53 degrees
  (`|dot| > 0.6` rejects the shallow crossings). A white core plus a coloured
  bloom, hue cycling per pair. Desktop only: it is an O(n²) pass and the most
  expensive thing per frame.
- 320 stars and 110 motes on desktop, 130 and 60 on mobile.

**To restore on a page:**

```tsx
import { Background } from "./components/Background";
<Background />
```

`/bg` renders both backgrounds and swaps them with the **B** key.

**Why it was replaced:** the drifting-nodes-with-glowing-intersections look
is the default visual for AI companies right now. IF's argument is that it
disagrees with the consensus, and the background was agreeing with it.

### Ripple propagation

Rings that march outward from their centre forever: `phase` climbs each
frame, every ring's radius is offset by it and wraps at `rings × gap`, and a
ring that wraps is reborn at the centre. Fade in over the first 10% of the
cycle and out over the last 30% so neither end pops.

**Set aside because** it reads as the scene zooming, not as flow. Live in
`BackgroundArcs.tsx` as `drift`, currently `0` on every family -- set it to
`0.16` to see it again.

### Flow along the ring

A second, brighter dashed pass over each ring with `lineDashOffset`
advancing per frame, so the dashes travel around the circumference while the
ring itself holds position. `setLineDash([22, 58])`, offset
`-(t · 210 + i · 37) % 80`, scaled by radius so every ring flows at the same
linear speed rather than the inner ones appearing to race.

**Set aside because** at any real ring density the dashes read as texture
rather than as motion. Worth revisiting if the rings ever get sparser.

### Hopping at crossings

Motes that switch ring families wherever two rings intersect, so the
geometry becomes a network you can travel rather than separate carousels.

The detection is exact and cheap: a point lies on a ring of another family
exactly when its distance to that family's centre is one of its radii, and
those radii are `r0 + phase + k·gap`. So the test is whether
`(distance − r0 − phase) mod gap` is near zero -- no circle-intersection
maths. A cooldown (~45 frames) stops a hop undoing itself; a coin flip
(~35%) stops every mote taking every junction.

**Set aside because** it needs three or more ring families to have enough
junctions to be worth it, and three families read as a plaid.

### Coloured motes

Motes drawn as a two-stage bloom -- a wide saturated halo carrying the hue,
a tight white-hot core over it. Colour alone reads as a smudge and a white
dot alone reads as a star; the two together read as a light that has a
colour. Hues: `[12, 200, 320, 45, 160, 275, 95, 235]`.

**Set aside because** the motes should read as the Starfield's own stars,
which are Bone. Kept here because the two-stage construction is the useful
part and applies to anything glowing.

### The manifesto 3D card

The left pane's copy wrapped in a `TiltCard` (`maxTilt 3.5`, `drift false`,
same surface as `.join-card`).

**Set aside because** a card draws a border, and a border promises
interactivity the manifesto does not keep. Replaced by the per-block dim in
§7 -- same legibility, no boundary.

---

## Changing this file

Update it in the same commit as the change it describes. A brand guide that
lags the code is worse than none, because it will be trusted.
