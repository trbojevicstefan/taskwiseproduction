import type {
  MarketingCard,
  MarketingFlowStep,
  MarketingNavItem,
} from "@/components/landing/marketing-types";

export const marketingNavItems: MarketingNavItem[] = [
  { label: "Home", href: "/" },
  { label: "Features", href: "/features" },
  { label: "Integrations", href: "/integrations" },
  { label: "Use cases", href: "/use-cases" },
  { label: "MCP", href: "/mcp" },
  { label: "Docs", href: "/docs" },
];

export const productFlowSteps: MarketingFlowStep[] = [
  {
    title: "Capture",
    description: "Bring in Fathom, Fireflies, Grain, tl;dv, Otter.ai, MeetGeek, Read AI, or pasted notes.",
  },
  {
    title: "Understand",
    description: "Chat with meeting transcripts and recover decisions, commitments, people, and unresolved work.",
  },
  {
    title: "Review",
    description: "Confirm AI-proposed tasks, ownership, due dates, and evidence before they become authoritative work.",
  },
  {
    title: "Execute",
    description: "Prioritize, plan, clear backlog noise with Swipe Sweep, and automate repeatable follow-through.",
  },
];

const genericMeetingIcon = "/brand-logos/manual-paste.svg";

export const integrationCards: MarketingCard[] = [
  {
    name: "Fathom",
    title: "Primary meeting source",
    description: "Keep Fathom transcripts, decisions, and reviewed follow-up connected to execution.",
    iconSrc: "/brand-logos/fathom-official.png",
    iconAlt: "Fathom logo",
  },
  {
    name: "Fireflies",
    title: "Meeting import",
    description: "Bring Fireflies meeting context into the same searchable memory and task-review workflow.",
    iconSrc: "/brand-logos/fireflies.png",
    iconAlt: "Fireflies logo",
  },
  {
    name: "Grain",
    title: "Meeting import",
    description: "Connect Grain conversations to people, tasks, priorities, and follow-through.",
    iconSrc: "/brand-logos/grain.png",
    iconAlt: "Grain logo",
  },
  {
    name: "tl;dv",
    title: "API + meeting events",
    description: "Sync tl;dv meetings and route completed meeting events into Taskwise review.",
    iconSrc: genericMeetingIcon,
    iconAlt: "Meeting source icon",
  },
  {
    name: "Otter.ai",
    title: "Enterprise Public API",
    description: "Move eligible Otter workspace conversations and action-item context into execution.",
    iconSrc: genericMeetingIcon,
    iconAlt: "Meeting source icon",
  },
  {
    name: "MeetGeek",
    title: "API + signed webhook",
    description: "Import meetings and verify signed completion events before they enter the workflow.",
    iconSrc: genericMeetingIcon,
    iconAlt: "Meeting source icon",
  },
  {
    name: "Read AI",
    title: "Webhook-first",
    description: "Receive signed completed-meeting reports and turn their context into reviewed follow-up.",
    iconSrc: genericMeetingIcon,
    iconAlt: "Meeting source icon",
  },
  {
    name: "Slack",
    title: "Follow-through",
    description: "Keep task updates, reminders, and team follow-through close to where work happens.",
    iconSrc: "/brand-logos/slack-favicon.png",
    iconAlt: "Slack logo",
  },
  {
    name: "Google Workspace",
    title: "Calendar and planning",
    description: "Connect calendar-aware planning and meeting-driven workflows.",
    iconSrc: "/brand-logos/google-favicon.ico",
    iconAlt: "Google logo",
  },
  {
    name: "Trello",
    title: "Board sync",
    description: "Carry reviewed work into a connected board workflow when Trello is part of the stack.",
    iconSrc: "/brand-logos/trello.svg",
    iconAlt: "Trello logo",
  },
  {
    name: "Manual paste",
    title: "Fast start",
    description: "Start from pasted notes or transcript text when no meeting integration is connected.",
    iconSrc: genericMeetingIcon,
    iconAlt: "Document icon",
  },
  {
    name: "MCP",
    title: "Operator-controlled AI tools",
    description: "Expose scoped Taskwise meeting-memory and task capabilities to compatible AI clients.",
    iconSrc: "/brand-logos/mcp.svg",
    iconAlt: "MCP icon",
  },
];
