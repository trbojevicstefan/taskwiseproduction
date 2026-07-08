"use client";

import React, { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Check, ChevronDown } from "lucide-react";
import { motion } from "framer-motion";
import { useTheme } from "next-themes";
import * as THREE from "three";

import { BrandIcon } from "@/components/landing/BrandIcon";
import { integrationCards } from "@/components/landing/marketing-content";

const T = {
  ink: "#f0f0f5",
  muted: "rgba(255,255,255,0.48)",
  faint: "rgba(255,255,255,0.28)",
  border: "rgba(255,255,255,0.06)",
  accent: ["#FF5C4D", "#FF9900", "#FF2E97"],
  amber: "#F59E0B",
} as const;

const accentGrad = `linear-gradient(135deg, ${T.accent[0]}, ${T.accent[1]}, ${T.accent[2]})`;

type TerrainAttribute = {
  count: number;
  getX(index: number): number;
  getY(index: number): number;
  getZ(index: number): number;
  setZ(index: number, value: number): void;
  needsUpdate: boolean;
};

const G = ({ children }: { children: ReactNode }) => (
  <span
    style={{
      background: accentGrad,
      WebkitBackgroundClip: "text",
      WebkitTextFillColor: "transparent",
      backgroundClip: "text",
    }}
  >
    {children}
  </span>
);

function TopographicField() {
  const containerRef = useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 1, 2400);
    camera.position.set(0, 182, 560);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    const planeW = 1600;
    const planeH = 1200;
    const segW = 46;
    const segH = 32;
    const geometry = new THREE.PlaneGeometry(planeW, planeH, segW, segH);
    const basePositions = geometry.attributes.position.array.slice() as Float32Array;

    const buildTerrain = (time: number, amplitude: number) => {
      const positions = geometry.attributes.position as TerrainAttribute;
      for (let i = 0; i < positions.count; i += 1) {
        const x = basePositions[i * 3];
        const y = basePositions[i * 3 + 1];
        const z =
          Math.sin(x * 0.01 + time * 0.8) * Math.cos(y * 0.009 + time * 0.98) * amplitude +
          Math.sin(x * 0.022 + time * 1.55) * amplitude * 0.36 +
          Math.cos(y * 0.018 - time * 0.38) * amplitude * 0.24;
        positions.setZ(i, z);
      }
      positions.needsUpdate = true;
      geometry.computeVertexNormals();
    };

    buildTerrain(0, 64);

    const wireMat = new THREE.MeshBasicMaterial({
      color: 0x3b3b3f,
      wireframe: true,
      transparent: true,
      opacity: 0.42,
    });
    const mesh = new THREE.Mesh(geometry, wireMat);
    mesh.rotation.x = -Math.PI / 2.12;
    mesh.position.y = -92;
    scene.add(mesh);

    const wireGlowMat = new THREE.MeshBasicMaterial({
      color: 0x8f5a2d,
      wireframe: true,
      transparent: true,
      opacity: 0.16,
    });
    const wireGlow = new THREE.Mesh(geometry, wireGlowMat);
    wireGlow.rotation.x = -Math.PI / 2.12;
    wireGlow.position.y = -92;
    wireGlow.scale.set(1.008, 1.008, 1.008);
    scene.add(wireGlow);

    const ptsMat = new THREE.PointsMaterial({
      color: 0xf59e0b,
      size: 2.25,
      transparent: true,
      opacity: 0.96,
    });
    const points = new THREE.Points(geometry, ptsMat);
    points.rotation.x = -Math.PI / 2.12;
    points.position.y = -92;
    scene.add(points);

    let targetX = 0;
    let targetY = 0;
    const onMove = (event: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      targetX = (event.clientX - rect.left - rect.width / 2) * 0.04;
      targetY = (event.clientY - rect.top - rect.height / 2) * 0.04;
    };

    window.addEventListener("mousemove", onMove);

    let animId = 0;
    const animate = () => {
      animId = window.requestAnimationFrame(animate);
      const time = Date.now() * 0.0004;
      buildTerrain(time, 64);
      pointPositionsUpdate(points);

      camera.position.x += (targetX - camera.position.x) * 0.03;
      camera.position.y += (182 - targetY - camera.position.y) * 0.03;
      camera.lookAt(0, -70, 0);
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      camera.aspect = cw / ch;
      camera.updateProjectionMatrix();
      renderer.setSize(cw, ch);
    };

    window.addEventListener("resize", onResize);
    onResize();

    return () => {
      window.cancelAnimationFrame(animId);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("resize", onResize);
      if (renderer.domElement && container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      geometry.dispose();
      wireMat.dispose();
      wireGlowMat.dispose();
      ptsMat.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <div className="absolute inset-0 h-full w-full overflow-hidden select-none bg-[#05070d] pointer-events-none">
      <div ref={containerRef} className="h-full w-full pointer-events-auto" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,#1f293712_3px,transparent_3px),linear-gradient(to_bottom,#1f293712_3px,transparent_3px)] bg-[size:48px_48px]" />
      <div className="pointer-events-none absolute left-0 top-0 h-44 w-full bg-gradient-to-b from-[#05070d] via-[#05070d]/80 to-transparent" />
      <div className="pointer-events-none absolute bottom-0 left-0 h-72 w-full bg-gradient-to-t from-[#05070d] via-[#05070d]/90 to-transparent" />
    </div>
  );
}

