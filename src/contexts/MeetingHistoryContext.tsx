
// src/contexts/MeetingHistoryContext.tsx
"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { ExtractedTaskSchema } from '@/types/chat';
import type { Meeting } from '@/types/meeting';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { apiFetch } from '@/lib/api';
import { normalizeTask } from '@/lib/data';

interface MeetingHistoryContextType {
  meetings: Meeting[];
  activeMeetingId: string | null;
  isLoadingMeetingHistory: boolean;
  setActiveMeetingId: (sessionId: string | null) => void;
  refreshMeetings: () => Promise<void>;
  createNewMeeting: (meetingData: Omit<Meeting, 'id' | 'userId' | 'createdAt' | 'lastActivityAt'>) => Promise<Meeting | undefined>;
  getActiveMeeting: () => Meeting | undefined;
  updateMeeting: (sessionId: string, updatedFields: Partial<Omit<Meeting, 'id' | 'userId' | 'createdAt' | 'lastActivityAt'>>) => Promise<Meeting | null>;
  deleteMeeting: (sessionId: string) => Promise<void>;
  deleteMeetings: (sessionIds: string[]) => Promise<void>;
}

const MeetingHistoryContext = createContext<MeetingHistoryContextType | undefined>(undefined);

export const MeetingHistoryProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [activeMeetingId, setActiveMeetingIdState] = useState<string | null>(null);
  const [isLoadingMeetingHistory, setIsLoadingMeetingHistory] = useState(true);
  const lastNotificationUserIdRef = useRef<string | null>(null);
  const notificationStateRef = useRef<{
    hasLoaded: boolean;
    knownIds: Set<string>;
    notifiedIds: Set<string>;
    permissionPrompted: boolean;
    pendingMeetings: Meeting[];
  }>({
    hasLoaded: false,
    knownIds: new Set(),
    notifiedIds: new Set(),
    permissionPrompted: false,
    pendingMeetings: [],
  });

  useEffect(() => {
    if (lastNotificationUserIdRef.current === user?.uid) return;
    lastNotificationUserIdRef.current = user?.uid ?? null;
    notificationStateRef.current = {
      hasLoaded: false,
      knownIds: new Set(),
      notifiedIds: new Set(),
      permissionPrompted: false,
      pendingMeetings: [],
    };
  }, [user?.uid]);

  const canUseNotifications = useCallback(
    () => typeof window !== "undefined" && "Notification" in window,
    []
  );

  const playNotificationSound = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      const AudioContextConstructor =
        window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextConstructor) return;
      const audioContext = new AudioContextConstructor();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = 880;
      gain.gain.value = 0.08;
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.18);
      oscillator.onended = () => {
        audioContext.close().catch(() => undefined);
      };
    } catch (error) {
      console.error("Failed to play notification sound:", error);
    }
  }, []);

  const notifyMeetings = useCallback(
    (meetingsToNotify: Meeting[]) => {
      if (!canUseNotifications()) return;
      if (Notification.permission !== "granted") return;

      const state = notificationStateRef.current;
      meetingsToNotify.forEach((meeting) => {
        if (state.notifiedIds.has(meeting.id)) return;
        const title = "New Fathom meeting";
        const body = meeting.title?.trim()
          ? meeting.title
          : "A new meeting is ready.";
        const notification = new Notification(title, {
          body,
          tag: meeting.id,
          data: { meetingId: meeting.id },
          silent: false,
        });
        notification.onclick = () => {
          window.focus();
          window.location.href = `/meetings/${meeting.id}`;
        };
        playNotificationSound();
        state.notifiedIds.add(meeting.id);
      });
    },
    [canUseNotifications, playNotificationSound]
  );

  const requestNotificationPermission = useCallback(async () => {
    if (!canUseNotifications()) return "unsupported";
    if (Notification.permission === "granted") return "granted";
    if (Notification.permission === "denied") return "denied";

    try {
      const permission = await Notification.requestPermission();
      if (permission === "granted") {
        toast({
          title: "Notifications enabled",
          description: "You'll hear about new Fathom meetings instantly.",
        });
        const pending = notificationStateRef.current.pendingMeetings;
        notificationStateRef.current.pendingMeetings = [];
        notifyMeetings(pending);
      } else if (permission === "denied") {
        toast({
          title: "Notifications blocked",
          description: "Enable notifications in your browser settings if you change your mind.",
        });
      }
      return permission;
    } catch (error) {
      console.error("Failed to request notification permission:", error);
      return "error";
    }
  }, [canUseNotifications, notifyMeetings, toast]);

  const promptForNotificationPermission = useCallback(() => {
    if (!canUseNotifications()) return;
    const state = notificationStateRef.current;
    if (state.permissionPrompted) return;
    if (Notification.permission !== "default") return;

    state.permissionPrompted = true;
    toast({
      title: "Enable desktop notifications?",
      description: "Get alerts when new Fathom meetings arrive.",
      action: (
        <ToastAction
          altText="Enable notifications"
          onClick={requestNotificationPermission}
        >
          Enable
        </ToastAction>
      ),
    });
  }, [canUseNotifications, requestNotificationPermission, toast]);

  const maybeNotifyNewFathomMeetings = useCallback(
    (nextMeetings: Meeting[]) => {
      const state = notificationStateRef.current;
      const previousIds = state.knownIds;
      const newlyAdded = state.hasLoaded
        ? nextMeetings.filter(
            (meeting) =>
              meeting.ingestSource === "fathom" &&
              !meeting.fathomNotificationReadAt &&
              !previousIds.has(meeting.id)
          )
        : [];

      if (newlyAdded.length > 0 && canUseNotifications()) {
        if (Notification.permission === "granted") {
          notifyMeetings(newlyAdded);
        } else if (Notification.permission === "default") {
          const pending = state.pendingMeetings;
          const pendingIds = new Set(pending.map((meeting) => meeting.id));
          state.pendingMeetings = [
            ...pending,
            ...newlyAdded.filter((meeting) => !pendingIds.has(meeting.id)),
          ];
          promptForNotificationPermission();
        }
      }

      state.knownIds = new Set(nextMeetings.map((meeting) => meeting.id));
      state.hasLoaded = true;
    },
    [canUseNotifications, notifyMeetings, promptForNotificationPermission]
  );

  const loadMeetings = useCallback(async (options?: { silent?: boolean }) => {
    if (!user?.uid) {
      setMeetings([]);
      setActiveMeetingIdState(null);
      setIsLoadingMeetingHistory(false);
      return;
    }

    if (!options?.silent) {
      setIsLoadingMeetingHistory(true);
    }
    try {
      const loadedMeetings = await apiFetch<Meeting[]>("/api/meetings");
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
      const sanitizedMeetings = loadedMeetings.map(m => ({
          ...m,
          extractedTasks: (m.extractedTasks || []).map(task => normalizeTask(task as ExtractedTaskSchema)),
          originalAiTasks: (m.originalAiTasks || []).map(task => normalizeTask(task as ExtractedTaskSchema)),
          originalAllTaskLevels: sanitizeLevels(m.originalAllTaskLevels),
          allTaskLevels: sanitizeLevels(m.allTaskLevels),
          taskRevisions: m.taskRevisions || [],
          attendees: m.attendees || [],
      }));
      maybeNotifyNewFathomMeetings(sanitizedMeetings);
      setMeetings(sanitizedMeetings);

      const timeValue = (value: any) =>
        value?.toMillis ? value.toMillis() : value ? new Date(value).getTime() : 0;

      setActiveMeetingIdState(prevActiveId => {
          const activeIdStillExists = sanitizedMeetings.some(s => s.id === prevActiveId);
          if (activeIdStillExists) {
              return prevActiveId;
          }
          const sortedMeetings = [...sanitizedMeetings].sort((a, b) =>
              timeValue(b.lastActivityAt) - timeValue(a.lastActivityAt)
          );
          return sortedMeetings.length > 0 ? sortedMeetings[0].id : null;
      });
    } finally {
      if (!options?.silent) {
        setIsLoadingMeetingHistory(false);
      }
    }
  }, [maybeNotifyNewFathomMeetings, user]);

  useEffect(() => {
    loadMeetings();
  }, [loadMeetings]);

  useEffect(() => {
    if (!user?.uid || !user?.fathomConnected) return;
    let isActive = true;
    const interval = setInterval(() => {
      if (!isActive) return;
      void loadMeetings({ silent: true });
    }, 30000);
    return () => {
      isActive = false;
      clearInterval(interval);
    };
  }, [loadMeetings, user?.fathomConnected, user?.uid]);

  const refreshMeetings = useCallback(async () => {
    await loadMeetings();
  }, [loadMeetings]);

  const setActiveMeetingId = useCallback((sessionId: string | null) => {
    setActiveMeetingIdState(sessionId);
  }, []);

  const createNewMeeting = useCallback(async (meetingData: Omit<Meeting, 'id' | 'userId' | 'createdAt' | 'lastActivityAt'>): Promise<Meeting | undefined> => {
    if (!user?.uid) {
      toast({ title: "Error", description: "You must be logged in.", variant: "destructive" });
      return undefined;
    }
    
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
    const sanitizedAllTaskLevels = sanitizeLevels(meetingData.allTaskLevels);
    const sanitizedOriginalAllTaskLevels = sanitizeLevels(meetingData.originalAllTaskLevels);

    const sanitizedData = {
        ...meetingData,
        extractedTasks: (meetingData.extractedTasks || []).map(task => normalizeTask(task as ExtractedTaskSchema)),
        allTaskLevels: sanitizedAllTaskLevels,
        originalAiTasks:
          (meetingData.originalAiTasks || meetingData.extractedTasks || []).map(task =>
            normalizeTask(task as ExtractedTaskSchema)
          ),
        originalAllTaskLevels: sanitizedOriginalAllTaskLevels || sanitizedAllTaskLevels,
    };
    const initialRevision =
      sanitizedData.extractedTasks && sanitizedData.extractedTasks.length > 0
        ? [
            {
              id: uuidv4(),
              createdAt: Date.now(),
              source: "ai",
              summary: "Initial AI extraction",
              tasksSnapshot: sanitizedData.extractedTasks,
            },
          ]
        : [];
    sanitizedData.taskRevisions =
      meetingData.taskRevisions && meetingData.taskRevisions.length > 0
        ? meetingData.taskRevisions
        : initialRevision;

    try {
      const created = await apiFetch<Meeting>("/api/meetings", {
        method: "POST",
        body: JSON.stringify(sanitizedData),
      });
      setActiveMeetingIdState(created.id);
      toast({ title: "Meeting Created", description: `Meeting "${meetingData.title}" has been saved.` });
      setMeetings(prev => [created, ...prev]);
      return created;
    } catch (error) {
      console.error("Failed to create new meeting in database", error);
      toast({ title: "Error", description: "Could not create new meeting record.", variant: "destructive" });
      return undefined;
    }
  }, [user, toast]);
  
  const updateMeeting = useCallback(async (sessionId: string, updatedFields: Partial<Omit<Meeting, 'id' | 'userId' | 'createdAt' | 'lastActivityAt'>>) => {
    if (!user?.uid) return null;
    try {
      const sanitizedFields = { ...updatedFields };
      if (sanitizedFields.extractedTasks) {
        sanitizedFields.extractedTasks = sanitizedFields.extractedTasks.map(task =>
          normalizeTask(task as ExtractedTaskSchema)
        );
      }
      const updated = await apiFetch<Meeting>(`/api/meetings/${sessionId}`, {
        method: "PATCH",
        body: JSON.stringify(sanitizedFields),
      });
      setMeetings(prev => prev.map(meeting => meeting.id === updated.id ? updated : meeting));
      return updated;
    } catch (error) {
      console.error(`Failed to update meeting ${sessionId} in database`, error);
      toast({ title: "Error", description: "Could not save meeting changes.", variant: "destructive" });
      return null;
    }
  }, [user, toast]);

  const getActiveMeeting = useCallback((): Meeting | undefined => {
    return meetings.find(s => s.id === activeMeetingId);
  }, [meetings, activeMeetingId]);

  const deleteMeeting = useCallback(async (sessionId: string) => {
    if (!user?.uid) {
        toast({ title: "Authentication Error", description: "You must be logged in to delete a meeting.", variant: "destructive" });
        return;
    }
    try {
      await apiFetch(`/api/meetings/${sessionId}`, { method: "DELETE" });
      setMeetings(prev => prev.filter(meeting => meeting.id !== sessionId));
      if (activeMeetingId === sessionId) {
        setActiveMeetingIdState(null); // Or set to the next available one
      }
      toast({
        title: "Meeting Deleted",
        description: "The meeting was hidden and its extracted tasks were removed.",
      });
    } catch (error) {
      console.error("Failed to delete meeting from database", error);
      toast({ title: "Error", description: "Could not delete meeting.", variant: "destructive" });
    }
  }, [user, toast, activeMeetingId]);

  const deleteMeetings = useCallback(
    async (sessionIds: string[]) => {
      if (!user?.uid) {
        toast({
          title: "Authentication Error",
          description: "You must be logged in to delete meetings.",
          variant: "destructive",
        });
        return;
      }

      const uniqueIds = Array.from(new Set(sessionIds)).filter(Boolean);
      if (uniqueIds.length === 0) return;

      try {
        if (uniqueIds.length === 1) {
          await apiFetch(`/api/meetings/${uniqueIds[0]}`, { method: "DELETE" });
        } else {
          await apiFetch("/api/meetings/bulk-delete", {
            method: "POST",
            body: JSON.stringify({ ids: uniqueIds }),
          });
        }

        const deletedSet = new Set(uniqueIds);
        setMeetings((prev) => prev.filter((meeting) => !deletedSet.has(meeting.id)));
        if (activeMeetingId && deletedSet.has(activeMeetingId)) {
          setActiveMeetingIdState(null);
        }
        toast({
          title: "Meetings Deleted",
          description: `${uniqueIds.length} meeting${uniqueIds.length === 1 ? "" : "s"} removed.`,
        });
      } catch (error) {
        console.error("Failed to delete meetings from database", error);
        toast({
          title: "Error",
          description: "Could not delete meetings.",
          variant: "destructive",
        });
      }
    },
    [user, toast, activeMeetingId]
  );

  return (
    <MeetingHistoryContext.Provider value={{
      meetings,
      activeMeetingId,
      isLoadingMeetingHistory,
      setActiveMeetingId,
      refreshMeetings,
      createNewMeeting,
      getActiveMeeting,
      updateMeeting,
      deleteMeeting,
      deleteMeetings,
    }}>
      {children}
    </MeetingHistoryContext.Provider>
  );
};

export const useMeetingHistory = () => {
  const context = useContext(MeetingHistoryContext);
  if (context === undefined) {
    throw new Error('useMeetingHistory must be used within a MeetingHistoryProvider');
  }
  return context;
};

