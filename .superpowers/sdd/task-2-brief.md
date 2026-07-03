# Task 2: Rebuild the homepage as a launch page

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
