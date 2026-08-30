/* ── Substack feed ───────────────────────────────────────────────────────
   The writing lives on Substack; this page only shows previews of it. We
   read the public RSS feed at build time so the grid needs no maintenance:
   publish over there, and the next build picks the post up here.

   The feed is parsed by hand rather than with an XML library. Substack's
   output is machine-generated and consistent, the shape we need is four
   fields deep, and a dependency for that is not worth the install. */

export interface Post {
  title: string;
  link: string;
  date: string;      // already formatted for display
  excerpt: string;
  image: string | null;
  readingMinutes: number;
}

const FEED = "https://inevitablefrontier.substack.com/feed";

/** Pulls the contents of <tag>…</tag>, unwrapping CDATA if present. */
function tag(xml: string, name: string): string {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  if (!m) return "";
  return m[1].replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim();
}

/** Strips markup and decodes the handful of entities Substack emits. */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#8217;|&rsquo;/g, "’")
    .replace(/&#8216;|&lsquo;/g, "‘")
    .replace(/&#8220;|&ldquo;/g, "“")
    .replace(/&#8221;|&rdquo;/g, "”")
    .replace(/&#8212;|&mdash;/g, "—")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** First image in the item: the cover enclosure, else the first inline img. */
function image(item: string): string | null {
  const enc = item.match(/<enclosure[^>]*url="([^"]+)"[^>]*type="image/);
  if (enc) return enc[1];
  const inline = tag(item, "content:encoded").match(/<img[^>]*src="([^"]+)"/);
  return inline ? inline[1] : null;
}

export function trimToWord(s: string, max: number): string {
  if (s.length <= max) return s;
  // Cut on a word boundary so the ellipsis never lands mid-word.
  return s.slice(0, s.lastIndexOf(" ", max)).trimEnd() + "…";
}

export async function getPosts(): Promise<Post[]> {
  let xml: string;
  try {
    // Revalidate every 30 minutes. The window is a trade: shorter means a new
    // post shows up sooner, but every expiry costs one visitor a stale page
    // while the refetch runs behind them. Half an hour keeps the feed fresh
    // without hitting Substack on every request.
    const res = await fetch(FEED, { next: { revalidate: 1800 } });
    if (!res.ok) return [];
    xml = await res.text();
  } catch {
    // A blog page that renders its empty state is far better than a build
    // that fails because Substack was briefly unreachable.
    return [];
  }

  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];

  return items.map((item) => {
    const body = text(tag(item, "content:encoded") || tag(item, "description"));
    const raw = tag(item, "pubDate");
    const when = new Date(raw);

    return {
      title: text(tag(item, "title")),
      link: tag(item, "link"),
      date: isNaN(when.getTime())
        ? ""
        : when.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          }).toUpperCase(),
      excerpt: trimToWord(body, 160),
      image: image(item),
      // 200 wpm, rounded up, floored at 1 so nothing reads "0 MIN".
      readingMinutes: Math.max(1, Math.ceil(body.split(" ").length / 200)),
    };
  });
}
