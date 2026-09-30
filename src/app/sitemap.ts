import type { MetadataRoute } from "next";
import { BLOG_ORIGIN, getBlogPosts } from "@/lib/blog";
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const posts = await getBlogPosts();
  return [
    ...["", "/features", "/integrations", "/mcp", "/docs", "/blog"].map(
      (path) => ({ url: `${BLOG_ORIGIN}${path}` }),
    ),
    ...posts.map((post) => ({
      url: `${BLOG_ORIGIN}/blog/${post.slug}`,
      lastModified: new Date(post.createdAt),
    })),
  ];
}
