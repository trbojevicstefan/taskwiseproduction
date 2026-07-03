"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, ShieldCheck, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Logo } from "@/components/ui/logo";
import AnimatedTaskHero from "@/components/landing/AnimatedTaskHero";
import HeroParticles from "@/components/landing/HeroParticles";
import TaskwiseGsapSection from "@/components/landing/TaskwiseGsapSection";
import { MarketingSection } from "@/components/landing/MarketingSection";
import {
  capabilityCards,
  integrationCards,
  marketingNavItems,
  productFlowSteps,
} from "@/components/landing/marketing-content";

const brandGradient =
  "bg-[radial-gradient(1200px_600px_at_10%_10%,rgba(255,86,48,0.25),transparent_60%),radial-gradient(1200px_600px_at_90%_20%,rgba(255,175,0,0.25),transparent_60%),radial-gradient(1200px_600px_at_50%_90%,rgba(255,0,128,0.25),transparent_60%)]";

const GradientText = ({ children }: { children: ReactNode }) => (
  <span className="bg-gradient-to-r from-[#FF5C4D] via-[#FF9900] to-[#FF2E97] bg-clip-text text-transparent">
    {children}
  </span>
);

export default function TaskwiseAIPage() {
  return (
    <main className={`relative min-h-screen overflow-hidden bg-[#090A0F] text-white ${brandGradient}`}>
      <div className="pointer-events-none fixed inset-0 -z-20 bg-[linear-gradient(to_bottom,rgba(255,255,255,0.03),transparent_18%),radial-gradient(circle_at_top,_rgba(255,255,255,0.08),transparent_30%)]" />

      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/25 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Logo size="md" />
            <Badge className="hidden border-white/10 bg-white/10 text-white sm:inline-flex">
              Beta
            </Badge>
          </div>
          <nav className="hidden items-center gap-6 text-sm text-white/65 lg:flex">
            {marketingNavItems.slice(0, 4).map((item) => (
              <Link key={item.href} href={item.href} className="transition hover:text-white">
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              className="hidden border-white/10 bg-white/10 text-white hover:bg-white/20 sm:inline-flex"
              asChild
            >
              <Link href="/login">Sign in</Link>
            </Button>
            <Button
              className="bg-gradient-to-r from-[#FF5C4D] via-[#FF9900] to-[#FF2E97] text-white shadow-[0_20px_60px_rgba(255,92,77,0.25)]"
              asChild
            >
              <Link href="/signup">
                Get started
                <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <HeroParticles className="-z-10" />
        <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:px-8 lg:py-24">
          <div className="max-w-3xl">
            <Badge className="mb-6 border-white/10 bg-white/10 text-white">
              New: Fathom, Fireflies, Grain, cleanup, prioritization, planning
            </Badge>
            <motion.h1
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="text-4xl font-semibold leading-tight tracking-tight text-white sm:text-5xl lg:text-7xl"
            >
              Turn meetings into <GradientText>prioritized, reviewed execution.</GradientText>
            </motion.h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-white/70">
              TaskwiseAI brings together Fathom, Fireflies, Grain, pasted notes, AI chat,
              cleanup, prioritization, planning, and Slack reminders so your team can move
              from raw conversation to confident action.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button className="bg-gradient-to-r from-[#FF5C4D] via-[#FF9900] to-[#FF2E97] text-white" asChild>
                <Link href="/signup">
                  Try it free
                  <ArrowRight className="ml-1 h-4 w-4" />
                </Link>
              </Button>
              <Button variant="secondary" className="border-white/10 bg-white/10 text-white hover:bg-white/20" asChild>
                <Link href="/features">See features</Link>
              </Button>
            </div>
            <div className="mt-6 flex flex-wrap gap-x-4 gap-y-2 text-sm text-white/60">
              <span className="inline-flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" />
                Review-first workflow
              </span>
              <span className="inline-flex items-center gap-2">
                <Sparkles className="h-4 w-4" />
                Deterministic prioritization
              </span>
              <span className="inline-flex items-center gap-2">
                <Sparkles className="h-4 w-4" />
                MCP operator layer
              </span>
            </div>
          </div>

          <div className="relative">
            <div className="absolute inset-0 rounded-[2rem] bg-gradient-to-br from-[#FF5C4D]/15 via-transparent to-[#FF2E97]/15 blur-3xl" />
            <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-white/5 p-4 shadow-2xl shadow-black/30 backdrop-blur">
              <AnimatedTaskHero />
            </div>
          </div>
        </div>
      </section>

      <MarketingSection
        eyebrow="Workflow"
        title={
          <>
            Capture, <GradientText>understand</GradientText>, review, execute.
          </>
        }
        subtitle="The homepage shows the loop at a glance: bring in a meeting, turn it into tasks, clean it up, prioritize it, and keep the team moving."
      >
        <div className="grid gap-4 lg:grid-cols-4">
          {productFlowSteps.map((step, index) => (
            <article key={step.title} className="rounded-[1.5rem] border border-white/10 bg-black/25 p-5">
              <div className="mb-4 flex items-center justify-between text-xs uppercase tracking-[0.3em] text-white/45">
                <span>{step.eyebrow}</span>
                <span>0{index + 1}</span>
              </div>
              <h3 className="text-lg font-medium text-white">{step.title}</h3>
              <p className="mt-3 text-sm leading-7 text-white/70">{step.description}</p>
            </article>
          ))}
        </div>
      </MarketingSection>

      <MarketingSection
        eyebrow="Capabilities"
        title="Big enough to impress. Clear enough to trust."
        subtitle="Each block on the homepage maps to a real product capability users can try right away."
      >
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {capabilityCards.map((card) => {
            const Icon = card.icon;
            return (
              <article key={card.title} className="rounded-[1.75rem] border border-white/10 bg-white/5 p-6 backdrop-blur">
                <div className="mb-4 inline-flex rounded-2xl bg-white/10 p-3">
                  <Icon className="h-5 w-5 text-white" />
                </div>
                <h3 className="text-lg font-medium text-white">{card.title}</h3>
                <p className="mt-2 text-sm leading-7 text-white/70">{card.description}</p>
              </article>
            );
          })}
        </div>
      </MarketingSection>

      <TaskwiseGsapSection />

      <MarketingSection
        eyebrow="Integrations"
        title="Meeting providers, calendar signals, and the rest of the stack."
        subtitle="Fathom, Fireflies, Grain, Slack, Google Workspace, manual paste, and the operator layer are all visible from the first screen."
      >
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {integrationCards.map((card) => {
            const Icon = card.icon;
            return (
              <Link
                key={card.title}
                href="/integrations"
                className="group rounded-[1.5rem] border border-white/10 bg-white/5 p-5 transition hover:border-white/20 hover:bg-white/10"
              >
                <div className="mb-4 flex items-center justify-between">
                  <div className="rounded-xl bg-white/10 p-2">
                    <Icon className="h-4 w-4 text-white" />
                  </div>
                  {card.badge && (
                    <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.25em] ${card.badge === "Live" ? "bg-emerald-500/15 text-emerald-200" : "bg-white/10 text-white/60"}`}>
                      {card.badge}
                    </span>
                  )}
                </div>
                <h3 className="text-sm font-medium text-white">{card.title}</h3>
                <p className="mt-2 text-sm leading-6 text-white/65">{card.description}</p>
              </Link>
            );
          })}
        </div>
      </MarketingSection>

      <MarketingSection
        eyebrow="Operator layer"
        title="Workflow replay, audit logs, and MCP keys live behind a dedicated page."
        subtitle="This keeps the advanced surfaces easy to find without burying them inside the integrations story."
      >
        <div className="grid gap-6 lg:grid-cols-3">
          {[
            "Audit logs explain what changed and why.",
            "Workflow replay helps operators inspect deliveries.",
            "MCP keys keep operator access scoped and explicit.",
          ].map((item) => (
            <div key={item} className="rounded-[1.5rem] border border-white/10 bg-white/5 p-6 text-sm leading-7 text-white/75">
              {item}
            </div>
          ))}
        </div>
      </MarketingSection>

      <MarketingSection
        eyebrow="Call to action"
        title="See the product, then put it to work."
        subtitle="The homepage links out to the feature story, the integrations story, and the operator surface so the branch feels complete."
      >
        <div className="flex flex-wrap gap-3">
          <Button className="bg-gradient-to-r from-[#FF5C4D] via-[#FF9900] to-[#FF2E97] text-white" asChild>
            <Link href="/signup">Get started</Link>
          </Button>
          <Button variant="secondary" className="border-white/10 bg-white/10 text-white hover:bg-white/20" asChild>
            <Link href="/login">Sign in</Link>
          </Button>
          <Button variant="secondary" className="border-white/10 bg-white/10 text-white hover:bg-white/20" asChild>
            <Link href="/features">Open features</Link>
          </Button>
        </div>
      </MarketingSection>
    </main>
  );
}
