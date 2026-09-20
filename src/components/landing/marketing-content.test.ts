import {
  integrationCards,
  marketingNavItems,
  productFlowSteps,
} from "@/components/landing/marketing-content";

describe("marketing content", () => {
  it("covers the current public product story", () => {
    expect(marketingNavItems.map((item) => item.href)).toEqual([
      "/",
      "/features",
      "/integrations",
      "/use-cases",
      "/mcp",
      "/docs",
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
      "tl;dv",
      "Otter.ai",
      "MeetGeek",
      "Read AI",
      "Slack",
      "Google Workspace",
      "Trello",
      "Manual paste",
      "MCP",
    ]);
  });
});
