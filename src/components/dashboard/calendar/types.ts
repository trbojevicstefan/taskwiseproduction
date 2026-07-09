// src/components/dashboard/calendar/types.ts

export type CalendarView = "month" | "week" | "agenda";

export interface CalendarAttendee {
  name?: string | null;
  email?: string | null;
}

export interface CalendarMeetingItem {
  id: string;
  title: string;
  startTime: string | null;
  attendeeCount: number;
  isClientMeeting: boolean;
  /** Additive (Priority 10): external calendar event id stored on the meeting. */
  calendarEventId?: string | null;
  /** Additive (Priority 10): used for Google-event ↔ meeting matching. */
  organizerEmail?: string | null;
  /** Additive (Priority 10): capped attendee list for the detail drawer. */
  attendees?: CalendarAttendee[];
}

export interface CalendarTaskItem {
  id: string;
  title: string;
  dueAt: string;
  status: string;
  priorityLabel: string | null;
  priorityScore: number | null;
  cleanupStatus: string | null;
  assigneeName: string | null;
  sourceSessionId: string | null;
  overdue: boolean;
}

/**
 * Additive Phase 10 projection of a scheduled Slack reminder returned by
 * GET /api/calendar within [from,to]. Only 'scheduled' reminders are sent.
 */
export interface CalendarReminderItem {
  id: string;
  taskId: string;
  taskTitle: string;
  kind: "before_due" | "on_due" | "overdue" | "custom" | string;
  runAt: string;
  status: "scheduled";
}

export const REMINDER_KIND_LABELS: Record<string, string> = {
  before_due: "Before due",
  on_due: "On due date",
  overdue: "Overdue",
  custom: "Custom",
};

export interface CalendarWarnings {
  overdueCount: number;
  cleanupSuggestedCount: number;
  expiredCount: number;
}

export interface CalendarData {
  meetings: CalendarMeetingItem[];
  tasks: CalendarTaskItem[];
  warnings: CalendarWarnings;
  /** Additive: scheduled Slack reminders in range (may be absent on older payloads). */
  reminders?: CalendarReminderItem[];
}

export interface GoogleCalendarOverlayEvent {
  id: string;
  title: string;
  startTime: string | null;
  endTime?: string | null;
  hangoutLink?: string | null;
  htmlLink?: string | null;
  location?: string | null;
  organizer?: string | null;
  /** Present when the overlay loads the broader Google Calendar event feed. */
  description?: string | null;
  attendees?: Array<{
    email?: string | null;
    name?: string | null;
    responseStatus?: string | null;
  }>;
}

export type TaskTone = "neutral" | "overdue" | "urgent";

export type CalendarDayEntry =
  | {
      kind: "meeting";
      id: string;
      title: string;
      date: Date | null;
      isClientMeeting: boolean;
      attendeeCount: number;
    }
  | {
      kind: "google";
      id: string;
      title: string;
      date: Date | null;
      link: string | null;
    }
  | {
      kind: "task";
      id: string;
      title: string;
      date: Date | null;
      tone: TaskTone;
      status: string;
      priorityLabel: string | null;
      assigneeName: string | null;
      sourceSessionId: string | null;
    };

export interface CalendarRange {
  from: Date;
  to: Date;
}

export const EMPTY_CALENDAR_WARNINGS: CalendarWarnings = {
  overdueCount: 0,
  cleanupSuggestedCount: 0,
  expiredCount: 0,
};

export const EMPTY_CALENDAR_DATA: CalendarData = {
  meetings: [],
  tasks: [],
  warnings: EMPTY_CALENDAR_WARNINGS,
  reminders: [],
};
