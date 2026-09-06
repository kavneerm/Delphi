"use client";

import Link from "next/link";
import { useState } from "react";
import { TiltCard } from "../components/TiltCard";
import { SOCIALS, isLive } from "../socials";

function JoinForm() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);

  if (done) return (
    <p style={{ fontFamily: "var(--font-fraunces)", fontSize: "1.1rem", fontStyle: "italic", color: "#ff5c35" }}>
      You&rsquo;re in. Welcome to the frontier.
    </p>
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (email) {
          setDone(true);
          setTimeout(() => { setDone(false); setEmail(""); }, 3000);
        }
      }}
      style={{ display: "flex", width: "100%", maxWidth: "480px" }}
    >
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="your@email.com"
        className="email-input"
        style={{ fontSize: "0.9rem", padding: "0.65rem 1rem", borderColor: "var(--fg)" }}
      />
      <button type="submit" className="btn-solid" style={{ fontSize: "0.72rem", padding: "0.65rem 1.75rem" }}>
        Join
      </button>
    </form>
  );
}

export default function JoinPage() {
  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", position: "relative" }}>

      {/* Nav */}
      <nav className="nav-bar" style={{
        position: "relative", zIndex: 10, flexShrink: 0,
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

      {/* Content */}
      <main style={{
        position: "relative", zIndex: 1, flex: 1,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "4rem 2rem",
      }}>
        {/* The 3D card sits behind the whole block. Drift is off here: this
            is the page's main content, not a tile in a grid, and a constant
            float under a form reads as instability rather than life. */}
        <TiltCard
          className="join-card"
          outerClassName="join-card-outer"
          maxTilt={3.5}
          perspective={1400}
          lift={8}
          drift={false}
          freezeWhileTyping
        >
          <p style={{
            fontFamily: "var(--font-space)", fontSize: "0.65rem", fontWeight: 600,
            letterSpacing: "0.15em", textTransform: "uppercase", color: "#ff5c35", marginBottom: "1.5rem",
          }}>
            Get Involved
          </p>

          <h1 style={{
            fontFamily: "var(--font-fraunces)", fontSize: "clamp(2.5rem, 6vw, 4rem)",
            fontWeight: 300, fontStyle: "italic", color: "var(--fg)",
            lineHeight: 1.1, letterSpacing: "-0.02em", marginBottom: "1.25rem",
          }}>
            Join the Frontier.
          </h1>

          <p style={{
            fontFamily: "var(--font-space)", fontSize: "0.9rem",
            lineHeight: 1.8, color: "var(--ash)", marginBottom: "2.5rem",
          }}>
            The policies being written today will define the technological environment
            your generation inherits. Stay informed, join our community, and be part
            of the conversation that shapes the future of AI.
          </p>

          <JoinForm />

          <div className="social-row" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "1.5rem" }}>
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
        </TiltCard>
      </main>
    </div>
  );
}
