# Taskwise Marketing Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the public homepage into a polished launch page that showcases the full Taskwise story and add dedicated public pages for features, integrations, and MCP.

**Architecture:** Build a small shared marketing shell and content model first, then use it to power the homepage and three supporting public pages. Keep the homepage emotionally strong and concise, while the supporting pages carry the detail for the new product capabilities and operator layer.

**Tech Stack:** Next.js App Router, React 18, TypeScript, Tailwind CSS, Framer Motion, Lucide icons, existing `Logo`, `Button`, `Badge`, `Card`, and `Link` components.

## Global Constraints

- The homepage should be public marketing, not docs.
- Supporting pages are worth adding because the feature set is now broad enough that the homepage alone would become cluttered.
- MCP should be presented as a power feature with its own page, not buried inside integrations.
- The homepage should feel polished, bold, and product-led.
- Dark, cinematic background with controlled gradients.
- Large hero headline and tight supporting copy.
- Fewer but larger content blocks.
- Strong hierarchy between “core product” and “advanced platform”.
- Motion that supports the story, not decoration for its own sake.
- Integrations and MCP should feel like power features, not afterthoughts.
- Do not imply a supported integration if it is only planned.
- Do not imply fully automated agent autonomy beyond what the app already does.
- Do not describe MCP write tools as unrestricted.
- Do not describe Slack reminders as chat-sent messages; they are scheduled reminders with persistence and state.
- Preserve existing auth links and routes.
- Ensure the new pages work well on desktop and mobile.

---

### Task 1: Build shared marketing scaffolding

**Files:**
- Create: `src/components/landing/marketing-content.ts`
- Create: `src/components/landing/MarketingPageShell.tsx`
- Create: `src/components/landing/MarketingSection.tsx`
- Create: `src/components/landing/marketing-types.ts`

**Interfaces:**
- Consumes: `Logo`, `Link`, `Button`, `Badge`, and simple React children.
- Produces: shared arrays for homepage/page copy, a reusable shell component, and a reusable section wrapper.

- [ ] **Step 1: Write the failing test**

Create `src/components/landing/marketing-content.test.ts`:

```ts
import { marketingNavItems, integrationCards, productFlowSteps } from "@/components/landing/marketing-content";

describe("marketing content", () => {
  it("covers the new public launch story", () => {
    expect(marketingNavItems.map((item) => item.href)).toEqual([
      "/",
      "/features",
      "/integrations",
      "/mcp",
      "/signup",
    ]);
    expect(productFlowSteps.map((step) => step.title)).toEqual([
      "Capture",
      "Understand",
      "Review",
      "Execute",
    ]);
    expect(integrationCards.map((card) => card.name)).toEqual([
      "Fathom",
      "Fireflies",
      "Grain",
      "Slack",
      "Google Workspace",
      "Trello",
      "Manual paste",
      "MCP",
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/components/landing/marketing-content.test.ts --runInBand`

Expected: FAIL because `src/components/landing/marketing-content.ts` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/landing/marketing-types.ts`:

```ts
export type MarketingNavItem = {
  label: string;
  href: string;
};

export type MarketingFlowStep = {
  title: string;
  description: string;
};

export type MarketingCard = {
  name: string;
  title: string;
  description: string;
  href?: string;
};
```

Create `src/components/landing/marketing-content.ts`:

```ts
import type { MarketingCard, MarketingFlowStep, MarketingNavItem } from "@/components/landing/marketing-types";

export const marketingNavItems: MarketingNavItem[] = [
  { label: "Home", href: "/" },
  { label: "Features", href: "/features" },
  { label: "Integrations", href: "/integrations" },
  { label: "MCP", href: "/mcp" },
  { label: "Get started", href: "/signup" },
];

export const productFlowSteps: MarketingFlowStep[] = [
  { title: "Capture", description: "Bring in Fathom, Fireflies, Grain, or pasted notes." },
  { title: "Understand", description: "Ask grounded questions over meetings, tasks, and people." },
  { title: "Review", description: "Clean up noisy tasks, approve the good ones, and set ownership." },
  { title: "Execute", description: "Plan the week, prioritize work, and keep follow-through alive." },
];

