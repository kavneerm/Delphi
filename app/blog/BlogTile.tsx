"use client";

import { TiltCard } from "../components/TiltCard";
import type { Post } from "./substack";

/** One preview tile, linking out to the post on Substack. */
export function BlogTile({ post, index }: { post: Post; index: number }) {
  return (
    <TiltCard href={post.link} className="blog-tile" driftIndex={index}>
      <div className="blog-tile-media">
        {post.image ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={post.image} alt="" loading="lazy" />
        ) : (
          <span className="blog-tile-media-fallback" aria-hidden="true">
            IF
          </span>
        )}
      </div>

      <div className="blog-tile-body">
        <h2 className="blog-tile-title">{post.title}</h2>
        {post.excerpt && <p className="blog-tile-excerpt">{post.excerpt}</p>}
        <p className="blog-tile-meta">
          {[post.date, `${post.readingMinutes} MIN`].filter(Boolean).join(" · ")}
        </p>
      </div>
    </TiltCard>
  );
}

/**
 * Shown when the feed has no posts yet. It is a single grid child, so the
 * auto-fit track stretches it across the full width on its own — the "first
 * one is big" behaviour needs no special casing.
 *
 * Half the usual tilt and a longer perspective: the tile is far larger, and
 * the same angle over this area is a lurch rather than a tilt.
 */
export function BlogTileEmpty() {
  return (
    <TiltCard
      className="blog-tile blog-tile-empty"
      outerClassName="blog-tile-lead"
      maxTilt={3.5}
      perspective={1400}
      lift={10}
    >
      <p className="blog-tile-empty-label">Coming Soon</p>
      <p className="blog-tile-empty-title">The first piece is on its way.</p>
      <p className="blog-tile-empty-note">
        Subscribe below and it will land in your inbox the day it goes up.
      </p>
    </TiltCard>
  );
}
