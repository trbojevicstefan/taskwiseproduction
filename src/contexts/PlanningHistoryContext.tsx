// src/contexts/PlanningHistoryContext.tsx
"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { PlanningSession, ExtractedTaskSchema } from '@/types/chat';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from '@/lib/api';
import { normalizeTask } from '@/lib/data';

export type DetailLevel = 'light' | 'medium' | 'detailed';

interface PlanningHistoryContextType {
  planningSessions: PlanningSession[];
  activePlanningSessionId: string | null;
  isLoadingPlanningHistory: boolean;
  setActivePlanningSessionId: (sessionId: string | null) => void;
  createNewPlanningSession: (
    inputText: string, 
    extractedTasks: ExtractedTaskSchema[], 
    title?: string, 
    allTaskLevels?: any, // Accept allTaskLevels
    sourceMeetingId?: string
  ) => Promise<PlanningSession | undefined>;
  getActivePlanningSession: () => PlanningSession | undefined;
  updatePlanningSessionTitle: (sessionId: string, newTitle: string) => Promise<void>;
  deletePlanningSession: (sessionId: string) => Promise<void>;
  updateActivePlanningSession: (updatedFields: Partial<Omit<PlanningSession, 'id' | 'userId' | 'createdAt' | 'lastActivityAt'>>) => Promise<void>;
  updatePlanningSession: (sessionId: string, updatedFields: Partial<Omit<PlanningSession, 'id' | 'userId' | 'createdAt' | 'lastActivityAt'>>) => Promise<void>;
}

const PlanningHistoryContext = createContext<PlanningHistoryContextType | undefined>(undefined);

