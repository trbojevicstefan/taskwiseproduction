import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { BrandIcon } from "@/components/landing/BrandIcon";
import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { PanoramicHero } from "@/components/landing/PanoramicHero";
import { MarketingSection } from "@/components/landing/MarketingSection";
import { integrationCards } from "@/components/landing/marketing-content";

export default function IntegrationsPage() {
  const visibleIntegrations = integrationCards.filter((card) => card.name !== "MCP");

  return (
    <MarketingPageShell>
      <PanoramicHero
        label="Connected systems"
        title={
          <>
            The integrations behind <span className="text-white/90">TaskwiseAI</span>
          </>
        }
        subtitle={
          <>
            TaskwiseAI keeps the live provider story honest: Fathom, Fireflies, Grain, Slack,
            Google Workspace, manual paste, and the board sync layer all stay visible.
          </>
        }
        primaryHref="/signup"
        primaryLabel="Get started"
        secondaryHref="/mcp"
        secondaryLabel="Open MCP"
      />

      <MarketingSection
        title={
          <>
            <span className="bg-gradient-to-r from-[#FFB257] via-[#FF8A3D] to-[#FF2E97] bg-clip-text text-transparent">
              Active
            </span>{" "}
            integrations
          </>
        }
        subtitle={
          <span>
            These are the surfaces that are part of the public product story, including{" "}
            <span className="text-white/88">Trello</span> as an active board sync option.
          </span>
        }
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {visibleIntegrations.map((card) => {
            return (
              <div
                key={card.name}
                className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-lg shadow-black/20"
              >
                <div className="mb-4 flex items-center justify-between gap-3">
                  <BrandIcon src={card.iconSrc} alt={card.iconAlt} />
                </div>
                <p className="text-xs uppercase tracking-[0.2em] text-white/45">{card.name}</p>
                <h2 className="mt-2 text-lg font-medium text-white">{card.title}</h2>
                <p className="mt-2 text-sm leading-6 text-white/68">{card.description}</p>
              </div>
            );
          })}
        </div>
      </MarketingSection>

      <MarketingSection
        title={
          <>
            MCP stays on its{" "}
            <span className="bg-gradient-to-r from-[#FF5C4D] via-[#FF9900] to-[#FFB257] bg-clip-text text-transparent">
              own page
            </span>
          </>
        }
        subtitle={
          <span>
            The integrations story is for connected systems. The operator story belongs in MCP,
            where keys, replay, and audit logs live.
          </span>
        }
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
