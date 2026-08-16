# Copy deck

Exact text, mapped to scroll progress. **Do not paraphrase, reorder, or "improve" this
copy.** If a line doesn't fit the layout, change the layout.

That rule stands. It is about nobody editing this copy *unilaterally* — not about the copy
being unchangeable. It has been revised once, at the client's explicit direction, and the
four changes are recorded under "Revisions" at the bottom so the rule keeps its force: the
text above is still the only text that ships, and it still may not be improved on the way
past. `npm run check:deck` asserts that the site and the `<noscript>` fallback both match
it, so a silent divergence fails the build rather than shipping.

All of it lives in real DOM text and must be complete and readable in the reduced-motion
render.

---

## Act I — The Frontier · `p` 0.00–0.12

**H1** (reveals by word, `p` 0.01–0.04)

> AI is the inevitable frontier.

**Body** (`p` 0.05–0.09)

> Abundance is guaranteed. Competition is not. Emerging technologies could bring
> intelligence, knowledge, medicine, energy, and productive capacity to new levels of
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

> If technological power becomes concentrated in a small number of corporations and
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
> researchers, and widespread experimentation; in which genuine risks are governed
> without creating monopolies; and in which the state is limited in scope, capable in
> execution, and constrained by individual rights.

Copy column returns **left**, its Act I position.

---

## Act IV — The Frontier Returns · `p` 0.80–1.00

**Statement** (`p` 0.84, display size, centered, the largest type on the page)

> Our goal is to ensure that the frontier remains open.

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

---

## Revisions

### 2026-08-16 — copyedit for flow, grammar and punctuation

At the client's request. Brief was explicit: refine the language, keep the general message,
and keep the sentence structures. No sentence was added, removed, split, joined or reordered
in any of the four; the argument is unchanged.

**Act I body — "could make … reach" → "could bring … to".**
Five list items sit between the verb and its complement, so `make` waited twelve words for
`reach` and the reader had to hold the construction open across the whole list. `bring … to`
is a lighter frame that survives the interruption. Same claim, same list, same order.

**Act II body — "concentrated within" → "concentrated in".**
Idiom. Power concentrates *in* institutions; *within* reads as "inside the boundary of",
which is a spatial claim rather than a structural one.

**Act III body — "in which" repeated at each semicolon.**
The sentence hangs three long clauses off a single `in which`, and each clause carries its
own comma series. By the second semicolon the governing phrase is twenty-odd words back and
the parallel stops being audible. Repeating the relative pronoun is the standard fix and
makes the three-part structure explicit. Four words longer; not one word otherwise changed.
This is the only edit that alters length enough to affect layout, so it is the one to watch
if the Act III column ever reflows.

**Act IV statement — "ensure the frontier remains" → "ensure that the frontier remains".**
Without `that`, `ensure the frontier` parses as a complete object before `remains` forces a
re-read. It is a mild stumble in body text and a conspicuous one in the largest type on the
page. Restoring `that` also sets the site's title phrase — *the frontier remains open* —
apart as a unit, which is how it is meant to land.

**Not changed:** both H2s, the H1, the CTA, and the transition line. They are clean and any
edit would have been preference, not correction.
