# Copy deck

Exact text, mapped to scroll progress. **Do not paraphrase, reorder, or "improve" this
copy.** If a line doesn't fit the layout, change the layout.

All of it lives in real DOM text and must be complete and readable in the reduced-motion
render.

---

## Act I — The Frontier · `p` 0.00–0.12

**H1** (reveals by word, `p` 0.01–0.04)

> AI is the inevitable frontier.

**Body** (`p` 0.05–0.09)

> Abundance is guaranteed. Competition is not. Emerging technologies could make
> intelligence, knowledge, medicine, energy, and productive capacity reach new levels of
> development and sophistication.

**Transition line** (`p` 0.10, sits low in frame, smaller)

> We see two paths ahead for AI development.

Scroll cue beneath it. Subtle — a thin descending rule, not a bouncing arrow.

---

## Act II — The Closed Frontier · `p` 0.25–0.40

**Eyebrow** (`p` 0.22, arrives *during* the transition, before the city resolves)

> One

**H2** (`p` 0.26)

> Closed Frontier

**Body** (`p` 0.29–0.36)

> If technological power becomes concentrated within a small number of corporations and
> government institutions, progress could instead produce dependency, regulatory capture,
> and permanent barriers to competition.

Copy column sits **right** in this act, pushed toward the frame edge by the slums. It is
the only act where the column moves. The crowding is the point.

---

## Act III — The Open Frontier · `p` 0.53–0.68

**Eyebrow** (`p` 0.50)

> Two

**H2** (`p` 0.54)

> Open Frontier

**Body** (`p` 0.57–0.65)

> A society in which technological progress remains open to new entrants, independent
> researchers, and widespread experimentation; genuine risks are governed without
> creating monopolies; and the state is limited in scope, capable in execution, and
> constrained by individual rights.

Copy column returns **left**, its Act I position.

---

## Act IV — The Frontier Returns · `p` 0.80–1.00

**Statement** (`p` 0.84, display size, centered, the largest type on the page)

> Our goal is to ensure the frontier remains open.

**CTA** (`p` 0.92)

Primary button, accent `#FF5E3A`, plus a quiet text link.

> [ Get involved ]   ·   Read the full case →

**Footer** (`p` 0.97) — organization name, contact, socials, legal. Standard, quiet, no
animation.

---

## Notes

**On the numbering.** The source lists these as "1." and "2." I've set them as the
eyebrow words *One* and *Two* because numerals read as ranked preference and these are
alternatives. If you want the numerals back, they go in the same slot with the same
timing.

**Reveal rule.** Every reveal is driven by `p`, never by a timer, and never blocks
scrolling. A user who scrolls fast sees everything already revealed rather than a queue
of animations playing catch-up.

**Reduced motion.** All copy renders immediately in document flow beneath its act's
static scene. Nothing is hidden behind a reveal that requires motion to trigger.

**Placeholder content.** The CTA destinations, org name, and footer are unspecified.
Leave them as clearly-marked `TODO` in the markup rather than inventing an organization
name, a tagline, or a link target.
