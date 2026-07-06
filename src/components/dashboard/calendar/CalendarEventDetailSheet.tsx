// src/components/dashboard/calendar/CalendarEventDetailSheet.tsx
"use client";

/**
 * Priority 10 — in-app event detail drawer. Clicking a calendar item opens
 * this sheet first; external links and navigation are explicit actions.
 *
 * - Internal meetings: title, time, attendees, link to /meetings/[id].
 * - Google overlay events: title, time, attendees, description, conferencing
 *   link (explicit, target _blank), the matched Taskwise meeting when found
 *   (external event id first, then title/time proximity — see
 *   src/lib/calendar-event-matching), and create/link actions when not.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import {
  Building2,
  CalendarDays,
  ExternalLink,
  Link2,
  ListPlus,
  Loader2,
  NotebookPen,
  Plus,
  Users,
  Video,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { apiFetch } from "@/lib/api";
import { matchGoogleEventToMeeting } from "@/lib/calendar-event-matching";
import { cn } from "@/lib/utils";
import { coerceDate } from "./calendar-utils";
import type {
  CalendarMeetingItem,
  GoogleCalendarOverlayEvent,
} from "./types";

export type CalendarDetailSelection =
  | { kind: "meeting"; meeting: CalendarMeetingItem }
  | { kind: "google"; event: GoogleCalendarOverlayEvent };

interface CalendarEventDetailSheetProps {
  selection: CalendarDetailSelection | null;
  /** In-range Taskwise meetings, used to match Google events. */
  meetings: CalendarMeetingItem[];
  onOpenChange: (open: boolean) => void;
  /** Called after a meeting is created or linked so the calendar can refresh. */
  onCalendarChanged?: () => void;
}

type RecentMeetingOption = {
  id: string;
  title: string;
  startTime: string | null;
};

const RECENT_MEETINGS_LIMIT = 20;

const formatEventTime = (
  start: string | null | undefined,
  end?: string | null
): string | null => {
  const startDate = coerceDate(start ?? null);
  if (!startDate) return null;
  const dayLabel = format(startDate, "EEEE, MMM d, yyyy");
  const startLabel = format(startDate, "p");
  const endDate = coerceDate(end ?? null);
  if (endDate && endDate.getTime() > startDate.getTime()) {
    return `${dayLabel} · ${startLabel} – ${format(endDate, "p")}`;
  }
  return `${dayLabel} · ${startLabel}`;
};

const attendeeLabel = (attendee: {
  name?: string | null;
  email?: string | null;
}): string => {
  const name = attendee.name?.trim();
  const email = attendee.email?.trim();
  if (name && email && name !== email) return `${name} (${email})`;
  return name || email || "";
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </h3>
  );
}

function AttendeeList({
  attendees,
  fallbackCount,
}: {
  attendees: Array<{ name?: string | null; email?: string | null }>;
  fallbackCount?: number;
}) {
  const labels = attendees.map(attendeeLabel).filter(Boolean);
  if (labels.length === 0) {
    if (fallbackCount && fallbackCount > 0) {
      return (
        <p className="text-sm text-muted-foreground">
          {fallbackCount} attendee{fallbackCount === 1 ? "" : "s"}
        </p>
      );
    }
    return <p className="text-sm text-muted-foreground">No attendees listed.</p>;
  }
  return (
    <ul className="space-y-1">
      {labels.map((label, index) => (
        <li
          key={`${label}-${index}`}
          className="flex items-center gap-2 text-sm text-foreground/90"
        >
          <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 truncate">{label}</span>
        </li>
      ))}
    </ul>
  );
}

