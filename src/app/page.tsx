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
import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { MarketingSection } from "@/components/landing/MarketingSection";
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
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_420px_at_15%_15%,rgba(255,120,80,0.20),transparent_60%),radial-gradient(820px_380px_at_85%_20%,rgba(255,170,60,0.18),transparent_60%),linear-gradient(180deg,rgba(255,255,255,0.03),transparent_30%)]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/10" />

        <div className="relative mx-auto grid w-full max-w-7xl gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:px-8 lg:py-24">
          <div className="space-y-8">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="border-white/10 bg-white/10 text-white/90">Launch page</Badge>
              <Badge className="border-white/10 bg-white/5 text-white/70">Meetings in, reviewed work out</Badge>
            </div>

            <div className="space-y-5">
              <h1 className="max-w-4xl text-4xl font-semibold leading-[1.02] tracking-tight text-white sm:text-5xl lg:text-6xl">
                Turn meetings into prioritized, reviewed execution.
              </h1>
              <p className="max-w-3xl text-base leading-7 text-white/72 sm:text-lg">
                Bring in Fathom, Fireflies, Grain, or pasted notes. Use AI chat over the
                source material, clean up noisy tasks, prioritize the next steps, plan
                the work, and keep reminders moving in Slack.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                size="lg"
                className="gem-button bg-gradient-to-r from-[#FF4D4D] via-[#FF9900] to-[#FF2E97] text-white"
                asChild
              >
                <Link href="/signup">
                  Get started
                </Link>
              </Button>
              <Button
                size="lg"
                variant="secondary"
                className="border border-white/10 bg-white/10 text-white hover:bg-white/20"
                asChild
              >
                <Link href="#flow">
                  See how it works
                </Link>
              </Button>
              <Link href="/login" className="text-sm font-medium text-white/65 transition hover:text-white">
                Sign in
              </Link>
            </div>

            <div className="flex flex-wrap gap-2 text-sm text-white/65">
              {[
                "AI chat",
                "AI task cleanup",
                "Deterministic prioritization",
                "Planning workspace",
                "Slack reminders",
              ].map((item) => (
                <span
                  key={item}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5"
                >
                  {item}
                </span>
              ))}
            </div>
          </div>

          <div className="relative">
            <div className="absolute -inset-6 rounded-[2rem] bg-gradient-to-br from-[#FF4D4D]/20 via-[#FF9900]/15 to-[#FF2E97]/20 blur-3xl" />
            <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/40 backdrop-blur">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-white/45">
                    Execution surface
                  </p>
                  <p className="mt-1 text-lg font-medium text-white">Review before board</p>
                </div>
                <Badge className="border-white/10 bg-white/10 text-white/80">Live workflow</Badge>
              </div>

              <div className="space-y-3">
                <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-white">Source-grounded chat</p>
                      <p className="text-sm text-white/60">
                        Meeting, task, people, and client context
                      </p>
                    </div>
                    <div className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/70">
                      Ask Taskwise
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-white/45">
                      Cleanup
                    </p>
                    <p className="mt-2 text-sm text-white/75">
                      Remove noise and make suggested tasks review-ready.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-white/45">
                      Prioritize
                    </p>
                    <p className="mt-2 text-sm text-white/75">
                      Keep the board stable with deterministic prioritization.
                    </p>
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/10 to-white/[0.03] p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-white">Reviewed work out</p>
                    <Badge className="border-white/10 bg-white/10 text-white/75">
                      Slack reminders
                    </Badge>
                  </div>
                  <div className="mt-3 grid gap-2 text-sm text-white/70">
                    <div className="flex items-center justify-between rounded-xl bg-black/20 px-3 py-2">
                      <span>Capture</span>
                      <span>Understand</span>
                    </div>
                    <div className="flex items-center justify-between rounded-xl bg-black/20 px-3 py-2">
                      <span>Review</span>
                      <span>Execute</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

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
                <span className="text-xs uppercase tracking-[0.18em] text-white/45">
                  Step {index + 1}
                </span>
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
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-white/45">{card.name}</p>
                  <h3 className="mt-2 text-lg font-medium text-white">{card.title}</h3>
                </div>
                {card.name === "Trello" ? (
                  <Badge className="border-white/10 bg-white/10 text-white/80">
                    Currently disabled
                  </Badge>
                ) : null}
              </div>
              <p className="text-sm leading-6 text-white/68">
                {card.name === "Trello"
                  ? "Trello is currently disabled and not live yet."
                  : card.description}
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
                Taskwise gives teams one place to capture work, clean it up, prioritize it, and
                keep it moving with reminders and operator-grade controls.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button
                size="lg"
                className="gem-button bg-gradient-to-r from-[#FF4D4D] via-[#FF9900] to-[#FF2E97] text-white"
                asChild
              >
                <Link href="/signup">
                  Get started
                </Link>
              </Button>
              <Button
                size="lg"
                variant="secondary"
                className="border border-white/10 bg-white/10 text-white hover:bg-white/20"
                asChild
              >
                <Link href="/features">
                  Features
                </Link>
              </Button>
              <Button
                size="lg"
                variant="secondary"
                className="border border-white/10 bg-white/10 text-white hover:bg-white/20"
                asChild
              >
                <Link href="/integrations">
                  Integrations
                </Link>
              </Button>
              <Button
                size="lg"
                variant="secondary"
                className="border border-white/10 bg-white/10 text-white hover:bg-white/20"
                asChild
              >
                <Link href="/mcp">
                  MCP
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </MarketingSection>
    </MarketingPageShell>
  );
}
