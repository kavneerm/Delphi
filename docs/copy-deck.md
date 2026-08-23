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

> We believe AI promises an abundant, prosperous future that can forward human flourishing. Regulation guided by optimism, not pessimism, will ensure we unlock AI's potential — and that it falls into the right hands.

---

## 01 — Who we are

**Lead**

> Inevitable Frontier is a research and policy organization working to shape the future of emerging technology.

**Body**

> We are students, researchers, policymakers, and founders from across the United States.

---

## 02 — What we envision

**Lead**

> A future where human flourishing is not a question of if, but when.

**Body**

> Technological innovation can transform human health, education, security, prosperity, and eventually humanity's reach into the cosmos.

> We believe extraordinary advancements are possible across artificial intelligence, biotechnology, defense, national security, health, education, and space.

---

## 03 — On our name

The turn. The organization is named against its own argument, and the site should say so
plainly rather than let a reader notice it as a contradiction.

**Lead**

> Our belief is intentionally antithetical to our name: the frontier is not inevitable.

**Body**

> It will become what the American people choose to build, permit, and protect.

---

## 04 — Our work

**Lead**

> Our work focuses on artificial intelligence.

**Body**

> Technological progress in AI should remain open to competition and experimentation — not directed exclusively by incumbent corporations, policymakers, or any single ideological faction.

> The companies building the most powerful technologies should not be able to use regulation to insulate themselves from competition — whether by raising compliance costs, gatekeeping access, or restricting what others may publish.

> Achieving this requires an environment where new companies and independent researchers can build, compete, and succeed.

---

## 05 — Get involved

**Lead**

> Work with us.

**Body**

> We are looking for students, researchers, policymakers, and founders who want to help shape how this technology is governed.

**Contact**

The address is not yet set. The page ships the literal marker `[ADD EMAIL]`, and
`npm run deploy` refuses to publish while it is present — see `scripts/placeholder.ts`.
Replacing the marker with a real `mailto:` link is what unblocks publishing.

---

# Page: /writing/

## Head

> Research and policy writing.

## Status

**Lead**

> We have not published yet.

**Body**

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
