import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { MarketingSection } from "@/components/landing/MarketingSection";
import { PanoramicHero } from "@/components/landing/PanoramicHero";
import { StructuredData } from "@/components/landing/StructuredData";
import { PUBLIC_SITE_URL, PUBLIC_USE_CASES } from "@/lib/public-marketing";

export const metadata: Metadata = {
  title: "AI Meeting Workflow Use Cases",
  description:
    "Explore practical TaskwiseAI workflows for meeting notes to tasks, transcript chat, Fathom, Fireflies, Grain, tl;dv, Otter.ai, MeetGeek, Read AI, MCP, and automation.",
  alternates: { canonical: "/use-cases" },
};

export default function UseCasesPage() {
  return (
    <MarketingPageShell>
      <StructuredData
        data={{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: "TaskwiseAI use cases",
          description: metadata.description,
          url: `${PUBLIC_SITE_URL}/use-cases`,
          isPartOf: { "@type": "WebSite", name: "TaskwiseAI", url: PUBLIC_SITE_URL },
        }}
      />

      <PanoramicHero
        label="Use cases"
        title={
          <>
            Practical ways to turn meetings into <span className="text-white/90">execution</span>
          </>
        }
        subtitle="Start with the job you need done: recover meeting context, turn notes into reviewed tasks, connect your recorder, or automate the follow-through."
        primaryHref="/signup"
        primaryLabel="Get started"
        secondaryHref="/integrations"
        secondaryLabel="See meeting sources"
      />

      <MarketingSection
        id="workflows"
        title={
          <>
            Choose the{" "}
            <span className="bg-gradient-to-r from-[#FFB257] via-[#FF8A3D] to-[#FF2E97] bg-clip-text text-transparent">
              workflow
            </span>
          </>
        }
        subtitle="Each page explains what Taskwise does, how the workflow works, and the provider-specific limits that matter before you connect it."
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {PUBLIC_USE_CASES.map((item) => (
            <Link
              key={item.slug}
              href={`/use-cases/${item.slug}`}
              className="group rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-lg shadow-black/20 transition-colors hover:bg-white/[0.07]"
            >
              <p className="text-xs uppercase tracking-[0.18em] text-white/45">{item.eyebrow}</p>
              <h2 className="mt-3 text-xl font-medium text-white">{item.heroTitle}</h2>
              <p className="mt-3 text-sm leading-6 text-white/68">{item.metaDescription}</p>
              <span className="mt-5 inline-flex items-center gap-2 text-sm text-white/80">
                Explore workflow
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </span>
            </Link>
          ))}
        </div>
      </MarketingSection>
    </MarketingPageShell>
  );
}
