"use client";

import Link from "next/link";
import { useState, useRef, useEffect } from "react";
import { TiltCard } from "./components/TiltCard";
import { SOCIALS, isLive } from "./socials";

/* The newest Substack post, already capped to length by the server component
   in page.tsx. Null when the feed is empty or unreachable, which is the state
   the site is in until the first piece goes up. */
export type LatestPost = { title: string };

/* ── Data ─────────────────────────────────────────────────────────────
   Typed explicitly rather than inferred. Every event is "soon" right now, so
   inference would collapse the shape to exactly that -- dropping `date` and
   `cal` from the type and breaking the card's dated branches as dead code.
   Naming the wider shape keeps those paths alive and typechecked, so putting
   a confirmed event back is a data change and nothing else. */
type EventItem = {
  n: string;
  title: string;
  desc: string;
  intro?: string;
  guests: { name: string; affiliation: string; img?: string }[];
  date?: string;
  cal?: { start: string; end: string; zoom: string };
  status: "upcoming" | "soon";
};

const events: EventItem[] = [
  {
    n: "01",
    title: "Coming soon",
    desc: "Coming soon",
    intro: "Speakers and date to be announced. Join the mailing list below and you'll hear the moment they're set.",
    guests: [
      { name: "Guest", affiliation: "TBA", img: "" },
      { name: "Guest", affiliation: "TBA", img: "" },
    ],
    status: "soon" as const,
  },
  {
    n: "02",
    title: "Coming soon",
    desc: "Coming soon",
    intro: "Speakers and date to be announced. Join the mailing list below and you'll hear the moment they're set.",
    guests: [
      { name: "Guest", affiliation: "TBA", img: "" },
      { name: "Guest", affiliation: "TBA", img: "" },
    ],
    status: "soon" as const,
  },
  {
    n: "03",
    title: "Coming soon",
    desc: "Coming soon",
    intro: "We're announcing this lineup in about two weeks. Join the mailing list below and you'll know the moment we do.",
    guests: [
      { name: "Guest", affiliation: "TBA", img: "" },
      { name: "Guest", affiliation: "TBA", img: "" },
    ],
    status: "soon" as const,
  },
];

/* ── Notification sound ─────────────────────────────────────────────────
   Returns a play function for the signup confirmation chime. The element is
   built after mount because Audio does not exist during server rendering,
   and it is created once per form rather than per click so the file is
   fetched a single time. */
function useNotifySound() {
  const ref = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const el = new Audio("/sounds/notify.m4a");
    el.preload = "auto";
    // Deliberately quiet. This fires without warning, often on headphones.
    el.volume = 0.35;
    ref.current = el;
  }, []);

  return () => {
    const el = ref.current;
    if (!el) return;
    el.currentTime = 0;
    // Playback can be refused — a muted device, an unsupported codec, or a
    // browser policy. Swallow it: a rejected promise must never surface as
    // an unhandled error or interrupt the signup itself.
    void el.play().catch(() => {});
  };
}

/* ── Per-event signup ───────────────────────────────────────────────── */
type EventType = (typeof events)[number];

