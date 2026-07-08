// src/components/dashboard/planning/AgendaInbox.tsx
//
// Priority 12 — the /planning/agendas entry point strip: upcoming meetings
// that still need an agenda, linking into the agenda workspace. Rendered
// above the existing Google Meeting Planner (which stays on the same page).
"use client";

import React, { useEffect, useState } from "react";
import { NotebookPen } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/lib/api";
import {
  normalizeUpcomingMeetings,
  type UpcomingMeeting,
} from "./planning-overview";
import { UpcomingMeetingRow } from "./UpcomingMeetingsSection";

export default function AgendaInbox() {
  const [meetings, setMeetings] = useState<UpcomingMeeting[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await apiFetch<{ ok?: boolean; data?: unknown }>(
          "/api/planning/upcoming-meetings"
        );
        if (!cancelled) {
          setMeetings(
            normalizeUpcomingMeetings((response as any)?.data ?? response)
          );
        }
      } catch (error) {
        console.error("Failed to load upcoming meetings:", error);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const needingAgenda = meetings.filter(
    (meeting) => meeting.needsAgenda && meeting.meetingId
  );

  if (!isLoading && needingAgenda.length === 0) {
    return null;
  }

  return (
    <div className="px-4 pt-4 sm:px-6 lg:px-8">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between gap-2 text-base">
            <span className="flex items-center gap-2">
              <NotebookPen className="h-4 w-4" />
              Meetings needing an agenda
            </span>
            <Badge variant="secondary">{needingAgenda.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">
              Loading upcoming meetings…
            </p>
          ) : (
            needingAgenda.map((meeting) => (
              <UpcomingMeetingRow key={meeting.id} meeting={meeting} />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
