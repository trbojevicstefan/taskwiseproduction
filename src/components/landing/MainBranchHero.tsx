"use client";
// src/components/landing/MainBranchHero.tsx

import React from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { Brain, ChevronRight, GitBranch, Zap } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import AnimatedTaskHero from "@/components/landing/AnimatedTaskHero";

const brandGradient =
  "bg-[radial-gradient(1200px_600px_at_10%_10%,rgba(255,86,48,0.25),transparent_60%),radial-gradient(1200px_600px_at_90%_20%,rgba(255,175,0,0.25),transparent_60%),radial-gradient(1200px_600px_at_50%_90%,rgba(255,0,128,0.25),transparent_60%)]";
const STAR_COUNT = 220;
const HERO_STARFIELD_SCALE = 1.25;
const HERO_STAR_DRIFT_X = 16;
const HERO_STAR_DRIFT_Y = 12;

const GradientText = ({ children }: { children: React.ReactNode }) => (
  <span className="bg-gradient-to-r from-[#FF4D4D] via-[#FF9900] to-[#FF2E97] bg-clip-text text-transparent">
    {children}
  </span>
);

export function MainBranchHero() {
  const { setTheme } = useTheme();
  const starsRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    setTheme("dark");
  }, [setTheme]);

  React.useEffect(() => {
    const starContainer = starsRef.current;
    if (!starContainer) {
      return;
    }

    starContainer.innerHTML = "";
    const stars = Array.from({ length: STAR_COUNT }, () => {
      const star = document.createElement("div");
      const size = Math.random() * 2.4 + 1.2;
      const baseOpacity = Math.random() * 0.6 + 0.45;

      star.className = "absolute rounded-full bg-white";
      star.style.width = `${size}px`;
      star.style.height = `${size}px`;
      star.style.left = `${Math.random() * 100}%`;
      star.style.top = `${Math.random() * 100}%`;
      star.style.opacity = `${baseOpacity}`;
      star.style.boxShadow = "0 0 6px rgba(255,255,255,0.95)";

      starContainer.appendChild(star);
      return {
        node: star,
        phase: Math.random() * Math.PI * 2,
        driftX: Math.random() * 0.6 + 0.4,
        driftY: Math.random() * 0.5 + 0.35,
        baseOpacity,
      };
    });

    let animationFrame = 0;

    const tick = (timestamp: number) => {
      const time = timestamp * 0.001;
      const offsetX = Math.sin(time * 0.08) * HERO_STAR_DRIFT_X;
      const offsetY = Math.cos(time * 0.06) * HERO_STAR_DRIFT_Y;

      starContainer.style.transform = `translate3d(${offsetX}px, ${offsetY}px, 0) scale(${HERO_STARFIELD_SCALE})`;

      stars.forEach(({ node, phase, driftX, driftY, baseOpacity }, index) => {
        const twinkle = 0.22 * Math.sin(time * driftX + phase);
        const shimmer = 0.08 * Math.cos(time * driftY + index * 0.17);
        node.style.opacity = `${Math.max(0.15, Math.min(1, baseOpacity + twinkle + shimmer))}`;
      });

      animationFrame = window.requestAnimationFrame(tick);
    };

    animationFrame = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      starContainer.innerHTML = "";
    };
  }, []);

  return (
    <section className={`relative isolate overflow-hidden ${brandGradient}`}>
      <div className="pointer-events-none absolute inset-0 -z-20 bg-[radial-gradient(900px_520px_at_18%_18%,rgba(255,120,48,0.26),transparent_60%),radial-gradient(820px_420px_at_82%_24%,rgba(255,64,128,0.16),transparent_62%),radial-gradient(700px_420px_at_50%_100%,rgba(255,128,32,0.22),transparent_58%)]" />
      <div
        ref={starsRef}
        className="pointer-events-none absolute inset-0 opacity-90"
        style={{ zIndex: 0, mixBlendMode: "screen", transform: `scale(${HERO_STARFIELD_SCALE})` }}
      />
      <div className="pointer-events-none absolute -left-28 top-24 -z-10 h-72 w-72 rounded-full bg-[#FF6B2D]/25 blur-3xl sm:h-96 sm:w-96" />
      <div className="pointer-events-none absolute -right-24 top-20 -z-10 h-72 w-72 rounded-full bg-[#FF2E97]/18 blur-3xl sm:h-[28rem] sm:w-[28rem]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-px bg-white/10" />

      <div className="relative z-20 mx-auto grid w-full max-w-7xl gap-12 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-16 lg:px-8 lg:py-24">
        <div className="max-w-3xl space-y-8">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="border-white/10 bg-white/10 text-white/90">Launch page</Badge>
            <Badge className="border-white/10 bg-white/5 text-white/70">
              Meetings in, reviewed work out
            </Badge>
          </div>

          <div className="space-y-5">
            <h1 className="max-w-4xl text-4xl font-semibold leading-[1.02] tracking-tight text-white sm:text-5xl lg:text-6xl">
              Turn meetings into <GradientText>reviewed task lists</GradientText> in seconds
            </h1>
            <p className="max-w-2xl text-base leading-7 text-white/72 sm:text-lg">
              TaskwiseAI turns pasted notes, transcripts, and Fathom meetings into suggested tasks
              your team can review, assign, and track on a board.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="lg"
              className="gem-button bg-gradient-to-r from-[#FF4D4D] via-[#FF9900] to-[#FF2E97] text-white"
              asChild
            >
              <Link href="/signup">Try it free</Link>
            </Button>
            <Button size="lg" variant="secondary" className="bg-white/10 text-white hover:bg-white/20">
              Watch demo <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-white/60">
            <span className="inline-flex items-center gap-2">
              <Zap className="h-4 w-4" /> No credit card
            </span>
            <span className="inline-flex items-center gap-2">
              <Brain className="h-4 w-4" /> GPT-powered
            </span>
            <span className="inline-flex items-center gap-2">
              <GitBranch className="h-4 w-4" /> Clear dependencies
            </span>
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="relative mt-8 w-full overflow-visible lg:mt-0 lg:max-w-[680px]"
        >
          <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(closest-side_at_50%_50%,rgba(255,143,64,0.18),transparent_72%)]" />
          <AnimatedTaskHero />
        </motion.div>
      </div>
    </section>
  );
}
