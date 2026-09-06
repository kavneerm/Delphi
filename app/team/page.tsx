"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { TiltCard } from "../components/TiltCard";

/* ── Data ───────────────────────────────────────────────────────────── */
/* `img` points at /public/team/. Until a file exists there the frame falls
   back to initials, so adding a portrait is a file drop, not a code change. */
const team = [
  {
    name: "Nahom Sisay",
    role: "Co-founder",
    img: "/team/nahom-sisay.webp",
    bio: "(put bio here)",
    links: {
      email: "",
      x: "https://x.com/nahomsisay",
      linkedin: "https://www.linkedin.com/in/nahomsisaytx/",
    },
  },
  {
    name: "Kavneer Majhail",
    role: "Co-founder",
    img: "/team/kavneer-majhail.webp",
    bio: "(put bio here)",
    links: {
      email: "",
      x: "https://x.com/kavneerm",
      linkedin: "https://www.linkedin.com/in/kavneer-majhail-425b04335/",
    },
  },
];

/* External board members. Compact cards: name, affiliation, and a portrait
   frame — no bio. The founders run IF and carry the page; the board lends it
   standing, and giving both the same weight would flatten that difference. */
const board: { name: string; affiliation: string; img?: string }[] = [
  // Add members here — see public/team/README.md for the portrait filenames.
];

/* ── Social row ─────────────────────────────────────────────────────────
   Mail, X, LinkedIn, in that order. Icons are inline SVG rather than a font
   or an image: three glyphs do not justify a request, and inline paths take
   `currentColor`, so the hover state is one colour change rather than three
   swapped assets.

   These are links, so they earn Ember on hover — see the accent rule in
   BRAND.md §1. A button with no address yet renders identically to a live
   one and simply carries no href, so the row looks finished while the real
   addresses are still outstanding. */
const ICONS = {
  email: (
    <>
      <rect x="2.5" y="4.5" width="15" height="11" rx="1.6" />
      <path d="M3 5.5l7 5 7-5" />
    </>
  ),
  x: (
    <path
      d="M4 4l5.2 6.9L4.2 16h1.6l4.2-4.4L13.4 16H16l-5.4-7.2L15.4 4h-1.6l-3.9 4.1L7 4H4z"
      fill="currentColor"
      stroke="none"
    />
  ),
  linkedin: (
    <>
      <rect x="3" y="3" width="14" height="14" rx="2" />
      <path d="M6.4 8.6v5.2M6.4 6.3v.1M9.6 13.8V8.6M9.6 10.8c0-1.3.8-2.2 2-2.2s2 .9 2 2.2v3" />
    </>
  ),
};

const SOCIALS = [
  { key: "email" as const, label: "Email", href: (v: string) => `mailto:${v}` },
  { key: "x" as const, label: "X", href: (v: string) => v },
  { key: "linkedin" as const, label: "LinkedIn", href: (v: string) => v },
];

function SocialRow({
  name,
  links,
}: {
  name: string;
  links: { email: string; x: string; linkedin: string };
}) {
  return (
    <div className="team-social">
      {SOCIALS.map(({ key, label, href }) => {
        const value = links[key];
        const icon = (
          <svg viewBox="0 0 20 20" aria-hidden="true" fill="none"
               stroke="currentColor" strokeWidth="1.4"
               strokeLinecap="round" strokeLinejoin="round">
            {ICONS[key]}
          </svg>
        );

        if (!value) {
          return (
            <span key={key} className="team-social-btn" aria-hidden="true">
              {icon}
            </span>
          );
        }

        // Plain <a>: mailto and external profiles are not internal routes, so
        // next/link would be wrong here.
        return (
          <a
            key={key}
            href={href(value)}
            className="team-social-btn"
            aria-label={`${name} on ${label}`}
            {...(key !== "email" ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          >
            {icon}
          </a>
        );
      })}
    </div>
  );
}

const NAV = [
  { label: "Blog", href: "/blog" },
  { label: "Team", href: "/team" },
];

/* ── Portrait ───────────────────────────────────────────────────────────
   Two shapes, chosen by whether an image exists.

   With a cutout (transparent PNG/WebP), the figure bleeds: it stands on the
   card's bottom edge with no frame at all. A cutout has no edge of its own,
   and putting it in a bordered box gives it a fake one — it reads as a
   sticker in a window. `contain` + a bottom anchor is required rather than
   `cover`: cover crops from the centre and decapitates a standing figure.

   With no image, it falls back to the framed initials — a bordered 14px box,
   the same frame the speaker headshots use. That fallback is what the page
   shows today, since no portraits have been supplied yet. */

/* Reports load failure up to the card rather than substituting the initials
   itself. The fallback is not a swap of one image for another — it changes
   the card's shape, from two columns to one — and only the card can do that.
   Left to its own devices the Cutout drops a framed monogram into the figure
   column, where it floats against the card's bottom-right corner. */
function Cutout({
  name,
  src,
  onFail,
}: {
  name: string;
  src: string;
  onFail: () => void;
}) {
  const imgRef = useRef<HTMLImageElement>(null);

  // onError alone is not enough: the request usually fails before React
  // hydrates, so that event is never delivered and a broken icon sticks.
  useEffect(() => {
    const el = imgRef.current;
    if (el && el.complete && el.naturalWidth === 0) onFail();
  }, [onFail]);

  return (
    <div className="team-cutout">
      {/* The glow is not decoration. The Field behind is bright and moving —
          Blooms in blue, teal and violet — and dark hair with nothing behind
          it dissolves into them. Bone at 7%, never Ember: a decorative accent
          would break the rule that Ember means "this is a link". */}
      <span className="team-cutout-glow" aria-hidden="true" />
      <img ref={imgRef} src={src} alt={name} onError={onFail} />
    </div>
  );
}

function InitialsFrame({ name, size }: { name: string; size: number }) {
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="team-portrait" style={{ width: size, height: size }}>
      <span
        aria-hidden="true"
        style={{
          fontFamily: "var(--font-space)",
          fontSize: size >= 72 ? "1rem" : "0.8rem",
          fontWeight: 500,
          letterSpacing: "0.06em",
          color: "rgba(240,237,230,0.35)",
        }}
      >
        {initials}
      </span>
    </div>
  );
}

/* Board portraits stay small and inline, so they take the halo rather than
   the bleed: a figure cropped at 52px is a face, and the bleed buys nothing. */
function BoardPortrait({ name, src }: { name: string; src?: string }) {
  const [failed, setFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const el = imgRef.current;
    if (el && el.complete && el.naturalWidth === 0) setFailed(true);
  }, []);

  if (!src || failed) return <InitialsFrame name={name} size={52} />;

  return (
    <div className="board-cutout">
      <span className="team-cutout-glow" aria-hidden="true" />
      <img ref={imgRef} src={src} alt={name} onError={() => setFailed(true)} />
    </div>
  );
}

