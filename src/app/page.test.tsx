import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import HomePage from "@/app/page";

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...props }: any) =>
    React.createElement("a", { href, ...props }, children),
}));

jest.mock("@/components/ui/logo", () => ({
  Logo: () => React.createElement("span", null, "logo"),
}));

describe("homepage marketing refresh", () => {
  it("surfaces meeting memory, reviewed execution, current providers, and operator controls", () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToStaticMarkup(React.createElement(HomePage));
    consoleError.mockRestore();

    expect(html).toContain("meeting memory");
    expect(html).toContain("reviewed execution");
    expect(html).toContain("Transcript chat");
    expect(html).toContain("Swipe Sweep");
    expect(html).toContain("Planning and automations");
    expect(html).toContain("Fathom");
    expect(html).toContain("Fireflies");
    expect(html).toContain("Grain");
    expect(html).toContain("tl;dv");
    expect(html).toContain("Otter.ai");
    expect(html).toContain("MeetGeek");
    expect(html).toContain("Read AI");
    expect(html).toContain("Scoped MCP keys");
    expect(html).toContain("Audit visibility");
    expect(html).toContain("Workflow replay and delivery");

    expect(html).toContain('href="/signup"');
    expect(html).toContain('href="/login"');
    expect(html).toContain('href="/features"');
    expect(html).toContain('href="/integrations"');
    expect(html).toContain('href="/use-cases"');
    expect(html).toContain('href="/mcp"');
  });
});
