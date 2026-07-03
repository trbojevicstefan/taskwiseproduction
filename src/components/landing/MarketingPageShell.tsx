"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useTheme } from "next-themes";
import { ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Logo } from "@/components/ui/logo";
import type { ReactNode } from "react";
import { marketingNavItems } from "./marketing-content";

type Props = {
  children: ReactNode;
  title: string;
  description: string;
};

export function MarketingPageShell({ children, title, description }: Props) {
  const { setTheme } = useTheme();

  useEffect(() => {
    setTheme("dark");
  }, [setTheme]);

  return (
    <main className="min-h-screen bg-[#0A0B10] text-white">
      <div className="pointer-events-none fixed inset-0 -z-20 bg-[radial-gradient(circle_at_top_left,_rgba(255,92,77,0.22),_transparent_30%),radial-gradient(circle_at_top_right,_rgba(255,153,0,0.16),_transparent_28%),radial-gradient(circle_at_bottom,_rgba(255,46,151,0.18),_transparent_36%)]" />
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/30 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Link href="/" className="inline-flex items-center gap-3">
              <Logo size="md" />
              <div className="hidden sm:block">
                <div className="text-sm font-medium text-white">{title}</div>
                <div className="text-xs text-white/50">{description}</div>
              </div>
            </Link>
            <Badge className="hidden border-white/10 bg-white/10 text-white sm:inline-flex">
              Beta
            </Badge>
          </div>
          <nav className="hidden items-center gap-6 text-sm text-white/65 lg:flex">
            {marketingNavItems.map((item) => (
              <Link key={item.href} href={item.href} className="transition hover:text-white">
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              className="hidden border-white/10 bg-white/10 text-white hover:bg-white/20 sm:inline-flex"
              asChild
            >
              <Link href="/login">Sign in</Link>
            </Button>
            <Button
              className="bg-gradient-to-r from-[#FF5C4D] via-[#FF9900] to-[#FF2E97] text-white shadow-[0_20px_60px_rgba(255,92,77,0.25)]"
              asChild
            >
              <Link href="/signup">
                Get started
                <ChevronRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </header>
      <div className="relative">{children}</div>
      <footer className="border-t border-white/10 bg-black/40">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-8 text-sm text-white/60 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <p>TaskwiseAI turns meetings into reviewed execution.</p>
          <div className="flex flex-wrap gap-4">
            {marketingNavItems.map((item) => (
              <Link key={item.href} href={item.href} className="transition hover:text-white">
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      </footer>
    </main>
  );
}
