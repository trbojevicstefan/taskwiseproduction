import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import FeaturesPage from "@/app/features/page";

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...props }: any) => {
    delete props.prefetch;
    return React.createElement("a", { href, ...props }, children);
  },
}));

jest.mock("@/components/ui/logo", () => ({
  Logo: () => React.createElement("span", null, "logo"),
}));

describe("features page", () => {
  it("describes the current meeting-to-execution capabilities", () => {
    const html = renderToStaticMarkup(React.createElement(FeaturesPage));

    expect(html).toContain("Transcript chat");
    expect(html).toContain("Reviewed task extraction");
    expect(html).toContain("Swipe Sweep");
    expect(html).toContain("Explainable prioritization");
    expect(html).toContain("Automations");
    expect(html).toContain("People and Clients");
    expect(html).toContain("Calendar and planning");
    expect(html).toContain("Shareable meeting follow-up");
    expect(html).toContain("Slack follow-through");
    expect(html).toContain("MCP operator controls");
    expect(html).toContain('href="/signup"');
    expect(html).toContain('href="/use-cases/ai-meeting-notes-to-tasks"');
    expect(html).toContain('href="/integrations"');
  });
});
