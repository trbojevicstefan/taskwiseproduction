import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import IntegrationsPage from "@/app/integrations/page";

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

describe("integrations page", () => {
  it("shows the live integrations story and links to MCP", () => {
    const html = renderToStaticMarkup(React.createElement(IntegrationsPage));

    expect(html).toContain("Fathom");
    expect(html).toContain("Fireflies");
    expect(html).toContain("Grain");
    expect(html).toContain("Slack");
    expect(html).toContain("Google Workspace");
    expect(html).toContain("Manual paste");
    expect(html).toContain("Trello");
    expect(html).toContain("MCP stays on its own page");
    expect(html).toContain('href="/mcp"');
    expect(html).toContain('href="/signup"');
  });
});
