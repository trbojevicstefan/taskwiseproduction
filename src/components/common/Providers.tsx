// src/components/common/Providers.tsx
"use client";

import { SessionProvider } from "next-auth/react";
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
    // This provides a clear, hierarchical structure.
    // AuthProvider is at the top, as other providers may depend on the user's auth state.
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
              <FolderProvider>
                  <MeetingHistoryProvider>
                    <ChatHistoryProvider>
                      <PlanningHistoryProvider>
                            <IntegrationsProvider>
                               <PasteActionProvider>
                                  <TaskProvider>
                                    {/* GlobalPasteHandler must be INSIDE all the providers it might need to use */}
                                    <GlobalPasteHandler />
                                    {children}
                                  </TaskProvider>
                                </PasteActionProvider>
                            </IntegrationsProvider>
                      </PlanningHistoryProvider>
                    </ChatHistoryProvider>
                  </MeetingHistoryProvider>
              </FolderProvider>
            </AuthProvider>
          </UIStateProvider>
        </SessionProvider>
      </ThemeProvider>
    );
}
