"use client";

import React, { useEffect, useRef } from "react";
import Link from "next/link";
import { Sparkles, MessageSquare, Layers, Share2, Rocket } from "lucide-react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/dist/ScrollTrigger";

type ShowcaseSection = {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  colorClass: string;
  buttonClass: string;
  ringColors: [string, string, string, string, string];
  content: React.ReactNode;
};

const SHOWCASE_SECTIONS: ShowcaseSection[] = [
  {
    id: "clarity",
    title: "Clarity",
    subtitle: "From meeting noise to decision-ready context",
    description:
      "Taskwise creates dependable transcripts, concise summaries, and owner-based action items so every meeting ends with clear next steps.",
    colorClass: "text-[#4CC9F0]",
    buttonClass: "bg-[#4CC9F0] text-black",
    ringColors: ["bg-[#002f4a]", "bg-[#005a8f]", "bg-[#0089d1]", "bg-[#00abff]", "bg-[#48e5ff]"],
    content: (
      <div className="space-y-4 font-sans text-slate-300">
        <div className="mb-2 flex items-center justify-between border-b border-white/10 pb-4">
          <h4 className="text-lg font-bold text-white">
            Summary
            <span className="ml-2 cursor-pointer text-xs font-normal text-slate-500 underline">
              Template: Weekly Execution Sync
            </span>
          </h4>
        </div>
        <div className="space-y-5 pt-2">
          <div>
            <p className="mb-1 text-sm font-bold text-white">Meeting Purpose</p>
            <p className="text-sm text-slate-400">
              - Align product, sales, and delivery owners on this week&apos;s launch blockers.
            </p>
          </div>
          <div>
            <p className="mb-2 text-sm font-bold text-white">Highlights</p>
            <div className="space-y-3">
              <div className="space-y-1">
                <p className="text-sm font-bold text-white">Launch readiness:</p>
                <div className="flex gap-2">
                  <div className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-cyan-500">
                    {">"}
                  </div>
                  <p className="text-sm font-medium leading-relaxed text-cyan-400">
                    Taskwise flagged two unresolved blockers and attached owners before the meeting ended.
                  </p>
                </div>
                <div className="flex gap-2 pl-6">
                  <div className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-500" />
                  <p className="text-sm text-slate-400">
                    Follow-ups were synced with due dates and surfaced in the workspace board automatically.
                  </p>
                </div>
              </div>
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
    colorClass: "text-[#F4E285]",
    buttonClass: "bg-[#F4E285] text-black",
    ringColors: ["bg-[#783600]", "bg-[#ad5000]", "bg-[#e06b00]", "bg-[#ff8f1a]", "bg-[#ffc66b]"],
    content: (
      <div className="space-y-6">
        <h4 className="mb-4 text-sm font-bold uppercase tracking-widest text-slate-400">Integrations</h4>
        <div className="space-y-2">
          {[
            {
              name: "Slack",
              desc: "Send summaries, decisions, and owner reminders to channels instantly.",
              icon: <MessageSquare size={18} />,
              iconColor: "text-green-400",
            },
            {
              name: "Salesforce",
              desc: "Attach meeting context and follow-up tasks to accounts and opportunities.",
              icon: <Layers size={18} />,
              iconColor: "text-blue-400",
            },
            {
              name: "HubSpot",
              desc: "Sync next steps and notes back to contacts without manual copy-paste.",
              icon: <Share2 size={18} />,
              iconColor: "text-orange-400",
            },
          ].map((item: any) => (
            <div
              key={item.name}
              className="flex items-center gap-4 rounded-xl border border-white/5 bg-white/5 p-4 transition-colors hover:bg-white/10"
            >
              <div className={`flex h-10 w-10 items-center justify-center rounded-lg bg-white/10 ${item.iconColor}`}>
                {item.icon}
              </div>
              <div>
                <p className="text-base font-bold text-white">{item.name}</p>
                <p className="mt-0.5 text-[11px] text-slate-400">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    id: "ease",
    title: "Ease",
    subtitle: "Enterprise-grade operations, zero setup",
    description:
      "Taskwise handles ingestion, processing, and secure delivery so your team can focus on execution while the platform scales in the background.",
    colorClass: "text-[#FF9F8A]",
    buttonClass: "bg-[#FF9F8A] text-black",
    ringColors: ["bg-[#3f0d12]", "bg-[#6d1a20]", "bg-[#9b2530]", "bg-[#d94b4b]", "bg-[#ff8a65]"],
    content: (
      <div className="flex h-full flex-col items-center justify-center py-8 text-center">
        <div className="relative mb-10 mt-4">
          <div className="absolute -inset-10 rounded-full bg-[#ff6a3d]/40 blur-[40px] animate-pulse" />
          <div className="relative flex h-28 w-28 items-center justify-center rounded-full border border-white/20 bg-white/10 backdrop-blur-md">
            <Rocket size={48} className="text-[#ff8a65]" />
          </div>
        </div>
        <h4 className="text-2xl font-bold text-white">Autonomous Delivery Layer</h4>
        <p className="mx-auto mt-3 max-w-[250px] text-sm text-slate-400">
          Built for always-on teams that need fast answers and reliable execution.
        </p>
        <div className="mt-10 w-full rounded-2xl border border-white/10 bg-white/5 p-5">
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

const STAR_COUNT = 200;

export default function TaskwiseGsapSection() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const starsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    const starContainer = starsRef.current;
    if (!container || !starContainer) {
      return;
    }

    gsap.registerPlugin(ScrollTrigger);
    starContainer.innerHTML = "";

    for (let i = 0; i < STAR_COUNT; i += 1) {
      const star = document.createElement("div");
      star.className = "absolute rounded-full bg-white";
      const size = Math.random() * 2 + 1;
      star.style.width = `${size}px`;
      star.style.height = `${size}px`;
      star.style.left = `${Math.random() * 100}%`;
      star.style.top = `${Math.random() * 100}%`;
      star.style.opacity = `${Math.random() * 0.6 + 0.4}`;
      star.style.boxShadow = "0 0 3px rgba(255,255,255,0.8)";
      starContainer.appendChild(star);
    }

    const ctx = gsap.context(() => {
      SHOWCASE_SECTIONS.forEach((section, index) => {
        if (index === 0) {
          gsap.set(`#nav-${section.id}`, { color: "#ffffff", scale: 1 });
          gsap.set(`#section-${section.id}`, { height: "auto", opacity: 1, marginTop: "1rem" });
          gsap.set(`#rings-${section.id}`, { opacity: 1 });
          gsap.set(`#card-${section.id}`, { opacity: 1, y: 0 });
          return;
        }

        gsap.set(`#nav-${section.id}`, { color: "rgba(255,255,255,0.3)", scale: 0.85 });
        gsap.set(`#section-${section.id}`, { height: 0, opacity: 0, marginTop: 0 });
        gsap.set(`#rings-${section.id}`, { opacity: 0 });
        gsap.set(`#card-${section.id}`, { opacity: 0, y: 50 });
      });

      gsap.to(starContainer, {
        yPercent: -60,
        ease: "none",
        scrollTrigger: {
          trigger: container,
          start: "top top",
          end: "+=5000",
          scrub: 1,
        },
      });

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: container,
          start: "top top",
          end: "+=5000",
          pin: true,
          scrub: 1,
          anticipatePin: 1,
        },
      });

      tl.to({}, { duration: 1.5 });

      SHOWCASE_SECTIONS.forEach((_, index) => {
        if (index === 0) {
          return;
        }

        const previous = SHOWCASE_SECTIONS[index - 1];
        const current = SHOWCASE_SECTIONS[index];
        const stepLabel = `step-${index}`;

        tl.to(`#nav-${previous.id}`, { color: "rgba(255,255,255,0.3)", scale: 0.85, duration: 1 }, stepLabel)
          .to(
            `#section-${previous.id}`,
            { height: 0, opacity: 0, marginTop: 0, duration: 1, ease: "power2.inOut" },
            stepLabel
          )
          .to(`#card-${previous.id}`, { opacity: 0, y: -50, duration: 1 }, stepLabel)
          .to(`#rings-${previous.id}`, { opacity: 0, duration: 1 }, stepLabel)
          .to(`#nav-${current.id}`, { color: "#ffffff", scale: 1, duration: 1 }, stepLabel)
          .to(
            `#section-${current.id}`,
            { height: "auto", opacity: 1, marginTop: "1rem", duration: 1, ease: "power2.inOut" },
            stepLabel
          )
          .to(`#card-${current.id}`, { opacity: 1, y: 0, duration: 1 }, stepLabel)
          .to(`#rings-${current.id}`, { opacity: 1, duration: 1 }, stepLabel);

        tl.to({}, { duration: 1.5 });
      });
    }, container);

    ScrollTrigger.refresh();

    return () => {
      ctx.revert();
      starContainer.innerHTML = "";
    };
  }, []);

  return (
    <section id="workflow" className="relative overflow-x-hidden bg-[#020202] py-6">
      <div ref={containerRef} className="relative flex h-screen w-full items-center justify-center overflow-hidden">
        <div ref={starsRef} className="pointer-events-none absolute inset-0 z-0 scale-125 opacity-80" />

        <div className="relative z-10 mx-auto grid w-full max-w-[1400px] grid-cols-1 items-center gap-12 px-6 md:grid-cols-[1fr_auto] md:gap-24 md:px-12">
          <div className="max-w-xl space-y-2">
            {SHOWCASE_SECTIONS.map((section: any) => (
              <div key={section.id} className="relative flex flex-col items-start justify-center">
                <h2
                  id={`nav-${section.id}`}
                  className="origin-left cursor-default text-[3rem] font-medium leading-tight sm:text-[3.5rem] md:text-[4.5rem]"
                >
                  {section.title}
                </h2>
                <div id={`section-${section.id}`} className="w-full overflow-hidden">
                  <div className="space-y-6 pb-8">
                    <div className={`flex items-center gap-2 text-sm font-semibold tracking-wide ${section.colorClass}`}>
                      <Sparkles size={14} fill="currentColor" />
                      {section.subtitle}
                    </div>
                    <p className="text-lg font-normal leading-relaxed text-slate-300">{section.description}</p>
                    <Link
                      href="/signup"
                      className={`inline-flex rounded-full px-8 py-3.5 text-xs font-bold uppercase tracking-widest transition-all hover:brightness-110 active:scale-95 ${section.buttonClass}`}
                    >
                      Start with Taskwise
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="relative flex h-[320px] w-[320px] items-center justify-center sm:h-[450px] sm:w-[450px] md:h-[550px] md:w-[550px] lg:h-[650px] lg:w-[650px]">
            <div className="absolute bottom-0 left-[50%] right-[-100vw] top-0 z-0 bg-gradient-to-r from-[#FF7A59] via-[#FF5C8D] to-[#FF3F3F]" />

            <div className="absolute inset-0 z-10 overflow-hidden rounded-full border-[10px] border-white bg-black shadow-[0_0_80px_rgba(0,0,0,0.5)] sm:border-[12px] md:border-[16px]">
              {SHOWCASE_SECTIONS.map((section: any) => (
                <React.Fragment key={`rings-${section.id}`}>
                  <div id={`rings-${section.id}`} className="absolute inset-0 flex items-center justify-center">
                    <div className={`absolute h-[100%] w-[100%] rounded-full ${section.ringColors[0]}`} />
                    <div className={`absolute h-[82%] w-[82%] rounded-full ${section.ringColors[1]}`} />
                    <div className={`absolute h-[64%] w-[64%] rounded-full ${section.ringColors[2]}`} />
                    <div className={`absolute h-[46%] w-[46%] rounded-full ${section.ringColors[3]}`} />
                    <div className={`absolute h-[28%] w-[28%] rounded-full ${section.ringColors[4]}`} />
                  </div>

                  <div
                    id={`card-${section.id}`}
                    className="absolute bottom-[12%] right-[-2%] top-[12%] z-20 flex w-[85%] flex-col overflow-hidden rounded-[1.5rem] border border-white/10 bg-[#191a1e]/95 shadow-[0_20px_50px_rgba(0,0,0,0.8)] backdrop-blur-md"
                  >
                    <div className="relative h-full flex-1 p-6 md:p-8">{section.content}</div>
                  </div>
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

