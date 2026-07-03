import Link from "next/link";
import { Activity, LockKeyhole, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { PanoramicHero } from "@/components/landing/PanoramicHero";
import { MarketingSection } from "@/components/landing/MarketingSection";

export default function MCPPage() {
  return (
    <MarketingPageShell>
      <PanoramicHero
        label="Operator surface"
        title={
          <>
            MCP is where TaskwiseAI opens the <span className="text-white/90">operator layer</span>
          </>
        }
        subtitle={
          <>
            Scoped API keys, workflow replay, and audit logs live here. It is separate from the
            integrations story so the product keeps a clean line between connected systems and
            operator controls.
          </>
        }
        primaryHref="/signup"
        primaryLabel="Request access"
        secondaryHref="/integrations"
        secondaryLabel="Back to integrations"
      />

      <MarketingSection
        title={
          <>
            <span className="bg-gradient-to-r from-[#FFB257] via-[#FF9900] to-[#FF2E97] bg-clip-text text-transparent">
              Operator
            </span>{" "}
            surfaces
          </>
        }
        subtitle={
          <span>
            This page keeps the advanced features readable without folding them into the
            integrations story.
          </span>
        }
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
        title={
          <>
            Why MCP is{" "}
            <span className="bg-gradient-to-r from-[#FF5C4D] via-[#FF9900] to-[#FFB257] bg-clip-text text-transparent">
              separate
            </span>
          </>
        }
        subtitle={
          <span>
            TaskwiseAI keeps normal product usage, connected integrations, and operator controls in
            different lanes.
          </span>
        }
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
