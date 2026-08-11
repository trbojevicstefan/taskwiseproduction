// src/contexts/ChatHistoryContext.tsx
"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { Message, ChatSession, ExtractedTaskSchema } from '@/types/chat';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from '@/lib/api';
import { normalizeTask } from '@/lib/data';
import type { ChatScope } from '@/types/general-chat';


interface ChatHistoryContextType {
  sessions: ChatSession[];
  activeSessionId: string | null;
  isLoadingHistory: boolean;
  setActiveSessionId: (sessionId: string | null) => void;
  createNewSession: (options?: {
    initialMessage?: Message;
    title?: string;
    sourceMeetingId?: string;
    scope?: ChatScope;
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
  /** Optimistically apply and serialize a durable message snapshot per session. */
  persistSessionMessages: (sessionId: string, messages: Message[]) => Promise<boolean>;
  /**
   * Local-only message sync (no network call). Used by the unified chat panel,
   * which persists messages itself via PATCH /api/chat-sessions/[id]; this
   * keeps the in-memory session list consistent so switching sessions and
   * back does not show stale messages.
   */
  applySessionMessagesLocal: (sessionId: string, messages: Message[]) => void;
}

const ChatHistoryContext = createContext<ChatHistoryContextType | undefined>(undefined);

export const ChatHistoryProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const sessionsRef = useRef<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionIdState] = useState<string | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const messageSaveQueuesRef = useRef(new Map<string, Promise<boolean>>());
  const messageSaveVersionsRef = useRef(new Map<string, number>());
  const durableMessagesRef = useRef(new Map<string, Message[]>());

  const replaceSessions = useCallback((next: ChatSession[]) => {
    sessionsRef.current = next;
    setSessions(next);
  }, []);

  const sanitizeLevels = useCallback((levels: any) =>
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
      : null, []);

  const sanitizeSession = useCallback((session: ChatSession): ChatSession => ({
    ...session,
    suggestedTasks: (session.suggestedTasks || []).map((task) =>
      normalizeTask(task as ExtractedTaskSchema)
    ),
    originalAiTasks: (session.originalAiTasks || []).map((task) =>
      normalizeTask(task as ExtractedTaskSchema)
    ),
    originalAllTaskLevels: sanitizeLevels(session.originalAllTaskLevels),
    allTaskLevels: sanitizeLevels(session.allTaskLevels),
    taskRevisions: session.taskRevisions || [],
    people: session.people || [],
  }), [sanitizeLevels]);

  useEffect(() => {
    if (user?.uid) {
      setIsLoadingHistory(true);
      const sessionIdsAtRequestStart = new Set(
        sessionsRef.current.map((session) => session.id)
      );
      apiFetch<ChatSession[]>("/api/chat-sessions")
        .then((loadedSessions) => {
          const sanitizedSessions = loadedSessions.map(sanitizeSession);
          sanitizedSessions.forEach((session) => {
            durableMessagesRef.current.set(session.id, session.messages || []);
          });
          const createdDuringLoad = sessionsRef.current.filter(
            (session) => !sessionIdsAtRequestStart.has(session.id)
          );
          const createdIds = new Set(createdDuringLoad.map(({ id }) => id));
          const mergedSessions = [
            ...createdDuringLoad,
            ...sanitizedSessions.filter((session) => !createdIds.has(session.id)),
          ];
          replaceSessions(mergedSessions);

          const timeValue = (value: any) =>
            value?.toMillis ? value.toMillis() : value ? new Date(value).getTime() : 0;

          setActiveSessionIdState(prevActiveId => {
            if (prevActiveId && mergedSessions.some(s => s.id === prevActiveId)) {
              return prevActiveId;
            }
            const sortedSessions = [...mergedSessions].sort(
              (a, b) => timeValue(b.lastActivityAt) - timeValue(a.lastActivityAt)
            );
            return sortedSessions.length > 0 ? sortedSessions[0].id : null;
          });
        })
        .finally(() => {
          setIsLoadingHistory(false);
        });
    } else {
      replaceSessions([]);
      setActiveSessionIdState(null);
      setIsLoadingHistory(false);
    }
  }, [replaceSessions, sanitizeSession, user?.uid]);

  const setActiveSessionId = useCallback((sessionId: string | null) => {
    setActiveSessionIdState(sessionId);
  }, []);

