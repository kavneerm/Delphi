# Copy deck

The exact text of inevitablefrontier.org, in the units the page renders it.

**Do not paraphrase, reorder, or "improve" this copy.** If a line doesn't fit the layout,
change the layout. This is not about the copy being unchangeable — it is about nobody
editing it unilaterally on the way past.

Every block quoted below must appear **verbatim** on the page. `npm run check:content`
asserts it, so a silent divergence fails the check rather than shipping. That is the point
of the file: the page and the check read the same source, instead of each holding its own
copy that can drift together and still agree.

Each `>` block is one element on the page. Splitting a block across two elements, or
merging two into one, will fail the check — the units here are the units rendered.

Blocks are grouped by the page they appear on. A `# Page: <path>` heading opens each
group, and `check:content` asserts that group's text against that page's built HTML.

---

# Page: /

## Hero — the belief

Stated before anything else. Everything below it is a consequence.

`everyone` and `few` are set in the accent colour on the page. They are the axis the whole
statement turns on, and the contrast should be visible before the sentence is read.

> We believe AI has two paths ahead. In the hands of everyone, it creates a future where all humans flourish. In the hands of few, it threatens totalitarian control to prevent everyone from accessing its benefits.

---

## 01 — Who we are

**Heading** (orange)

> Who we are

> Inevitable Frontier is a research and policy organization working to shape the future of emerging technology.

> We are students, researchers, policymakers, and founders from across the United States.

---

## 02 — What we envision

**Heading** (orange)

> What we envision

> A future where human flourishing is not a question of if, but when.

> Technological innovation can transform human health, education, security, prosperity, and eventually humanity's reach into the cosmos.

> We believe extraordinary advancements are possible across artificial intelligence, biotechnology, defense, national security, health, education, and space.

---

## 03 — Our work

**Heading** (orange)

> Our work

> Our work focuses on artificial intelligence.

> Technological progress in AI should remain open to competition and experimentation — not directed exclusively by incumbent corporations, policymakers, or any single ideological faction.

> The companies building the most powerful technologies should not be able to use regulation to insulate themselves from competition — whether by raising compliance costs, gatekeeping access, or restricting what others may publish.

> Achieving this requires an environment where new companies and independent researchers can build, compete, and succeed.

---

## 04 — The simulation

The one place on the site that is not an argument. It hands the reader the thing the letter
describes, and the link is the only call to action above the contact form.

**Heading** (orange)

> The simulation

**Body**

> Concentrated control is easy to state and hard to feel. So we built something you can hold: an Arctic archipelago whose shipping, rescue, and communications all run through a handful of satellites owned by someone else — and a clock that starts when those satellites stop answering.

> It runs in your browser. Nothing is recorded.

**Link**

> Enter the simulation

---

## 05 — Get involved

**Heading** (orange)

> Get involved

> We are looking for students, researchers, policymakers, and founders who want to help shape how this technology is governed. Tell us who you are and we will be in touch.

**Form**

A native HTML form POST — no JavaScript. Fields: Name, Email, and an optional "What are you
working on?". A honeypot field named `_gotcha` sits off-screen to absorb bots.

`action` is the literal marker `[FORM ENDPOINT]` until a real destination exists.
`scripts/placeholder.ts` blocks `npm run deploy` while it is present, so the site cannot
publish a form that silently discards what people type into it.

---

# Page: /writing/

## Head

> Research and policy writing.

## Status

> We have not published yet.

> Inevitable Frontier is new. Our first briefs are in progress, and when they are ready they will be posted here in full — readable on the page, free, and without a login.

> If you want to know when the first one lands, or you are working on something adjacent, get in touch.

The page carries a commented-out entry template showing how a brief is added. It is
deliberately not rendered: inventing plausible-looking publications for an organization
that has not published any would be the single most damaging thing this site could do.

---

## Revisions

- **2026-08-23** — Deck rewritten for the current site. The previous deck described v1's
  four-act scroll structure and now lives at `v1/docs/copy-deck.md`.
- **2026-08-23** — Comma added to "guided by optimism, not pessimism" (was unpunctuated in
  the source statement). Punctuation only; no wording changed.
- **2026-08-23** — "Achieving them" became "Achieving this" when the domains sentence moved
  from section 05 into section 02, leaving no plural antecedent in section 04.
- **2026-08-23** — Added the `/writing/` page. Copy is an honest empty state; no article
  titles were invented.
- **2026-08-23** — Contact address set to kavneerm@gmail.com, replacing the `[ADD EMAIL]`
  marker and unblocking `npm run deploy`.
- **2026-08-23** — Hero replaced with the two-paths statement, at the client's direction.
  This restores the contingency the site lost when "On our name" was removed: the previous
  hero asserted an abundant future, and nothing on the page then said it might not arrive.
  "Two paths ahead" states the stake outright, which is what section 03's argument about who
  may build AI needs in order to be an answer to something.
- **2026-08-23** — Sections 01–04 restructured as one continuous letter: orange headings,
  one serif column, no rules between sections, no section numbers.
- **2026-08-23** — Contact replaced with a form; kavneerm@gmail.com removed at the client's
  direction. The site now has no working contact path until the form endpoint is set.
- **2026-08-23** — Removed the "On our name" section at the client's direction. The colophon
  line repeated its claim verbatim ("The frontier is not inevitable…") and was replaced with
  the section 01 descriptor, since leaving it would have asserted the removed argument with
  nothing left explaining it. Remaining sections renumbered 01–04.
