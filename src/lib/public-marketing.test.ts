import {
  PUBLIC_MARKETING_PROVIDERS,
  PUBLIC_SITE_ROUTES,
  PUBLIC_USE_CASES,
  getPublicSitemapPaths,
} from "@/lib/public-marketing";

describe("public marketing content contracts", () => {
  it("represents every supported meeting source in public marketing data", () => {
    const names = PUBLIC_MARKETING_PROVIDERS.map((provider) => provider.name);

    expect(names).toEqual(
      expect.arrayContaining([
        "Fathom",
        "Fireflies",
        "Grain",
        "tl;dv",
        "Otter.ai",
        "MeetGeek",
        "Read AI",
      ])
    );
  });

  it("keeps use-case slugs, titles, and descriptions unique", () => {
    const slugs = PUBLIC_USE_CASES.map((item) => item.slug);
    const titles = PUBLIC_USE_CASES.map((item) => item.metaTitle);
    const descriptions = PUBLIC_USE_CASES.map((item) => item.metaDescription);

    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });

  it("covers the high-intent SEO targets with useful answer content", () => {
    const requiredSlugs = [
      "ai-meeting-notes-to-tasks",
      "chat-with-meeting-transcripts",
      "fathom-meeting-tasks",
      "fireflies-to-task-board",
      "grain-to-task-board",
      "tldv-to-task-board",
      "otter-action-items",
      "meetgeek-task-workflow",
      "read-ai-to-task-workflow",
      "mcp-for-meeting-memory",
      "ai-meeting-workflow-automation",
    ];

    expect(PUBLIC_USE_CASES.map((item) => item.slug)).toEqual(expect.arrayContaining(requiredSlugs));

    for (const item of PUBLIC_USE_CASES) {
      expect(item.heroTitle.length).toBeGreaterThan(20);
      expect(item.summary.length).toBeGreaterThan(80);
      expect(item.steps.length).toBeGreaterThanOrEqual(3);
      expect(item.faqs.length).toBeGreaterThanOrEqual(3);
      expect(item.ctaLabel.length).toBeGreaterThan(3);
      expect(item.relatedSlugs.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("builds a public sitemap that includes core marketing routes and every use case", () => {
    const sitemapPaths = getPublicSitemapPaths();

    expect(sitemapPaths).toEqual(expect.arrayContaining(PUBLIC_SITE_ROUTES));
    expect(sitemapPaths).toEqual(
      expect.arrayContaining(PUBLIC_USE_CASES.map((item) => `/use-cases/${item.slug}`))
    );
    expect(new Set(sitemapPaths).size).toBe(sitemapPaths.length);
  });
});
