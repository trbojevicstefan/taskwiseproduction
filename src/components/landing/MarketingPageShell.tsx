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
                  <Link key={item.href} href={item.href} className="hover:text-white">
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
      </main>
    </div>
  );
}
