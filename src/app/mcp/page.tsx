import Link from "next/link";
import { Activity, LockKeyhole, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { MarketingSection } from "@/components/landing/MarketingSection";

export default function MCPPage() {
  return (
    <MarketingPageShell>
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_420px_at_20%_15%,rgba(255,120,80,0.18),transparent_60%),radial-gradient(820px_380px_at_85%_10%,rgba(255,170,60,0.15),transparent_60%),linear-gradient(180deg,rgba(255,255,255,0.03),transparent_30%)]" />
        <div className="relative mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-24">
          <div className="max-w-3xl space-y-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="border-white/10 bg-white/10 text-white/90">Power features</Badge>
              <Badge className="border-white/10 bg-white/5 text-white/70">Dedicated operator page</Badge>
            </div>
            <div className="space-y-4">
              <h1 className="text-4xl font-semibold leading-[1.02] tracking-tight text-white sm:text-5xl lg:text-6xl">
                MCP is where TaskwiseAI opens the operator layer.
              </h1>
              <p className="max-w-3xl text-base leading-7 text-white/72 sm:text-lg">
                Scoped API keys, workflow replay, and audit logs live here. It is separate from the
                integrations story so the product keeps a clean line between connected systems and
                operator controls.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                size="lg"
                className="gem-button bg-gradient-to-r from-[#FF4D4D] via-[#FF9900] to-[#FF2E97] text-white"
                asChild
              >
                <Link href="/signup">Request access</Link>
              </Button>
              <Button
                size="lg"
                variant="secondary"
                className="border border-white/10 bg-white/10 text-white hover:bg-white/20"
                asChild
              >
                <Link href="/integrations">Back to integrations</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <MarketingSection
        title="Operator surfaces"
        subtitle="This page keeps the advanced features readable without folding them into the integrations story."
      >
        <div className="grid gap-4 md:grid-cols-3">
          {[
            { icon: LockKeyhole, title: "MCP API keys", text: "Create scoped keys for operator workflows and keep access explicit." },
            { icon: ShieldCheck, title: "Audit logs", text: "Review what happened, who triggered it, and how workspace state changed." },
            { icon: Activity, title: "Workflow replay", text: "Inspect deliveries and trace the steps that moved a workflow forward." },
          ].map(({ icon: Icon, title, text }) => (
            <div
              key={title}
              className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-lg shadow-black/20"
            >
              <div className="mb-4 inline-flex rounded-xl border border-white/10 bg-white/10 p-3 text-white">
                <Icon className="h-5 w-5" />
              </div>
              <h2 className="text-lg font-medium text-white">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-white/68">{text}</p>
            </div>
          ))}
        </div>
      </MarketingSection>

      <MarketingSection
        title="Why MCP is separate"
        subtitle="TaskwiseAI keeps normal product usage, connected integrations, and operator controls in different lanes."
      >
        <div className="grid gap-4 md:grid-cols-3">
          {[
            "Operator actions stay scoped and auditable.",
            "Replay tools let you inspect workflow delivery step by step.",
            "Keys and logs are separate from normal workspace navigation.",
          ].map((text) => (
            <div
              key={text}
              className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-lg shadow-black/20"
            >
              <p className="text-sm leading-6 text-white/68">{text}</p>
            </div>
          ))}
        </div>
      </MarketingSection>
    </MarketingPageShell>
  );
}
