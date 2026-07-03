import type {
  MarketingCard,
  MarketingFlowStep,
  MarketingNavItem,
} from "@/components/landing/marketing-types";

export const marketingNavItems: MarketingNavItem[] = [
  { label: "Home", href: "/" },
  { label: "Features", href: "/features" },
  { label: "Integrations", href: "/integrations" },
  { label: "MCP", href: "/mcp" },
  { label: "Get started", href: "/signup" },
];

export const productFlowSteps: MarketingFlowStep[] = [
  { title: "Capture", description: "Bring in Fathom, Fireflies, Grain, or pasted notes." },
  { title: "Understand", description: "Ask grounded questions over meetings, tasks, and people." },
  { title: "Review", description: "Clean up noisy tasks, approve the good ones, and set ownership." },
  { title: "Execute", description: "Plan the week, prioritize work, and keep follow-through alive." },
];

export const integrationCards: MarketingCard[] = [
  {
    name: "Fathom",
    title: "Primary meeting sync",
    description: "Ingest meeting transcripts and notes from the existing Fathom flow.",
  },
  {
    name: "Fireflies",
    title: "Note-taker ingest",
    description: "Pull transcript-driven meetings from Fireflies through the provider abstraction.",
  },
  {
    name: "Grain",
    title: "Transcript ingest",
    description: "Sync Grain recordings and transcripts into the same workflow.",
  },
  {
    name: "Slack",
    title: "Scheduled reminders",
    description: "Keep task follow-through alive with persistent reminders and pings.",
  },
  {
    name: "Google Workspace",
    title: "Calendar and task flows",
    description: "Support calendar-linked workflows and planning surfaces.",
  },
  {
    name: "Trello",
    title: "Disabled integration",
    description: "Trello appears in the platform story, but the live integration is currently disabled.",
  },
  {
    name: "Manual paste",
    title: "Fast start",
    description: "Start from pasted notes or transcript text when no integration is connected.",
  },
  {
    name: "MCP",
    title: "Operator surface",
    description: "Expose workspace-scoped read/write tools for advanced automation.",
  },
];
