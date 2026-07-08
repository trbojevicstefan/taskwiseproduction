"use client";

import Link from "next/link";
import React, { useEffect, useRef } from "react";
import { Layers, MessageSquare, Rocket, Share2, Sparkles } from "lucide-react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/dist/ScrollTrigger";

type ShowcaseSection = {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  accent: string;
  badge: string;
  icon: React.ReactNode;
  panel: React.ReactNode;
};

const SHOWCASE_SECTIONS: ShowcaseSection[] = [
  {
    id: "clarity",
    title: "Clarity",
    subtitle: "From meeting noise to decision-ready context",
    description:
      "Taskwise creates dependable transcripts, concise summaries, and owner-based action items so every meeting ends with clear next steps.",
    accent: "from-[#4CC9F0]/18 via-[#00abff]/10 to-white/[0.03]",
    badge: "Summary",
    icon: <Sparkles size={16} fill="currentColor" />,
    panel: (
      <div className="space-y-4 rounded-[1.6rem] border border-white/10 bg-[#191a1e]/95 p-5 shadow-[0_20px_50px_rgba(0,0,0,0.55)] backdrop-blur-md sm:p-6">
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <h4 className="text-base font-bold text-white">
            Weekly Execution Sync
            <span className="ml-2 block text-xs font-normal text-slate-500 sm:inline">
              Template summary
            </span>
          </h4>
          <div className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-cyan-200">
            Clarity
          </div>
        </div>
        <div className="space-y-4 pt-1">
          <div>
            <p className="mb-1 text-xs font-bold uppercase tracking-[0.2em] text-white/55">
              Meeting purpose
            </p>
            <p className="text-sm leading-6 text-slate-300">
              Align product, sales, and delivery owners on this week&apos;s launch blockers.
            </p>
          </div>
          <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/55">
              Highlights
            </p>
            <div className="mt-3 space-y-3">
              <div className="rounded-xl border border-cyan-400/15 bg-cyan-400/8 p-3">
                <p className="text-sm font-semibold text-cyan-200">Launch readiness</p>
                <p className="mt-1 text-sm leading-6 text-slate-300">
                  Two blockers were flagged and attached to owners before the meeting ended.
                </p>
              </div>
              <p className="text-sm leading-6 text-slate-400">
                Follow-ups were synced with due dates and surfaced in the workspace board automatically.
              </p>
            </div>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: "momentum",
    title: "Momentum",
    subtitle: "Search fast, automate follow-through",
    description:
      "\"Ask Taskwise\" lets your team query meetings, decisions, and open actions in seconds, then push updates into the tools everyone already uses.",
    accent: "from-[#F4E285]/18 via-[#ff8f1a]/12 to-white/[0.03]",
    badge: "Integrations",
    icon: <MessageSquare size={16} fill="currentColor" />,
    panel: (
      <div className="space-y-3 rounded-[1.6rem] border border-white/10 bg-[#191a1e]/95 p-5 shadow-[0_20px_50px_rgba(0,0,0,0.55)] backdrop-blur-md sm:p-6">
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <h4 className="text-sm font-bold uppercase tracking-[0.2em] text-slate-400">
            Integrations
          </h4>
          <div className="rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-amber-100">
            Momentum
          </div>
        </div>
        {[
          {
            name: "Slack",
            desc: "Send summaries, decisions, and owner reminders to channels instantly.",
            icon: <MessageSquare size={18} />,
            iconColor: "text-green-300",
          },
          {
            name: "Salesforce",
            desc: "Attach meeting context and follow-up tasks to accounts and opportunities.",
            icon: <Layers size={18} />,
            iconColor: "text-blue-300",
          },
          {
            name: "HubSpot",
            desc: "Sync next steps and notes back to contacts without manual copy-paste.",
            icon: <Share2 size={18} />,
            iconColor: "text-orange-300",
          },
        ].map((item) => (
          <div
            key={item.name}
            className="flex items-center gap-4 rounded-2xl border border-white/8 bg-white/[0.04] p-4 transition-colors hover:bg-white/[0.08]"
          >
            <div className={`flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 ${item.iconColor}`}>
              {item.icon}
            </div>
            <div>
              <p className="text-base font-bold text-white">{item.name}</p>
              <p className="mt-0.5 text-[11px] leading-5 text-slate-400">{item.desc}</p>
            </div>
          </div>
        ))}
      </div>
    ),
  },
  {
    id: "ease",
    title: "Ease",
    subtitle: "Enterprise-grade operations, zero setup",
    description:
      "Taskwise handles ingestion, processing, and secure delivery so your team can focus on execution while the platform scales in the background.",
    accent: "from-[#ff6a3d]/18 via-[#ff8a65]/12 to-white/[0.03]",
    badge: "Delivery",
    icon: <Rocket size={16} fill="currentColor" />,
    panel: (
      <div className="flex flex-col items-center rounded-[1.6rem] border border-white/10 bg-[#191a1e]/95 p-6 text-center shadow-[0_20px_50px_rgba(0,0,0,0.55)] backdrop-blur-md sm:p-8">
        <div className="relative mb-8 mt-1">
          <div className="absolute -inset-10 rounded-full bg-[#ff6a3d]/35 blur-[40px]" />
          <div className="relative flex h-28 w-28 items-center justify-center rounded-full border border-white/20 bg-white/10 backdrop-blur-md">
            <Rocket size={48} className="text-[#ff8a65]" />
          </div>
        </div>
        <h4 className="text-2xl font-bold text-white">Autonomous Delivery Layer</h4>
        <p className="mx-auto mt-3 max-w-[280px] text-sm leading-6 text-slate-400">
          Built for always-on teams that need fast answers and reliable execution.
        </p>
        <div className="mt-8 w-full rounded-2xl border border-white/10 bg-white/5 p-5 text-left">
          <div className="mb-3 flex justify-between font-mono text-xs text-slate-400">
            <span>TASKWISE_RESPONSE_TIME</span>
            <span className="font-bold text-green-400">12ms</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/50">
            <div className="h-full w-[85%] bg-[#ff7f50]" />
          </div>
        </div>
      </div>
    ),
  },
];

export default function TaskwiseGsapSection() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const starContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    const starContainer = starContainerRef.current;
    if (!container || !starContainer) {
      return undefined;
    }

    gsap.registerPlugin(ScrollTrigger);
    starContainer.innerHTML = "";

    for (let index = 0; index < 120; index += 1) {
      const star = document.createElement("div");
      const size = Math.random() * 2.2 + 1;
      const opacity = Math.random() * 0.55 + 0.25;

      star.className = "absolute rounded-full bg-white";
      star.style.width = `${size}px`;
      star.style.height = `${size}px`;
      star.style.left = `${Math.random() * 100}%`;
      star.style.top = `${Math.random() * 100}%`;
      star.style.opacity = `${opacity}`;
      star.style.boxShadow = "0 0 5px rgba(255,255,255,0.85)";

      starContainer.appendChild(star);
    }

    const ctx = gsap.context(() => {
      gsap.to(starContainer, {
        yPercent: -12,
        ease: "none",
        scrollTrigger: {
          trigger: container,
          start: "top bottom",
          end: "bottom top",
          scrub: 1,
        },
      });

      const panels = gsap.utils.toArray<HTMLElement>("[data-gsap-panel]", container);
      panels.forEach((panel) => {
        gsap.fromTo(
          panel,
          { opacity: 0, y: 48, scale: 0.98 },
          {
            opacity: 1,
            y: 0,
            scale: 1,
            ease: "power2.out",
            scrollTrigger: {
              trigger: panel,
              start: "top 78%",
              end: "top 45%",
              scrub: 0.6,
            },
          },
        );
      });
    }, container);

    ScrollTrigger.refresh();

    return () => {
      ctx.revert();
      starContainer.innerHTML = "";
    };
  }, []);

  return (
    <section id="workflow" className="relative overflow-hidden bg-[#020202] py-16 sm:py-24">
      <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_50%_18%,rgba(255,106,61,0.12),transparent_28%),radial-gradient(circle_at_82%_78%,rgba(255,46,151,0.08),transparent_24%),linear-gradient(180deg,rgba(255,255,255,0.015),transparent_18%)]" />
      <div
        ref={starContainerRef}
        className="pointer-events-none absolute inset-0 z-0 opacity-85"
        style={{ mixBlendMode: "screen" }}
      />

      <div className="relative z-10 mx-auto w-full max-w-[1400px] px-4 sm:px-6 lg:px-10">
        <div className="mx-auto mb-12 max-w-3xl text-center">
          <p className="text-xs uppercase tracking-[0.28em] text-white/45">Clarity, momentum, ease</p>
          <h2 className="mt-4 text-4xl font-semibold tracking-tight text-white sm:text-5xl lg:text-6xl">
            A calmer story that still feels alive.
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-300 sm:text-lg">
            Scroll through the three sections without pinning the page or fighting mobile scroll.
            The motion stays subtle, readable, and stable.
          </p>
        </div>

        <div ref={containerRef} className="space-y-8 sm:space-y-10">
          {SHOWCASE_SECTIONS.map((section) => (
            <div
              key={section.id}
              data-gsap-panel
              className={`grid gap-6 rounded-[2rem] border border-white/10 bg-gradient-to-br ${section.accent} p-5 shadow-[0_20px_60px_rgba(0,0,0,0.35)] backdrop-blur-sm sm:p-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:p-8`}
            >
              <div className="max-w-xl space-y-4">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs uppercase tracking-[0.24em] text-white/65">
                  <span className="text-[#FFB257]">{section.icon}</span>
                  {section.badge}
                </div>
                <h3 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                  {section.title}
                </h3>
                <p className={`text-sm font-semibold tracking-wide ${section.id === "clarity" ? "text-[#4CC9F0]" : section.id === "momentum" ? "text-[#F4E285]" : "text-[#FF9F8A]"}`}>
                  {section.subtitle}
                </p>
                <p className="text-base leading-7 text-slate-300">{section.description}</p>
                <Link
                  href="/signup"
                  prefetch={false}
                  className="inline-flex rounded-full bg-gradient-to-r from-[#FF5C4D] via-[#FF9900] to-[#FF2E97] px-6 py-3 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(255,120,60,0.18)] transition-transform hover:-translate-y-0.5"
                >
                  Start with Taskwise
                </Link>
              </div>

              <div className="relative flex min-h-[280px] items-center justify-center overflow-hidden rounded-[1.6rem] border border-white/10 bg-black/30 p-3 sm:min-h-[320px] sm:p-5">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(255,255,255,0.08),transparent_42%)]" />
                <div className="relative w-full">{section.panel}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
