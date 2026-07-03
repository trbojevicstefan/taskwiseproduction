"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { MarketingSection } from "@/components/landing/MarketingSection";
import { capabilityCards, productFlowSteps } from "@/components/landing/marketing-content";

export default function FeaturesPage() {
  return (
    <MarketingPageShell
      title="Features"
      description="The product story behind reviewed execution"
    >
      <section className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:px-8 lg:py-24">
        <div className="max-w-3xl">
          <Badge className="mb-5 border-white/10 bg-white/10 text-white">Everything on one execution loop</Badge>
          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
            className="text-4xl font-semibold tracking-tight text-white sm:text-6xl"
          >
            A feature set built to turn meetings into shipping work.
          </motion.h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-white/70">
            TaskwiseAI combines AI chat, cleanup, prioritization, planning, and reminder
            workflows so your team can move from noisy conversation to reviewed tasks
            without breaking the thread.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button className="bg-gradient-to-r from-[#FF5C4D] via-[#FF9900] to-[#FF2E97] text-white" asChild>
              <Link href="/signup">
                Try it free
                <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
            <Button variant="secondary" className="border-white/10 bg-white/10 text-white hover:bg-white/20" asChild>
              <Link href="/">Back to home</Link>
            </Button>
          </div>
        </div>
        <div className="grid gap-4 rounded-[2rem] border border-white/10 bg-white/5 p-5 shadow-2xl shadow-black/30 backdrop-blur">
          {[
            "AI chat grounded in meetings, tasks, people, and clients",
            "Cleanup and prioritization before tasks reach the board",
            "Planning views for today, this week, blocked, and waiting work",
            "Slack reminders that stay stateful and auditable",
          ].map((item) => (
            <div key={item} className="flex items-start gap-3 rounded-2xl border border-white/10 bg-black/25 p-4">
              <Sparkles className="mt-0.5 h-4 w-4 text-[#FFB36A]" />
              <p className="text-sm leading-6 text-white/80">{item}</p>
            </div>
          ))}
        </div>
      </section>

      <MarketingSection
        eyebrow="Core capabilities"
        title="The pieces that make the loop feel simple."
        subtitle="These are the user-facing surfaces that turn raw meeting data into trustworthy task execution."
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

      <MarketingSection
        eyebrow="Workflow"
        title="Capture, understand, review, execute."
        subtitle="The homepage tells the short version; this page shows the whole path from meeting signal to shipped task."
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
        eyebrow="Finish line"
        title="Everything feeds a reviewed board, not a black box."
        subtitle="That means you keep control, know why something was suggested, and can decide what deserves to ship."
      >
        <div className="flex flex-wrap gap-3">
          <Button className="bg-gradient-to-r from-[#FF5C4D] via-[#FF9900] to-[#FF2E97] text-white" asChild>
            <Link href="/signup">Get started</Link>
          </Button>
          <Button variant="secondary" className="border-white/10 bg-white/10 text-white hover:bg-white/20" asChild>
            <Link href="/">Return home</Link>
          </Button>
        </div>
      </MarketingSection>
    </MarketingPageShell>
  );
}
