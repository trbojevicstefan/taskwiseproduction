import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { BLOG_ORIGIN, getBlogPost } from "@/lib/blog";

type Props = { params: Promise<{ slug: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = await getBlogPost(slug);
  if (!post) notFound();
  const url = `${BLOG_ORIGIN}/blog/${post.slug}`;
  return {
    title: `${post.title} | Taskwise Blog`,
    description: post.shortsummary,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      title: post.title,
      description: post.shortsummary,
      url,
      siteName: "TaskwiseAI",
      publishedTime: post.createdAt,
      authors: [post.authorname],
      images: [{ url: post.coverimage }],
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.shortsummary,
      images: [post.coverimage],
    },
  };
}
export default async function Article({ params }: Props) {
  const { slug } = await params;
  const post = await getBlogPost(slug);
  if (!post) notFound();
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.shortsummary,
    image: [post.coverimage, post.inlineimage].filter(Boolean),
    datePublished: post.createdAt,
    author: { "@type": "Organization", name: post.authorname },
    publisher: {
      "@type": "Organization",
      name: "TaskwiseAI",
      url: BLOG_ORIGIN,
    },
    mainEntityOfPage: `${BLOG_ORIGIN}/blog/${post.slug}`,
  };
  return (
    <MarketingPageShell>
      <article className="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-20">
        <Link href="/blog" className="text-sm text-white/60 hover:text-white">
          ← All articles
        </Link>
        <p className="mt-10 text-xs font-semibold uppercase tracking-[0.2em] text-[#FFB257]">
          {post.category}
        </p>
        <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
          {post.title}
        </h1>
        <p className="mt-6 text-xl leading-8 text-white/65">
          {post.subheading || post.shortsummary}
        </p>
        <div className="mt-8 flex items-center gap-3 text-sm text-white/60">
          {post.authoravatar ? (
            <img
              src={post.authoravatar}
              alt=""
              width={40}
              height={40}
              className="h-10 w-10 rounded-full"
            />
          ) : null}
          <div>
            <p className="font-medium text-white">{post.authorname}</p>
            <time dateTime={post.createdAt}>
              {new Date(post.createdAt).toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
                timeZone: "UTC",
              })}
            </time>
          </div>
        </div>
        <img
          src={post.coverimage}
          alt={post.title}
          width={1536}
          height={1024}
          className="mt-10 aspect-[3/2] w-full rounded-2xl object-cover"
          fetchPriority="high"
        />
        <div
          className="mt-12 text-lg leading-8 text-white/80 [&_p]:my-6 [&_h2]:mb-4 [&_h2]:mt-12 [&_h2]:text-3xl [&_h2]:font-semibold [&_h2]:text-white [&_h3]:mb-3 [&_h3]:mt-8 [&_h3]:text-2xl [&_h3]:font-semibold [&_ul]:my-6 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-2 [&_a]:text-[#FFB257] [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-[#FF8F73] [&_blockquote]:pl-6 [&_img]:rounded-xl [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-white/5 [&_pre]:p-5 [&_table]:block [&_table]:overflow-x-auto"
          dangerouslySetInnerHTML={{ __html: post.content || "" }}
        />
        {post.inlineimage && !post.content?.includes(post.inlineimage) ? (
          <figure className="mt-10">
            <img
              src={post.inlineimage}
              alt={`${post.title}: supporting illustration`}
              width={1536}
              height={1024}
              loading="lazy"
              className="w-full rounded-2xl"
            />
          </figure>
        ) : null}
        <div className="mt-12 border-t border-white/10 pt-8">
          <p className="font-semibold">About {post.authorname}</p>
          <p className="mt-2 text-sm leading-7 text-white/60">
            {post.authorbio ||
              "The Taskwise team shares practical guides to meeting memory, reviewed tasks, and team execution."}
          </p>
        </div>
        <aside className="mt-12 rounded-2xl border border-[#FF8F73]/25 bg-[#FF8F73]/5 p-8">
          <h2 className="text-2xl font-semibold">
            Put your next meeting to work.
          </h2>
          <p className="mt-3 leading-7 text-white/65">
            Capture the context. Review the actions. Keep follow-through alive
            with Taskwise.
          </p>
          <Link
            href="/signup"
            className="mt-6 inline-flex rounded-lg bg-gradient-to-r from-[#FF4D4D] to-[#FF9900] px-6 py-3 font-semibold text-white"
          >
            Get started with Taskwise
          </Link>
        </aside>
      </article>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
        }}
      />
    </MarketingPageShell>
  );
}