export default function CalendarEventDetailSheet({
  selection,
  meetings,
  onOpenChange,
  onCalendarChanged,
}: CalendarEventDetailSheetProps) {
  // Set after a successful create/link so the drawer reflects the new link
  // immediately, before the calendar payload refresh lands.
  const [linkedMeeting, setLinkedMeeting] = useState<{
    id: string;
    title: string | null;
  } | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isPickerLoading, setIsPickerLoading] = useState(false);
  const [recentMeetings, setRecentMeetings] = useState<RecentMeetingOption[]>([]);
  const [linkingMeetingId, setLinkingMeetingId] = useState<string | null>(null);

  const selectionKey =
    selection === null
      ? null
      : selection.kind === "meeting"
        ? `meeting:${selection.meeting.id}`
        : `google:${selection.event.id}`;

  useEffect(() => {
    // Reset transient action state whenever a different item is opened.
    setLinkedMeeting(null);
    setIsCreating(false);
    setActionError(null);
    setIsPickerOpen(false);
    setRecentMeetings([]);
    setLinkingMeetingId(null);
  }, [selectionKey]);

  const googleEvent = selection?.kind === "google" ? selection.event : null;

  const matchedMeeting = useMemo(() => {
    if (!googleEvent) return null;
    if (linkedMeeting) return linkedMeeting;
    const match = matchGoogleEventToMeeting(
      {
        id: googleEvent.id,
        title: googleEvent.title,
        startTime: googleEvent.startTime,
        organizer: googleEvent.organizer ?? null,
        attendees: googleEvent.attendees ?? [],
      },
      meetings
    );
    if (!match) return null;
    const meeting = meetings.find((item) => item.id === match.meetingId);
    return { id: match.meetingId, title: meeting?.title ?? null };
  }, [googleEvent, linkedMeeting, meetings]);

  const handleCreateMeeting = useCallback(async () => {
    if (!googleEvent || isCreating) return;
    setIsCreating(true);
    setActionError(null);
    try {
      const response = await apiFetch<{
        ok?: boolean;
        meeting?: { id: string; title?: string | null };
      }>("/api/calendar/meetings", {
        method: "POST",
        body: JSON.stringify({
          title: googleEvent.title || "Untitled Meeting",
          startTime: googleEvent.startTime,
          endTime: googleEvent.endTime ?? null,
          attendees: (googleEvent.attendees ?? []).map((attendee) => ({
            name: attendee.name ?? null,
            email: attendee.email ?? null,
          })),
          description: googleEvent.description ?? null,
          externalEventId: googleEvent.id,
        }),
      });
      if (response?.meeting?.id) {
        setLinkedMeeting({
          id: response.meeting.id,
          title: response.meeting.title ?? googleEvent.title ?? null,
        });
        onCalendarChanged?.();
      } else {
        setActionError("Could not create the meeting.");
      }
    } catch (error: any) {
      setActionError(error?.message || "Could not create the meeting.");
    } finally {
      setIsCreating(false);
    }
  }, [googleEvent, isCreating, onCalendarChanged]);

  const handleOpenPicker = useCallback(async () => {
    if (isPickerOpen) {
      setIsPickerOpen(false);
      return;
    }
    setIsPickerOpen(true);
    setActionError(null);
    setIsPickerLoading(true);
    try {
      const response = await apiFetch<{
        data?: Array<{ id: string; title?: string; startTime?: string | null }>;
      }>(`/api/meetings?paginate=1&limit=${RECENT_MEETINGS_LIMIT}`);
      setRecentMeetings(
        (response?.data ?? []).map((meeting) => ({
          id: meeting.id,
          title: meeting.title || "Untitled Meeting",
          startTime: meeting.startTime ?? null,
        }))
      );
    } catch (error: any) {
      setActionError(error?.message || "Could not load recent meetings.");
    } finally {
      setIsPickerLoading(false);
    }
  }, [isPickerOpen]);

  const handleLinkExisting = useCallback(
    async (meeting: RecentMeetingOption) => {
      if (!googleEvent || linkingMeetingId) return;
      setLinkingMeetingId(meeting.id);
      setActionError(null);
      try {
        await apiFetch("/api/calendar/meetings/link", {
          method: "POST",
          body: JSON.stringify({
            meetingId: meeting.id,
            externalEventId: googleEvent.id,
          }),
        });
        setLinkedMeeting({ id: meeting.id, title: meeting.title });
        setIsPickerOpen(false);
        onCalendarChanged?.();
      } catch (error: any) {
        setActionError(error?.message || "Could not link the meeting.");
      } finally {
        setLinkingMeetingId(null);
      }
    },
    [googleEvent, linkingMeetingId, onCalendarChanged]
  );

  const externalLink = googleEvent
    ? googleEvent.hangoutLink || googleEvent.htmlLink || null
    : null;

  const agendaHref = "/planning/agendas";

  return (
    <Sheet open={selection !== null} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto bg-background sm:max-w-md"
        data-testid="calendar-detail-sheet"
      >
        {selection?.kind === "meeting" && (
          <div className="flex h-full flex-col gap-4">
            <SheetHeader>
              <div className="flex items-center gap-2 pr-8">
                {selection.meeting.isClientMeeting ? (
                  <Building2 className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                ) : (
                  <Video className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                )}
                <SheetTitle className="min-w-0 truncate">
                  {selection.meeting.title}
                </SheetTitle>
              </div>
              <SheetDescription>
                {formatEventTime(selection.meeting.startTime) ??
                  "No start time recorded."}
              </SheetDescription>
              {selection.meeting.isClientMeeting && (
                <Badge variant="outline" className="w-fit">
                  Client meeting
                </Badge>
              )}
            </SheetHeader>
            <Separator />
            <div className="space-y-2">
              <SectionLabel>Attendees</SectionLabel>
              <AttendeeList
                attendees={selection.meeting.attendees ?? []}
                fallbackCount={selection.meeting.attendeeCount}
              />
            </div>
            <Separator />
            <div className="flex flex-col gap-2">
              <Button asChild data-testid="calendar-detail-open-meeting">
                <Link href={`/meetings/${selection.meeting.id}`}>
                  <NotebookPen className="mr-2 h-4 w-4" aria-hidden="true" />
                  Open meeting
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href={agendaHref}>
                  <ListPlus className="mr-2 h-4 w-4" aria-hidden="true" />
                  Create agenda
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href={`/meetings/${selection.meeting.id}`}>
                  <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                  Add tasks
                </Link>
              </Button>
            </div>
          </div>
        )}

        {selection?.kind === "google" && googleEvent && (
          <div className="flex h-full flex-col gap-4">
            <SheetHeader>
              <div className="flex items-center gap-2 pr-8">
                <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <SheetTitle className="min-w-0 truncate">
                  {googleEvent.title}
                </SheetTitle>
              </div>
              <SheetDescription>
                {formatEventTime(googleEvent.startTime, googleEvent.endTime) ??
                  "No start time recorded."}
              </SheetDescription>
              <Badge variant="outline" className="w-fit">
                Google Calendar
              </Badge>
            </SheetHeader>
            <Separator />
            <div className="space-y-2">
              <SectionLabel>Attendees</SectionLabel>
              <AttendeeList attendees={googleEvent.attendees ?? []} />
            </div>
            {googleEvent.description?.trim() && (
              <div className="space-y-2">
                <SectionLabel>Description</SectionLabel>
                <p className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border bg-card p-3 text-sm text-foreground/90">
                  {googleEvent.description.trim()}
                </p>
              </div>
            )}
            <Separator />
            <div className="space-y-2">
              <SectionLabel>Taskwise meeting</SectionLabel>
              {matchedMeeting ? (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Linked to{" "}
                    <span className="font-medium text-foreground">
                      {matchedMeeting.title || "a Taskwise meeting"}
                    </span>
                    .
                  </p>
                  <Button asChild data-testid="calendar-detail-open-meeting">
                    <Link href={`/meetings/${matchedMeeting.id}`}>
                      <NotebookPen className="mr-2 h-4 w-4" aria-hidden="true" />
                      Open Taskwise meeting
                    </Link>
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <p className="text-sm text-muted-foreground">
                    No Taskwise meeting is linked to this event yet.
                  </p>
                  <Button
                    onClick={handleCreateMeeting}
                    disabled={isCreating || !googleEvent.startTime}
                    data-testid="calendar-detail-create-meeting"
                  >
                    {isCreating ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                    )}
                    Create Taskwise meeting
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleOpenPicker}
                    data-testid="calendar-detail-link-existing"
                  >
                    <Link2 className="mr-2 h-4 w-4" aria-hidden="true" />
                    Link to existing meeting
                  </Button>
                  {isPickerOpen && (
                    <div
                      className="max-h-56 space-y-1 overflow-y-auto rounded-md border bg-card p-2"
                      data-testid="calendar-detail-meeting-picker"
                    >
                      {isPickerLoading ? (
                        <p className="p-2 text-sm text-muted-foreground">
                          Loading recent meetings…
                        </p>
                      ) : recentMeetings.length === 0 ? (
                        <p className="p-2 text-sm text-muted-foreground">
                          No recent meetings found.
                        </p>
                      ) : (
                        recentMeetings.map((meeting) => {
                          const startDate = coerceDate(meeting.startTime);
                          return (
                            <button
                              key={meeting.id}
                              type="button"
                              data-testid="calendar-detail-picker-option"
                              disabled={Boolean(linkingMeetingId)}
                              onClick={() => void handleLinkExisting(meeting)}
                              className={cn(
                                "flex w-full flex-col rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted",
                                linkingMeetingId === meeting.id && "opacity-60"
                              )}
                            >
                              <span className="truncate text-sm font-medium text-foreground">
                                {meeting.title}
                              </span>
                              {startDate && (
                                <span className="text-xs text-muted-foreground">
                                  {format(startDate, "MMM d, yyyy · p")}
                                </span>
                              )}
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              )}
              {actionError && (
                <p className="text-sm text-destructive" role="alert">
                  {actionError}
                </p>
              )}
            </div>
            <Separator />
            <div className="flex flex-col gap-2">
              {externalLink && (
                <Button
                  variant="outline"
                  asChild
                  data-testid="calendar-detail-external-link"
                >
                  <a href={externalLink} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="mr-2 h-4 w-4" aria-hidden="true" />
                    Open meeting link
                  </a>
                </Button>
              )}
              <Button variant="outline" asChild>
                <Link href={agendaHref}>
                  <ListPlus className="mr-2 h-4 w-4" aria-hidden="true" />
                  Create agenda
                </Link>
              </Button>
              {matchedMeeting && (
                <Button variant="outline" asChild>
                  <Link href={`/meetings/${matchedMeeting.id}`}>
                    <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                    Add tasks
                  </Link>
                </Button>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
