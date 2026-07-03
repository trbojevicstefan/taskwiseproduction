import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  MessagesSquare,
  NotebookPen,
  Sparkles,
  Wand2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { PanoramicHero } from "@/components/landing/PanoramicHero";
import { MarketingSection } from "@/components/landing/MarketingSection";
import { productFlowSteps } from "@/components/landing/marketing-content";

export const metadata: Metadata = {
  title: "Features | TaskwiseAI",
  description:
    "Explore AI chat, cleanup tasks, prioritization, planning, calendar, people, and reminders in TaskwiseAI.",
};

const featureCards = [
  {
    icon: MessagesSquare,
    title: "AI chat",
    body:
      "Ask grounded questions over meetings, tasks, people, and clients with answers tied to workspace sources.",
  },
  {
    icon: Wand2,
    title: "task cleanup",
    body:
      "Clean up noisy drafts, remove duplicates, and turn messy outputs into reviewed work the team can trust.",
  },
  {
    icon: ArrowRight,
    title: "Deterministic prioritization",
    body:
      "Keep board ordering stable and explainable so the team can review priorities without guesswork.",
  },
  {
    icon: NotebookPen,
    title: "Planning workspace",
    body:
      "Use the planning workspace to turn reviewed work into a clear next-step plan for the team.",
  },
  {
    icon: CalendarDays,
    title: "Calendar and people/client views",
    body:
      "Move between calendar context, people surfaces, and client views without leaving the execution flow.",
  },
  {
    icon: Sparkles,
    title: "Slack reminders",
    body:
      "Keep follow-through alive with scheduled Slack reminders that keep reviewed work visible and stateful.",
  },
];

export default function FeaturesPage() {
  return (
    <MarketingPageShell>
      <PanoramicHero
        label="Product tour"
        title={
          <>
            The feature set behind <span className="text-white/90">TaskwiseAI</span>
          </>
        }
        subtitle={
          <>
            TaskwiseAI turns meetings into reviewed work with grounded AI chat, cleanup,
            deterministic prioritization, planning, calendar context, people and client views, and
            Slack reminders that keep execution moving.
          </>
        }
        primaryHref="/signup"
        primaryLabel="Get started"
        secondaryHref="/"
        secondaryLabel="Back to home"
      />

      <MarketingSection
        id="capabilities"
        title={
          <>
            Core capabilities for{" "}
            <span className="bg-gradient-to-r from-[#FFB257] via-[#FF8A3D] to-[#FF2E97] bg-clip-text text-transparent">
              reviewed execution
            </span>
          </>
        }
        subtitle={
          <span>
            These are the surfaces the public story should emphasize:{" "}
            <span className="text-white/88">chat</span>,{" "}
            <span className="text-white/88">cleanup</span>,{" "}
            <span className="text-white/88">prioritization</span>, planning, calendar context,
            people and client views, and reminders.
          </span>
        }
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
            The launch story in{" "}
            <span className="bg-gradient-to-r from-[#FF5C4D] via-[#FF9900] to-[#FFB257] bg-clip-text text-transparent">
              four steps
            </span>
          </>
        }
        subtitle={
          <span>
            This page reuses the shared launch-copy flow so the public navigation stays aligned
            with the homepage, while the{" "}
            <span className="text-white/88">execution language</span> still feels distinct.
          </span>
        }
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
            Ready to see the workflow in{" "}
            <span className="bg-gradient-to-r from-[#FFB257] via-[#FF9900] to-[#FF2E97] bg-clip-text text-transparent">
              action
            </span>
            ?
          </>
        }
        subtitle={
          <span>
            Use the launch page, explore the feature story, or move on to{" "}
            <span className="text-white/88">integrations</span> and{" "}
            <span className="text-white/88">MCP</span> when you want the deeper platform
            surfaces.
          </span>
        }
      >
        <div className="rounded-[2rem] border border-white/10 bg-gradient-to-br from-white/10 via-white/[0.06] to-white/[0.03] p-6 shadow-2xl shadow-black/30 sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl space-y-3">
              <p className="text-xs uppercase tracking-[0.22em] text-white/45">Launch CTA</p>
              <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                Start with the features page, then move into the rest of the product story.
              </h2>
              <p className="text-base leading-7 text-white/68">
                TaskwiseAI gives teams one place to capture work, clean it up, prioritize it, and
                keep it moving with reminders and operator-grade controls.
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
                <Link href="/">Home</Link>
              </Button>
            </div>
          </div>
        </div>
      </MarketingSection>
    </MarketingPageShell>
  );
}
