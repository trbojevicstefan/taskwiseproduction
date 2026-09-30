import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import BlogIndex, { revalidate as blogRevalidate } from "./page";
import Article, { generateMetadata } from "./[slug]/page";
import sitemap, { dynamic as sitemapDynamic } from "../sitemap";
import { getBlogPosts, getBlogPost } from "@/lib/blog";
const post = {
  slug: "meeting-actions",
  title: "Meeting actions",
  shortsummary: "Follow through",
  subheading: "Clear owners",
  coverimage: "https://example.com/cover.webp",
  inlineimage: "https://example.com/inline.webp",
  category: "Meetings",
  authorname: "Taskwise Team",
  authorbio: "We build Taskwise",
  createdAt: "2026-09-30T12:00:00Z",
  content: "<h2>Review</h2><p>Safe</p>",
};
jest.mock("@/lib/blog", () => ({
  ...jest.requireActual("@/lib/blog"),
  getBlogPosts: jest.fn(),
  getBlogPost: jest.fn(),
}));
jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...props }: any) => {
    delete props.prefetch;
    return React.createElement("a", { href, ...props }, children);
  },
}));
jest.mock("@/components/ui/logo", () => ({
  Logo: () => React.createElement("span", null, "logo"),
}));
jest.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
  (getBlogPosts as jest.Mock).mockResolvedValue([post]);
  (getBlogPost as jest.Mock).mockResolvedValue(post);
});
afterEach(() => jest.restoreAllMocks());
it("renders article links, covers, and accessible Blog navigation", async () => {
  const html = renderToStaticMarkup(await BlogIndex());
  expect(html).toContain('href="/blog/meeting-actions"');
  expect(html).toContain(post.coverimage);
  expect(html).toContain('href="/blog"');
});
it("renders two images, author, date, semantic prose and signup CTA", async () => {
  const html = renderToStaticMarkup(
    await Article({ params: Promise.resolve({ slug: post.slug }) }),
  );
  expect(html).toContain(post.coverimage);
  expect(html).toContain(post.inlineimage);
  expect(html).toContain("Taskwise Team");
  expect(html).toContain("2026-09-30");
  expect(html).toContain("<h2>Review</h2>");
  expect(html).toContain('href="/signup"');
});
it("returns notFound for missing articles", async () => {
  (getBlogPost as jest.Mock).mockResolvedValue(null);
  await expect(
    Article({ params: Promise.resolve({ slug: "missing" }) }),
  ).rejects.toThrow("NOT_FOUND");
});
it("provides canonical, article OG and cover metadata", async () => {
  const metadata = await generateMetadata({
    params: Promise.resolve({ slug: post.slug }),
  });
  expect(metadata.alternates?.canonical).toBe(
    "https://www.taskwise.ai/blog/meeting-actions",
  );
  expect(metadata.openGraph).toMatchObject({
    type: "article",
    images: [{ url: post.coverimage }],
  });
});
it("escapes JSON-LD script termination", async () => {
  (getBlogPost as jest.Mock).mockResolvedValue({
    ...post,
    title: "Title </script><script>alert(1)</script>",
  });
  const html = renderToStaticMarkup(
    await Article({ params: Promise.resolve({ slug: post.slug }) }),
  );
  expect(html).toContain("\\u003c/script>");
  expect(html).not.toContain("</script><script>alert(1)");
});
it("sitemap includes article URLs and fails visibly on feed errors", async () => {
  expect(await sitemap()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        url: "https://www.taskwise.ai/blog/meeting-actions",
      }),
    ]),
  );
  (getBlogPosts as jest.Mock).mockRejectedValue(new Error("Unavailable"));
  await expect(sitemap()).rejects.toThrow("Unavailable");
});
it("index gives a useful unavailable state", async () => {
  (getBlogPosts as jest.Mock).mockRejectedValue(new Error("Unavailable"));
  expect(renderToStaticMarkup(await BlogIndex())).toContain(
    "temporarily unavailable",
  );
});

it("recovers the index after feed failures and defers sitemap to requests", () => {
  expect(blogRevalidate).toBe(60);
  expect(sitemapDynamic).toBe("force-dynamic");
});
it("renders the supporting image when its URL only appears as a hyperlink", async () => {
  (getBlogPost as jest.Mock).mockResolvedValue({
    ...post,
    content: `<p><a href="${post.inlineimage}">View illustration</a></p>`,
  });
  const html = renderToStaticMarkup(
    await Article({ params: Promise.resolve({ slug: post.slug }) }),
  );
  expect(html).toContain(`src="${post.inlineimage}"`);
});
it("does not duplicate the supporting image already present in article HTML", async () => {
  (getBlogPost as jest.Mock).mockResolvedValue({
    ...post,
    content: `<figure><img src="${post.inlineimage}" alt="Illustration"></figure>`,
  });
  const html = renderToStaticMarkup(
    await Article({ params: Promise.resolve({ slug: post.slug }) }),
  );
  expect(html.split(`src="${post.inlineimage}"`).length - 1).toBe(1);
});
