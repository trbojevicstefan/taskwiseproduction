import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Bot, CheckCircle2, Mic2, Radio, Video } from "lucide-react";

import { Button } from "@/components/ui/button";
import { BrandIcon } from "@/components/landing/BrandIcon";
import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { PanoramicHero } from "@/components/landing/PanoramicHero";
import { MarketingSection } from "@/components/landing/MarketingSection";
import { StructuredData } from "@/components/landing/StructuredData";
import { integrationCards } from "@/components/landing/marketing-content";
import { PUBLIC_MARKETING_PROVIDERS, PUBLIC_SITE_URL } from "@/lib/public-marketing";

export const metadata: Metadata = {
  title: "AI Meeting Integrations | Fathom, tl;dv, Otter, MeetGeek & More",
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

const meetingSourceNames = new Set(PUBLIC_MARKETING_PROVIDERS.map((provider) => provider.name));

const newMeetingSources = [
  {
    name: "tl;dv",
    title: "Transcripts and notes into the same action rail",
    description:
      "Connect with an API key, backfill recent meetings, and route completed meeting events into Taskwise.",
    Icon: Video,
    badge: "API + webhook",
    href: "/use-cases/tldv-to-task-board",
  },
  {
    name: "Otter.ai",
    title: "Enterprise conversation memory, connected",
    description:
      "Import eligible Otter Enterprise workspace conversations, transcripts and action-item context without creating a separate task silo.",
    Icon: Mic2,
    badge: "Enterprise API",
    href: "/use-cases/otter-action-items",
  },
  {
    name: "MeetGeek",
    title: "Meeting intelligence with verified follow-through",
    description:
      "Bring meetings into Taskwise through API sync and signed completion webhooks for search, review, people context and automation.",
    Icon: Bot,
    badge: "API + signed webhook",
    href: "/use-cases/meetgeek-task-workflow",
  },
  {
    name: "Read AI",
    title: "Completed reports through a signed webhook",
    description:
      "Webhook-first integration for completed Read AI reports. Manual sync is intentionally not exposed in the current connection flow.",
    Icon: Radio,
    badge: "Webhook-first",
    href: "/use-cases/read-ai-to-task-workflow",
  },
];

export default function IntegrationsPage() {
  const fathom = integrationCards.find((card) => card.name === "Fathom");
  const existingMeetingSources = integrationCards.filter(
    (card) => ["Fireflies", "Grain"].includes(card.name)
  );
  const executionIntegrations = integrationCards.filter(
    (card) => card.name !== "MCP" && !meetingSourceNames.has(card.name)
  );

  return (
    <MarketingPageShell>
      <StructuredData
        data={{
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: "TaskwiseAI meeting integrations",
          url: `${PUBLIC_SITE_URL}/integrations`,
          itemListElement: PUBLIC_MARKETING_PROVIDERS.map((provider, index) => ({
            "@type": "ListItem",
            position: index + 1,
            name: provider.name,
            description: provider.description,
          })),
        }}
      />

      <PanoramicHero
        label="Meeting memory, connected"
        title={
          <>
            Your meeting tools should end in <span className="text-white/90">action</span>
          </>
        }
        subtitle={
          <>
            Keep your preferred notetaker. TaskwiseAI turns the captured conversation into searchable
            memory, reviewed commitments, people and client context, planning, and deliberate follow-through.
          </>
        }
        primaryHref="/signup"
        primaryLabel="Get started"
        secondaryHref="/use-cases"
        secondaryLabel="Explore workflows"
      />

      {fathom ? (
        <MarketingSection
          title={
            <>
              Fathom is our <span className="bg-gradient-to-r from-[#FFB257] via-[#FF8A3D] to-[#FF2E97] bg-clip-text text-transparent">primary meeting source</span>
            </>
          }
          subtitle="Keep Fathom for meeting capture and use Taskwise as the layer that carries conversation context into reviewed execution."
        >
          <div className="grid gap-5 rounded-3xl border border-white/10 bg-white/[0.04] p-6 shadow-xl shadow-black/20 lg:grid-cols-[1.1fr_1fr] lg:p-8">
            <div>
              <div className="flex items-center gap-4">
                <BrandIcon src={fathom.iconSrc} alt={fathom.iconAlt} />
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-white/45">Primary source</p>
                  <h2 className="text-xl font-medium text-white">Fathom → TaskwiseAI</h2>
                </div>
              </div>
              <p className="mt-5 max-w-2xl text-sm leading-7 text-white/68">
                Ingest meeting context once, then use the same record for transcript chat, task review,
                people and client context, Swipe Sweep, planning, sharing, and automation.
              </p>
              <Link href="/use-cases/fathom-meeting-tasks" className="mt-5 inline-flex items-center gap-2 text-sm text-white/80 hover:text-white">
                See the Fathom workflow <ArrowRight className="h-4 w-4" />
              </Link>
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
        subtitle="The recorder can change without changing what happens next: normalize the meeting, review commitments, preserve context, then execute deliberately."
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {existingMeetingSources.map((card) => (
            <div key={card.name} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-lg shadow-black/20">
              <BrandIcon src={card.iconSrc} alt={card.iconAlt} />
              <p className="mt-4 text-xs uppercase tracking-[0.2em] text-white/45">{card.name}</p>
              <h2 className="mt-2 text-lg font-medium text-white">{card.title}</h2>
              <p className="mt-2 text-sm leading-6 text-white/68">{card.description}</p>
              <Link
                href={card.name === "Fireflies" ? "/use-cases/fireflies-to-task-board" : "/use-cases/grain-to-task-board"}
                className="mt-4 inline-flex items-center gap-2 text-sm text-white/75 hover:text-white"
              >
                Explore workflow <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          ))}

          {newMeetingSources.map(({ name, title, description, Icon, badge, href }) => (
            <div key={name} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-lg shadow-black/20 transition hover:border-white/20 hover:bg-white/[0.06]">
              <div className="mb-4 flex items-center justify-between gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-xl border border-white/10 bg-white/[0.06]"><Icon className="h-5 w-5 text-white/85" /></span>
                <span className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-white/55">{badge}</span>
              </div>
              <p className="text-xs uppercase tracking-[0.2em] text-white/45">{name}</p>
              <h2 className="mt-2 text-lg font-medium text-white">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-white/68">{description}</p>
              <Link href={href} className="mt-4 inline-flex items-center gap-2 text-sm text-white/75 hover:text-white">
                Explore workflow <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          ))}
        </div>
      </MarketingSection>

      <MarketingSection
        title={
          <>
            Keep the execution tools your team <span className="bg-gradient-to-r from-[#FFB257] via-[#FF8A3D] to-[#FF2E97] bg-clip-text text-transparent">already uses</span>
          </>
        }
        subtitle="Delivery and planning tools can stay connected to the same meeting-to-action workflow instead of becoming separate memory silos."
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {executionIntegrations.map((card) => (
            <div key={card.name} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-lg shadow-black/20 transition hover:border-white/20 hover:bg-white/[0.06]">
              <div className="mb-4"><BrandIcon src={card.iconSrc} alt={card.iconAlt} /></div>
              <p className="text-xs uppercase tracking-[0.2em] text-white/45">{card.name}</p>
              <h2 className="mt-2 text-lg font-medium text-white">{card.title}</h2>
              <p className="mt-2 text-sm leading-6 text-white/68">{card.description}</p>
            </div>
          ))}
        </div>
      </MarketingSection>

      <MarketingSection
        title={<>MCP stays on its <span className="bg-gradient-to-r from-[#FF5C4D] via-[#FF9900] to-[#FFB257] bg-clip-text text-transparent">own control surface</span></>}
        subtitle="Integrations move meeting data between systems. MCP lets compatible AI clients work with scoped Taskwise meeting-memory and task capabilities."
      >
        <div className="flex flex-wrap gap-3">
          <Button size="lg" className="gem-button bg-gradient-to-r from-[#FF4D4D] via-[#FF9900] to-[#FF2E97] text-white" asChild>
            <Link href="/mcp">Explore MCP<ArrowRight className="ml-1 h-4 w-4" /></Link>
          </Button>
          <Button size="lg" variant="secondary" className="border border-white/10 bg-white/10 text-white hover:bg-white/20" asChild>
            <Link href="/use-cases/ai-meeting-notes-to-tasks">Meeting notes to tasks</Link>
          </Button>
        </div>
      </MarketingSection>
    </MarketingPageShell>
  );
}
