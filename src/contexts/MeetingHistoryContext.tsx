
// src/contexts/MeetingHistoryContext.tsx
"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { ExtractedTaskSchema } from '@/types/chat';
import type { Meeting } from '@/types/meeting';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from '@/lib/api';
import { sanitizeTaskForFirestore } from '@/lib/data';

interface MeetingHistoryContextType {
  meetings: Meeting[];
  activeMeetingId: string | null;
  isLoadingMeetingHistory: boolean;
  setActiveMeetingId: (sessionId: string | null) => void;
  createNewMeeting: (meetingData: Omit<Meeting, 'id' | 'userId' | 'createdAt' | 'lastActivityAt'>) => Promise<Meeting | undefined>;
  getActiveMeeting: () => Meeting | undefined;
  updateMeeting: (sessionId: string, updatedFields: Partial<Omit<Meeting, 'id' | 'userId' | 'createdAt' | 'lastActivityAt'>>) => Promise<void>;
  deleteMeeting: (sessionId: string) => Promise<void>;
}

const MeetingHistoryContext = createContext<MeetingHistoryContextType | undefined>(undefined);

export const MeetingHistoryProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [activeMeetingId, setActiveMeetingIdState] = useState<string | null>(null);
  const [isLoadingMeetingHistory, setIsLoadingMeetingHistory] = useState(true);

  useEffect(() => {
    if (user?.uid) {
      setIsLoadingMeetingHistory(true);
      apiFetch<Meeting[]>("/api/meetings")
        .then((loadedMeetings) => {
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
          const sanitizedMeetings = loadedMeetings.map(m => ({
              ...m,
              extractedTasks: (m.extractedTasks || []).map(task => sanitizeTaskForFirestore(task as ExtractedTaskSchema)),
              originalAiTasks: (m.originalAiTasks || []).map(task => sanitizeTaskForFirestore(task as ExtractedTaskSchema)),
              originalAllTaskLevels: sanitizeLevels(m.originalAllTaskLevels),
              allTaskLevels: sanitizeLevels(m.allTaskLevels),
              taskRevisions: m.taskRevisions || [],
              attendees: m.attendees || [],
          }));
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
        })
        .finally(() => {
          setIsLoadingMeetingHistory(false);
        });
    } else {
      setMeetings([]);
      setActiveMeetingIdState(null);
      setIsLoadingMeetingHistory(false);
    }
  }, [user]);

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
    const sanitizedAllTaskLevels = sanitizeLevels(meetingData.allTaskLevels);
    const sanitizedOriginalAllTaskLevels = sanitizeLevels(meetingData.originalAllTaskLevels);

    const sanitizedData = {
        ...meetingData,
        extractedTasks: (meetingData.extractedTasks || []).map(task => sanitizeTaskForFirestore(task as ExtractedTaskSchema)),
        allTaskLevels: sanitizedAllTaskLevels,
        originalAiTasks:
          (meetingData.originalAiTasks || meetingData.extractedTasks || []).map(task =>
            sanitizeTaskForFirestore(task as ExtractedTaskSchema)
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
      console.error("Failed to create new meeting in Firestore", error);
      toast({ title: "Error", description: "Could not create new meeting record.", variant: "destructive" });
      return undefined;
    }
  }, [user, toast]);
  
  const updateMeeting = useCallback(async (sessionId: string, updatedFields: Partial<Omit<Meeting, 'id' | 'userId' | 'createdAt' | 'lastActivityAt'>>) => {
    if (!user?.uid) return;
    try {
      const updated = await apiFetch<Meeting>(`/api/meetings/${sessionId}`, {
        method: "PATCH",
        body: JSON.stringify(updatedFields),
      });
      setMeetings(prev => prev.map(meeting => meeting.id === updated.id ? updated : meeting));
    } catch (error) {
      console.error(`Failed to update meeting ${sessionId} in Firestore`, error);
      toast({ title: "Error", description: "Could not save meeting changes.", variant: "destructive" });
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
      toast({ title: "Meeting Deleted", description: "The meeting and its linked sessions have been removed." });
    } catch (error) {
      console.error("Failed to delete meeting from Firestore", error);
      toast({ title: "Error", description: "Could not delete meeting.", variant: "destructive" });
    }
  }, [user, toast, activeMeetingId]);

  return (
    <MeetingHistoryContext.Provider value={{
      meetings,
      activeMeetingId,
      isLoadingMeetingHistory,
      setActiveMeetingId,
      createNewMeeting,
      getActiveMeeting,
      updateMeeting,
      deleteMeeting,
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
