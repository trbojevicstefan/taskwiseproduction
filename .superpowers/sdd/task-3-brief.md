# Task 3: Add the public `/features` page

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
