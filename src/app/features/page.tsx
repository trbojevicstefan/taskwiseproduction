import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Bot,
  CalendarDays,
  ListChecks,
  MessagesSquare,
  NotebookPen,
  Share2,
  Sparkles,
  Users,
  Wand2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { PanoramicHero } from "@/components/landing/PanoramicHero";
import { MarketingSection } from "@/components/landing/MarketingSection";
import { productFlowSteps } from "@/components/landing/marketing-content";

export const metadata: Metadata = {
  title: "AI Meeting Workflow Features",
  description:
    "Explore transcript chat, reviewed task extraction, Swipe Sweep, priorities, automations, People and Clients, calendar planning, sharing, Slack follow-through, and MCP in TaskwiseAI.",
  alternates: { canonical: "/features" },
};

const featureCards = [
  {
    icon: MessagesSquare,
    title: "Transcript chat",
    body: "Ask grounded questions across captured meetings to recover decisions, commitments, owners, people, and unresolved work.",
  },
  {
    icon: ListChecks,
    title: "Reviewed task extraction",
    body: "Let AI propose meeting-derived work, then confirm evidence, ownership, scope, and timing before it becomes authoritative.",
  },
  {
    icon: Wand2,
    title: "Swipe Sweep",
    body: "Clear stale, noisy, or low-value backlog items quickly so the board keeps the work that still deserves attention.",
  },
  {
    icon: ArrowRight,
    title: "Explainable prioritization",
    body: "Keep ordering stable and reviewable instead of allowing an opaque AI score to reshuffle the team's work without context.",
  },
  {
    icon: Sparkles,
    title: "Automations",
    body: "Turn reviewed work into repeatable follow-through so routine next steps happen consistently after the meeting ends.",
  },
  {
    icon: Users,
    title: "People and Clients",
    body: "Keep the people, clients, meetings, and tasks that belong together visible as connected operating context.",
  },
  {
    icon: CalendarDays,
    title: "Calendar and planning",
    body: "Move from meeting context into a clearer weekly plan while keeping upcoming commitments and due work visible.",
  },
  {
    icon: Share2,
    title: "Shareable meeting follow-up",
    body: "Share the useful output from a meeting without forcing someone else to reconstruct decisions from the raw transcript.",
  },
  {
    icon: NotebookPen,
    title: "Slack follow-through",
    body: "Keep reviewed work visible with Slack-oriented reminders and updates closer to where the team communicates.",
  },
  {
    icon: Bot,
    title: "MCP operator controls",
    body: "Expose scoped meeting-memory and task capabilities to compatible AI clients while keeping operator-visible control in Taskwise.",
  },
];

export default function FeaturesPage() {
  return (
    <MarketingPageShell>
      <PanoramicHero
        label="Product tour"
        title={
          <>
            From meeting memory to <span className="text-white/90">reviewed execution</span>
          </>
        }
        subtitle={
          <>
            TaskwiseAI keeps transcript context, task review, people, priorities, planning, cleanup,
            sharing, automations, and follow-through in one connected workflow.
          </>
        }
        primaryHref="/signup"
        primaryLabel="Get started"
        secondaryHref="/use-cases/ai-meeting-notes-to-tasks"
        secondaryLabel="See the workflow"
      />

      <MarketingSection
        id="capabilities"
        title={
          <>
            Built for the work that happens{" "}
            <span className="bg-gradient-to-r from-[#FFB257] via-[#FF8A3D] to-[#FF2E97] bg-clip-text text-transparent">
              after the meeting
            </span>
          </>
        }
        subtitle="Search what happened, review what needs doing, organize what matters, and keep follow-through connected to its source context."
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {featureCards.map((card) => {
            const Icon = card.icon;

            return (
              <div
                key={card.title}
                className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-lg shadow-black/20"
              >
                <div className="mb-4 inline-flex rounded-xl border border-white/10 bg-white/10 p-3 text-white">
                  <Icon className="h-5 w-5" />
                </div>
                <h2 className="text-lg font-medium text-white">{card.title}</h2>
                <p className="mt-2 text-sm leading-6 text-white/68">{card.body}</p>
              </div>
            );
          })}
        </div>
      </MarketingSection>

      <MarketingSection
        id="flow"
        title={
          <>
            One operating loop from{" "}
            <span className="bg-gradient-to-r from-[#FF5C4D] via-[#FF9900] to-[#FFB257] bg-clip-text text-transparent">
              capture to follow-through
            </span>
          </>
        }
        subtitle="The same review-first workflow works across supported meeting sources, so downstream execution stays consistent even when teams use different recorders."
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
        id="cta"
        title={
          <>
            Keep the context. Move the{" "}
            <span className="bg-gradient-to-r from-[#FFB257] via-[#FF9900] to-[#FF2E97] bg-clip-text text-transparent">
              work
            </span>
            .
          </>
        }
        subtitle="Explore supported meeting sources or start with a concrete workflow for turning meeting notes into reviewed tasks."
      >
        <div className="rounded-[2rem] border border-white/10 bg-gradient-to-br from-white/10 via-white/[0.06] to-white/[0.03] p-6 shadow-2xl shadow-black/30 sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl space-y-3">
              <p className="text-xs uppercase tracking-[0.22em] text-white/45">Meeting to execution</p>
              <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                Make the meeting useful after everyone closes the call.
              </h2>
              <p className="text-base leading-7 text-white/68">
                TaskwiseAI connects meeting memory to reviewed tasks, ownership, planning, cleanup,
                automations, and team follow-through.
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
                <Link href="/integrations">Meeting sources</Link>
              </Button>
            </div>
          </div>
        </div>
      </MarketingSection>
    </MarketingPageShell>
  );
}
