import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BrainCircuit,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Eye,
  MessagesSquare,
  MonitorSmartphone,
  NotebookPen,
  Settings2,
  ShieldCheck,
  Sparkles,
  Wand2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { BrandIcon } from "@/components/landing/BrandIcon";
import { MainBranchHero } from "@/components/landing/MainBranchHero";
import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { MarketingSection } from "@/components/landing/MarketingSection";
import { StructuredData } from "@/components/landing/StructuredData";
import TaskwiseGsapSection from "@/components/landing/TaskwiseGsapSection";
import { integrationCards, productFlowSteps } from "@/components/landing/marketing-content";
import { PUBLIC_MARKETING_PROVIDERS, PUBLIC_SITE_URL } from "@/lib/public-marketing";

export const metadata: Metadata = {
  title: "Meeting Memory to Reviewed Execution",
  description:
    "Turn meeting transcripts into searchable memory, reviewed tasks, clear ownership, priorities, Swipe Sweep cleanup, planning, automations, and follow-through.",
  alternates: { canonical: "/" },
};

const capabilityCards = [
  {
    icon: MessagesSquare,
    title: "Transcript chat",
    body: "Ask grounded questions over captured meetings and recover decisions, commitments, people, clients, and unresolved work without rereading entire calls.",
    accent: "from-[#FF5C4D]/18 via-[#FF9900]/12 to-[#FF2E97]/18",
    iconAccent: "from-[#FF5C4D] to-[#FFB257]",
  },
  {
    icon: Wand2,
    title: "Reviewed tasks + Swipe Sweep",
    body: "Confirm meeting-derived work, then clear stale or low-value backlog items quickly so important tasks stay visible.",
    accent: "from-white/[0.07] via-[#FF9900]/10 to-white/[0.04]",
    iconAccent: "from-[#FFB257] to-[#FF5C4D]",
  },
  {
    icon: CheckCircle2,
    title: "Explainable prioritization",
    body: "Keep board ordering stable and reviewable so priority decisions do not disappear inside an opaque AI score.",
    accent: "from-[#FF9900]/16 via-white/[0.05] to-[#FF5C4D]/14",
    iconAccent: "from-[#FF9900] to-[#FF5C4D]",
  },
  {
    icon: NotebookPen,
    title: "Planning and automations",
    body: "Turn reviewed work into a practical plan, then automate the repeatable follow-through that should happen after approval.",
    accent: "from-white/[0.06] via-[#FF2E97]/10 to-white/[0.04]",
    iconAccent: "from-[#FF2E97] to-[#FF9900]",
  },
  {
    icon: CalendarDays,
    title: "Calendar, people, and clients",
    body: "Move between meeting context, calendar commitments, people, clients, and tasks without breaking the execution thread.",
    accent: "from-[#FF5C4D]/14 via-white/[0.05] to-[#FF9900]/12",
    iconAccent: "from-[#FF5C4D] to-[#FF9900]",
  },
  {
    icon: Sparkles,
    title: "Sharing and Slack follow-through",
    body: "Share the useful output from a meeting and keep reviewed work visible with team updates and reminders after the call ends.",
    accent: "from-[#FF2E97]/14 via-[#FF9900]/10 to-white/[0.04]",
    iconAccent: "from-[#FF2E97] to-[#FF5C4D]",
  },
];

const operatorCards = [
  {
    icon: ShieldCheck,
    title: "Scoped MCP keys",
    body: "Issue workspace-scoped credentials for approved AI workflows that need Taskwise meeting-memory or task context.",
    accent: "from-[#FF5C4D]/18 via-white/[0.05] to-[#FF9900]/18",
    iconAccent: "from-[#FF5C4D] to-[#FF9900]",
  },
  {
    icon: NotebookPen,
    title: "Audit visibility",
    body: "Keep advanced operator activity visible and reviewable instead of turning automation into an invisible side channel.",
    accent: "from-white/[0.05] via-[#FF2E97]/12 to-white/[0.04]",
    iconAccent: "from-[#FF2E97] to-[#FF5C4D]",
  },
  {
    icon: ArrowRight,
    title: "Workflow replay and delivery",
    body: "Inspect delivery and replay paths when repeatable meeting-driven workflows need operational traceability.",
    accent: "from-[#FF9900]/16 via-white/[0.05] to-[#FF5C4D]/16",
    iconAccent: "from-[#FF9900] to-[#FF2E97]",
  },
  {
    icon: Settings2,
    title: "Operator controls",
    body: "Keep advanced capabilities in their own control lane so the normal meeting-to-execution experience stays focused.",
    accent: "from-[#FF5C4D]/14 via-[#FF2E97]/10 to-white/[0.04]",
    iconAccent: "from-[#FF5C4D] to-[#FF2E97]",
  },
];