export const PlanningHistoryProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [planningSessions, setPlanningSessions] = useState<PlanningSession[]>([]);
  const [activePlanningSessionId, setActivePlanningSessionIdState] = useState<string | null>(null);
  const [isLoadingPlanningHistory, setIsLoadingPlanningHistory] = useState(true);

  useEffect(() => {
    if (user?.uid) {
      setIsLoadingPlanningHistory(true);
      apiFetch<PlanningSession[]>("/api/planning-sessions")
        .then((loadedSessions) => {
          const sanitizeLevels = (levels: any) =>
            levels
              ? {
                  light: (levels.light || []).map((task: any) =>
                    normalizeTask(task as ExtractedTaskSchema)
                  ),
                  medium: (levels.medium || []).map((task: any) =>
                    normalizeTask(task as ExtractedTaskSchema)
                  ),
                  detailed: (levels.detailed || []).map((task: any) =>
                    normalizeTask(task as ExtractedTaskSchema)
                  ),
                }
              : null;
          const sanitizedSessions = loadedSessions.map(s => ({
              ...s,
              extractedTasks: (s.extractedTasks || []).map(task => normalizeTask(task as ExtractedTaskSchema)),
              originalAiTasks: (s.originalAiTasks || []).map(task => normalizeTask(task as ExtractedTaskSchema)),
              originalAllTaskLevels: sanitizeLevels(s.originalAllTaskLevels),
              allTaskLevels: sanitizeLevels(s.allTaskLevels),
              taskRevisions: s.taskRevisions || [],
          }));
          setPlanningSessions(sanitizedSessions);

          const timeValue = (value: any) =>
            value?.toMillis ? value.toMillis() : value ? new Date(value).getTime() : 0;

          setActivePlanningSessionIdState(prevActiveId => {
            if (prevActiveId && sanitizedSessions.some(s => s.id === prevActiveId)) {
              return prevActiveId;
            }
            const sortedSessions = [...sanitizedSessions].sort(
              (a, b) => timeValue(b.lastActivityAt) - timeValue(a.lastActivityAt)
            );
            return sortedSessions.length > 0 ? sortedSessions[0].id : null;
          });
        })
        .finally(() => {
          setIsLoadingPlanningHistory(false);
        });
    } else {
      setPlanningSessions([]);
      setActivePlanningSessionIdState(null);
      setIsLoadingPlanningHistory(false);
    }
  }, [user]);

  const setActivePlanningSessionId = useCallback((sessionId: string | null) => {
    setActivePlanningSessionIdState(sessionId);
  }, []);

  const createNewPlanningSession = useCallback(async (
    inputText: string, 
    extractedTasks: ExtractedTaskSchema[], 
    title?: string, 
    allTaskLevels?: any,
    sourceMeetingId?: string
  ): Promise<PlanningSession | undefined> => {
    if (!user?.uid) {
      toast({ title: "Error", description: "You must be logged in.", variant: "destructive" });
      return undefined;
    }
    const now = new Date();
    const sessionTitle = title || inputText.substring(0, 40).split('\n')[0] + (inputText.length > 40 ? '...' : '') || `Plan ${now.toLocaleTimeString()}`;

    const sanitizedExtractedTasks = (extractedTasks || []).map(task => normalizeTask(task as ExtractedTaskSchema));
    const sanitizeLevels = (levels: any) =>
      levels
        ? {
            light: (levels.light || []).map((task: any) =>
              normalizeTask(task as ExtractedTaskSchema)
            ),
            medium: (levels.medium || []).map((task: any) =>
              normalizeTask(task as ExtractedTaskSchema)
            ),
            detailed: (levels.detailed || []).map((task: any) =>
              normalizeTask(task as ExtractedTaskSchema)
            ),
          }
        : null;
    const sanitizedTaskLevels = sanitizeLevels(allTaskLevels);

    const newSessionData: Omit<PlanningSession, 'id' | 'userId'| 'createdAt' | 'lastActivityAt'> = {
      title: sessionTitle,
      inputText,
      extractedTasks: sanitizedExtractedTasks,
      originalAiTasks: sanitizedExtractedTasks,
      originalAllTaskLevels: sanitizedTaskLevels,
      taskRevisions:
        sanitizedExtractedTasks.length > 0
          ? [
              {
                id: uuidv4(),
                createdAt: Date.now(),
                source: "ai",
                summary: "Initial AI extraction",
                tasksSnapshot: sanitizedExtractedTasks,
              },
            ]
          : [],
      folderId: null,
      sourceMeetingId: sourceMeetingId || null,
      allTaskLevels: sanitizedTaskLevels,
    };
    try {
      const created = await apiFetch<PlanningSession>("/api/planning-sessions", {
        method: "POST",
        body: JSON.stringify(newSessionData),
      });
      setActivePlanningSessionIdState(created.id);
      setPlanningSessions(prev => [created, ...prev]);
      return created;
    } catch (error) {
      console.error("Failed to create new planning session in database", error);
      toast({ title: "Error", description: "Could not create new plan.", variant: "destructive" });
      return undefined;
    }
  }, [user, toast]);
  
  const updatePlanningSession = useCallback(async (sessionId: string, updatedFields: Partial<Omit<PlanningSession, 'id' | 'userId' | 'createdAt' | 'lastActivityAt'>>) => {
    if (!user?.uid) return;
    let fieldsToUpdate = { ...updatedFields };
    if (fieldsToUpdate.extractedTasks) {
        fieldsToUpdate.extractedTasks = (fieldsToUpdate.extractedTasks || []).map(task => normalizeTask(task as ExtractedTaskSchema));
    }
     try {
      const updated = await apiFetch<PlanningSession>(`/api/planning-sessions/${sessionId}`, {
        method: "PATCH",
        body: JSON.stringify(fieldsToUpdate),
      });
      setPlanningSessions(prev => prev.map(session => session.id === updated.id ? updated : session));
    } catch (error) {
      console.error(`Failed to update planning session ${sessionId} in database`, error);
      toast({ title: "Error", description: "Could not save plan changes.", variant: "destructive" });
    }
  }, [user, toast]);

  const updateActivePlanningSession = useCallback(async (updatedFields: Partial<Omit<PlanningSession, 'id' | 'userId' | 'createdAt' | 'lastActivityAt'>>) => {
      if(activePlanningSessionId) {
          await updatePlanningSession(activePlanningSessionId, updatedFields);
      }
  }, [activePlanningSessionId, updatePlanningSession]);

  const getActivePlanningSession = useCallback((): PlanningSession | undefined => {
    return planningSessions.find(s => s.id === activePlanningSessionId);
  }, [planningSessions, activePlanningSessionId]);

  const updatePlanningSessionTitle = useCallback(async (sessionId: string, newTitle: string) => {
    if (!user?.uid) return;
    try {
      const updated = await apiFetch<PlanningSession>(`/api/planning-sessions/${sessionId}`, {
        method: "PATCH",
        body: JSON.stringify({ title: newTitle }),
      });
      setPlanningSessions(prev => prev.map(session => session.id === updated.id ? updated : session));
    } catch (error) {
      console.error("Failed to update plan title in database", error);
      toast({ title: "Error", description: "Could not update plan title.", variant: "destructive" });
    }
  }, [user, toast]);

  const deletePlanningSession = useCallback(async (sessionId: string) => {
    if (!user?.uid) return;
    const sessionToDelete = planningSessions.find(s => s.id === sessionId);
    try {
      // First, unlink from the meeting if necessary
      if (sessionToDelete?.sourceMeetingId) {
          await apiFetch(`/api/meetings/${sessionToDelete.sourceMeetingId}`, {
            method: "PATCH",
            body: JSON.stringify({ planningSessionId: null }),
          });
      }
      // Then, delete the planning session document
      await apiFetch(`/api/planning-sessions/${sessionId}`, { method: "DELETE" });
      setPlanningSessions(prev => prev.filter(session => session.id !== sessionId));
      if (activePlanningSessionId === sessionId) {
        setActivePlanningSessionIdState(null); 
      }
      toast({ title: "Plan Deleted", description: "The planning session has been removed." });
    } catch (error) {
      console.error("Failed to delete plan from database", error);
      toast({ title: "Error", description: "Could not delete plan.", variant: "destructive" });
    }
  }, [user, toast, activePlanningSessionId, planningSessions]);

  return (
    <PlanningHistoryContext.Provider value={{
      planningSessions,
      activePlanningSessionId: activePlanningSessionId,
      isLoadingPlanningHistory,
      setActivePlanningSessionId,
      createNewPlanningSession,
      getActivePlanningSession,
      updatePlanningSessionTitle,
      deletePlanningSession,
      updateActivePlanningSession,
      updatePlanningSession,
    }}>
      {children}
    </PlanningHistoryContext.Provider>
  );
};

export const usePlanningHistory = () => {
  const context = useContext(PlanningHistoryContext);
  if (context === undefined) {
    throw new Error('usePlanningHistory must be used within a PlanningHistoryProvider');
  }
  return context;
};