export const integrationCards: MarketingCard[] = [
  { name: "Fathom", title: "Primary meeting sync", description: "Ingest meeting transcripts and notes from the existing Fathom flow." },
  { name: "Fireflies", title: "Note-taker ingest", description: "Pull transcript-driven meetings from Fireflies through the provider abstraction." },
  { name: "Grain", title: "Transcript ingest", description: "Sync Grain recordings and transcripts into the same workflow." },
  { name: "Slack", title: "Scheduled reminders", description: "Keep task follow-through alive with persistent reminders and pings." },
  { name: "Google Workspace", title: "Calendar and task flows", description: "Support calendar-linked workflows and planning surfaces." },
  { name: "Trello", title: "Export and delivery", description: "Push or export work into external task boards." },
  { name: "Manual paste", title: "Fast start", description: "Start from pasted notes or transcript text when no integration is connected." },
  { name: "MCP", title: "Operator surface", description: "Expose workspace-scoped read/write tools for advanced automation." },
];
```

Create `src/components/landing/MarketingSection.tsx`:

```tsx
import type { ReactNode } from "react";

export function MarketingSection({
  id,
  title,
  subtitle,
  children,
}: {
  id?: string;
  title: ReactNode;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="mb-8 space-y-3">
        <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">{title}</h2>
        {subtitle ? <p className="max-w-3xl text-base text-white/70">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}
```

Create `src/components/landing/MarketingPageShell.tsx`:

```tsx
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { marketingNavItems } from "@/components/landing/marketing-content";

export function MarketingPageShell({
  children,
  showSectionNav = true,
}: {
  children: ReactNode;
  showSectionNav?: boolean;
}) {
  return (
    <div className="dark">
      <main className="min-h-screen bg-[#0B0B0F] text-white">
        <header className="sticky top-0 z-40 border-b border-white/10 bg-black/20 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
            <Link href="/" className="flex items-center gap-3">
              <Logo size="md" />
              <Badge className="hidden sm:inline-flex bg-white/10 text-white">Beta</Badge>
            </Link>
            {showSectionNav ? (
              <nav className="hidden items-center gap-6 text-sm text-white/70 md:flex">
                {marketingNavItems.map((item) => (
                  <Link key={item.href} href={item.href} className="hover:text-white">
                    {item.label}
                  </Link>
                ))}
              </nav>
            ) : null}
            <div className="flex items-center gap-3">
              <Button variant="secondary" className="hidden sm:inline-flex bg-white/10 text-white hover:bg-white/20" asChild>
                <Link href="/login" prefetch={false}>Sign in</Link>
              </Button>
              <Button className="gem-button bg-gradient-to-r from-[#FF4D4D] via-[#FF9900] to-[#FF2E97] text-white" asChild>
                <Link href="/signup" prefetch={false}>Get started</Link>
              </Button>
            </div>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/components/landing/marketing-content.test.ts --runInBand`

Expected: PASS with 1 suite and 1 test.

- [ ] **Step 5: Commit**

```bash
git add src/components/landing/marketing-content.ts src/components/landing/marketing-content.test.ts src/components/landing/MarketingPageShell.tsx src/components/landing/MarketingSection.tsx src/components/landing/marketing-types.ts
git commit -m "feat: add shared marketing scaffolding"
```

### Task 2: Rebuild the homepage as a launch page

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/components/landing/AnimatedTaskHero.tsx` only if the hero needs copy or structure tweaks to fit the new homepage story
- Modify: `src/components/landing/TaskwiseGsapSection.tsx` only if the current three-panel story needs to be rewritten to mention the new feature set
- Create: `src/app/page.test.tsx`

**Interfaces:**
- Consumes: `MarketingPageShell`, `MarketingSection`, `marketingNavItems`, `productFlowSteps`, `integrationCards`, existing hero components.
- Produces: a public homepage that clearly exposes Fathom, Fireflies, Grain, AI chat, cleanup, prioritization, planning, Slack reminders, and MCP.

- [ ] **Step 1: Write the failing test**

Create `src/app/page.test.tsx`:

```tsx
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import HomePage from "@/app/page";

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...props }: any) => React.createElement("a", { href, ...props }, children),
}));

jest.mock("@/components/ui/logo", () => ({
  Logo: () => React.createElement("span", null, "logo"),
}));

jest.mock("@/components/landing/AnimatedTaskHero", () => ({
  __esModule: true,
  default: () => React.createElement("div", { "data-testid": "hero" }, "hero"),
}));

jest.mock("@/components/landing/TaskwiseGsapSection", () => ({
  __esModule: true,
  default: () => React.createElement("div", null, "story"),
}));

describe("homepage marketing refresh", () => {
  it("surfaces the new platform story", () => {
    const html = renderToStaticMarkup(React.createElement(HomePage));

    expect(html).toContain("Fathom");
    expect(html).toContain("Fireflies");
    expect(html).toContain("Grain");
    expect(html).toContain("AI task cleanup");
    expect(html).toContain("Deterministic prioritization");
    expect(html).toContain("Planning workspace");
    expect(html).toContain("Slack reminders");
    expect(html).toContain("MCP");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/app/page.test.tsx --runInBand`

Expected: FAIL because the homepage still renders the old mixed layout and does not yet expose the new launch story.

- [ ] **Step 3: Write minimal implementation**

Rewrite `src/app/page.tsx` to:

- Export homepage metadata for the public launch
- Use `MarketingPageShell`
- Present a premium hero with the “meetings in, reviewed work out” story
- Add a four-step product flow section
- Add a core capabilities section that includes chat, cleanup, prioritization, planning, calendar, and people/client classification
- Add an integrations section that explicitly includes Fathom, Fireflies, Grain, Slack, Google Workspace, Trello, manual paste, and MCP
- Add an operator layer section that mentions keys, audit logs, workflow replay, and advanced settings
- End with a strong CTA section linking to `/signup`, `/features`, `/integrations`, and `/mcp`
- Keep the current hero motion components only where they strengthen the page visually

Suggested structure:

```tsx
export const metadata: Metadata = {
  title: "TaskwiseAI | Meetings to execution",
  description:
    "Turn meetings, notes, and recordings into reviewed tasks, priority, reminders, and operator-ready workflows.",
};

export default function HomePage() {
  return (
    <MarketingPageShell>
      {/* hero */}
      {/* flow */}
      {/* capabilities */}
      {/* integrations */}
      {/* operator layer */}
      {/* final CTA */}
    </MarketingPageShell>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/app/page.test.tsx --runInBand`

Expected: PASS with the homepage exposing the new platform story.

- [ ] **Step 5: Commit**

```bash
git add src/app/page.tsx src/app/page.test.tsx src/components/landing/AnimatedTaskHero.tsx src/components/landing/TaskwiseGsapSection.tsx
git commit -m "feat: refresh homepage launch story"
```

### Task 3: Add the public `/features` page

**Files:**
- Create: `src/app/features/page.tsx`
- Create: `src/app/features/page.test.tsx`

**Interfaces:**
- Consumes: `MarketingPageShell`, `MarketingSection`, and the shared launch-copy data.
- Produces: a focused features page for chat, cleanup, prioritization, planning, calendar, people, and reminders.

- [ ] **Step 1: Write the failing test**

Create `src/app/features/page.test.tsx`:

```tsx
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import FeaturesPage from "@/app/features/page";

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...props }: any) => React.createElement("a", { href, ...props }, children),
}));

jest.mock("@/components/ui/logo", () => ({
  Logo: () => React.createElement("span", null, "logo"),
}));

describe("features page", () => {
  it("describes the major product capabilities", () => {
    const html = renderToStaticMarkup(React.createElement(FeaturesPage));

    expect(html).toContain("AI chat");
    expect(html).toContain("task cleanup");
    expect(html).toContain("Deterministic prioritization");
    expect(html).toContain("Planning workspace");
    expect(html).toContain("Slack reminders");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/app/features/page.test.tsx --runInBand`

Expected: FAIL because the route does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `src/app/features/page.tsx`:

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { MarketingSection } from "@/components/landing/MarketingSection";

export const metadata: Metadata = {
  title: "Features | TaskwiseAI",
  description:
    "Explore AI chat, cleanup tasks, prioritization, planning, calendar, people, and reminders in TaskwiseAI.",
};

export default function FeaturesPage() {
  return (
    <MarketingPageShell>
      {/* explanatory sections for chat, cleanup, prioritization, planning, calendar, people, reminders */}
    </MarketingPageShell>
  );
}
```

The page should explicitly cover:

- AI chat over meetings, tasks, people, and clients
- AI task cleanup
- Deterministic prioritization
- Planning workspace
- Calendar and people/client views
- Slack reminders

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/app/features/page.test.tsx --runInBand`

Expected: PASS with the features page rendering the new capability story.

- [ ] **Step 5: Commit**

```bash
git add src/app/features/page.tsx src/app/features/page.test.tsx
git commit -m "feat: add features page"
```

### Task 4: Add the public `/integrations` page

**Files:**
- Create: `src/app/integrations/page.tsx`
- Create: `src/app/integrations/page.test.tsx`

**Interfaces:**
- Consumes: `MarketingPageShell`, `MarketingSection`, and `integrationCards`.
- Produces: a polished integrations page that highlights Fathom, Fireflies, Grain, Slack, Google Workspace, Trello, manual paste, and MCP.

- [ ] **Step 1: Write the failing test**

Create `src/app/integrations/page.test.tsx`:

```tsx
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import IntegrationsPage from "@/app/integrations/page";

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...props }: any) => React.createElement("a", { href, ...props }, children),
}));

jest.mock("@/components/ui/logo", () => ({
  Logo: () => React.createElement("span", null, "logo"),
}));

describe("integrations page", () => {
  it("lists the supported meeting and workflow integrations", () => {
    const html = renderToStaticMarkup(React.createElement(IntegrationsPage));

    expect(html).toContain("Fathom");
    expect(html).toContain("Fireflies");
    expect(html).toContain("Grain");
    expect(html).toContain("Slack");
    expect(html).toContain("Google Workspace");
    expect(html).toContain("Trello");
    expect(html).toContain("MCP");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/app/integrations/page.test.tsx --runInBand`

Expected: FAIL because the route does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `src/app/integrations/page.tsx`:

```tsx
import type { Metadata } from "next";
import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { MarketingSection } from "@/components/landing/MarketingSection";
import { integrationCards } from "@/components/landing/marketing-content";

export const metadata: Metadata = {
  title: "Integrations | TaskwiseAI",
  description:
    "Connect Fathom, Fireflies, Grain, Slack, Google Workspace, Trello, and MCP-powered operator workflows.",
};

export default function IntegrationsPage() {
  return (
    <MarketingPageShell>
      {/* provider cards and platform layer explanation */}
    </MarketingPageShell>
  );
}
```

The page should:

- Present Fathom, Fireflies, and Grain as equal note-taker options
- Explain Slack as the follow-through channel for reminders and updates
- Present Google Workspace and Trello as workflow surfaces
- Make MCP feel like the advanced operator layer, not a casual end-user integration

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/app/integrations/page.test.tsx --runInBand`

Expected: PASS with the integrations page showing the full integration story.

- [ ] **Step 5: Commit**

```bash
git add src/app/integrations/page.tsx src/app/integrations/page.test.tsx
git commit -m "feat: add integrations page"
```

### Task 5: Add the public `/mcp` page

**Files:**
- Create: `src/app/mcp/page.tsx`
- Create: `src/app/mcp/page.test.tsx`

**Interfaces:**
- Consumes: `MarketingPageShell`, `MarketingSection`, and the existing technical MCP docs page for cross-linking.
- Produces: a public-facing MCP landing page that explains workspace-scoped keys, read/write tools, auditability, and safe operator use.

- [ ] **Step 1: Write the failing test**

Create `src/app/mcp/page.test.tsx`:

```tsx
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import McpPage from "@/app/mcp/page";

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...props }: any) => React.createElement("a", { href, ...props }, children),
}));

