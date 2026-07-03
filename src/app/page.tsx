import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  MessagesSquare,
  NotebookPen,
  Settings2,
  ShieldCheck,
  Sparkles,
  Wand2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BrandIcon } from "@/components/landing/BrandIcon";
import { MainBranchHero } from "@/components/landing/MainBranchHero";
import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { MarketingSection } from "@/components/landing/MarketingSection";
import TaskwiseGsapSection from "@/components/landing/TaskwiseGsapSection";
import { integrationCards, productFlowSteps } from "@/components/landing/marketing-content";

export const metadata: Metadata = {
  title: "TaskwiseAI | Meetings to execution",
  description:
    "Turn meetings, notes, and recordings into reviewed tasks, priority, reminders, and MCP-ready workflows.",
};

const capabilityCards = [
  {
    icon: MessagesSquare,
    title: "Source-grounded AI chat",
    body: "Ask questions over meetings, tasks, people, and clients with answers grounded in workspace sources instead of generic summaries.",
  },
  {
    icon: Wand2,
    title: "AI task cleanup",
    body: "Clean up noisy task drafts, remove duplicates, and turn messy output into reviewed work the team can trust.",
  },
  {
    icon: CheckCircle2,
    title: "Deterministic prioritization",
    body: "Use deterministic prioritization so the board stays stable and execution decisions stay explainable.",
  },
  {
    icon: NotebookPen,
    title: "Planning workspace",
    body: "Use the planning workspace to organize reviewed work into the next steps your team can actually ship.",
  },
  {
    icon: CalendarDays,
    title: "Calendar, people, and clients",
    body: "Move between calendar context, people surfaces, and client views without leaving the execution loop.",
  },
  {
    icon: Sparkles,
    title: "Slack reminders",
    body: "Keep follow-through alive with Slack reminders that keep reviewed work visible after the meeting ends.",
  },
];

const operatorCards = [
  {
    icon: ShieldCheck,
    title: "MCP keys",
    body: "Issue and manage workspace-scoped MCP keys for approved operator workflows.",
  },
  {
    icon: NotebookPen,
    title: "Audit logs",
    body: "Track operator activity with audit logs that make advanced access easier to review.",
  },
  {
    icon: ArrowRight,
    title: "Workflow replay / delivery",
    body: "Use workflow replay and workflow delivery when you need reliable automation over repeated meeting work.",
  },
  {
    icon: Settings2,
    title: "Advanced settings",
    body: "Expose the controls advanced teams need without cluttering the main execution experience.",
  },
];

