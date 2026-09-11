# Taskwise Public SEO + Content + AEO/GEO Refresh

Date: 2026-09-11
Branch: `feat/meeting-providers-batch-sep2026`

## Goal

Update the public Taskwise website so it accurately reflects the current product: multi-provider meeting ingestion, transcript chat, reviewed task extraction, Swipe Sweep cleanup, Automations, People/Clients context, Calendar/Planning, sharing, and MCP operator controls. Improve technical SEO and answer-engine discoverability without changing the existing dark visual system, gradients, spacing rhythm, hero animation, card primitives, or navigation styling.

## Approaches considered

### A. Visual rewrite

Rebuild the marketing site around a new landing template.

Rejected: unnecessary regression risk and directly conflicts with the requirement to preserve the current site style.

### B. Copy-only patch

Change homepage text and metadata only.

Rejected: fast, but leaves sitemap, canonical coverage, structured data, answer-oriented content, provider intent pages, and internal linking incomplete.

### C. Shared SEO content model + existing visual shell — chosen

Keep `MarketingPageShell`, `PanoramicHero`, `MarketingSection`, the existing color tokens/classes, and the animated homepage hero. Centralize public use-case content in a typed module, render SEO landing pages through the existing components, add structured data/sitemap/llms.txt, and update existing copy in-place.

This gives the strongest SEO/AEO improvement with the lowest styling risk.

## Tasks

### Task 1 — Add contract tests first

- [x] Add `src/lib/public-marketing.test.ts`.
- [x] Assert all required meeting providers are represented in public marketing data: Fathom, Fireflies, Grain, tl;dv, Otter.ai, MeetGeek, Read AI.
- [x] Assert use-case slugs are unique and include the high-intent targets from CP14.
- [x] Assert every use case has unique title/description, FAQ content, CTA, and related links.
- [x] Assert sitemap source contains the public marketing routes and all public use-case routes.

RED was confirmed in GitHub Actions before implementation: lint passed and typecheck failed on the intentionally missing public marketing module.

### Task 2 — Centralize public product/SEO content

- [x] Add `src/lib/public-marketing.ts`.
- [x] Define the canonical production URL `https://www.taskwise.ai`.
- [x] Define provider marketing records and current capability language.
- [x] Define high-intent use cases:
  - [x] AI meeting notes to tasks.
  - [x] Chat with meeting transcripts.
  - [x] Fathom meeting tasks/workflow layer.
  - [x] Fireflies to task board.
  - [x] Grain to task board.
  - [x] tl;dv to task board.
  - [x] Otter action items to execution.
  - [x] MeetGeek task workflow.
  - [x] Read AI reports to action workflow.
  - [x] MCP for meeting memory.
  - [x] AI meeting workflow automation.
- [x] Keep claims bounded to implemented product paths and provider contract status.

### Task 3 — Technical SEO foundation

- [x] Update `src/app/layout.tsx` with consistent title template/default, description, application name, robots directives, OpenGraph/Twitter defaults, and canonical metadata base.
- [x] Add `src/app/sitemap.ts` generated from the public route model.
- [x] Replace stale `public/robots.txt` comments with a clean allow-all policy and canonical `www.taskwise.ai` sitemap URL.
- [x] Add `public/llms.txt` as a concise, factual machine-readable product index with public routes and capability summary.

### Task 4 — Structured data / AEO

- [x] Add `src/components/landing/StructuredData.tsx` for safe JSON-LD rendering.
- [x] Add SoftwareApplication + WebSite structured data on the homepage.
- [x] Add FAQPage + BreadcrumbList only on pages where visible content supports those answers.
- [x] Keep structured data factual; do not invent ratings, pricing, customer counts, awards, or unsupported claims.

### Task 5 — Homepage copy refresh without visual changes

- [x] Update `src/components/landing/marketing-content.ts` with all current providers and updated flow language.
- [ ] Keep the existing `src/components/landing/MainBranchHero.tsx` animation/layout/classes unchanged; its current review-first hero remains valid while the integration marquee now receives the expanded provider data.
- [x] Update `src/app/page.tsx` metadata and section copy so it reads like production marketing rather than an internal brief.
- [x] Add concise internal links to features, integrations, transcript chat/use cases, and MCP using existing styles.

### Task 6 — Features + integrations + MCP content refresh

- [x] Update `src/app/features/page.tsx` to include transcript chat, reviewed extraction, Swipe Sweep, Automations, People/Clients, Calendar/Planning, sharing, Slack follow-through, and MCP/operator controls.
- [x] Update `src/app/integrations/page.tsx` copy/internal links while preserving its current card styling and provider-specific caveats.
- [x] Update `src/app/mcp/page.tsx` metadata and visible answer-oriented content without overstating client compatibility.
- [x] Update `src/app/docs/page.tsx` metadata and top-level jobs-to-be-done links so docs support public discovery.

### Task 7 — High-intent use-case landing pages

- [x] Add `src/app/use-cases/page.tsx` index using existing marketing components.
- [x] Add `src/app/use-cases/[slug]/page.tsx` with `generateStaticParams()` and `generateMetadata()` from the shared model.
- [x] Render intent-specific overview, how-it-works steps, FAQ, related use cases, and direct activation CTA.
- [x] Preserve the existing dark marketing visual language; no new global CSS or dependency.

### Task 8 — Plan/checkpoint bookkeeping

- [ ] Mark completed CP14 items in `docs/superpowers/plans/2026-09-11-taskwise-product-reinvention-plan.md` only when implemented.
- [x] Update this plan checkboxes as tasks land.

### Task 9 — Verification

- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm test -- --runInBand`
- [ ] `npm run test:routes:smoke`
- [ ] Verify exact-head GitHub CI.
- [ ] Verify exact-head Vercel preview/production status before merge.

## Guardrails

- Do not change the existing marketing palette, gradients, hero animation, card radii, or page shell.
- Do not add dependencies.
- Do not expose private/authenticated routes in structured data as public product pages.
- Do not claim a provider is live-tested with real credentials unless that live test has occurred.
- Do not publish competitor-superiority claims without evidence.
- Do not manufacture reviews, ratings, usage counts, customer logos, or social proof.
- Prefer concise, answerable copy over keyword repetition.
