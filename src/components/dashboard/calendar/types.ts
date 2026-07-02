// src/components/dashboard/calendar/types.ts

export type CalendarView = "month" | "week" | "agenda";

export interface CalendarMeetingItem {
  id: string;
  title: string;
  startTime: string | null;
  attendeeCount: number;
  isClientMeeting: boolean;
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

export interface CalendarWarnings {
  overdueCount: number;
  cleanupSuggestedCount: number;
  expiredCount: number;
}

export interface CalendarData {
  meetings: CalendarMeetingItem[];
  tasks: CalendarTaskItem[];
  warnings: CalendarWarnings;
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
};
