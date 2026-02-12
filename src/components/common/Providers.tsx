// src/components/common/Providers.tsx
"use client";

import { SessionProvider } from "next-auth/react";
import { usePathname } from "next/navigation";
import { AuthProvider } from '@/contexts/AuthContext';
import { ChatHistoryProvider } from '@/contexts/ChatHistoryContext';
import { PlanningHistoryProvider } from '@/contexts/PlanningHistoryContext';
import { IntegrationsProvider } from '@/contexts/IntegrationsContext';
import { ThemeProvider } from "next-themes";
import { PasteActionProvider } from '@/contexts/PasteActionContext';
import GlobalPasteHandler from '@/components/common/GlobalPasteHandler';
import { FolderProvider } from '@/contexts/FolderContext';
import { TaskProvider } from '@/contexts/TaskContext';
import { UIStateProvider } from '@/contexts/UIStateContext';
import { MeetingHistoryProvider } from '@/contexts/MeetingHistoryContext';

export function Providers({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const dashboardPrefixes = [
    "/meetings",
    "/chat",
    "/planning",
    "/explore",
    "/reports",
    "/people",
    "/settings",
    "/workspaces",
  ];
  const isDashboardRoute = dashboardPrefixes.some(
    (prefix) => pathname === prefix || pathname?.startsWith(`${prefix}/`)
  );
  const needsTaskContext = pathname === "/reports" || pathname?.startsWith("/reports/");

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <SessionProvider>
        <UIStateProvider>
          <AuthProvider>
            {isDashboardRoute ? (
              <FolderProvider>
                <MeetingHistoryProvider>
                  <ChatHistoryProvider>
                    <PlanningHistoryProvider>
                      <IntegrationsProvider>
                        <PasteActionProvider>
                          <TaskProvider enabled={Boolean(needsTaskContext)}>
                            <GlobalPasteHandler />
                            {children}
                          </TaskProvider>
                        </PasteActionProvider>
                      </IntegrationsProvider>
                    </PlanningHistoryProvider>
                  </ChatHistoryProvider>
                </MeetingHistoryProvider>
              </FolderProvider>
            ) : (
              children
            )}
          </AuthProvider>
        </UIStateProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}
