import {
  integrationCards,
  marketingNavItems,
  productFlowSteps,
} from "@/components/landing/marketing-content";

describe("marketing content", () => {
  it("covers the new public launch story", () => {
    expect(marketingNavItems.map((item) => item.href)).toEqual([
      "/",
      "/features",
      "/integrations",
      "/mcp",
      "/docs",
      "/signup",
    ]);
    expect(productFlowSteps.map((step) => step.title)).toEqual([
      "Capture",
      "Understand",
      "Review",
      "Execute",
    ]);
    expect(integrationCards.map((card) => card.name)).toEqual([
      "Fathom",
      "Fireflies",
      "Grain",
      "Slack",
      "Google Workspace",
      "Trello",
      "Manual paste",
      "MCP",
    ]);
  });
});
