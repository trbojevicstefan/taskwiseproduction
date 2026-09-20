import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import MCPPage from "@/app/mcp/page";

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

describe("mcp page", () => {
  it("explains scoped operator access and guardrails", () => {
    const html = renderToStaticMarkup(React.createElement(MCPPage));

    expect(html).toContain("MCP");
    expect(html).toContain("Scoped MCP keys");
    expect(html).toContain("Audit visibility");
    expect(html).toContain("Workflow replay");
    expect(html).toContain("Operator controls");
    expect(html).toContain("compatible AI clients");
    expect(html).toContain('href="/signup"');
    expect(html).toContain('href="/integrations"');
    expect(html).toContain('href="/use-cases/mcp-for-meeting-memory"');
  });
});
