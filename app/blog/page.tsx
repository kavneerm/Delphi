import Link from "next/link";
import { BlogTile, BlogTileEmpty } from "./BlogTile";
import { getPosts } from "./substack";

export const metadata = {
  title: "Writing — Inevitable Frontier",
  description:
    "Essays on AI policy, power, and who gets to build the frontier.",
};

const NAV = [
  { label: "Blog", href: "/blog" },
  { label: "Team", href: "/team" },
];

export default async function BlogPage() {
  const posts = await getPosts();

  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", position: "relative" }}>

      {/* Nav — same classes as every other page so the mobile rules apply */}
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
                fontFamily: "var(--font-space)", fontSize: "0.85rem", fontWeight: 400,
                letterSpacing: "0.02em", textTransform: "uppercase",
                color: "var(--fg)", textDecoration: "none",
              }}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </nav>

      <main className="blog-main" style={{ position: "relative", zIndex: 3, flex: 1 }}>
        <header className="blog-header">
          <span className="label" style={{ color: "var(--fg)", fontSize: "0.85rem" }}>
            <span className="dot-accent" />
            Writing
          </span>
        </header>

        <div className="blog-grid">
          {posts.length === 0 ? (
            <BlogTileEmpty />
          ) : (
            posts.map((post, i) => (
              <BlogTile key={post.link} post={post} index={i} />
            ))
          )}
        </div>

        {/* Subscribe — Substack's own embed, so signups land directly on the
            mailing list with no backend of ours in between. The iframe is
            cross-origin, so its interior cannot be restyled; it is wrapped in
            a tile-style frame instead, which contains the white panel and
            makes it read as a deliberate card. */}
        <section className="blog-subscribe" aria-labelledby="subscribe-heading">
          <p className="blog-subscribe-label">Newsletter</p>
          <h2 id="subscribe-heading" className="blog-subscribe-title">
            Get it in your inbox.
          </h2>
          <div className="blog-subscribe-frame">
            <iframe
              src="https://inevitablefrontier.substack.com/embed"
              title="Subscribe to Inevitable Frontier"
              scrolling="no"
            />
          </div>
        </section>
      </main>
    </div>
  );
}
