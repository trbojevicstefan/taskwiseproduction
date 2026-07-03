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
  { label: "Docs", href: "/docs" },
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
    iconSrc: "/brand-logos/fathom-official.png",
    iconAlt: "Fathom logo",
  },
  {
    name: "Fireflies",
    title: "Note-taker ingest",
    description: "Pull transcript-driven meetings from Fireflies through the provider abstraction.",
    iconSrc: "/brand-logos/fireflies.png",
    iconAlt: "Fireflies logo",
  },
  {
    name: "Grain",
    title: "Transcript ingest",
    description: "Sync Grain recordings and transcripts into the same workflow.",
    iconSrc: "/brand-logos/grain.png",
    iconAlt: "Grain logo",
  },
  {
    name: "Slack",
    title: "Scheduled reminders",
    description: "Keep task follow-through alive with persistent reminders and pings.",
    iconSrc: "/brand-logos/slack-favicon.png",
    iconAlt: "Slack logo",
  },
  {
    name: "Google Workspace",
    title: "Calendar and task flows",
    description: "Support calendar-linked workflows and planning surfaces.",
    iconSrc: "/brand-logos/google-favicon.ico",
    iconAlt: "Google logo",
  },
  {
    name: "Trello",
    title: "Board sync",
    description: "Trello appears in the platform story as an active board sync option.",
    iconSrc: "/brand-logos/trello.svg",
    iconAlt: "Trello logo",
  },
  {
    name: "Manual paste",
    title: "Fast start",
    description: "Start from pasted notes or transcript text when no integration is connected.",
    iconSrc: "/brand-logos/manual-paste.svg",
    iconAlt: "Document icon",
  },
  {
    name: "MCP",
    title: "Operator surface",
    description: "Expose workspace-scoped read/write tools for advanced automation.",
    iconSrc: "/brand-logos/mcp.svg",
    iconAlt: "MCP icon",
  },
];