function pointPositionsUpdate(points: { geometry: { attributes: { position: { needsUpdate: boolean } } } }) {
  points.geometry.attributes.position.needsUpdate = true;
}

const MagneticBtn = ({
  children,
  href,
  variant = "primary",
}: {
  children: ReactNode;
  href: string;
  variant?: "primary" | "ghost";
}) => {
  const ref = useRef<HTMLAnchorElement>(null);
  const [p, setP] = useState({ x: 0, y: 0 });
  const [h, setH] = useState(false);

  const onM = useCallback((event: React.MouseEvent) => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setP({ x: event.clientX - r.left - r.width / 2, y: event.clientY - r.top - r.height / 2 });
  }, []);

  const isPrimary = variant === "primary";

  return (
    <Link
      ref={ref}
      href={href}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => {
        setH(false);
        setP({ x: 0, y: 0 });
      }}
      onMouseMove={onM}
      className="relative inline-flex items-center gap-2 overflow-hidden rounded-lg px-6 py-3 text-sm font-medium transition-all duration-300"
      style={{
        transform: h ? `translate(${p.x * 0.15}px, ${p.y * 0.15}px)` : "none",
        background: isPrimary ? accentGrad : "rgba(255,255,255,0.03)",
        color: T.ink,
        border: isPrimary ? "none" : `1px solid ${T.border}`,
        boxShadow: isPrimary ? "0 8px 40px rgba(255,92,77,0.25)" : "none",
      }}
    >
      {children}
      <ArrowRight className="h-3.5 w-3.5" />
    </Link>
  );
};

export function MainBranchHero() {
  const { setTheme } = useTheme();

  React.useEffect(() => {
    setTheme("dark");
  }, [setTheme]);

  return (
    <section className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-5 pt-24 text-center">
      <TopographicField />

      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(ellipse at 50% 40%, transparent 30%, rgba(6,8,15,0.8) 100%)" }}
      />

      <motion.h1
        className="relative z-10 mt-2 max-w-6xl text-5xl font-semibold tracking-tight sm:text-7xl lg:text-[7.4rem]"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
        style={{ lineHeight: 0.9, letterSpacing: "-0.062em", color: T.ink }}
      >
        Turn meetings into <G>prioritized, reviewed execution.</G>
      </motion.h1>

      <motion.p
        className="relative z-10 mt-6 max-w-[900px] text-xl leading-relaxed sm:text-2xl"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.25 }}
        style={{ color: T.muted }}
      >
        AI that ingests your meetings, structures the chaos, and delivers reviewed action items to
        your team - automatically.
      </motion.p>

      <motion.div
        className="relative z-10 mt-10 flex flex-wrap justify-center gap-3"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.4 }}
      >
        <MagneticBtn href="/signup">Try it free</MagneticBtn>
        <MagneticBtn href="/features" variant="ghost">
          Explore features
        </MagneticBtn>
      </motion.div>

      <motion.div
        className="relative z-10 mt-12 flex flex-wrap items-center justify-center gap-6 text-base"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.7 }}
        style={{ color: T.faint }}
      >
        {["Review-first workflow", "Deterministic prioritization", "MCP operator layer"].map((label, index) => (
          <span key={label} className="flex items-center gap-2">
            <Check className="h-3.5 w-3.5" style={{ color: T.accent[index % 3] }} />
            {label}
          </span>
        ))}
      </motion.div>

      <motion.div
        animate={{ y: [0, 8, 0] }}
        transition={{ repeat: Infinity, duration: 2 }}
        className="absolute bottom-6 z-10"
      >
        <ChevronDown className="h-5 w-5" style={{ color: T.faint }} />
      </motion.div>

      <IntegrationsMarquee />
    </section>
  );
}

function IntegrationsMarquee() {
  const items = useMemo(() => {
    const base = integrationCards;
    return [...base, ...base];
  }, []);

  return (
    <div className="absolute bottom-0 left-0 right-0 z-20 overflow-hidden border-t border-white/10 bg-black/30 backdrop-blur-sm">
      <div className="flex min-w-max gap-3 py-4 animate-[marquee_28s_linear_infinite]">
        {items.map((card, index) => {
          const frameClassName =
            card.name === "Fathom"
              ? "border-transparent bg-transparent shadow-none"
              : card.name === "MCP"
                ? "border-white/10 bg-gradient-to-br from-[#FF5C4D]/20 via-[#FF9900]/15 to-[#FF2E97]/20"
                : card.name === "Manual paste"
                  ? "border-white/10 bg-gradient-to-br from-white/[0.08] via-[#FF9900]/10 to-[#FF2E97]/15"
                  : "border-white/10 bg-black/10";

          return (
            <div
              key={`${card.name}-${index}`}
              className="flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 shadow-[0_10px_30px_rgba(0,0,0,0.25)]"
            >
              <BrandIcon
                src={card.iconSrc}
                alt={card.iconAlt}
                bare={card.name === "Fathom"}
                className={`h-11 w-11 rounded-full ${frameClassName}`}
                imageClassName={
                  card.name === "MCP"
                    ? "h-7 w-7"
                    : card.name === "Manual paste"
                      ? "h-7 w-7"
                      : card.name === "Fathom"
                        ? "h-8 w-8"
                        : card.name === "Google Workspace" || card.name === "Slack"
                          ? "h-8 w-8"
                          : "h-6 w-6"
                }
              />
              <div className="text-left">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white">{card.name}</span>
                </div>
                <p className="text-xs text-white/60">{card.title}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default MainBranchHero;
