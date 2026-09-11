import type { MetadataRoute } from "next";
import { getPublicSitemapPaths, PUBLIC_SITE_URL } from "@/lib/public-marketing";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  return getPublicSitemapPaths().map((path) => ({
    url: `${PUBLIC_SITE_URL}${path === "/" ? "" : path}`,
    lastModified: now,
    changeFrequency: path === "/" ? "weekly" : "monthly",
    priority: path === "/" ? 1 : path === "/features" || path === "/integrations" ? 0.9 : 0.7,
  }));
}
