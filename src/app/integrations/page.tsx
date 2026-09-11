import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Radio, Video, Mic2, Bot } from "lucide-react";

import { Button } from "@/components/ui/button";
import { BrandIcon } from "@/components/landing/BrandIcon";
import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { PanoramicHero } from "@/components/landing/PanoramicHero";
import { MarketingSection } from "@/components/landing/MarketingSection";
import { integrationCards } from "@/components/landing/marketing-content";

export const metadata: Metadata = {
  title: "AI Meeting Integrations | Fathom, tl;dv, Otter, MeetGeek & More | TaskwiseAI",
  description:
    "Turn Fathom, Fireflies, Grain, tl;dv, Otter.ai, MeetGeek and Read AI meeting memory into reviewed tasks, client context, planning and follow-up workflows.",
  alternates: { canonical: "/integrations" },
  openGraph: {
    title: "AI Meeting Integrations | TaskwiseAI",
    description:
      "Connect meeting memory to execution: transcripts, reviewed tasks, client context, reminders and automations.",
    url: "/integrations",
    type: "website",
  },
};

const newMeetingSources = [
  {
    name: "tl;dv",
    title: "Transcripts and notes into the same action rail",
    description:
      "Connect with an API key, backfill recent meetings, and route completed meeting events into Taskwise.",
    Icon: Video,
    badge: "API + webhook",
  },
  {
    name: "Otter.ai",
    title: "Enterprise conversation memory, connected",
    description:
      "Import eligible Otter workspace conversations, transcripts and action-item context without creating a separate task silo.",
    Icon: Mic2,
    badge: "Enterprise API",
  },
  {
    name: "MeetGeek",
    title: "Meeting intelligence with durable follow-through",
    description:
      "Bring meeting records and transcript pages into Taskwise for search, people context, review and automation.",
    Icon: Bot,
    badge: "API + webhook",
  },
  {
    name: "Read AI",
    title: "Completed reports through a signed webhook",
    description:
      "Webhook-first integration for completed Read AI reports. Taskwise does not pretend short-lived OAuth access is a static API-key connection.",
    Icon: Radio,
    badge: "Webhook-first",
  },
];

export default function IntegrationsPage() {
  const visibleIntegrations = integrationCards.filter((card) => card.name !== "MCP");
  const fathom = visibleIntegrations.find((card) => card.name === "Fathom");
  const remaining = visibleIntegrations.filter((card) => card.name !== "Fathom");

  return (
    <MarketingPageShell>
      <PanoramicHero
        label="Meeting memory, connected"
        title={
          <>
            Your meeting tools should end in <span className="text-white/90">action</span>
          </>
        }
        subtitle={
          <>
            Keep your preferred notetaker. TaskwiseAI turns the transcript into searchable context,
            reviewed commitments, client memory, planning, reminders, and downstream workflows.
          </>
        }
        primaryHref="/signup"
        primaryLabel="Get started"
        secondaryHref="/mcp"
        secondaryLabel="Explore MCP"
      />

      {fathom ? (
        <MarketingSection
          title={
            <>
              Fathom is our <span className="bg-gradient-to-r from-[#FFB257] via-[#FF8A3D] to-[#FF2E97] bg-clip-text text-transparent">primary meeting source</span>
            </>
          }
          subtitle="Taskwise is designed to make a Fathom meeting useful after the recap arrives — without replacing the notetaker you already trust."
        >
          <div className="grid gap-5 rounded-3xl border border-white/10 bg-white/[0.04] p-6 shadow-xl shadow-black/20 lg:grid-cols-[1.1fr_1fr] lg:p-8">
            <div>
              <div className="flex items-center gap-4">
                <BrandIcon src={fathom.iconSrc} alt={fathom.iconAlt} />
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-white/45">Recommended</p>
                  <h2 className="text-xl font-medium text-white">Fathom → TaskwiseAI</h2>
                </div>
              </div>
              <p className="mt-5 max-w-2xl text-sm leading-7 text-white/68">
                Ingest the transcript and meeting context once, then use the same record for transcript chat,
                task review, people and client context, board cleanup, meeting planning, and automation.
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {["Search and chat with transcripts", "Review extracted commitments", "Link people and clients", "Automate downstream follow-up"].map((item) => (
                <div key={item} className="flex items-start gap-2 rounded-xl border border-white/10 bg-black/10 p-3 text-sm text-white/78">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#FFB257]" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
        </MarketingSection>
      ) : null}

      <MarketingSection
        title={
          <>
            More meeting sources, <span className="bg-gradient-to-r from-[#FFB257] via-[#FF8A3D] to-[#FF2E97] bg-clip-text text-transparent">one memory layer</span>
          </>
        }
        subtitle="The source can change without changing what happens next: normalize the meeting, review commitments, keep client context, then automate deliberately."
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {newMeetingSources.map(({ name, title, description, Icon, badge }) => (
            <div key={name} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-lg shadow-black/20 transition hover:border-white/20 hover:bg-white/[0.06]">
              <div className="mb-4 flex items-center justify-between gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-xl border border-white/10 bg-white/[0.06]"><Icon className="h-5 w-5 text-white/85" /></span>
                <span className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-white/55">{badge}</span>
              </div>
              <p className="text-xs uppercase tracking-[0.2em] text-white/45">{name}</p>
              <h2 className="mt-2 text-lg font-medium text-white">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-white/68">{description}</p>
            </div>
          ))}
        </div>
      </MarketingSection>

      <MarketingSection
        title={
          <>
            Keep the tools your team <span className="bg-gradient-to-r from-[#FFB257] via-[#FF8A3D] to-[#FF2E97] bg-clip-text text-transparent">already uses</span>
          </>
        }
        subtitle="Delivery channels and execution tools plug into the same meeting-to-action workflow instead of becoming separate silos."
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {remaining.map((card) => (
            <div key={card.name} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-lg shadow-black/20 transition hover:border-white/20 hover:bg-white/[0.06]">
              <div className="mb-4 flex items-center justify-between gap-3"><BrandIcon src={card.iconSrc} alt={card.iconAlt} /></div>
              <p className="text-xs uppercase tracking-[0.2em] text-white/45">{card.name}</p>
              <h2 className="mt-2 text-lg font-medium text-white">{card.title}</h2>
              <p className="mt-2 text-sm leading-6 text-white/68">{card.description}</p>
            </div>
          ))}
        </div>
      </MarketingSection>

      <MarketingSection
        title={<>MCP stays on its <span className="bg-gradient-to-r from-[#FF5C4D] via-[#FF9900] to-[#FFB257] bg-clip-text text-transparent">own page</span></>}
        subtitle="Integrations move meeting data between systems. MCP lets AI clients query and act on Taskwise workspace context through explicit, scoped tools."
      >
        <div className="flex flex-wrap gap-3">
          <Button size="lg" className="gem-button bg-gradient-to-r from-[#FF4D4D] via-[#FF9900] to-[#FF2E97] text-white" asChild>
            <Link href="/mcp">Explore MCP<ArrowRight className="ml-1 h-4 w-4" /></Link>
          </Button>
          <Button size="lg" variant="secondary" className="border border-white/10 bg-white/10 text-white hover:bg-white/20" asChild>
            <Link href="/">Back home</Link>
          </Button>
        </div>
      </MarketingSection>
    </MarketingPageShell>
  );
}
