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
  it("shows the current meeting sources, provider caveats, and MCP control surface", () => {
    const html = renderToStaticMarkup(React.createElement(IntegrationsPage));

    expect(html).toContain("Fathom");
    expect(html).toContain("primary meeting source");
    expect(html).toContain("Fireflies");
    expect(html).toContain("Grain");
    expect(html).toContain("tl;dv");
    expect(html).toContain("Otter.ai");
    expect(html).toContain("Enterprise API");
    expect(html).toContain("MeetGeek");
    expect(html).toContain("signed webhook");
    expect(html).toContain("Read AI");
    expect(html).toContain("Webhook-first");
    expect(html).toContain("Slack");
    expect(html).toContain("Google Workspace");
    expect(html).toContain("Manual paste");
    expect(html).toContain("Trello");
    expect(html).toContain("MCP stays on its");
    expect(html).toContain("own control surface");
    expect(html).toContain('href="/mcp"');
    expect(html).toContain('href="/signup"');
    expect(html).toContain('href="/use-cases"');
  });

  it("has search-focused metadata for the expanded meeting integration set", () => {
    expect(metadata.title).toContain("AI Meeting Integrations");
    expect(metadata.description).toContain("Fathom");
    expect(metadata.description).toContain("tl;dv");
    expect(metadata.description).toContain("Read AI");
  });
});