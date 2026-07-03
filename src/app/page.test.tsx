import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import HomePage from "@/app/page";

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...props }: any) => {
    delete props.prefetch;
    return React.createElement("a", { href, ...props }, children);
  },
}));

jest.mock("next-themes", () => ({
  useTheme: () => ({ setTheme: jest.fn() }),
}));

jest.mock("@/components/ui/logo", () => ({
  Logo: () => React.createElement("span", null, "logo"),
}));

jest.mock("@/components/landing/AnimatedTaskHero", () => ({
  __esModule: true,
  default: () => React.createElement("div", null, "hero"),
}));

jest.mock("@/components/landing/HeroParticles", () => ({
  __esModule: true,
  default: () => React.createElement("div", null, "particles"),
}));

describe("homepage", () => {
  it("showcases the new launch story and routes", () => {
    const html = renderToStaticMarkup(React.createElement(HomePage));

    expect(html).toContain("Turn meetings into");
    expect(html).toContain("prioritized, reviewed execution.");
    expect(html).toContain("Fathom");
    expect(html).toContain("Fireflies");
    expect(html).toContain("Grain");
    expect(html).toContain("AI task cleanup");
    expect(html).toContain("Deterministic prioritization");
    expect(html).toContain("Planning workspace");
    expect(html).toContain("Slack reminders");
    expect(html).toContain("MCP");
    expect(html).toContain("Audit logs");
    expect(html).toContain('href="/features"');
    expect(html).toContain('href="/integrations"');
    expect(html).toContain('href="/mcp"');
    expect(html).toContain('href="/login"');
    expect(html).toContain('href="/signup"');
  });
});
