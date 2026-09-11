import type { Metadata } from "next";
import Link from "next/link";
import { Activity, LockKeyhole, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { PanoramicHero } from "@/components/landing/PanoramicHero";
import { MarketingSection } from "@/components/landing/MarketingSection";
import { StructuredData } from "@/components/landing/StructuredData";
import { PUBLIC_SITE_URL } from "@/lib/public-marketing";

export const metadata: Metadata = {
  title: "MCP for Meeting Memory & Tasks",
  description:
    "Use TaskwiseAI MCP tools to give compatible AI clients scoped access to meeting memory and task workflows with explicit keys, audit visibility, and operator controls.",
  alternates: { canonical: "/mcp" },
};

export default function MCPPage() {
  return (
    <MarketingPageShell>
      <StructuredData
        data={{
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: "TaskwiseAI MCP for meeting memory and tasks",
          description: metadata.description,
          url: `${PUBLIC_SITE_URL}/mcp`,
        }}
      />

      <PanoramicHero
        label="Operator surface"
        title={
          <>
            Give compatible AI clients <span className="text-white/90">scoped Taskwise context</span>
          </>
        }
        subtitle={
          <>
            Taskwise MCP connects AI workflows to meeting memory and tasks through explicit operator
            controls. Compatibility depends on the client&apos;s MCP support and your workspace setup.
          </>
        }
        primaryHref="/signup"
        primaryLabel="Get started"
        secondaryHref="/use-cases/mcp-for-meeting-memory"
        secondaryLabel="See the MCP workflow"
      />

      <MarketingSection
        title={
          <>
            <span className="bg-gradient-to-r from-[#FFB257] via-[#FF9900] to-[#FF2E97] bg-clip-text text-transparent">
              Operator-controlled
            </span>{" "}
            access
          </>
        }
        subtitle="MCP is an advanced control surface for approved AI workflows, not a promise of unrestricted autonomous access to the workspace."
      >
        <div className="grid gap-4 md:grid-cols-3">
          {[
            {
              icon: LockKeyhole,
              title: "Scoped MCP keys",
              text: "Create credentials for approved operator workflows and keep access boundaries explicit.",
            },
            {
              icon: ShieldCheck,
              title: "Audit visibility",
              text: "Keep operator activity reviewable so advanced access does not become invisible background automation.",
            },
            {
              icon: Activity,
              title: "Workflow replay",
              text: "Inspect workflow delivery and trace the steps that moved meeting-driven work forward.",
            },
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
            One context layer, <span className="bg-gradient-to-r from-[#FF5C4D] via-[#FF9900] to-[#FFB257] bg-clip-text text-transparent">different operators</span>
          </>
        }
        subtitle="The useful part of MCP is that compatible agents can work with the same meeting memory and task context people already review in Taskwise."
      >
        <div className="grid gap-4 md:grid-cols-3">
          {[
            "Ask an approved AI workflow to work from existing meeting memory instead of reconstructing context from scratch.",
            "Keep task operations connected to the same reviewed execution model used by the Taskwise interface.",
            "Separate normal workspace usage, provider integrations, and advanced operator credentials into clear control lanes.",
          ].map((text) => (
            <div
              key={text}
              className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-lg shadow-black/20"
            >
              <p className="text-sm leading-6 text-white/68">{text}</p>
            </div>
          ))}
        </div>

        <div className="mt-8 flex flex-wrap gap-3">
          <Button size="lg" className="gem-button bg-gradient-to-r from-[#FF4D4D] via-[#FF9900] to-[#FF2E97] text-white" asChild>
            <Link href="/use-cases/mcp-for-meeting-memory">Explore MCP use case</Link>
          </Button>
          <Button size="lg" variant="secondary" className="border border-white/10 bg-white/10 text-white hover:bg-white/20" asChild>
            <Link href="/integrations">View integrations</Link>
          </Button>
        </div>
      </MarketingSection>
    </MarketingPageShell>
  );
}
