"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, ShieldCheck, LockKeyhole, Activity } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { MarketingSection } from "@/components/landing/MarketingSection";
import { operatorCards } from "@/components/landing/marketing-content";

export default function MCPPage() {
  return (
    <MarketingPageShell
      title="MCP"
      description="The operator layer for keys, replay, and logs"
    >
      <section className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:px-8 lg:py-24">
        <div>
          <Badge className="mb-5 border-white/10 bg-white/10 text-white">Power features</Badge>
          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
            className="text-4xl font-semibold tracking-tight text-white sm:text-6xl"
          >
            MCP is where Taskwise opens the doors for operators.
          </motion.h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-white/70">
            It is intentionally separate from the integration story: scoped API keys,
            audit logs, and replay tools for people who need to inspect or automate the
            workspace with care.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button className="bg-gradient-to-r from-[#FF5C4D] via-[#FF9900] to-[#FF2E97] text-white" asChild>
              <Link href="/signup">
                Request access
                <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
            <Button variant="secondary" className="border-white/10 bg-white/10 text-white hover:bg-white/20" asChild>
              <Link href="/integrations">Back to integrations</Link>
            </Button>
          </div>
        </div>
        <div className="grid gap-4 rounded-[2rem] border border-white/10 bg-white/5 p-5 backdrop-blur">
          {[
            { icon: LockKeyhole, title: "Scoped keys", text: "Grant operator access without handing over the full user session." },
            { icon: ShieldCheck, title: "Guardrails first", text: "Audit trails and access controls stay visible with every action." },
            { icon: Activity, title: "Replay and inspect", text: "Review workflow deliveries and understand what happened step by step." },
          ].map(({ icon: Icon, title, text }) => (
            <div key={title} className="flex items-start gap-3 rounded-2xl border border-white/10 bg-black/25 p-4">
              <div className="rounded-xl bg-white/10 p-2">
                <Icon className="h-4 w-4 text-white" />
              </div>
              <div>
                <h3 className="text-sm font-medium text-white">{title}</h3>
                <p className="mt-1 text-sm leading-6 text-white/65">{text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <MarketingSection
        eyebrow="Operator surfaces"
        title="Built for the part of the product that needs restraint."
        subtitle="MCP is useful when the workflow needs keys, logs, or replay. It is not the same thing as normal workspace use."
      >
        <div className="grid gap-6 md:grid-cols-3">
          {operatorCards.map((card) => {
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
    </MarketingPageShell>
  );
}