  const createNewSession = useCallback(async (options: {
    initialMessage?: Message;
    title?: string;
    sourceMeetingId?: string;
    scope?: ChatScope;
    initialTasks?: ExtractedTaskSchema[];
    initialPeople?: any[];
    allTaskLevels?: any;
  } = {}): Promise<ChatSession | undefined> => {
    const { initialMessage, title, sourceMeetingId, scope, initialTasks, initialPeople, allTaskLevels } = options;

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

    const newSessionData: Omit<ChatSession, 'id' | 'userId' | 'createdAt' | 'lastActivityAt'> = {
      title: sessionTitle,
      messages: initialMessage ? [initialMessage] : [],
      suggestedTasks: (initialTasks || []).map(normalizeTask),
      originalAiTasks: (initialTasks || []).map(normalizeTask),
      originalAllTaskLevels: sanitizedTaskLevels,
      taskRevisions:
        initialTasks && initialTasks.length > 0
          ? [
              {
                id: uuidv4(),
                createdAt: Date.now(),
                source: "ai",
                summary: "Initial AI extraction",
                tasksSnapshot: (initialTasks || []).map(normalizeTask),
              },
            ]
          : [],
      people: initialPeople || [],
      folderId: null,
      sourceMeetingId: sourceMeetingId || null,
      scope:
        sourceMeetingId
          ? { type: 'meeting', meetingId: sourceMeetingId }
          : scope ?? { type: 'workspace' },
      allTaskLevels: sanitizedTaskLevels,
    };
    try {
      const created = await apiFetch<ChatSession>("/api/chat-sessions", {
        method: "POST",
        body: JSON.stringify(newSessionData),
      });
      setActiveSessionIdState(created.id);
      durableMessagesRef.current.set(created.id, created.messages || []);
      replaceSessions([created, ...sessionsRef.current.filter(({ id }) => id !== created.id)]);
      return created;
    } catch (error) {
      console.error("Failed to create new session in database", error);
      toast({ title: "Error", description: "Could not create new chat session.", variant: "destructive" });
      return undefined;
    }
  }, [replaceSessions, user, toast]);
  
  const updateSession = useCallback(async (sessionId: string, updatedFields: Partial<Omit<ChatSession, 'id' | 'userId' | 'createdAt' | 'lastActivityAt'>>) => {
     if (!user?.uid) return;
      try {
        const targetSession = sessions.find((session: any) => session.id === sessionId);
        const updated = await apiFetch<ChatSession>(`/api/chat-sessions/${sessionId}`, {
          method: "PATCH",
          body: JSON.stringify(updatedFields),
        });
        replaceSessions(
          sessionsRef.current.map(session =>
            session.id === updated.id
              ? { ...updated, messages: session.messages }
              : session
          )
        );

        const isMeetingLinked =
          Boolean(targetSession?.sourceMeetingId) ||
          Boolean(updatedFields.sourceMeetingId);
        if (updatedFields.suggestedTasks && !isMeetingLinked) {
          await apiFetch("/api/tasks/sync", {
            method: "POST",
            body: JSON.stringify({
              sourceSessionId: sessionId,
              sourceSessionType: "chat",
              sourceSessionName: updatedFields.title || targetSession?.title || updated.title,
              origin: "chat",
              tasks: updatedFields.suggestedTasks,
            }),
          });
        }
      } catch (error) {
        console.error(`Failed to update session ${sessionId} in database`, error);
        // Do not show toast for every background save. Let caller decide.
        // toast({ title: "Error", description: "Could not save session changes.", variant: "destructive" });
      }
  }, [replaceSessions, user, sessions]);

  const applySessionMessagesLocal = useCallback((sessionId: string, messages: Message[]) => {
    replaceSessions(
      sessionsRef.current.map(session =>
        session.id === sessionId
          ? { ...session, messages, lastActivityAt: new Date() }
          : session
      )
    );
  }, [replaceSessions]);

