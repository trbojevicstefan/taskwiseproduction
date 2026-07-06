// src/components/dashboard/planning/UpcomingMeetingsSection.tsx
//
// Priority 12 — "Upcoming meetings" section on /planning: merged Taskwise +
// Google upcoming meetings with the needs-agenda flag and attendee open-task
// counts. Taskwise-backed rows link into the agenda workspace
// (/planning/agendas/[meetingId]); Google-only rows link to the Meeting
// Planner (which can schedule/annotate Google events).
"use client";

import React from "react";
import Link from "next/link";
import { CalendarClock, ExternalLink, NotebookPen, Video } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { format, isValid } from "date-fns";
import type { UpcomingMeeting } from "./planning-overview";

const SOURCE_LABELS: Record<UpcomingMeeting["source"], string> = {
  taskwise: "Taskwise",
  google: "Google",
  linked: "Linked",
};

export const formatUpcomingTime = (startTime: string): string => {
  const date = new Date(startTime);
  if (!isValid(date)) return "";
  return format(date, "EEE, MMM d · HH:mm");
};

/** Agenda workspace for Taskwise-backed rows, Meeting Planner otherwise. */
export const resolveUpcomingMeetingHref = (
  meeting: UpcomingMeeting
): string =>
  meeting.meetingId
    ? `/planning/agendas/${encodeURIComponent(meeting.meetingId)}`
    : "/planning/agendas";

export function UpcomingMeetingRow({ meeting }: { meeting: UpcomingMeeting }) {
  const attendeeNames = meeting.attendees
    .map((attendee) => attendee.name || attendee.email)
    .filter(Boolean)
    .slice(0, 4)
    .join(", ");

  return (
    <div className="data-row flex items-start justify-between gap-2 p-2.5">
      <div className="min-w-0 flex-1 space-y-1.5">
        <p
          className="truncate text-sm font-medium text-foreground"
          title={meeting.title}
        >
          {meeting.title}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            <CalendarClock className="h-3 w-3" />
            {formatUpcomingTime(meeting.startTime)}
          </span>
          <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {SOURCE_LABELS[meeting.source]}
          </span>
          {meeting.needsAgenda ? (
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-300">
              Needs agenda
            </span>
          ) : (
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
              Agenda ready ({meeting.agendaSectionCount})
            </span>
          )}
          {meeting.openTaskCount > 0 && (
            <span className="rounded-full border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:border-sky-400/40 dark:bg-sky-400/10 dark:text-sky-300">
              {meeting.openTaskCount} open task
              {meeting.openTaskCount === 1 ? "" : "s"}
            </span>
          )}
        </div>
        {attendeeNames && (
          <p
            className="truncate text-xs text-muted-foreground"
            title={attendeeNames}
          >
            {attendeeNames}
            {meeting.attendees.length > 4 &&
              ` +${meeting.attendees.length - 4} more`}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {meeting.hangoutLink && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            title="Open meeting link"
            aria-label={`Open meeting link for "${meeting.title}"`}
            asChild
          >
            <a
              href={meeting.hangoutLink}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Video className="h-3.5 w-3.5" />
            </a>
          </Button>
        )}
        {meeting.meetingId && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            title="Open meeting"
            aria-label={`Open meeting "${meeting.title}"`}
            asChild
          >
            <Link href={`/meetings/${encodeURIComponent(meeting.meetingId)}`}>
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7"
          asChild
        >
          <Link href={resolveUpcomingMeetingHref(meeting)}>
            <NotebookPen className="mr-1.5 h-3.5 w-3.5" />
            {meeting.needsAgenda ? "Prepare agenda" : "Edit agenda"}
          </Link>
        </Button>
      </div>
    </div>
  );
}

export interface UpcomingMeetingsSectionProps {
  meetings: UpcomingMeeting[];
  isLoading?: boolean;
  className?: string;
}

export default function UpcomingMeetingsSection({
  meetings,
  isLoading = false,
  className,
}: UpcomingMeetingsSectionProps) {
  if (!isLoading && meetings.length === 0) {
    return null;
  }
  const needsAgendaCount = meetings.filter((m) => m.needsAgenda).length;

  return (
    <Card className={cn(className)}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4" />
            Upcoming meetings
          </span>
          <span className="flex items-center gap-1.5">
            {needsAgendaCount > 0 && (
              <Badge
                variant="outline"
                className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
              >
                {needsAgendaCount} need{needsAgendaCount === 1 ? "s" : ""} agenda
              </Badge>
            )}
            <Badge variant="secondary" className="shrink-0">
              {meetings.length}
            </Badge>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        {isLoading && meetings.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Loading upcoming meetings…
          </p>
        ) : (
          meetings.map((meeting) => (
            <UpcomingMeetingRow key={meeting.id} meeting={meeting} />
          ))
        )}
      </CardContent>
    </Card>
  );
}
