import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import MCPPage from "@/app/mcp/page";

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...props }: any) =>
    React.createElement("a", { href, ...props }, children),
}));

jest.mock("@/components/ui/logo", () => ({
  Logo: () => React.createElement("span", null, "logo"),
}));

describe("mcp page", () => {
  it("explains the operator layer and guardrails", () => {
    const html = renderToStaticMarkup(React.createElement(MCPPage));

    expect(html).toContain("MCP");
    expect(html).toContain("API keys");
    expect(html).toContain("Audit logs");
    expect(html).toContain("Workflow replay");
    expect(html).toContain("deliveries");
    expect(html).toContain('href="/signup"');
    expect(html).toContain('href="/integrations"');
  });
});
