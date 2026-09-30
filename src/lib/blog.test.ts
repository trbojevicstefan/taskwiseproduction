import { getBlogPosts, getBlogPost, sanitizeBlogHtml } from "./blog";
const post = {
  slug: "meeting-actions",
  title: "Meeting actions",
  shortsummary: "Follow through",
  subheading: "Clear owners",
  coverimage: "https://example.com/cover.webp",
  inlineimage: "https://example.com/inline.webp",
  category: "Meetings",
  authorname: "Taskwise Team",
  createdAt: "2026-09-30T12:00:00Z",
  content: "<p>Hello</p>",
};
const fetchMock = jest.fn();
beforeEach(() => {
  global.fetch = fetchMock;
  fetchMock.mockReset();
});
function response(value: unknown) {
  fetchMock.mockResolvedValue({ ok: true, json: async () => value });
}
it("rejects invalid slugs without a request", async () => {
  expect(await getBlogPost("../bad")).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});
it("sorts published own-site posts and excludes explicit drafts and other sites", async () => {
  response({
    posts: [
      { ...post, slug: "older", createdAt: "2026-09-01" },
      { ...post, status: "draft" },
      { ...post, site: "opaya" },
      post,
    ],
  });
  expect((await getBlogPosts()).map((p) => p.slug)).toEqual([
    "meeting-actions",
    "older",
  ]);
  expect(fetchMock.mock.calls[0][1]).toEqual({ next: { revalidate: 60 } });
});
it("rejects malformed feed instead of an empty success", async () => {
  response({ posts: [{ ...post, coverimage: "javascript:alert(1)" }] });
  await expect(getBlogPosts()).rejects.toThrow();
  response({ wrong: [] });
  await expect(getBlogPosts()).rejects.toThrow();
});
it("reports transport failure", async () => {
  fetchMock.mockResolvedValue({ ok: false, status: 503 });
  await expect(getBlogPosts()).rejects.toThrow();
});
it("loads detail and preserves semantic HTML while removing executable markup", async () => {
  response({
    post: {
      ...post,
      content:
        '<h2>Review</h2><p onclick="evil()">Safe<a href="javascript:evil()">link</a></p><script>evil()</script><iframe src="https://evil.test"></iframe>',
    },
  });
  const result = await getBlogPost(post.slug);
  expect(result?.content).toContain("<h2>Review</h2>");
  expect(result?.content).not.toMatch(/onclick|javascript:|script|iframe/);
});
it("does not return a mismatched slug or explicit foreign detail", async () => {
  response({ post: { ...post, slug: "wrong" } });
  await expect(getBlogPost(post.slug)).rejects.toThrow();
  response({ post: { ...post, site: "opaya" } });
  expect(await getBlogPost(post.slug)).toBeNull();
});
it("only allows safe HTTPS images and links in article HTML", () => {
  expect(
    sanitizeBlogHtml(
      '<img src="http://bad.test/a"><img src="https://good.test/a" onerror="evil()"><a href="https://good.test">Good</a>',
    ),
  ).not.toMatch(/http:|onerror/);
});
it("accepts canonical site and normalizes empty optional avatar and inline fields", async () => {
  response({
    posts: [
      {
        ...post,
        site: "https://www.taskwise.ai",
        authoravatar: "",
        inlineimage: "",
      },
    ],
  });
  const [result] = await getBlogPosts();
  expect(result.slug).toBe(post.slug);
  expect(result.authoravatar).toBeUndefined();
  expect(result.inlineimage).toBeUndefined();
});
it("rejects a detail whose two image URLs are identical", async () => {
  response({ post: { ...post, inlineimage: post.coverimage } });
  await expect(getBlogPost(post.slug)).rejects.toThrow();
});