/* Owns whether the portrait loaded, because that decides the card's shape:
   with a Cutout it is two columns, without one it is a single text column
   led by the framed initials. */
function FounderCard({ m }: { m: (typeof team)[number] }) {
  const [failed, setFailed] = useState(false);
  const onFail = useCallback(() => setFailed(true), []);
  const showCutout = Boolean(m.img) && !failed;

  return (
    <TiltCard
      className={`team-card${showCutout ? "" : " team-card-plain"}`}
      outerClassName="team-card-outer"
      maxTilt={2.5}
      perspective={1400}
      lift={6}
      drift={false}
    >
      {/* The Cutout leads, so it takes the left column. The original
          photo was cropped through his arm, and that cut edge now sits
          flush against the card border where the border hides it,
          rather than floating mid-card where it reads as a slice. */}
      {showCutout && <Cutout name={m.name} src={m.img!} onFail={onFail} />}

      {/* Text and figure are separate columns rather than the figure being
          absolutely positioned: a bio runs 3-5 lines depending on the name,
          and an overlaid figure would collide with the last line on
          whichever card is longer. */}
      <div className="team-card-text">
        {!showCutout && <InitialsFrame name={m.name} size={72} />}

        <h2 style={{
          fontFamily: "var(--font-fraunces)", fontSize: "1.3rem", fontWeight: 500,
          color: "var(--fg)", marginBottom: "0.35rem", letterSpacing: "-0.015em",
        }}>
          {m.name}
        </h2>

        <p style={{
          fontFamily: "var(--font-space)", fontSize: "0.62rem", fontWeight: 600,
          letterSpacing: "0.1em", textTransform: "uppercase",
          color: "var(--accent)", marginBottom: "1rem",
        }}>
          {m.role}
        </p>

        <p style={{
          fontFamily: "var(--font-space)", fontSize: "0.82rem",
          lineHeight: 1.75, color: "var(--ash)",
        }}>
          {m.bio}
        </p>

        <SocialRow name={m.name} links={m.links} />
      </div>

    </TiltCard>
  );
}

export default function TeamPage() {
  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", position: "relative" }}>

      {/* Nav */}
      <nav className="nav-bar" style={{
        position: "relative", zIndex: 20, flexShrink: 0,
        borderBottom: "1px solid var(--fg)", padding: "0 2rem", height: "52px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <Link href="/" className="nav-wordmark" >
          <img
            src="/logo/if-lockup.svg"
            alt="Inevitable Frontier"
            className="nav-logo"
          />
        </Link>
        <div className="nav-links" style={{ display: "flex", alignItems: "center", gap: "2rem" }}>
          {NAV.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              style={{
                fontFamily: "var(--font-space)",
                fontSize: "0.85rem",
                fontWeight: 400,
                letterSpacing: "0.02em",
                textTransform: "uppercase",
                color: "var(--fg)",
                textDecoration: "none",
              }}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </nav>

      {/* Content */}
      <main className="team-main" style={{ position: "relative", zIndex: 3, flex: 1 }}>
        <div className="team-inner">
          <p className="label" style={{ color: "var(--accent)", marginBottom: "1.5rem" }}>
            Who We Are
          </p>

          <h1 className="team-heading">Team</h1>

          {/* Content cards, so: gentle tilt, no idle drift, and a neutral
              hover border — these hold no link and must not read as pressable. */}
          <div className="team-grid">
            {team.map((m) => (
              <FounderCard key={m.name} m={m} />
            ))}
          </div>

          {/* Only renders once there is someone to list — an empty section
              heading over blank space reads as a page that failed to load. */}
          {board.length > 0 && (
            <>
              <h2 className="team-heading team-heading-sub">External Board Members</h2>

              <div className="board-grid">
                {board.map((m) => (
                  <TiltCard
                    key={m.name}
                    className="board-card"
                    outerClassName="board-card-outer"
                    maxTilt={2.5}
                    perspective={1400}
                    lift={6}
                    drift={false}
                  >
                    <BoardPortrait name={m.name} src={m.img} />

                    <div style={{ minWidth: 0 }}>
                      <h3 style={{
                        fontFamily: "var(--font-fraunces)", fontSize: "1.05rem", fontWeight: 500,
                        color: "var(--fg)", marginBottom: "0.25rem", letterSpacing: "-0.015em",
                      }}>
                        {m.name}
                      </h3>
                      <p style={{
                        fontFamily: "var(--font-space)", fontSize: "0.72rem",
                        lineHeight: 1.5, color: "var(--ash)",
                      }}>
                        {m.affiliation}
                      </p>
                    </div>
                  </TiltCard>
                ))}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
