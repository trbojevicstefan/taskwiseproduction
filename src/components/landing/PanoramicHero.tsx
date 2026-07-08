"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import * as THREE from "three";
import React, { useEffect, useMemo, useRef, type ReactNode } from "react";

type TerrainAttribute = {
  count: number;
  getX(index: number): number;
  getY(index: number): number;
  setZ(index: number, value: number): void;
  needsUpdate: boolean;
};

const colors = {
  ink: "#f0f0f5",
  muted: "rgba(255,255,255,0.68)",
  border: "rgba(255,255,255,0.08)",
  accent: ["#FF5C4D", "#FF9900", "#FF2E97"],
} as const;

const accentGrad = `linear-gradient(135deg, ${colors.accent[0]}, ${colors.accent[1]}, ${colors.accent[2]})`;

function PanoramicTerrain() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 1, 2400);
    camera.position.set(0, -122, 560);
    camera.lookAt(0, -28, 0);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    const geometry = new THREE.PlaneGeometry(1800, 920, 52, 24);
    const basePositions = geometry.attributes.position.array.slice() as Float32Array;

    const buildTerrain = (time: number, amplitude: number) => {
      const positions = geometry.attributes.position as TerrainAttribute;
      for (let i = 0; i < positions.count; i += 1) {
        const x = basePositions[i * 3];
        const y = basePositions[i * 3 + 1];
        const z =
          Math.sin(x * 0.01 + time * 0.8) * Math.cos(y * 0.009 + time * 0.98) * amplitude +
          Math.sin(x * 0.022 + time * 1.55) * amplitude * 0.32 +
          Math.cos(y * 0.018 - time * 0.38) * amplitude * 0.2;
        positions.setZ(i, z);
      }
      positions.needsUpdate = true;
      geometry.computeVertexNormals();
    };

    buildTerrain(0, 36);

    const wireMat = new THREE.MeshBasicMaterial({
      color: 0x34343a,
      wireframe: true,
      transparent: true,
      opacity: 0.24,
    });
    const mesh = new THREE.Mesh(geometry, wireMat);
    mesh.rotation.x = -Math.PI / 2.08;
    mesh.position.y = -92;
    scene.add(mesh);

    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xff8b3d,
      wireframe: true,
      transparent: true,
      opacity: 0.11,
    });
    const glow = new THREE.Mesh(geometry, glowMat);
    glow.rotation.x = -Math.PI / 2.08;
    glow.position.y = -92;
    glow.scale.set(1.01, 1.01, 1.01);
    scene.add(glow);

    const ptsMat = new THREE.PointsMaterial({
      color: 0xf59e0b,
      size: 1.8,
      transparent: true,
      opacity: 0.86,
    });
    const points = new THREE.Points(geometry, ptsMat);
    points.rotation.x = -Math.PI / 2.08;
    points.position.y = -92;
    scene.add(points);

    let targetX = 0;
    let targetY = 0;
    const onMove = (event: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      targetX = (event.clientX - rect.left - rect.width / 2) * 0.02;
      targetY = (event.clientY - rect.top - rect.height / 2) * 0.02;
    };

    window.addEventListener("mousemove", onMove);

    let animId = 0;
    const animate = () => {
      animId = window.requestAnimationFrame(animate);
      const time = Date.now() * 0.0004;
      buildTerrain(time, 36);
      points.geometry.attributes.position.needsUpdate = true;

      camera.position.x += (targetX - camera.position.x) * 0.03;
      camera.position.y += (-122 - targetY - camera.position.y) * 0.03;
      camera.lookAt(0, -30, 0);
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
      glowMat.dispose();
      ptsMat.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden bg-[#05070d]">
      <div ref={containerRef} className="h-full w-full" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,#1f29370f_2px,transparent_2px),linear-gradient(to_bottom,#1f29370f_2px,transparent_2px)] bg-[size:36px_36px]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-[#05070d] via-[#05070d]/80 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-[#05070d] via-[#05070d]/85 to-transparent" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,transparent_25%,rgba(5,7,13,0.55)_100%)]" />
    </div>
  );
}

export function PanoramicHero({
  label,
  title,
  subtitle,
  primaryHref,
  primaryLabel,
  secondaryHref,
  secondaryLabel,
}: {
  label: string;
  title: ReactNode;
  subtitle: ReactNode;
  primaryHref: string;
  primaryLabel: string;
  secondaryHref: string;
  secondaryLabel: string;
}) {
  const pillStyle = useMemo(
    () => ({
      background: "rgba(255,255,255,0.06)",
      border: `1px solid ${colors.border}`,
    }),
    [],
  );

  return (
    <section className="relative overflow-hidden border-b border-white/10">
      <div className="relative min-h-[34rem] w-full px-4 py-14 sm:px-6 sm:py-16 lg:px-8">
        <div className="absolute inset-0">
          <PanoramicTerrain />
        </div>

        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(6,8,15,0.14)_0%,rgba(6,8,15,0.72)_100%)]" />

        <div className="relative mx-auto flex min-h-[34rem] w-full max-w-7xl items-center">
          <div className="max-w-3xl">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-medium uppercase tracking-[0.22em] text-white/70" style={pillStyle}>
              <span className="h-2 w-2 rounded-full bg-[#FF9900]" />
              {label}
            </div>
            <motion.h1
              className="max-w-4xl text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              style={{ lineHeight: 0.95, letterSpacing: "-0.05em", color: colors.ink }}
            >
              {title}
            </motion.h1>
            <motion.p
              className="mt-5 max-w-2xl text-base leading-7 sm:text-lg"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.1 }}
              style={{ color: colors.muted }}
            >
              {subtitle}
            </motion.p>
            <motion.div
              className="mt-8 flex flex-wrap gap-3"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.18 }}
            >
              <Link
                href={primaryHref}
                className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#FF5C4D] via-[#FF9900] to-[#FF2E97] px-5 py-3 text-sm font-medium text-white shadow-[0_16px_34px_rgba(255,120,60,0.22)] transition-transform duration-300 hover:-translate-y-0.5"
              >
                {primaryLabel}
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href={secondaryHref}
                className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/5 px-5 py-3 text-sm font-medium text-white/88 transition-colors duration-300 hover:bg-white/10"
              >
                {secondaryLabel}
              </Link>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}

