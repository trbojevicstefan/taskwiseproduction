// src/components/layouts/DashboardPageLayout.tsx
"use client";

import type { ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import React, { useEffect, useState } from 'react';
import SidebarNav from '@/components/dashboard/SidebarNav';
import { Logo } from '@/components/ui/logo';
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  useSidebar,
} from '@/components/ui/sidebar'; 
import { cn } from '@/lib/utils';
import AnimatedTaskHero from '@/components/landing/AnimatedTaskHero';
import OnboardingWizard from '@/components/auth/OnboardingWizard';

const DashboardContentWrapper = ({ children }: { children: ReactNode }) => {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [isOnboardingVisible, setIsOnboardingVisible] = useState(true);

  // This effect is now just for showing the loading screen or handling a logged-out user trying to access a protected route.
  // The primary redirection logic is in AuthContext.
  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (user && !user.onboardingCompleted) {
      setIsOnboardingVisible(true);
    }
  }, [user?.uid, user?.onboardingCompleted]);

  if (loading || !user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-background p-4 overflow-hidden">
        <Logo size="lg" className="mb-6" />
        <div className="relative w-full max-w-2xl h-96 flex items-center justify-center">
            <AnimatedTaskHero />
        </div>
        <p className="mt-8 text-muted-foreground font-body text-lg">
          Loading your workspace...
        </p>
      </div>
    );
  }

  // Once user is loaded, decide whether to show the app or the onboarding wizard.
  return (
    <>
      {!user.onboardingCompleted && isOnboardingVisible && (
        <OnboardingWizard onClose={() => setIsOnboardingVisible(false)} />
      )}
      {(user.onboardingCompleted || !isOnboardingVisible) && children}
    </>
  );
};

const SidebarLogo = () => {
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";
  return (
    <div className={cn("flex w-full", isCollapsed ? "justify-center" : "justify-start")}>
      <Logo size={isCollapsed ? "sm" : "md"} isIconOnly={isCollapsed} />
    </div>
  );
};

const SidebarHeaderContent = () => {
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";
  return (
    <SidebarHeader
      className={cn(
        "flex-row items-center gap-0",
        isCollapsed ? "p-2 justify-center" : "p-4 justify-start"
      )}
    >
      <SidebarLogo />
    </SidebarHeader>
  );
};

export default function DashboardPageLayout({ children }: { children: ReactNode }) {
  return (
    <DashboardContentWrapper>
      <SidebarProvider defaultOpen={true}>
        <div className="flex h-screen bg-muted/30">
          <Sidebar variant="sidebar" collapsible="icon" side="left">
            <SidebarHeaderContent />
            <SidebarContent>
              <SidebarNav />
            </SidebarContent>
          </Sidebar>
          <main className="flex-1 flex flex-col h-screen overflow-hidden">
            {children}
          </main>
        </div>
      </SidebarProvider>
    </DashboardContentWrapper>
  );
}