function calLinks(event: EventType) {
  if (!("cal" in event) || !event.cal) return null;
  const { start, end, zoom } = event.cal;
  const title = encodeURIComponent(event.title);
  const desc  = encodeURIComponent(`Inevitable Frontier · ${event.title}\n\nJoin via Zoom: ${zoom}`);
  const loc   = encodeURIComponent(zoom);

  const google = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${start}/${end}&details=${desc}&location=${loc}`;

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Inevitable Frontier//EN",
    "BEGIN:VEVENT",
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${event.title}`,
    `DESCRIPTION:Inevitable Frontier conversation.\\nZoom: ${zoom}`,
    `LOCATION:${zoom}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const icsHref = `data:text/calendar;charset=utf8,${encodeURIComponent(ics)}`;
  return { google, icsHref };
}

/* ── Headshot slot ──────────────────────────────────────────────────────
   Renders the photo at `src` if it loads, and falls back to the speaker's
   initials if the file is missing or fails. That means a headshot appears
   the moment the file is dropped into /public/speakers — no code change,
   and no broken-image icon in the meantime. */
function SpeakerPhoto({
  src,
  name,
  placeholder,
}: {
  src?: string;
  name: string;
  placeholder?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // onError alone is not enough: the request usually fails before React
  // hydrates, so that event is never delivered and a broken icon sticks.
  // Re-check on mount — a finished image with no intrinsic width failed.
  useEffect(() => {
    const el = imgRef.current;
    if (el && el.complete && el.naturalWidth === 0) setFailed(true);
  }, []);

  const initials = name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div
      className="speaker-photo"
      style={{
        // Grows to fill the row: the frame spans from the event date line
        // down to the bottom of the CTA. Rows are given a uniform min-height
        // in globals.css so every frame comes out the same size.
        width: "92px",
        flex: 1,
        minHeight: "116px",
        borderRadius: "14px",
        border: "1px solid rgba(255,255,255,0.15)",
        background: "rgba(240,237,230,0.04)",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {placeholder ? null : src && !failed ? (
        <img
          ref={imgRef}
          src={src}
          alt={name}
          onError={() => setFailed(true)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
          }}
        />
      ) : (
        <span
          aria-hidden="true"
          style={{
            fontFamily: "var(--font-space)",
            fontSize: "0.9rem",
            fontWeight: 500,
            letterSpacing: "0.06em",
            color: "rgba(240,237,230,0.35)",
          }}
        >
          {initials}
        </span>
      )}
    </div>
  );
}

/* ── Speaker rail (static row of headshots) ─────────────────────────── */
function SpeakerRail({
  guests,
  placeholder,
}: {
  guests: { name: string; affiliation: string; img?: string }[];
  placeholder?: boolean;
}) {
  return (
    <div
      className="speaker-rail"
      style={{
        display: "flex",
        gap: "1rem",
        flexShrink: 0,
      }}
    >
      {guests.map((g, i) => {
        const parts = g.name.split(" ");
        const first = parts[0];
        const last = parts.slice(1).join(" ");
        return (
          <div
            key={`${g.name}-${i}`}
            className="speaker-card"
            style={{
              flex: "0 0 auto",
              width: "92px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            {/* Headshot (desaturated photo slot) — grows to fill */}
            <SpeakerPhoto src={g.img} name={g.name} placeholder={placeholder} />
            <span className="speaker-name" style={{ fontFamily: "var(--font-space)", fontSize: "0.72rem", fontWeight: 500, color: "var(--fg)", marginTop: "0.5rem", lineHeight: 1.15, textAlign: "center" }}>
              {first}
            </span>
            {/* Always rendered, even when there is no surname — a one-line
                name would otherwise leave its photo taller than its
                neighbours, since the photo absorbs whatever height the text
                below it does not use. */}
            <span className="speaker-name" style={{ fontFamily: "var(--font-space)", fontSize: "0.72rem", fontWeight: 500, color: "var(--fg)", lineHeight: 1.15, textAlign: "center" }}>
              {last || " "}
            </span>
            <span className="speaker-affil" style={{ fontFamily: "var(--font-space)", fontSize: "0.72rem", fontWeight: 500, fontStyle: "italic", color: "var(--fg)", marginTop: "0.28rem", lineHeight: 1.15, textAlign: "center" }}>
              {g.affiliation}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function EventRow({ event }: { event: EventType }) {
  const [state, setState] = useState<"idle" | "form" | "done">("idle");
  const [email, setEmail] = useState("");
  const playNotify = useNotifySound();

  return (
    <div className="event-row">
      {/* Drift is off: these sit in a scrolling column, and rows that float
          while the reader scrolls past them read as instability. The tilt is
          gentle for the same reason a large card gets less of it than a small
          one — the same angle over a wider surface is a lurch. */}
      <TiltCard
        className="event-card"
        outerClassName="event-card-outer"
        maxTilt={2.5}
        perspective={1400}
        lift={5}
        drift={false}
        freezeWhileTyping
      >
      <div className="event-inner" style={{ display: "flex", gap: "2.5rem", alignItems: "stretch", justifyContent: "flex-start" }}>

        {/* Left — text content + CTA */}
        <div className="event-text" style={{ flex: "1 1 auto", minWidth: 0, maxWidth: "34rem", display: "flex", flexDirection: "column" }}>
          {/* Date label */}
          <span
            style={{
              fontFamily: "var(--font-space)",
              fontSize: "0.6rem",
              fontWeight: 600,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "#ff5c35",
              display: "block",
              marginBottom: "0.6rem",
            }}
          >
            {"date" in event && event.date ? event.date : event.status === "soon" ? "Coming soon" : `Event ${event.n}`}
          </span>

          {/* Title */}
          <h3
            style={{
              fontFamily: "var(--font-fraunces)",
              fontSize: "1.05rem",
              fontWeight: 500,
              color: "var(--fg)",
              lineHeight: 1.3,
              letterSpacing: "-0.01em",
              marginBottom: "0.5rem",
            }}
          >
            {event.title}
          </h3>

          {/* Description */}
          <p
            style={{
              fontFamily: "var(--font-space)",
              fontSize: "0.78rem",
              lineHeight: 1.6,
              color: "var(--fg)",
              marginBottom: "0.75rem",
            }}
          >
            {event.desc}
          </p>

          {/* Who's speaking, and why them */}
          {event.intro && <p className="event-intro">{event.intro}</p>}

          {/* CTA / form — pinned to bottom, level with speaker names */}
          {(event.status === "upcoming" || event.status === "soon") && (
            <div className="event-cta" style={{ marginTop: "auto", paddingTop: "1.1rem" }}>
          {state === "idle" && (
            <button onClick={() => setState("form")} className="event-cta-btn">
              <span>{event.status === "soon" ? "Get notified" : "Reserve a spot"}</span>
              <span aria-hidden="true">→</span>
            </button>
          )}

          {state === "form" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (email) {
                  playNotify();
                  setState("done");
                }
              }}
              className="signup-form"
              style={{ display: "flex", gap: "0", maxWidth: "23rem" }}
            >
              <input
                autoFocus
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={`Email for Event ${event.n}`}
                className="email-input"
                style={{ fontSize: "0.75rem", padding: "0.45rem 0.75rem" }}
              />
              <button
                type="submit"
                className="btn-solid"
                style={{ fontSize: "0.62rem", padding: "0.45rem 1rem" }}
              >
                Notify me
              </button>
              <button
                type="button"
                onClick={() => setState("idle")}
                style={{
                  background: "none",
                  border: "none",
                  color: "#4a4540",
                  fontFamily: "var(--font-space)",
                  fontSize: "0.7rem",
                  cursor: "pointer",
                  padding: "0 0.5rem",
                }}
              >
                ✕
              </button>
            </form>
          )}

          {state === "done" && (() => {
            const links = calLinks(event);
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                <p style={{ fontFamily: "var(--font-fraunces)", fontSize: "0.85rem", fontStyle: "italic", color: "#ff5c35" }}>
                  {links ? "You’re in. Add it to your calendar." : "You’re on the list. We’ll email you when it’s live."}
                </p>
                {links && (
                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                    <a
                      href={links.google}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setTimeout(() => setState("idle"), 300)}
                      style={{
                        fontFamily: "var(--font-space)",
                        fontSize: "0.62rem",
                        fontWeight: 600,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        color: "var(--fg)",
                        border: "1px solid var(--fg)",
                        padding: "0.4rem 0.9rem",
                        textDecoration: "none",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Google Calendar →
                    </a>
                    <a
                      href={links.icsHref}
                      download={`if-event-${event.n}.ics`}
                      onClick={() => setTimeout(() => setState("idle"), 300)}
                      style={{
                        fontFamily: "var(--font-space)",
                        fontSize: "0.62rem",
                        fontWeight: 600,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        color: "var(--muted)",
                        border: "1px solid #2a2520",
                        padding: "0.4rem 0.9rem",
                        textDecoration: "none",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Download .ics
                    </a>
                  </div>
                )}
              </div>
            );
          })()}
            </div>
          )}
        </div>

        {/* Right — guest speaker rail. Unannounced events use the identical
            layout with empty frames and placeholder names, so the row keeps
            the same shape once real speakers are filled in. */}
        {event.guests.length > 0 && (
          <SpeakerRail guests={event.guests} placeholder={event.status === "soon"} />
        )}
      </div>
      </TiltCard>
    </div>
  );
}

/* ── Page ───────────────────────────────────────────────────────────── */
export default function HomeClient({ latest }: { latest: LatestPost | null }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [copyOpacity, setCopyOpacity] = useState(0);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    if (max <= 0) return;
    setCopyOpacity(el.scrollTop / max);
  };

  return (
    <div className="page-shell" style={{ height: "100dvh", display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>


      {/* Nav */}
      <nav
        className="nav-bar"
        style={{
          position: "relative",
          zIndex: 20,
          flexShrink: 0,
          borderBottom: "1px solid var(--fg)",
          padding: "0 2rem",
          height: "52px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <a
          href="#"
          className="nav-wordmark">
          <img
            src="/logo/if-lockup.svg"
            alt="Inevitable Frontier"
            className="nav-logo"
          />
        </a>

        <div className="nav-links" style={{ display: "flex", alignItems: "center", gap: "2rem" }}>
          {[
            { label: "Blog", href: "/blog" },
            { label: "Team", href: "/team" },
          ].map((item) => (
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


      {/* LCD screen texture — above canvas, behind all content, below nav */}
      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          top: "52px",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 1,
          pointerEvents: "none",
          backgroundImage: `
            repeating-linear-gradient(0deg,
              rgba(0, 0, 0, 0.07) 0px, rgba(0, 0, 0, 0.07) 1px,
              transparent 1px, transparent 2px
            ),
            repeating-linear-gradient(90deg,
              rgba(0, 0, 0, 0.05) 0px, rgba(0, 0, 0, 0.05) 1px,
              transparent 1px, transparent 2px
            )
          `,
          backgroundSize: "2px 2px",
        }}
      />

      {/* Dark scrim — above LCD, below content */}
      <div className="background-dimmer" aria-hidden="true" />

      {/* ── Split pane ─────────────────────────────────────────────────── */}
      <div
        className="split-pane"
        style={{
          position: "relative",
          zIndex: 3,
          flex: 1,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          overflow: "hidden",
          minHeight: 0,
        }}
      >
        {/* Left — philosophy */}
        <div
          className="pane-left"
          style={{
            position: "relative",
            borderRight: "1px solid var(--fg)",
            overflowY: "auto",
            padding: "3.5rem 3rem 3.5rem",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
          <p
            style={{
              fontFamily: "var(--font-fraunces)",
              fontSize: "clamp(1.5rem, 2.4vw, 2.1rem)",
              fontWeight: 300,
              lineHeight: 1.2,
              color: "#ffffff",
              /* Tighter than the space below the paragraph on purpose: the
                 subtext explains the headline, so the two group, and the
                 actions get the larger gap because they are a different kind
                 of thing. Equal gaps read as a flat, undifferentiated stack. */
              marginBottom: "1.4rem",
              fontStyle: "italic",
              letterSpacing: "-0.015em",
            }}
          >
            An extraordinary future is within reach — but it&rsquo;s being
            shaped by a few hundred people. We work to keep the door open for
            everyone else.
          </p>

          <p
            style={{
              fontFamily: "var(--font-space)",
              fontSize: "0.9rem",
              lineHeight: 1.8,
              color: "var(--fg)",
            }}
          >
            Inevitable Frontier is a research and policy organization working
            to ensure AI remains in the hands of everyone. We host
            conversations with the people shaping these debates and build a
            community of young people who refuse to sit out the decisions
            that will define their future.
          </p>

          {/* Hero actions. Desktop shows "Read our latest" only; the
              "Upcoming events" scroll affordance is mobile-only, since
              desktop already has the conversations pane on screen. */}
          <div className="hero-actions">
            {/* Carries the newest post's title when there is one. Falls back
                to the plain label when the feed is empty, so the CTA is never
                left dangling after a colon. */}
            <Link href="/blog" className="hero-cta-primary">
              {latest ? `Read our latest: ${latest.title}` : "Read our latest"}{" "}
              <span aria-hidden="true">→</span>
            </Link>
            <Link href="/join" className="hero-cta-join">
              Get involved &mdash; bring us to your campus{" "}
              <span aria-hidden="true">→</span>
            </Link>
            <a href="#live-conversations" className="hero-cta-secondary">
              Upcoming events <span aria-hidden="true">↓</span>
            </a>
          </div>
        </div>

        {/* Right — scrollable conversations */}
        <div
          id="live-conversations"
          className="pane-right"
          style={{
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          {/* Sticky header inside right pane */}
          <div
            className="conversations-header"
            style={{
              flexShrink: 0,
              padding: "0.6rem 2.5rem 0.6rem",
              borderBottom: "1px solid var(--fg)",
            }}
          >
            <span className="label" style={{ color: "var(--fg)", fontSize: "0.85rem" }}>
              <span className="dot-accent" />
              Live Conversations
            </span>
          </div>

          {/* Scrollable list */}
          <div
            id="join"
            ref={scrollRef}
            onScroll={handleScroll}
            className="events-scroll"
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "0 2.5rem 2rem",
              scrollbarWidth: "thin",
              scrollbarColor: "rgba(255,255,255,0.35) transparent",
            }}
          >
            <div className="events-list">
              {events.map((e) => (
                <EventRow key={e.n} event={e} />
              ))}
            </div>

            {/* Newsletter inside the scroll list, after events */}
            <div
              style={{
                borderTop: "1px solid var(--fg)",
                paddingTop: "1.6rem",
                marginTop: "0.5rem",
              }}
            >
              <p
                style={{
                  fontFamily: "var(--font-space)",
                  fontSize: "0.72rem",
                  color: "var(--fg)",
                  marginBottom: "0.75rem",
                  letterSpacing: "0.05em",
                }}
              >
                Or subscribe to everything
              </p>
              <GeneralSignup />

              {/* Socials */}
              <div className="social-row" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "1rem" }}>
                {SOCIALS.map((s) => (
                  <a
                    key={s.label}
                    href={s.href}
                    {...(isLive(s) ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                    className="btn-ghost"
                    style={{ fontSize: "0.62rem", padding: "0.35rem 0.85rem", color: "var(--fg)", borderColor: "var(--fg)" }}
                  >
                    {s.label}
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer — behind conversations pane, fades in as user scrolls down */}
      <footer
        className="site-footer"
        style={{
          position: "absolute",
          bottom: "0.75rem",
          right: "1.5rem",
          zIndex: 0,
          pointerEvents: "none",
          opacity: copyOpacity,
          transition: "opacity 0.15s ease",
        }}
      >
        <span style={{ fontFamily: "var(--font-space)", fontSize: "0.6rem", color: "var(--ash)", letterSpacing: "0.05em" }}>
          © 2026 · inevitablefrontier.org
        </span>
      </footer>
    </div>
  );
}


/* ── General newsletter signup (inside events pane) ─────────────────── */
function GeneralSignup() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const playNotify = useNotifySound();

  if (done) {
    return (
      <p style={{ fontFamily: "var(--font-fraunces)", fontSize: "0.85rem", fontStyle: "italic", color: "#ff5c35" }}>
        Welcome to the frontier.
      </p>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (email) {
          playNotify();
          setDone(true);
          setTimeout(() => { setDone(false); setEmail(""); }, 3000);
        }
      }}
      className="signup-form newsletter-form"
      style={{ display: "flex", width: "100%" }}
    >
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="your@email.com"
        className="email-input"
        style={{ fontSize: "0.75rem", padding: "0.45rem 0.75rem", borderColor: "var(--fg)" }}
      />
      <button
        type="submit"
        className="btn-solid"
        style={{ fontSize: "0.62rem", padding: "0.45rem 1rem" }}
      >
        Subscribe
      </button>
    </form>
  );
}
