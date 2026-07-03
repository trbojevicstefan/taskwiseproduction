import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { MarketingPageShell } from "@/components/landing/MarketingPageShell";

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

describe("MarketingPageShell", () => {
  it("opens docs in a new tab from the header nav", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        MarketingPageShell,
        null,
        React.createElement("div", null, "content"),
      ),
    );

    expect(html).toContain('href="/docs"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});
