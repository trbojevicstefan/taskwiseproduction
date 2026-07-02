"use client";

import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { cn } from "@/lib/utils";

type ResearchBriefOverlayProps = {
  isOpen: boolean;
  phase: "loading" | "complete";
  minDurationMs?: number;
};

const STATUS_TEXTS = [
  "Optimizing Workspace",
  "Parsing Logic",
  "Syncing Database",
  "Compiling Assets",
];

export default function ResearchBriefOverlay({
  isOpen,
  phase,
  minDurationMs = 8000,
}: ResearchBriefOverlayProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState(STATUS_TEXTS[0]);
  const [startedAt, setStartedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setStartedAt(performance.now());
    setProgress(0);
    setStatusText(STATUS_TEXTS[0]);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || phase !== "loading" || startedAt === null) return;

    const tick = () => {
      const elapsed = performance.now() - startedAt;
      const pct = Math.min(95, (elapsed / minDurationMs) * 95);
      setProgress(pct);
      const index = Math.min(
        STATUS_TEXTS.length - 1,
        Math.floor(pct / 25)
      );
      setStatusText(STATUS_TEXTS[index]);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isOpen, minDurationMs, phase, startedAt]);

  useEffect(() => {
    if (!isOpen) return;
    if (phase === "complete") {
      setProgress(100);
      setStatusText("Status: Online");
    }
  }, [isOpen, phase]);

  useEffect(() => {
    if (!isOpen) return;
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      75,
      container.clientWidth / container.clientHeight,
      0.1,
      1000
    );
    camera.position.z = 5;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    const loaderGroup = new THREE.Group();
    scene.add(loaderGroup);

    const wireMaterial = new THREE.MeshBasicMaterial({
      color: 0x000000,
      wireframe: true,
      transparent: true,
      opacity: 0.5,
    });
    const solidMaterial = new THREE.MeshPhongMaterial({
      color: 0x3b82f6,
      shininess: 100,
      flatShading: true,
    });

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);
    const mainLight = new THREE.DirectionalLight(0xffffff, 1);
    mainLight.position.set(5, 5, 5);
    scene.add(mainLight);

    const geometry = new THREE.BoxGeometry(2, 2, 2);
    const cube = new THREE.Mesh(geometry, solidMaterial);
    const wireframe = new THREE.Mesh(geometry, wireMaterial);
    wireframe.scale.set(1.1, 1.1, 1.1);

    loaderGroup.add(cube);
    loaderGroup.add(wireframe);

    const particlesCount = 50;
    const posArray = new Float32Array(particlesCount * 3);
    for (let i = 0; i < particlesCount * 3; i += 1) {
      posArray[i] = (Math.random() - 0.5) * 10;
    }
    const particlesGeometry = new THREE.BufferGeometry();
    particlesGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(posArray, 3)
    );
    const particlesMaterial = new THREE.PointsMaterial({
      size: 0.05,
      color: 0x000000,
    });
    const particles = new THREE.Points(particlesGeometry, particlesMaterial);
    scene.add(particles);

    let frameId: number;
    const start = performance.now();
    const animate = () => {
      const t = (performance.now() - start) / 1000;
      loaderGroup.rotation.x = t * 0.6;
      loaderGroup.rotation.y = t * 0.8;
      cube.scale.set(
        1 + Math.sin(t * 2) * 0.12,
        1 + Math.sin(t * 3) * 0.2,
        1 + Math.sin(t * 2.5) * 0.12
      );
      wireframe.scale.set(
        1.1 + Math.sin(t * 1.1) * 0.15,
        1.1 + Math.sin(t * 1.4) * 0.15,
        1.1 + Math.sin(t * 1.2) * 0.15
      );
      particles.rotation.y += 0.0015;
      renderer.render(scene, camera);
      frameId = requestAnimationFrame(animate);
    };
    animate();

    const handleResize = () => {
      if (!container) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", handleResize);
      geometry.dispose();
      wireMaterial.dispose();
      solidMaterial.dispose();
      particlesGeometry.dispose();
      particlesMaterial.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const percentText = `${Math.round(progress)}%`;
  const progressWidth = `${Math.round(progress)}%`;
  const badgeText = phase === "complete" ? "Status: Online" : "System: Initializing";

  return (
    <div className="absolute inset-0 z-50 overflow-hidden bg-transparent">
      <div ref={containerRef} className="absolute inset-0" />

      <div className="pointer-events-none relative z-10 flex h-full w-full flex-col items-center justify-center gap-6 text-center">
        <div
          className={cn(
            "relative flex h-[120px] w-[120px] items-center justify-center",
            "bg-white border-[5px] border-black shadow-[10px_10px_0_#000]",
            "-rotate-2"
          )}
        >
          <img
            src="https://www.taskwise.ai/logo.svg"
            alt="TaskWise"
            className="h-[70%] w-[70%] object-contain"
          />
        </div>

        <div
          className={cn(
            "px-3 py-1 text-xs font-black uppercase tracking-[0.2em]",
            "border-[3px] border-black shadow-[4px_4px_0_#000]",
            phase === "complete" ? "bg-emerald-400 text-black" : "bg-yellow-300 text-black"
          )}
        >
          {badgeText}
        </div>

        <div className="relative mt-6 w-[280px] overflow-hidden border-2 border-white bg-black px-3 py-2 text-[11px] font-bold uppercase tracking-[0.2em] text-white">
          <div
            className="absolute left-0 top-0 h-full bg-blue-500"
            style={{ width: progressWidth }}
          />
          <div className="relative flex items-center justify-between">
            <span>{statusText}</span>
            <span>{percentText}</span>
          </div>
        </div>
      </div>

      <div
        className={cn(
          "absolute inset-0 z-20 flex items-center justify-center bg-blue-500/90 text-white transition-opacity duration-500",
          phase === "complete" ? "opacity-100" : "pointer-events-none opacity-0"
        )}
      >
        <div className="text-5xl font-black uppercase tracking-tight [-skew-x-12]">
          Complete
        </div>
      </div>
    </div>
  );
}