export default function HomePage() {
  return (
    <MarketingPageShell>
      <MainBranchHero />

      <MarketingSection
        id="signal"
        title={
          <>
            Shared understanding. <span className="text-white/90">Faster execution.</span>
          </>
        }
        subtitle="A tighter public story, with Taskwise bringing meetings, tasks, and reminders into one execution surface."
      >
        <div className="grid gap-4 md:grid-cols-3">
          {[
            {
              title: "Capture the meeting",
              text: "Pull in transcripts, notes, and recordings from the tools your team already uses.",
            },
            {
              title: "Shape the work",
              text: "Clean up draft tasks, score what matters, and surface the next move with context.",
            },
            {
              title: "Keep it moving",
              text: "Plan the week, route reminders to Slack, and keep the work from stalling out.",
            },
          ].map((item, index) => (
            <div
              key={item.title}
              className="rounded-[1.5rem] border border-white/10 bg-gradient-to-br from-white/[0.05] via-white/[0.03] to-white/[0.02] p-6 shadow-lg shadow-black/20"
            >
              <p className="text-xs uppercase tracking-[0.22em] text-white/45">0{index + 1}</p>
              <h3 className="mt-3 text-xl font-medium text-white">{item.title}</h3>
              <p className="mt-3 text-sm leading-7 text-white/68">{item.text}</p>
            </div>
          ))}
        </div>
      </MarketingSection>

      <TaskwiseGsapSection />

      <MarketingSection
        id="flow"
        title={
          <>
            The four-step <span className="text-white/90">meeting-to-execution flow</span>
          </>
        }
        subtitle="Taskwise keeps the public story simple: capture work, understand it, review it, then execute without losing the source context."
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {productFlowSteps.map((step, index) => (
            <div
              key={step.title}
              className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-lg shadow-black/20"
            >
              <div className="mb-4 flex items-center justify-between">
                <span className="text-xs uppercase tracking-[0.18em] text-white/45">Step {index + 1}</span>
                <span className="text-sm text-white/50">{step.title}</span>
              </div>
              <h3 className="text-lg font-medium text-white">{step.title}</h3>
              <p className="mt-2 text-sm leading-6 text-white/68">{step.description}</p>
            </div>
          ))}
        </div>
      </MarketingSection>

      <MarketingSection
        id="features"
        title={
          <>
            Core capabilities for <span className="text-white/90">reviewed execution</span>
          </>
        }
        subtitle="These are the surfaces the homepage should advertise: grounded chat, cleanup, prioritization, planning, calendar context, and reminder follow-through."
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {capabilityCards.map((card) => {
            const Icon = card.icon;

            return (
              <div
                key={card.title}
                className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-lg shadow-black/20"
              >
                <div className="mb-4 inline-flex rounded-xl border border-white/10 bg-white/10 p-3 text-white">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-medium text-white">{card.title}</h3>
                <p className="mt-2 text-sm leading-6 text-white/68">{card.body}</p>
              </div>
            );
          })}
        </div>
      </MarketingSection>

      <MarketingSection
        id="integrations"
        title={
          <>
            Integrations that match <span className="text-white/90">how people already work</span>
          </>
        }
        subtitle="The launch page should name the real sources and surfaces, while clearly marking Trello as disabled / not live yet."
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {integrationCards.map((card) => (
            <div
              key={card.name}
              className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-lg shadow-black/20"
            >
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="space-y-3">
                  <BrandIcon src={card.iconSrc} alt={card.iconAlt} />
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-white/45">{card.name}</p>
                    <h3 className="mt-2 text-lg font-medium text-white">{card.title}</h3>
                  </div>
                </div>
                <Badge
                  className={
                    card.isDisabled
                      ? "border-white/10 bg-white/10 text-white/80"
                      : "border-emerald-500/20 bg-emerald-500/10 text-emerald-100"
                  }
                >
                  {card.isDisabled ? "Currently disabled" : "Live"}
                </Badge>
              </div>
              <p className="text-sm leading-6 text-white/68">
                {card.isDisabled ? "Trello is currently disabled and not live yet." : card.description}
              </p>
            </div>
          ))}
        </div>
      </MarketingSection>

      <MarketingSection
        id="mcp"
        title={
          <>
            Operator layer with <span className="text-white/90">safe advanced controls</span>
          </>
        }
        subtitle="MCP is part of the public platform story, but it should read like an operator surface, not a consumer feature."
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {operatorCards.map((card) => {
            const Icon = card.icon;

            return (
              <div
                key={card.title}
                className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-lg shadow-black/20"
              >
                <div className="mb-4 inline-flex rounded-xl border border-white/10 bg-white/10 p-3 text-white">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-medium text-white">{card.title}</h3>
                <p className="mt-2 text-sm leading-6 text-white/68">{card.body}</p>
              </div>
            );
          })}
        </div>
      </MarketingSection>

      <MarketingSection
        id="cta"
        title="Ready to turn meetings into reviewed work?"
        subtitle="Start with the launch flow, explore the platform surfaces, or go deeper into MCP and integrations."
      >
        <div className="rounded-[2rem] border border-white/10 bg-gradient-to-br from-white/10 via-white/[0.06] to-white/[0.03] p-6 shadow-2xl shadow-black/30 sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl space-y-3">
              <p className="text-xs uppercase tracking-[0.22em] text-white/45">Launch CTA</p>
              <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                Explore the product surfaces, integrations, and operator layer in one place.
              </h2>
              <p className="text-base leading-7 text-white/68">
                Taskwise gives teams one place to capture work, clean it up, prioritize it, and keep
                it moving with reminders and operator-grade controls.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button
                size="lg"
                className="gem-button bg-gradient-to-r from-[#FF4D4D] via-[#FF9900] to-[#FF2E97] text-white"
                asChild
              >
                <Link href="/signup">Get started</Link>
              </Button>
              <Button
                size="lg"
                variant="secondary"
                className="border border-white/10 bg-white/10 text-white hover:bg-white/20"
                asChild
              >
                <Link href="/features">Features</Link>
              </Button>
              <Button
                size="lg"
                variant="secondary"
                className="border border-white/10 bg-white/10 text-white hover:bg-white/20"
                asChild
              >
                <Link href="/integrations">Integrations</Link>
              </Button>
              <Button
                size="lg"
                variant="secondary"
                className="border border-white/10 bg-white/10 text-white hover:bg-white/20"
                asChild
              >
                <Link href="/mcp">MCP</Link>
              </Button>
            </div>
          </div>
        </div>
      </MarketingSection>
    </MarketingPageShell>
  );
}
