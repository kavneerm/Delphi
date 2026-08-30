/* ── Homepage ───────────────────────────────────────────────────────────
   A thin server component over the real page.

   The homepage itself is interactive -- tilt, per-event signup forms, the
   scroll-linked copy fade -- so it has to be a client component, and a client
   component cannot await the Substack feed. This wrapper does the fetch on
   the server and hands the result down as a prop, which keeps the RSS request
   on the build/revalidate path rather than in the visitor's browser.

   `getPosts` already returns [] on any failure, so an unreachable Substack or
   an empty feed simply means no title and the CTA keeps its plain label.
   ──────────────────────────────────────────────────────────────────────── */

import HomeClient from "./HomeClient";
import { getPosts, trimToWord } from "./blog/substack";

/* The hero CTA is a nowrap button in a half-viewport pane, sitting beside
   "Get involved — bring us to your campus". "Read our latest: " spends 17
   characters before the title even starts, so the title has to be capped or
   the pair breaks onto two rows.

   Measured on the live page at a 1503px viewport: the left pane offers 655px
   of content width, "Get involved" takes 317px, and the 12px gap leaves a
   326px budget for this button. A 26-character cap renders at 307px and fits;
   28 renders at 357px and wraps.

   A character cap cannot guarantee a pixel width -- a title made of long
   words is wider at the same count -- so this is a good default rather than a
   promise. The safety net is already in place: .hero-actions sets
   flex-wrap: wrap, so an over-long title stacks the two buttons cleanly
   instead of pushing through the pane edge. */
const TITLE_CAP = 26;

export default async function Page() {
  const posts = await getPosts();
  const newest = posts[0] ?? null;

  return (
    <HomeClient
      latest={
        newest ? { title: trimToWord(newest.title, TITLE_CAP) } : null
      }
    />
  );
}
