import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { marketingNavItems } from "@/components/landing/marketing-content";

export function MarketingPageShell({
  children,
  showSectionNav = true,
}: {
  children: ReactNode;
  showSectionNav?: boolean;
}) {
  return (
    <div className="dark">
      <main className="min-h-screen bg-[#0B0B0F] text-white">
        <header className="sticky top-0 z-40 border-b border-white/10 bg-black/20 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
            <Link href="/" className="flex items-center gap-3">
              <Logo size="md" />
              <Badge className="hidden sm:inline-flex bg-white/10 text-white">Beta</Badge>
            </Link>
            {showSectionNav ? (
              <nav className="hidden items-center gap-6 text-sm text-white/70 md:flex">
                {marketingNavItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="hover:text-white"
                    target={item.label === "Docs" ? "_blank" : undefined}
                    rel={item.label === "Docs" ? "noopener noreferrer" : undefined}
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
            ) : null}
            <div className="flex items-center gap-3">
              <Button
                variant="secondary"
                className="hidden sm:inline-flex bg-white/10 text-white hover:bg-white/20"
                asChild
              >
                <Link href="/login" prefetch={false}>
                  Sign in
                </Link>
              </Button>
              <Button className="gem-button bg-gradient-to-r from-[#FF4D4D] via-[#FF9900] to-[#FF2E97] text-white" asChild>
                <Link href="/signup" prefetch={false}>
                  Get started
                </Link>
              </Button>
            </div>
          </div>
        </header>
        {children}
        <footer className="relative w-full overflow-hidden border-t border-white/10 bg-black">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_420px_at_50%_0%,rgba(255,120,80,0.22),transparent_55%),radial-gradient(600px_280px_at_50%_55%,rgba(255,255,255,0.05),transparent_60%),linear-gradient(180deg,rgba(255,255,255,0.03),transparent_30%)]" />
          <div className="relative mx-auto flex w-full max-w-none flex-col items-center gap-6 px-4 py-12 text-center sm:px-6 lg:px-10 lg:py-16">
            <p className="text-xs uppercase tracking-[0.26em] text-white/45">TaskwiseAI</p>
            <div className="w-full overflow-hidden">
              <pre className="hidden select-none whitespace-pre text-center font-mono text-[clamp(0.62rem,1.25vw,1.7rem)] leading-[0.98] tracking-[0.06em] text-[#FFB257] drop-shadow-[0_0_18px_rgba(255,145,60,0.42),0_2px_0_rgba(0,0,0,0.82)] sm:block">
{`  ███████████   █████████    █████████  █████   ████ █████   ███   █████ █████  █████████  ██████████
  ▒█▒▒▒███▒▒▒█  ███▒▒▒▒▒███  ███▒▒▒▒▒███▒███   ███▒ ▒▒███   ▒███  ▒▒███ ▒▒███  ███▒▒▒▒▒███▒███▒▒▒▒▒█
  ▒   ▒███  ▒  ▒███    ▒███ ▒███    ▒▒▒  ▒███  ███    ▒███   ▒███   ▒███  ▒███ ▒███    ▒▒▒  ▒███  █ ▒ 
      ▒███     ▒███████████ ▒▒█████████  ▒███████     ▒███   ▒███   ▒███  ▒███ ▒▒█████████  ▒██████   
      ▒███     ▒███▒▒▒▒▒███  ▒▒▒▒▒▒▒▒███ ▒███▒▒███    ▒▒███  █████  ███   ▒███  ▒▒▒▒▒▒▒▒███ ▒███▒▒█   
      ▒███     ▒███    ▒███  ███    ▒███ ▒███ ▒▒███    ▒▒▒█████▒█████▒    ▒███  ███    ▒███ ▒███ ▒   █
      █████    █████   █████▒▒█████████  █████ ▒▒████    ▒▒███ ▒▒███      █████▒▒█████████  ██████████
     ▒▒▒▒▒    ▒▒▒▒▒   ▒▒▒▒▒  ▒▒▒▒▒▒▒▒▒  ▒▒▒▒▒   ▒▒▒▒      ▒▒▒   ▒▒▒      ▒▒▒▒▒  ▒▒▒▒▒▒▒▒▒  ▒▒▒▒▒▒▒▒▒▒
                                                                                                    
                                                                                                    
                                                                                                     `}
              </pre>
              <pre className="mx-auto select-none whitespace-pre text-center font-mono text-[clamp(0.56rem,3.1vw,0.9rem)] leading-[0.95] tracking-[0.08em] text-[#FFB257] drop-shadow-[0_0_12px_rgba(255,145,60,0.34),0_1px_0_rgba(0,0,0,0.82)] sm:hidden">
{`██████████████████████
█   TASKWISEAI     █
██████████████████████`}
              </pre>
            </div>
            <div className="flex w-full flex-col items-center gap-3 border-t border-white/10 pt-5">
              <p className="max-w-2xl text-sm leading-6 text-white/55">
                Turn meetings into reviewed execution with grounded AI, clear prioritization, and
                operator-grade workflow.
              </p>
              <p className="text-xs uppercase tracking-[0.22em] text-white/35">
                Meetings to execution
              </p>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
