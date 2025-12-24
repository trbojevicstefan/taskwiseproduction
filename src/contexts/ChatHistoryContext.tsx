// src/contexts/ChatHistoryContext.tsx
"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { Message, ChatSession, ExtractedTaskSchema } from '@/types/chat';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from '@/lib/api';
import { sanitizeTaskForFirestore } from '@/lib/data';


interface ChatHistoryContextType {
  sessions: ChatSession[];
  activeSessionId: string | null;
  isLoadingHistory: boolean;
  setActiveSessionId: (sessionId: string | null) => void;
  createNewSession: (options?: {
    initialMessage?: Message;
    title?: string;
    sourceMeetingId?: string;
    initialTasks?: ExtractedTaskSchema[];
    initialPeople?: any[];
    allTaskLevels?: any;
  }) => Promise<ChatSession | undefined>;
  addMessageToActiveSession: (message: Message) => Promise<void>;
  getActiveSession: () => ChatSession | undefined;
  updateSessionTitle: (sessionId: string, newTitle: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  updateActiveSessionSuggestions: (suggestions: ExtractedTaskSchema[]) => Promise<void>;
  removeSuggestionFromActiveSession: (suggestionId: string) => Promise<void>;
  updateSession: (sessionId: string, updatedFields: Partial<Omit<ChatSession, 'id' | 'userId' | 'createdAt' | 'lastActivityAt'>>) => Promise<void>;
}

const ChatHistoryContext = createContext<ChatHistoryContextType | undefined>(undefined);

export const ChatHistoryProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionIdState] = useState<string | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);

  useEffect(() => {
    if (user?.uid) {
      setIsLoadingHistory(true);
      apiFetch<ChatSession[]>("/api/chat-sessions")
        .then((loadedSessions) => {
          const sanitizeLevels = (levels: any) =>
            levels
              ? {
                  light: (levels.light || []).map((task: any) =>
                    sanitizeTaskForFirestore(task as ExtractedTaskSchema)
                  ),
                  medium: (levels.medium || []).map((task: any) =>
                    sanitizeTaskForFirestore(task as ExtractedTaskSchema)
                  ),
                  detailed: (levels.detailed || []).map((task: any) =>
                    sanitizeTaskForFirestore(task as ExtractedTaskSchema)
                  ),
                }
              : null;
          const sanitizedSessions = loadedSessions.map(s => ({
            ...s,
            suggestedTasks: (s.suggestedTasks || []).map(t => sanitizeTaskForFirestore(t as ExtractedTaskSchema)),
            originalAiTasks: (s.originalAiTasks || []).map(t => sanitizeTaskForFirestore(t as ExtractedTaskSchema)),
            originalAllTaskLevels: sanitizeLevels(s.originalAllTaskLevels),
            allTaskLevels: sanitizeLevels(s.allTaskLevels),
            taskRevisions: s.taskRevisions || [],
            createdAt: s.createdAt,
            lastActivityAt: s.lastActivityAt,
            people: s.people || [],
          }));
          setSessions(sanitizedSessions);

          const timeValue = (value: any) =>
            value?.toMillis ? value.toMillis() : value ? new Date(value).getTime() : 0;

          setActiveSessionIdState(prevActiveId => {
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
          setIsLoadingHistory(false);
        });
    } else {
      setSessions([]);
      setActiveSessionIdState(null);
      setIsLoadingHistory(false);
    }
  }, [user]);

  const setActiveSessionId = useCallback((sessionId: string | null) => {
    setActiveSessionIdState(sessionId);
  }, []);

  const createNewSession = useCallback(async (options: {
    initialMessage?: Message;
    title?: string;
    sourceMeetingId?: string;
    initialTasks?: ExtractedTaskSchema[];
    initialPeople?: any[];
    allTaskLevels?: any;
  } = {}): Promise<ChatSession | undefined> => {
    const { initialMessage, title, sourceMeetingId, initialTasks, initialPeople, allTaskLevels } = options;

    if (!user?.uid) {
      toast({ title: "Error", description: "You must be logged in to create a session.", variant: "destructive" });
      return undefined;
    }
    const now = new Date();
    const sessionTitle = title || initialMessage?.text.substring(0, 30).split('\n')[0] || `Chat ${now.toLocaleTimeString()}`;
    const sanitizeLevels = (levels: any) =>
      levels
        ? {
            light: (levels.light || []).map((task: any) =>
              sanitizeTaskForFirestore(task as ExtractedTaskSchema)
            ),
            medium: (levels.medium || []).map((task: any) =>
              sanitizeTaskForFirestore(task as ExtractedTaskSchema)
            ),
            detailed: (levels.detailed || []).map((task: any) =>
              sanitizeTaskForFirestore(task as ExtractedTaskSchema)
            ),
          }
        : null;
    const sanitizedTaskLevels = sanitizeLevels(allTaskLevels);

    const newSessionData: Omit<ChatSession, 'id' | 'userId' | 'createdAt' | 'lastActivityAt'> = {
      title: sessionTitle,
      messages: initialMessage ? [initialMessage] : [],
      suggestedTasks: (initialTasks || []).map(sanitizeTaskForFirestore),
      originalAiTasks: (initialTasks || []).map(sanitizeTaskForFirestore),
      originalAllTaskLevels: sanitizedTaskLevels,
      taskRevisions:
        initialTasks && initialTasks.length > 0
          ? [
              {
                id: uuidv4(),
                createdAt: Date.now(),
                source: "ai",
                summary: "Initial AI extraction",
                tasksSnapshot: (initialTasks || []).map(sanitizeTaskForFirestore),
              },
            ]
          : [],
      people: initialPeople || [],
      folderId: null,
      sourceMeetingId: sourceMeetingId || null,
      allTaskLevels: sanitizedTaskLevels,
    };
    try {
      const created = await apiFetch<ChatSession>("/api/chat-sessions", {
        method: "POST",
        body: JSON.stringify(newSessionData),
      });
      setActiveSessionIdState(created.id);
      setSessions(prev => [created, ...prev]);
      return created;
    } catch (error) {
      console.error("Failed to create new session in database", error);
      toast({ title: "Error", description: "Could not create new chat session.", variant: "destructive" });
      return undefined;
    }
  }, [user, toast]);
  
  const updateSession = useCallback(async (sessionId: string, updatedFields: Partial<Omit<ChatSession, 'id' | 'userId' | 'createdAt' | 'lastActivityAt'>>) => {
     if (!user?.uid) return;
      try {
        const updated = await apiFetch<ChatSession>(`/api/chat-sessions/${sessionId}`, {
          method: "PATCH",
          body: JSON.stringify(updatedFields),
        });
        setSessions(prev => prev.map(session => session.id === updated.id ? updated : session));
        
      } catch (error) {
        console.error(`Failed to update session ${sessionId} in database`, error);
        // Do not show toast for every background save. Let caller decide.
        // toast({ title: "Error", description: "Could not save session changes.", variant: "destructive" });
      }
  }, [user]);

  const addMessageToActiveSession = useCallback(async (message: Message) => {
    if (!user?.uid || !activeSessionId) return;

    setSessions(currentSessions => {
        const newSessions = [...currentSessions];
        const sessionIndex = newSessions.findIndex(s => s.id === activeSessionId);
        if (sessionIndex === -1) return currentSessions;

        const targetSession = { ...newSessions[sessionIndex] };
        
        let newMessagesArray;
        const existingIndicatorIndex = targetSession.messages.findIndex(m => m.id === 'ai-typing-indicator');

        if (message.id === 'ai-typing-indicator') {
            if (existingIndicatorIndex === -1) {
                newMessagesArray = [...targetSession.messages, message];
            } else {
                return currentSessions;
            }
        } else {
             const messagesWithoutIndicator = targetSession.messages.filter(m => m.id !== 'ai-typing-indicator');
             newMessagesArray = [...messagesWithoutIndicator, message];
        }

        const updatedSession = {
            ...targetSession,
            messages: newMessagesArray,
            lastActivityAt: new Date(),
        };

        newSessions[sessionIndex] = updatedSession;
        
        if (message.id !== 'ai-typing-indicator') {
            apiFetch(`/api/chat-sessions/${activeSessionId}`, {
              method: "PATCH",
              body: JSON.stringify({ messages: updatedSession.messages }),
            }).catch(error => {
                console.error("Failed to update session messages in database", error);
                toast({ title: "Error", description: "Could not save message.", variant: "destructive" });
            });
        }
        
        return newSessions;
    });
}, [user, activeSessionId, toast]);


  const getActiveSession = useCallback((): ChatSession | undefined => {
    return sessions.find(s => s.id === activeSessionId);
  }, [sessions, activeSessionId]);

  const updateSessionTitle = useCallback(async (sessionId: string, newTitle: string) => {
    if (!user?.uid) return;
    try {
      await apiFetch(`/api/chat-sessions/${sessionId}`, {
        method: "PATCH",
        body: JSON.stringify({ title: newTitle, avoidTimestampUpdate: true }),
      });
      setSessions(prev => prev.map(session => session.id === sessionId ? { ...session, title: newTitle } : session));
    } catch (error) {
      console.error("Failed to update session title in database", error);
      toast({ title: "Error", description: "Could not update session title.", variant: "destructive" });
    }
  }, [user, toast]);

  const deleteSession = useCallback(async (sessionId: string) => {
    if (!user?.uid) return;
    const sessionToDelete = sessions.find(s => s.id === sessionId);

    try {
      if (sessionToDelete?.sourceMeetingId) {
        await apiFetch(`/api/meetings/${sessionToDelete.sourceMeetingId}`, {
          method: "PATCH",
          body: JSON.stringify({ chatSessionId: null }),
        });
      }
      await apiFetch(`/api/chat-sessions/${sessionId}`, { method: "DELETE" });
      setSessions(prev => prev.filter(session => session.id !== sessionId));
      toast({ title: "Session Deleted", description: "The chat session has been removed." });
    } catch (error) {
      console.error("Failed to delete session from database", error);
      toast({ title: "Error", description: "Could not delete session.", variant: "destructive" });
    }
  }, [user, toast, sessions]);

  const updateActiveSessionSuggestions = useCallback(async (newSuggestions: ExtractedTaskSchema[]) => {
    if (!user?.uid || !activeSessionId) return;
    try {
      const sanitizedSuggestions = newSuggestions.map(sanitizeTaskForFirestore);
      await updateSession(activeSessionId, { suggestedTasks: sanitizedSuggestions });
    } catch (error) {
      console.error("Failed to update session suggestions in database", error);
    }
  }, [user, activeSessionId, updateSession]);

  const removeSuggestionFromActiveSession = useCallback(async (suggestionId: string) => {
    if (!user?.uid || !activeSessionId) return;
    const currentSession = sessions.find(s => s.id === activeSessionId);
    if (!currentSession) return;

    const updatedSuggestions = (currentSession.suggestedTasks || []).filter(task => task.id !== suggestionId);
    try {
      const sanitizedUpdatedSuggestions = updatedSuggestions.map(sanitizeTaskForFirestore); 
      await updateSession(activeSessionId, { suggestedTasks: sanitizedUpdatedSuggestions });
    } catch (error) {
      console.error("Failed to remove suggestion in database", error);
      toast({ title: "Error", description: "Could not remove AI suggestion.", variant: "destructive" });
    }
  }, [user, activeSessionId, sessions, toast, updateSession]);

  return (
    <ChatHistoryContext.Provider value={{ 
      sessions, 
      activeSessionId, 
      isLoadingHistory,
      setActiveSessionId, 
      createNewSession, 
      addMessageToActiveSession,
      getActiveSession,
      updateSessionTitle,
      deleteSession,
      updateActiveSessionSuggestions,
      removeSuggestionFromActiveSession,
      updateSession,
    }}>
      {children}
    </ChatHistoryContext.Provider>
  );
};

export const useChatHistory = () => {
  const context = useContext(ChatHistoryContext);
  if (context === undefined) {
    throw new Error('useChatHistory must be used within a ChatHistoryProvider');
  }
  return context;
};
