# Taskwise editorial workflow

## Live configuration

- Site: https://www.taskwise.ai/blog
- Firebase project: `taskwiseai-v0`; existing `(default)` database; collection `taskwise_blog_posts`.
- Writer: `eP74jlymTiyZTOWD` (Taskwise - Blog Writer).
- Public feed: `2i86jwCZRzEsVYey` (Taskwise - Public Blog Feed).
- Feed URL: https://n8n.performarkn8n.com/webhook/taskwise-blog-feed (optional `?slug=meeting-notes-to-tasks`).
- Google Sheet: https://docs.google.com/spreadsheets/d/1qD8QJqWTJ8-MSxtP--tvaSzB4tXqajQJ9C_x-8jp71s/edit
- Owner: team@n8nlab.io; existing n8n Google Sheets identity has writer access.
- Schedule: Monday, Wednesday and Friday at 12:00, Europe/Belgrade.

No extra Firestore database was created. A dedicated `n8n-taskwise-blog` service account has `roles/datastore.user` in Taskwise's project. The private key exists only in encrypted n8n credentials, never in this repository. The role grants data access in the project; collection isolation is enforced by the configured writer and public feed, not by collection-level IAM.

Images use the already-existing `n8nauts.firebasestorage.app` bucket under `taskwise-blog/`; no new storage bucket was created. Matching compressed asset copies are in `public/blog/`. Illustrations are conceptual, not screenshots.

## Editorial queue

Set a row to `Ready` or `Queued`, provide a unique lowercase hyphenated slug, Guide/Comparison/Listicle type, product-grounded key points, subheading, summary, category/tags, author name/avatar/bio, source URLs, target keyword, audience and two distinct HTTPS image URLs. Optional `Publish After` accepts an ISO timestamp. The writer skips future dates and slugs already in Firestore; it marks the completed row `Published` with URL and timestamp. To keep future topics available, add rows before the six-topic queue is exhausted.

Next.js reads published articles server-side and caches feed requests for 60 seconds. Article metadata, OpenGraph, JSON-LD and sitemap derive from the same validated content. Blog HTML is sanitized before rendering. New posts require no Vercel deployment. The blog does not read Taskwise's private MongoDB workspace data.

## Verification and recovery

`node automations/taskwise-blog-contract.test.cjs` validates schedule, project/collection isolation, topic selection and complete public-feed listings. Application tests run through `npm test -- --runInBand`.

The initial live writer execution `49857` succeeded through `Mark Blog Topic Published`, publishing `meeting-notes-to-tasks`. The temporary publication-test webhook was removed; the scheduled workflow is active. If a writer execution fails, inspect its last node before retrying. A successful Firestore write followed by a failed Sheet update leaves a published slug that selection will skip; reconcile that Sheet row manually instead of generating the article again.

Workflow exports contain credential IDs but no keys. On another n8n instance, select its service account, Sheets and Gemini credentials explicitly. Keep the feed collection and required `site === https://www.taskwise.ai` filter scoped to Taskwise.