  const persistSessionMessages = useCallback((sessionId: string, messages: Message[]) => {
    if (!user?.uid) return Promise.resolve(false);

    if (!durableMessagesRef.current.has(sessionId)) {
      const current = sessionsRef.current.find((session) => session.id === sessionId);
      durableMessagesRef.current.set(sessionId, current?.messages || []);
    }
    applySessionMessagesLocal(sessionId, messages);
    const version = (messageSaveVersionsRef.current.get(sessionId) ?? 0) + 1;
    messageSaveVersionsRef.current.set(sessionId, version);
    const previous = messageSaveQueuesRef.current.get(sessionId) ?? Promise.resolve(true);
    const operation: Promise<boolean> = previous
      .catch(() => false)
      .then(async () => {
        try {
          await apiFetch(`/api/chat-sessions/${sessionId}`, {
            method: "PATCH",
            body: JSON.stringify({ messages }),
          });
          durableMessagesRef.current.set(sessionId, messages);
          return true;
        } catch (error) {
          console.error("Failed to persist chat messages:", error);
          if (messageSaveVersionsRef.current.get(sessionId) === version) {
            try {
              const loadedSessions = await apiFetch<ChatSession[]>("/api/chat-sessions");
              const authoritative = loadedSessions
                .map(sanitizeSession)
                .find((session) => session.id === sessionId);
              if (authoritative) {
                durableMessagesRef.current.set(
                  sessionId,
                  authoritative.messages || []
                );
              }
              replaceSessions(
                authoritative
                  ? sessionsRef.current.map((session) =>
                      session.id === sessionId ? authoritative : session
                    )
                  : sessionsRef.current.filter((session) => session.id !== sessionId)
              );
            } catch (reloadError) {
              console.error("Failed to reload chat session after save failure:", reloadError);
              const durableMessages = durableMessagesRef.current.get(sessionId) || [];
              replaceSessions(
                sessionsRef.current.map((session) =>
                  session.id === sessionId
                    ? { ...session, messages: durableMessages }
                    : session
                )
              );
            }
          }
          toast({
            title: "Error",
            description: "Could not save message.",
            variant: "destructive",
          });
          return false;
        }
      })
      .finally(() => {
        if (messageSaveQueuesRef.current.get(sessionId) === operation) {
          messageSaveQueuesRef.current.delete(sessionId);
        }
      });
    messageSaveQueuesRef.current.set(sessionId, operation);
    return operation;
  }, [applySessionMessagesLocal, replaceSessions, sanitizeSession, toast, user?.uid]);

  const addMessageToActiveSession = useCallback(async (message: Message) => {
    if (!user?.uid || !activeSessionId) return;

        const targetSession = sessionsRef.current.find(s => s.id === activeSessionId);
        if (!targetSession) return;
        
        let newMessagesArray;
        const existingIndicatorIndex = targetSession.messages.findIndex(m => m.id === 'ai-typing-indicator');

        if (message.id === 'ai-typing-indicator') {
            if (existingIndicatorIndex === -1) {
                newMessagesArray = [...targetSession.messages, message];
            } else {
                return;
            }
        } else {
             const messagesWithoutIndicator = targetSession.messages.filter(m => m.id !== 'ai-typing-indicator');
             newMessagesArray = [...messagesWithoutIndicator, message];
        }

        if (message.id !== 'ai-typing-indicator') {
            await persistSessionMessages(activeSessionId, newMessagesArray);
        } else {
            applySessionMessagesLocal(activeSessionId, newMessagesArray);
        }
}, [activeSessionId, applySessionMessagesLocal, persistSessionMessages, user?.uid]);

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
      replaceSessions(sessionsRef.current.map(session => session.id === sessionId ? { ...session, title: newTitle } : session));
    } catch (error) {
      console.error("Failed to update session title in database", error);
      toast({ title: "Error", description: "Could not update session title.", variant: "destructive" });
    }
  }, [replaceSessions, user, toast]);

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
      durableMessagesRef.current.delete(sessionId);
      replaceSessions(sessionsRef.current.filter(session => session.id !== sessionId));
      toast({ title: "Session Deleted", description: "The chat session has been removed." });
    } catch (error) {
      console.error("Failed to delete session from database", error);
      toast({ title: "Error", description: "Could not delete session.", variant: "destructive" });
    }
  }, [replaceSessions, user, toast, sessions]);

  const updateActiveSessionSuggestions = useCallback(async (newSuggestions: ExtractedTaskSchema[]) => {
    if (!user?.uid || !activeSessionId) return;
    try {
      const sanitizedSuggestions = newSuggestions.map(normalizeTask);
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
      const sanitizedUpdatedSuggestions = updatedSuggestions.map(normalizeTask); 
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
      applySessionMessagesLocal,
      persistSessionMessages,
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
