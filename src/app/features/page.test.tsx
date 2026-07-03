import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import FeaturesPage from "@/app/features/page";

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...props }: any) =>
    React.createElement("a", { href, ...props }, children),
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
    expect(html).toContain('href="/signup"');
    expect(html).toContain('href="/"');
  });
});
