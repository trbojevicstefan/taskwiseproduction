import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import IntegrationsPage, { metadata } from "@/app/integrations/page";

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
  it("shows Fathom as the primary meeting source and links to MCP", () => {
    const html = renderToStaticMarkup(React.createElement(IntegrationsPage));

    expect(html).toContain("Fathom");
    expect(html).toContain("primary meeting source");
    expect(html).toContain("Fireflies");
    expect(html).toContain("Grain");
    expect(html).toContain("Slack");
    expect(html).toContain("Google Workspace");
    expect(html).toContain("Manual paste");
    expect(html).toContain("Trello");
    expect(html).toContain("MCP stays on its");
    expect(html).toContain("own page");
    expect(html).toContain('href="/mcp"');
    expect(html).toContain('href="/signup"');
  });

  it("has search-focused metadata for meeting workflow integrations", () => {
    expect(metadata.title).toContain("AI Meeting Integrations");
    expect(metadata.description).toContain("Fathom");
    expect(metadata.description).toContain("meeting");
  });
});