export default function HomePage() {
  return (
    <MarketingPageShell>
      <StructuredData
        data={[
          {
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: "TaskwiseAI",
            applicationCategory: "BusinessApplication",
            operatingSystem: "Web",
            url: PUBLIC_SITE_URL,
            description: metadata.description,
            featureList: [
              "Meeting transcript chat",
              "Reviewed task extraction",
              "Swipe Sweep backlog cleanup",
              "Task prioritization and planning",
              "Meeting workflow automations",
              "People and client context",
              "MCP operator controls",
            ],
          },
          {
            "@context": "https://schema.org",
            "@type": "WebSite",
            name: "TaskwiseAI",
            url: PUBLIC_SITE_URL,
            description: metadata.description,
          },
        ]}
      />

      <MainBranchHero />

      <MarketingSection
        id="signal"
        title={
          <>
            Shared understanding. <span className="text-white/90">Faster execution.</span>
          </>
        }
        subtitle={
          <span>
            Taskwise connects{" "}
            <span className="bg-gradient-to-r from-[#FFB257] via-[#FF8A3D] to-[#FF2E97] bg-clip-text font-medium text-transparent">
              meeting memory
            </span>{" "}
            to reviewed tasks, people, priorities, planning, and{" "}
            <span className="bg-gradient-to-r from-[#FF5C4D] via-[#FF9900] to-[#FFB257] bg-clip-text font-medium text-transparent">
              follow-through
            </span>
            .
          </span>
        }
      >
        <div className="grid gap-4 md:grid-cols-3">
          {[
            {
              icon: BrainCircuit,
              title: "Capture the conversation",
              text: "Bring transcripts and meeting context in from the recorder your team already uses.",
              accent: "from-[#FF5C4D]/18 via-[#FF9900]/10 to-white/[0.03]",
            },
            {
              icon: Eye,
              title: "Review what matters",
              text: "Ask questions, inspect proposed commitments, confirm ownership, and clear backlog noise with context.",
              accent: "from-[#FF9900]/16 via-[#FF2E97]/10 to-white/[0.03]",
            },
            {
              icon: Clock3,
              title: "Keep work moving",
              text: "Prioritize, plan, share, and automate repeatable follow-through after the team approves the work.",
              accent: "from-white/[0.06] via-[#FF5C4D]/10 to-[#FF9900]/14",
            },
          ].map((item, index) => (
            <div
              key={item.title}
              className={`rounded-[1.5rem] border border-white/10 bg-gradient-to-br ${item.accent} p-6 shadow-lg shadow-black/20 backdrop-blur-sm`}
            >
              <div className="mb-4 flex items-center justify-between">
                <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-black/20 text-white shadow-[0_10px_24px_rgba(0,0,0,0.25)]">
                  <item.icon className="h-5 w-5 text-[#FFB257]" />
                </div>
                <p className="text-xs uppercase tracking-[0.22em] text-white/45">0{index + 1}</p>
              </div>
              <h3 className="text-xl font-semibold tracking-tight text-white">{item.title}</h3>
              <p className="mt-3 text-sm leading-7 text-white/70">{item.text}</p>
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
        subtitle="Capture the conversation, understand the context, review proposed work, then execute without losing the source meeting."
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {productFlowSteps.map((step, index) => (
            <div
              key={step.title}
              className="group rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.07] via-white/[0.04] to-[#FF9900]/[0.04] p-5 shadow-lg shadow-black/20 transition-transform duration-300 hover:-translate-y-1"
            >
              <div className="mb-5 flex items-center justify-between gap-3">
                <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-[#FF5C4D] via-[#FF9900] to-[#FF2E97] text-black shadow-[0_12px_30px_rgba(255,153,0,0.18)]">
                  {index === 0 ? (
                    <MonitorSmartphone className="h-5 w-5" />
                  ) : index === 1 ? (
                    <Wand2 className="h-5 w-5" />
                  ) : index === 2 ? (
                    <CheckCircle2 className="h-5 w-5" />
                  ) : (
                    <ArrowRight className="h-5 w-5" />
                  )}
                </div>
                <div className="text-right">
                  <span className="block text-xs uppercase tracking-[0.18em] text-white/40">Step {index + 1}</span>
                  <span className="text-sm text-white/55">{step.title}</span>
                </div>
              </div>
              <h3 className="text-lg font-semibold tracking-tight text-white">{step.title}</h3>
              <p className="mt-2 text-sm leading-6 text-white/70">{step.description}</p>
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
        subtitle="Search meeting memory, review AI-proposed work, keep the board clean, connect people and planning, and automate the follow-through that should be repeatable."
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {capabilityCards.map((card) => {
            const Icon = card.icon;

            return (
              <div
                key={card.title}
                className={`rounded-2xl border border-white/10 bg-gradient-to-br ${card.accent} p-5 shadow-lg shadow-black/20 backdrop-blur-sm`}
              >
                <div className={`mb-4 inline-flex rounded-2xl bg-gradient-to-br ${card.iconAccent} p-3 text-white shadow-[0_14px_30px_rgba(0,0,0,0.22)]`}>
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-semibold tracking-tight text-white">{card.title}</h3>
                <p className="mt-2 text-sm leading-6 text-white/70">{card.body}</p>
              </div>
            );
          })}
        </div>
        <div className="mt-6">
          <Link href="/features" className="inline-flex items-center gap-2 text-sm text-white/75 hover:text-white">
            Explore all features <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </MarketingSection>

      <MarketingSection
        id="integrations"
        title={
          <>
            Keep the meeting tools <span className="text-white/90">your team already uses</span>
          </>
        }
        subtitle={`Taskwise supports ${PUBLIC_MARKETING_PROVIDERS.map((provider) => provider.name).join(", ")} as meeting sources, with provider-specific connection modes.`}
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {integrationCards.map((card) => (
            <div
              key={card.name}
              className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.06] via-white/[0.04] to-[#FF9900]/[0.04] p-5 shadow-lg shadow-black/20 backdrop-blur-sm"
            >
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="space-y-3">
                  <BrandIcon src={card.iconSrc} alt={card.iconAlt} className="shadow-[0_14px_30px_rgba(0,0,0,0.2)]" />
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-[#FFB257]">{card.name}</p>
                    <h3 className="mt-2 text-lg font-semibold tracking-tight text-white">{card.title}</h3>
                  </div>
                </div>
              </div>
              <p className="text-sm leading-6 text-white/70">{card.description}</p>
            </div>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap gap-5 text-sm">
          <Link href="/integrations" className="inline-flex items-center gap-2 text-white/75 hover:text-white">
            Compare meeting sources <ArrowRight className="h-4 w-4" />
          </Link>
          <Link href="/use-cases" className="inline-flex items-center gap-2 text-white/75 hover:text-white">
            Explore use cases <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </MarketingSection>

      <MarketingSection
        id="mcp"
        title={
          <>
            Operator layer with <span className="text-white/90">scoped advanced controls</span>
          </>
        }
        subtitle="MCP gives compatible AI clients a controlled path to Taskwise meeting memory and tasks while operator credentials and activity stay in their own lane."
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {operatorCards.map((card) => {
            const Icon = card.icon;

            return (
              <div
                key={card.title}
                className={`rounded-2xl border border-white/10 bg-gradient-to-br ${card.accent} p-5 shadow-lg shadow-black/20 backdrop-blur-sm`}
              >
                <div className={`mb-4 inline-flex rounded-2xl bg-gradient-to-br ${card.iconAccent} p-3 text-white shadow-[0_14px_30px_rgba(0,0,0,0.22)]`}>
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-semibold tracking-tight text-white">{card.title}</h3>
                <p className="mt-2 text-sm leading-6 text-white/70">{card.body}</p>
              </div>
            );
          })}
        </div>
      </MarketingSection>

      <MarketingSection
        id="cta"
        title="Ready to make meetings useful after the call?"
        subtitle="Start with a meeting source, explore a workflow, or go deeper into the operator layer."
      >
        <div className="rounded-[2rem] border border-white/10 bg-gradient-to-br from-white/10 via-white/[0.06] to-white/[0.03] p-6 shadow-2xl shadow-black/30 sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl space-y-3">
              <p className="text-xs uppercase tracking-[0.22em] text-[#FFB257]">Meeting to execution</p>
              <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                Keep the context and move the work forward.
              </h2>
              <p className="text-base leading-7 text-white/72">
                Taskwise connects meeting memory to reviewed tasks, ownership, priorities, planning,
                sharing, automations, and follow-through.
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
                <Link href="/use-cases">Use cases</Link>
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