jest.mock("@/components/ui/logo", () => ({
  Logo: () => React.createElement("span", null, "logo"),
}));

describe("mcp page", () => {
  it("explains the operator layer in plain language", () => {
    const html = renderToStaticMarkup(React.createElement(McpPage));

    expect(html).toContain("workspace-scoped");
    expect(html).toContain("read tools");
    expect(html).toContain("write tools");
    expect(html).toContain("audit");
    expect(html).toContain("keys");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/app/mcp/page.test.tsx --runInBand`

Expected: FAIL because the route does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `src/app/mcp/page.tsx`:

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { MarketingSection } from "@/components/landing/MarketingSection";

export const metadata: Metadata = {
  title: "MCP | TaskwiseAI",
  description:
    "Learn how TaskwiseAI exposes workspace-scoped MCP read and write tools with auditability and key management.",
};

export default function McpPage() {
  return (
    <MarketingPageShell>
      {/* public MCP explainer, read/write split, auth, audit, and cross-link to /docs/mcp */}
    </MarketingPageShell>
  );
}
```

The page should:

- Explain MCP in plain English
- Show the read/write split
- Emphasize workspace scoping and auditability
- Link to the technical docs page at `/docs/mcp`

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/app/mcp/page.test.tsx --runInBand`

Expected: PASS with the MCP page clearly positioning the operator surface.

- [ ] **Step 5: Commit**

```bash
git add src/app/mcp/page.tsx src/app/mcp/page.test.tsx
git commit -m "feat: add mcp landing page"
```

### Task 6: Final metadata, cross-links, and verification

**Files:**
- Modify: `src/app/layout.tsx`
- Modify: `src/app/page.tsx` only if any final nav/footer links or metadata need a small adjustment after pages land
- Modify: `src/app/docs/page.tsx` only if a lightweight cross-link to the public marketing pages improves discoverability
- Modify: `src/app/docs/mcp/page.tsx` only if a lightweight cross-link back to `/mcp` is helpful
- Create: `src/app/layout.test.ts`

**Interfaces:**
- Consumes: the new public pages and the shell/content helpers.
- Produces: consistent site metadata and discoverable links from the public surface to the detailed docs.

- [ ] **Step 1: Write the failing verification**

Create `src/app/layout.test.ts`:

```ts
import { metadata } from "@/app/layout";

describe("root metadata", () => {
  it("describes Taskwise as a meeting execution platform", () => {
    expect(metadata.title).toBe("TaskwiseAI | Autonomous Meeting Execution");
    expect(metadata.description).toContain("reviewed tasks");
    expect(metadata.openGraph?.title).toBe("TaskwiseAI | Autonomous Meeting Execution");
    expect(metadata.twitter?.card).toBe("summary_large_image");
  });
});
```

Then run the page and layout tests together:

Run: `npx jest src/app/layout.test.ts src/app/page.test.tsx src/app/features/page.test.tsx src/app/integrations/page.test.tsx src/app/mcp/page.test.tsx --runInBand`

Expected: FAIL until the new pages are wired and the root metadata has been refreshed.

- [ ] **Step 2: Run the test to confirm the expected failure**

Expected failure should point to the outdated root metadata strings or an unwired page.

- [ ] **Step 3: Write the final polish changes**

Make the smallest final edits needed to:

- Ensure the root metadata in `src/app/layout.tsx` matches the public brand story
- Ensure the homepage nav links point to the new feature pages
- Add any cross-links between public marketing and technical docs that improve discoverability without clutter

Use the final metadata shape as:

```ts
export const metadata: Metadata = {
  title: "TaskwiseAI | Autonomous Meeting Execution",
  description:
    "Turn meetings into reviewed tasks, prioritized plans, reminders, and operator-ready workflows.",
  metadataBase: new URL("https://www.taskwise.ai"),
  openGraph: {
    title: "TaskwiseAI | Autonomous Meeting Execution",
    description:
      "Turn meetings into reviewed tasks, prioritized plans, reminders, and operator-ready workflows.",
    url: "https://www.taskwise.ai",
    siteName: "TaskwiseAI",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "TaskwiseAI | Autonomous Meeting Execution",
    description:
      "Turn meetings into reviewed tasks, prioritized plans, reminders, and operator-ready workflows.",
  },
};
```

- [ ] **Step 4: Run the verification commands**

Run:

```bash
npx jest src/app/layout.test.ts src/app/page.test.tsx src/app/features/page.test.tsx src/app/integrations/page.test.tsx src/app/mcp/page.test.tsx --runInBand
npm run lint
npm run typecheck
```

Expected:

- All four page tests pass
- ESLint exits with 0 errors
- TypeScript exits cleanly

- [ ] **Step 5: Commit**

```bash
git add src/app/layout.tsx src/app/page.tsx src/app/features/page.tsx src/app/integrations/page.tsx src/app/mcp/page.tsx src/app/docs/page.tsx src/app/docs/mcp/page.tsx
git commit -m "feat: ship marketing refresh"
```
