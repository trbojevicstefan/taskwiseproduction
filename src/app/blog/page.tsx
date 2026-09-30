import type { Metadata } from "next";
import Link from "next/link";
import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { BLOG_ORIGIN, getBlogPosts, type BlogPost } from "@/lib/blog";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Taskwise Blog | Meetings to meaningful work",
  description:
    "Practical guides to meeting memory, reviewed action items, team planning and grounded AI workflows.",
  alternates: { canonical: `${BLOG_ORIGIN}/blog` },
  openGraph: {
    title: "Taskwise Blog",
    description: "From meeting memory to meaningful work.",
    url: `${BLOG_ORIGIN}/blog`,
    type: "website",
  },
};
export default async function BlogIndex() {
  let posts: BlogPost[] = [];
  let unavailable = false;
  try {
    posts = await getBlogPosts();
  } catch (error) {
    unavailable = true;
    console.error("Taskwise blog feed unavailable", error);
  }
  return (
    <MarketingPageShell>
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
        <p className="text-sm font-semibold uppercase tracking-[0.22em] text-[#FFB257]">
          The Taskwise blog
        </p>
        <h1 className="mt-5 max-w-3xl text-4xl font-semibold tracking-tight sm:text-6xl">
          From meeting memory
          <br />
          <span className="text-[#FF8F73]">to meaningful work.</span>
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-white/65">
          Practical ideas for capturing decisions, reviewing action items, and
          keeping your team moving.
        </p>
        {unavailable ? (
          <div
            role="status"
            className="mt-12 rounded-2xl border border-white/10 bg-white/5 p-8"
          >
            Our articles are temporarily unavailable. Please try again shortly.
          </div>
        ) : posts.length === 0 ? (
          <p className="mt-12 text-white/65">
            Our first guides are on their way. Check back soon.
          </p>
        ) : (
          <div className="mt-14 grid gap-8 md:grid-cols-2 lg:grid-cols-3">
            {posts.map((post) => (
              <article
                key={post.slug}
                className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] transition hover:border-[#FF8F73]/50"
              >
                <Link href={`/blog/${post.slug}`} className="block">
                  <img
                    src={post.coverimage}
                    alt={post.title}
                    width={1536}
                    height={1024}
                    loading="lazy"
                    className="aspect-[3/2] w-full object-cover"
                  />
                </Link>
                <div className="p-6">
                  <p className="text-xs font-semibold uppercase tracking-wider text-[#FFB257]">
                    {post.category}
                  </p>
                  <h2 className="mt-3 text-2xl font-semibold leading-tight">
                    <Link href={`/blog/${post.slug}`}>{post.title}</Link>
                  </h2>
                  <p className="mt-4 text-sm leading-7 text-white/65">
                    {post.shortsummary}
                  </p>
                  <div className="mt-6 flex flex-wrap gap-x-3 gap-y-1 text-xs text-white/45">
                    <span>{post.authorname}</span>
                    <time dateTime={post.createdAt}>
                      {new Date(post.createdAt).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                        timeZone: "UTC",
                      })}
                    </time>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </MarketingPageShell>
  );
}
