import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import DashboardHeader from "@/components/dashboard/DashboardHeader";

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...props }: any) =>
    React.createElement("a", { href, ...props }, children),
}));

jest.mock("@/components/dashboard/HeaderNav", () => ({
  __esModule: true,
  default: () => React.createElement("span", null, "header-nav"),
}));

jest.mock("lucide-react", () => ({ Workflow: () => React.createElement("span", null, "workflow-icon") }));

jest.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: any) => React.createElement(React.Fragment, null, children),
  Tooltip: ({ children }: any) => React.createElement(React.Fragment, null, children),
  TooltipTrigger: ({ children }: any) => React.createElement(React.Fragment, null, children),
  TooltipContent: ({ children }: any) => React.createElement("span", null, children),
}));

jest.mock("@/components/ui/button", () => ({
  Button: ({ children, asChild: _asChild, ...props }: any) => React.createElement("span", props, children),
}));

describe("DashboardHeader", () => {
  it("keeps Automations one click away from every work surface", () => {
    const html = renderToStaticMarkup(
      React.createElement(DashboardHeader, { pageTitle: React.createElement("h1", null, "Meetings") })
    );

    expect(html).toContain('href="/automations"');
    expect(html).toContain("Automations");
  });
});