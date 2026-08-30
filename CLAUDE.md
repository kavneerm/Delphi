# Inevitable Frontier

Website for Inevitable Frontier (inevitablefrontier.org) — a youth research and
policy organization on AI, co-founded by Nahom Sisay and Kavneer Majhail.
Next.js 14 (App Router), TypeScript, Tailwind.

```bash
npm run dev      # http://localhost:3000
```

**Never run `npm run build` while `next dev` is running.** The build overwrites
`.next` and the dev server starts serving unstyled pages. Stop the server,
build, then `rm -rf .next` and restart.

---

## The background — read this before touching it

One background: `app/components/BackgroundArcs.tsx`, mounted **once in
`app/layout.tsx`**. No page mounts it.

Three rules, each of which was a real bug:

1. **Mount it in the layout, never in a page.** Inside a page it is destroyed
   and rebuilt on every route change, which reads as the background flashing
   out between pages.

2. **Internal links must be `next/link`.** A plain `<a href="/team">` is a
   full document load and tears down the layout too, so rule 1 alone fixes
   nothing. Plain `<a>` is still right for `#` anchors, external links and
   the `.ics` downloads.

3. **Size to `span = Math.max(W, H)`, never to `W`.** Anything covering the
   viewport — Blooms, Vignette, ring radii — shrinks on a tall narrow screen
   if it is a fraction of width. The biggest Bloom covered 174% of viewport
   height on desktop and 45% on a phone before this was fixed.

Earlier backgrounds are **not** kept as files; they are in git history:

```bash
git show b4485ea:app/components/Background.tsx   # the old Field
```

Recover with `git show <commit>:<path> > <path>` and verify with `shasum`
and `git diff` before trusting it. Nahom asked for exactness here — a
reconstruction from a screenshot is not a revert, and he will check.

`app/components/BackgroundTrajectories.tsx` is a finished, unused third
composition. Nothing imports it. Do not delete it as dead code — BRAND.md
§9a documents it.

`/bg` is an unlinked workbench: the background with no content over it.
**L** texture, **S** scrim, **H** hint. Its root must not set an opaque
background or it covers the layout's canvas.

## BRAND.md is the design system

`BRAND.md` is the single source of truth for colour, type, shape, motion and
the named elements. **Update it in the same commit as any design change** —
Nahom asked for this explicitly. A brand guide that lags the code is worse
than none, because it gets trusted.

Use its lexicon in conversation and commit messages: Pitch/Bone/Ember for the
palette; the Field (Starfield, Blooms, Motes, Wisps, Sparks, Rings, Nodes,
Vignette) for the background; 3D Card, Glint, Frost, Portrait, the Split for
the surface.

Design tokens live in `app/globals.css` under `:root`. No raw hex belongs in a
component — `--fg` (Bone), `--muted` (Slate), `--ash` (Ash), `--accent`
(Ember). The accent means "this is a link" and nothing else.

---

## Layout

- `app/page.tsx` — homepage: manifesto left, live conversations right
- `app/join/page.tsx`, `app/team/page.tsx`, `app/blog/page.tsx`
- `app/components/TiltCard.tsx` — the 3D card used by every card surface
- Mobile breakpoint is `768px`. Inline styles are used heavily, so mobile
  overrides need `!important`. Touch targets clear 44px at ≤768px by growing
  hit area, never type size — see BRAND.md §7.

## Testing responsive layouts

`resize_window` in the Chrome tools does **not** reflow the viewport on this
machine (`innerWidth` stays pinned). Test in a sized iframe instead — an
iframe has its own viewport, so media queries respond to its width. Audit
`contentDocument` for horizontal overflow, sub-44px targets, and <12px text.

## Still outstanding

Needs content from Nahom: real Substack URL, Zoom links for events 01 and 02,
social URLs (all still `#`), founder portraits for the Team page.

Code: the email forms show a confirmation and reset without persisting
anything; only the `/blog` Substack embed captures an address. Not deployed —
no Vercel project, domain not pointed.
