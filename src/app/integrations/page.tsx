import Link from "next/link";
import { ArrowRight, Bot, FileText, Globe, Link2, Filter, Database, CheckCircle2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { MarketingSection } from "@/components/landing/MarketingSection";
import { integrationCards } from "@/components/landing/marketing-content";

export default function IntegrationsPage() {
  const visibleIntegrations = integrationCards.filter((card) => card.name !== "MCP");

  return (
    <MarketingPageShell>
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_420px_at_15%_15%,rgba(255,120,80,0.20),transparent_60%),radial-gradient(820px_380px_at_85%_20%,rgba(255,170,60,0.18),transparent_60%),linear-gradient(180deg,rgba(255,255,255,0.03),transparent_30%)]" />
        <div className="relative mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-24">
          <div className="max-w-3xl space-y-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="border-white/10 bg-white/10 text-white/90">Connected systems</Badge>
              <Badge className="border-white/10 bg-white/5 text-white/70">Public integrations page</Badge>
            </div>
            <div className="space-y-4">
              <h1 className="text-4xl font-semibold leading-[1.02] tracking-tight text-white sm:text-5xl lg:text-6xl">
                The integrations behind TaskwiseAI.
              </h1>
              <p className="max-w-3xl text-base leading-7 text-white/72 sm:text-lg">
                TaskwiseAI keeps the live provider story honest: Fathom, Fireflies, Grain, Slack,
                Google Workspace, manual paste, and the board sync layer all stay visible.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
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
                <Link href="/mcp">Open MCP</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <MarketingSection
        title="Live integrations"
        subtitle="These are the surfaces that are currently part of the public product story."
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {visibleIntegrations.map((card) => {
            const icons = {
              Fathom: Bot,
              Fireflies: ArrowRight,
              Grain: FileText,
              Slack: Link2,
              "Google Workspace": Globe,
              "Manual paste": Filter,
              "Board sync": Database,
              Trello: CheckCircle2,
            } as const;
            const Icon = icons[card.name as keyof typeof icons] || Database;

            return (
              <div
                key={card.name}
                className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-lg shadow-black/20"
              >
                <div className="mb-4 inline-flex rounded-xl border border-white/10 bg-white/10 p-3 text-white">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-medium text-white">{card.name}</h2>
                  {card.name === "Trello" ? (
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-white/60">
                      Disabled
                    </span>
                  ) : (
                    <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-emerald-200">
                      Live
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm leading-6 text-white/68">{card.description}</p>
              </div>
            );
          })}
        </div>
      </MarketingSection>

      <MarketingSection
        title="MCP stays on its own page"
        subtitle="The integrations story is for connected systems. The operator story belongs in MCP, where keys, replay, and audit logs live."
      >
        <div className="flex flex-wrap gap-3">
          <Button
            size="lg"
            className="gem-button bg-gradient-to-r from-[#FF4D4D] via-[#FF9900] to-[#FF2E97] text-white"
            asChild
          >
            <Link href="/mcp">
              Open MCP
              <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
          <Button
            size="lg"
            variant="secondary"
            className="border border-white/10 bg-white/10 text-white hover:bg-white/20"
            asChild
          >
            <Link href="/">Back home</Link>
          </Button>
        </div>
      </MarketingSection>
    </MarketingPageShell>
  );
}
