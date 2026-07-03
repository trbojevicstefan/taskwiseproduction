# Task 1: Build shared marketing scaffolding

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
import type {
  MarketingCard,
  MarketingFlowStep,
  MarketingNavItem,
} from "@/components/landing/marketing-types";

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
  {
    name: "Fathom",
    title: "Primary meeting sync",
    description: "Ingest meeting transcripts and notes from the existing Fathom flow.",
  },
  {
    name: "Fireflies",
    title: "Note-taker ingest",
    description: "Pull transcript-driven meetings from Fireflies through the provider abstraction.",
  },
  {
    name: "Grain",
    title: "Transcript ingest",
    description: "Sync Grain recordings and transcripts into the same workflow.",
  },
  {
    name: "Slack",
    title: "Scheduled reminders",
    description: "Keep task follow-through alive with persistent reminders and pings.",
  },
  {
    name: "Google Workspace",
    title: "Calendar and task flows",
    description: "Support calendar-linked workflows and planning surfaces.",
  },
  {
    name: "Trello",
    title: "Export and delivery",
    description: "Push or export work into external task boards.",
  },
  {
    name: "Manual paste",
    title: "Fast start",
    description: "Start from pasted notes or transcript text when no integration is connected.",
  },
  {
    name: "MCP",
    title: "Operator surface",
    description: "Expose workspace-scoped read/write tools for advanced automation.",
  },
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
        <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          {title}
        </h2>
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
              <Button
                variant="secondary"
                className="hidden sm:inline-flex bg-white/10 text-white hover:bg-white/20"
                asChild
              >
                <Link href="/login" prefetch={false}>
                  Sign in
                </Link>
              </Button>
              <Button className="gem-button bg-gradient-to-r from-[#FF4D4D] via-[#FF9900] to-[#FF2E97] text-white" asChild>
                <Link href="/signup" prefetch={false}>
                  Get started
                </Link>
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
