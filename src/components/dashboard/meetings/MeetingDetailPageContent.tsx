
// src/components/dashboard/meetings/MeetingDetailPageContent.tsx
"use client";

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useMeetingHistory } from '@/contexts/MeetingHistoryContext';
import { useChatHistory } from '@/contexts/ChatHistoryContext';
import { useToast } from '@/hooks/use-toast';
import type { Meeting } from '@/types/meeting';
import { MeetingDetailSheet } from './MeetingsPageContent';

export default function MeetingDetailPageContent({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const { meetings, updateMeeting, refreshMeetings, isLoadingMeetingHistory } = useMeetingHistory();
  const { sessions, createNewSession, setActiveSessionId } = useChatHistory();
  const { toast } = useToast();
  const [hasRefreshed, setHasRefreshed] = useState(false);

  useEffect(() => {
    setHasRefreshed(false);
  }, [meetingId]);

  const clearDuplicateChatLinks = useCallback(
    async (chatSessionId: string, targetMeetingId: string) => {
      const duplicates = meetings.filter(
        (item) => item.chatSessionId === chatSessionId && item.id !== targetMeetingId
      );
      if (duplicates.length === 0) return;
      await Promise.all(
        duplicates.map((duplicate) =>
          updateMeeting(duplicate.id, { chatSessionId: null })
        )
      );
    },
    [meetings, updateMeeting]
  );

  const [isNavigating, setIsNavigating] = useState(false);

  const handleNavigateToChat = useCallback(
    async (meeting: Meeting) => {
      if (isNavigating) return;
      setIsNavigating(true);
      try {
        const sessionFromMeeting = meeting.chatSessionId
          ? sessions.find((session) => session.id === meeting.chatSessionId)
          : undefined;
        const sessionFromLookup = sessions.find(
          (session) => session.sourceMeetingId === meeting.id
        );
        const existingSession = sessionFromMeeting || sessionFromLookup;

        if (existingSession) {
          await clearDuplicateChatLinks(existingSession.id, meeting.id);
          if (meeting.chatSessionId !== existingSession.id) {
            await updateMeeting(meeting.id, { chatSessionId: existingSession.id });
          }
          setActiveSessionId(existingSession.id);
          router.push('/chat');
          return;
        }

        toast({ title: 'Creating Chat Session...' });
        const newSession = await createNewSession({
          title: `Chat about "${meeting.title}"`,
          sourceMeetingId: meeting.id,
          initialTasks: (meeting.extractedTasks as import('@/types/chat').ExtractedTaskSchema[] | undefined),
          initialPeople: meeting.attendees,
        });

        if (newSession) {
          await clearDuplicateChatLinks(newSession.id, meeting.id);
          await updateMeeting(meeting.id, { chatSessionId: newSession.id });
          setActiveSessionId(newSession.id);
          router.push('/chat');
        } else {
          toast({
            title: 'Error',
            description: 'Could not create chat session.',
            variant: 'destructive',
          });
          setIsNavigating(false);
        }
      } catch (error) {
        console.error("Navigation error:", error);
        setIsNavigating(false);
      }
    },
    [sessions, updateMeeting, setActiveSessionId, router, toast, createNewSession, isNavigating]
  );

  const handleClose = useCallback(() => {
    router.push('/meetings');
  }, [router]);

  useEffect(() => {
    if (hasRefreshed || isLoadingMeetingHistory) return;
    const exists = meetings.some((meeting) => meeting.id === meetingId);
    if (!exists) {
      setHasRefreshed(true);
      void refreshMeetings();
    }
  }, [hasRefreshed, isLoadingMeetingHistory, meetingId, meetings, refreshMeetings]);

  const exists = meetings.some((meeting) => meeting.id === meetingId);
  if (!exists && (isLoadingMeetingHistory || !hasRefreshed)) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        Loading meeting...
      </div>
    );
  }

  if (!exists) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20 text-center text-muted-foreground">
        <p className="text-lg font-semibold text-foreground">Meeting not found</p>
        <p className="text-sm text-muted-foreground">
          This meeting may have been deleted or is no longer available.
        </p>
        <Button variant="outline" onClick={handleClose}>
          Back to Meetings
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <MeetingDetailSheet
        id={meetingId}
        onClose={handleClose}
        onNavigateToChat={handleNavigateToChat}
        variant="page"
      />
    </div>
  );
}
