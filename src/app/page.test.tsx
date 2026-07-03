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
  it("surfaces the new launch story and section coverage", () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToStaticMarkup(React.createElement(HomePage));
    consoleError.mockRestore();

    expect(html).toContain("Turn meetings into");
    expect(html).toContain("prioritized, reviewed execution");
    expect(html).toContain("Fathom");
    expect(html).toContain("Fireflies");
    expect(html).toContain("Grain");
    expect(html).toContain("AI that ingests your meetings");
    expect(html).toContain("deterministic prioritization");
    expect(html).toContain("Review-first workflow");
    expect(html).toContain("MCP operator layer");
    expect(html).toContain("MCP keys");
    expect(html).toContain("audit logs");
    expect(html).toContain("workflow replay");
    expect(html).toContain("workflow delivery");
    expect(html).toContain("Board sync");
    expect(html).toContain("Trello");

    expect(html).toContain('href="/signup"');
    expect(html).toContain('href="/login"');
    expect(html).toContain('href="/features"');
    expect(html).toContain('href="/integrations"');
    expect(html).toContain('href="/mcp"');
  });
});
