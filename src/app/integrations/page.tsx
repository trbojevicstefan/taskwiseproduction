"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { MarketingSection } from "@/components/landing/MarketingSection";
import { integrationCards } from "@/components/landing/marketing-content";

export default function IntegrationsPage() {
  return (
    <MarketingPageShell
      title="Integrations"
      description="Meeting providers, messaging, calendars, and workspace signals"
    >
      <section className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:px-8 lg:py-24">
        <div>
          <Badge className="mb-5 border-white/10 bg-white/10 text-white">Connected systems</Badge>
          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
            className="text-4xl font-semibold tracking-tight text-white sm:text-6xl"
          >
            The integrations page for how Taskwise actually runs.
          </motion.h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-white/70">
            We keep the story honest: the live providers are visible, disabled surfaces are
            called out, and the platform always distinguishes from the operator layer.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button className="bg-gradient-to-r from-[#FF5C4D] via-[#FF9900] to-[#FF2E97] text-white" asChild>
              <Link href="/signup">
                Start with your workspace
                <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
            <Button variant="secondary" className="border-white/10 bg-white/10 text-white hover:bg-white/20" asChild>
              <Link href="/mcp">See the operator layer</Link>
            </Button>
          </div>
        </div>
        <div className="rounded-[2rem] border border-white/10 bg-white/5 p-5 backdrop-blur">
          <p className="mb-4 text-sm uppercase tracking-[0.3em] text-white/45">What is live</p>
          <div className="grid gap-3">
            {integrationCards.map((card) => {
              const Icon = card.icon;
              return (
                <div key={card.title} className="flex items-start gap-4 rounded-2xl border border-white/10 bg-black/25 p-4">
                  <div className="rounded-xl bg-white/10 p-2">
                    <Icon className="h-4 w-4 text-white" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-medium text-white">{card.title}</h3>
                      {card.badge && (
                        <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.25em] ${card.badge === "Live" ? "bg-emerald-500/15 text-emerald-200" : "bg-white/10 text-white/60"}`}>
                          {card.badge}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm leading-6 text-white/65">{card.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <MarketingSection
        eyebrow="Why it matters"
        title="Everything routes through the same meeting ingestion model."
        subtitle="That keeps Fathom, Fireflies, Grain, pasted notes, and downstream planning consistent instead of fragmented."
      >
        <div className="grid gap-6 lg:grid-cols-3">
          {[
            "Provider webhook verification happens before ingest.",
            "Fetched transcripts normalize into the same task and meeting rails.",
            "Disabled integrations stay visible without pretending they are live.",
          ].map((text) => (
            <div key={text} className="rounded-[1.5rem] border border-white/10 bg-white/5 p-6 text-sm leading-7 text-white/75">
              {text}
            </div>
          ))}
        </div>
      </MarketingSection>

      <MarketingSection
        eyebrow="Operator note"
        title="MCP stays on its own page."
        subtitle="The integrations story is for connected systems. The operator story belongs in MCP, where keys, replay, and audit logs live."
      >
        <div className="flex flex-wrap gap-3">
          <Button className="bg-gradient-to-r from-[#FF5C4D] via-[#FF9900] to-[#FF2E97] text-white" asChild>
            <Link href="/mcp">
              Open MCP
              <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
          <Button variant="secondary" className="border-white/10 bg-white/10 text-white hover:bg-white/20" asChild>
            <Link href="/signup">Start a workspace</Link>
          </Button>
        </div>
      </MarketingSection>
    </MarketingPageShell>
  );
}
