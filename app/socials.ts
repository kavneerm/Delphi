/* ── Social links ───────────────────────────────────────────────────────
   One list, rendered by the social row on both the homepage and /join. They
   were two hardcoded arrays that had to be kept in step by hand; this is the
   single place to add a URL as each account comes online.

   `#` means "no account yet". The row renders those as plain, inert buttons:
   an outbound link that goes nowhere is worse than one that visibly waits.
   ──────────────────────────────────────────────────────────────────────── */

export type Social = { label: string; href: string };

export const SOCIALS: Social[] = [
  { label: "X / Twitter", href: "#" },
  { label: "Instagram", href: "#" },
  { label: "Substack", href: "https://inevitablefrontier.substack.com" },
];

/** A link that actually goes somewhere, rather than a placeholder. */
export function isLive(s: Social): boolean {
  return s.href.startsWith("http");
}
