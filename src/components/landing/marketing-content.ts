import {
  ArrowRight,
  Bot,
  CalendarCheck,
  CheckCircle2,
  Database,
  FileText,
  Filter,
  Globe,
  KeyRound,
  Link2,
  MessageSquare,
  PanelLeftClose,
  Sparkles,
  Workflow,
  Zap,
} from "lucide-react";

import type { MarketingCard, MarketingNavItem, MarketingStep } from "./marketing-types";

export const marketingNavItems: MarketingNavItem[] = [
  { href: "/", label: "Home" },
  { href: "/features", label: "Features" },
  { href: "/integrations", label: "Integrations" },
  { href: "/mcp", label: "MCP" },
  { href: "/signup", label: "Get started" },
];

export const productFlowSteps: MarketingStep[] = [
  {
    eyebrow: "Capture",
    title: "Bring in the meeting signal",
    description: "Sync Fathom, Fireflies, and Grain recordings, or paste notes directly when the meeting already happened.",
  },
  {
    eyebrow: "Understand",
    title: "Let AI structure the work",
    description: "Taskwise groups action items, drafts owners and due dates, and grounds answers in the people, meetings, and tasks you already have.",
  },
  {
    eyebrow: "Review",
    title: "Clean up before the board",
    description: "Suggested tasks flow through cleanup, prioritization, and human approval so the board stays trusted.",
  },
  {
    eyebrow: "Execute",
    title: "Keep work moving",
    description: "Plan the week, route reminders to Slack, and keep task and meeting context tied together.",
  },
];

export const capabilityCards: MarketingCard[] = [
  {
    icon: MessageSquare,
    title: "AI chat",
    description: "Ask questions about meetings, tasks, and clients with responses grounded in workspace data.",
  },
  {
    icon: PanelLeftClose,
    title: "AI task cleanup",
    description: "Filter vanity, stale, and duplicate suggestions before they reach the board.",
  },
  {
    icon: Sparkles,
    title: "Deterministic prioritization",
    description: "Transparent scoring highlights what needs attention first without hiding the reasons.",
  },
  {
    icon: Workflow,
    title: "Planning workspace",
    description: "Turn open work into a triaged plan for today, this week, blocked items, and ownership gaps.",
  },
  {
    icon: CalendarCheck,
    title: "Calendar and people/client views",
    description: "See upcoming meetings, overdue follow-ups, and team/client relationships in one place.",
  },
  {
    icon: Zap,
    title: "Slack reminders",
    description: "Schedule stateful reminders that keep reviewed work visible at the right time.",
  },
];

export const integrationCards: MarketingCard[] = [
  {
    icon: Bot,
    title: "Fathom",
    description: "Legacy and current meeting sync paths keep working while the ingestion pipeline stays shared.",
    badge: "Live",
  },
  {
    icon: ArrowRight,
    title: "Fireflies",
    description: "Webhook-driven ingest with transcript fetch on event, HMAC verification, and synced meeting data.",
    badge: "Live",
  },
  {
    icon: FileText,
    title: "Grain",
    description: "Provider sync with list/get pagination, transcript parsing, and secret-verified webhook handling.",
    badge: "Live",
  },
  {
    icon: Link2,
    title: "Slack",
    description: "Share work, sync users, and deliver scheduled reminders from the workspace settings layer.",
    badge: "Live",
  },
  {
    icon: Globe,
    title: "Google Workspace",
    description: "Calendar data and account-linked flows keep the planning view tied to real scheduling context.",
    badge: "Live",
  },
  {
    icon: Filter,
    title: "Manual paste",
    description: "Drop in transcript text or meeting notes without waiting for an integration hookup.",
    badge: "Live",
  },
  {
    icon: Database,
    title: "Board sync",
    description: "Reviewed tasks flow into the board and remain linked to the source conversation.",
    badge: "Live",
  },
  {
    icon: CheckCircle2,
    title: "Trello",
    description: "Trello appears in the platform story, but the live integration is currently disabled.",
    badge: "Disabled",
  },
];

export const operatorCards: MarketingCard[] = [
  {
    icon: KeyRound,
    title: "MCP API keys",
    description: "Create scoped keys for operator workflows and keep access separated from end-user actions.",
  },
  {
    icon: Workflow,
    title: "Workflow replay",
    description: "Replay deliveries and inspect the steps that moved a workflow forward or failed.",
  },
  {
    icon: Sparkles,
    title: "Audit logs",
    description: "Review what happened, who triggered it, and how the workspace state changed.",
  },
];
