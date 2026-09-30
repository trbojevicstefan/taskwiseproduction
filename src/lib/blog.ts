import sanitizeHtml from "sanitize-html";
import { z } from "zod";

export const BLOG_ORIGIN = "https://www.taskwise.ai";
const httpsUrl = z
  .string()
  .url()
  .refine((value) => new URL(value).protocol === "https:");
const optionalHttpsUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  httpsUrl.optional(),
);
const slugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(160);
const postSchema = z.object({
  slug: slugSchema,
  title: z.string().trim().min(1).max(300),
  shortsummary: z.string().max(2000),
  subheading: z.string().max(2000).default(""),
  content: z.string().max(300000).optional(),
  coverimage: httpsUrl,
  inlineimage: optionalHttpsUrl,
  category: z.string().max(200).default("Guides"),
  authorname: z.string().trim().min(1).max(200),
  authorbio: z.string().max(3000).optional(),
  authoravatar: optionalHttpsUrl,
  createdAt: z
    .string()
    .refine(
      (value) => Number.isFinite(Date.parse(value)),
      "Invalid publication date",
    ),
});
export type BlogPost = z.infer<typeof postSchema>;

// The feed scopes published documents; defensively honor explicit visibility metadata too.
function isPublicTaskwise(value: unknown): boolean {
  if (!value || typeof value !== "object") return true; // Schema validation reports malformed entries.
  const record = value as Record<string, unknown>;
  if (
    record.status !== undefined &&
    String(record.status).toLowerCase() !== "published"
  )
    return false;
  if (record.published === false) return false;
  return (
    record.site === undefined ||
    ["taskwise", "taskwise.ai", "www.taskwise.ai", BLOG_ORIGIN].includes(
      String(record.site),
    )
  );
}

export function sanitizeBlogHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      "p",
      "h2",
      "h3",
      "h4",
      "ul",
      "ol",
      "li",
      "strong",
      "em",
      "blockquote",
      "a",
      "code",
      "pre",
      "br",
      "hr",
      "figure",
      "figcaption",
      "img",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
    ],
    allowedAttributes: {
      a: ["href", "title"],
      img: ["src", "alt", "width", "height", "loading"],
    },
    allowedSchemes: ["https", "mailto"],
    allowedSchemesByTag: { img: ["https"] },
    allowProtocolRelative: false,
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }),
    },
  });
}

async function fetchFeed(slug?: string): Promise<unknown> {
  const url = new URL(
    process.env.TASKWISE_BLOG_FEED_URL ||
      "https://n8n.performarkn8n.com/webhook/taskwise-blog-feed",
  );
  if (url.protocol !== "https:") throw new Error("Blog feed must use HTTPS");
  if (slug) url.searchParams.set("slug", slug);
  const response = await fetch(url.toString(), { next: { revalidate: 60 } });
  if (!response.ok)
    throw new Error(`Blog feed unavailable (${response.status})`);
  return response.json();
}

export async function getBlogPosts(): Promise<BlogPost[]> {
  const envelope = z
    .object({ posts: z.array(z.unknown()) })
    .parse(await fetchFeed());
  return envelope.posts
    .filter(isPublicTaskwise)
    .map((value) => postSchema.parse(value))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export async function getBlogPost(slug: string): Promise<BlogPost | null> {
  if (!slugSchema.safeParse(slug).success) return null;
  const envelope = z
    .object({ post: z.unknown().nullable() })
    .parse(await fetchFeed(slug));
  if (envelope.post === null || !isPublicTaskwise(envelope.post)) return null;
  const post = postSchema
    .extend({ content: z.string().min(1).max(300000), inlineimage: httpsUrl })
    .refine(
      (post) => post.coverimage !== post.inlineimage,
      "Article requires two distinct images",
    )
    .parse(envelope.post);
  if (post.slug !== slug)
    throw new Error("Blog feed returned a different article");
  return { ...post, content: sanitizeBlogHtml(post.content) };
}
