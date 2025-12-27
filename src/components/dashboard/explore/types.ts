// src/components/dashboard/explore/types.ts

import type { ExtractedTaskSchema } from '@/types/chat';
import type { Meeting } from '@/types/meeting';

export interface CalendarEvent {
  id: string;
  title: string;
  startTime: string;
  endTime?: string | null;
  hangoutLink?: string | null;
  location?: string | null;
  organizer?: string | null;
  attendees?: Array<{
    email: string;
    name?: string | null;
    responseStatus?: string | null;
  }>;
}

export interface DayData {
  date: Date;
  meetings: Meeting[];
  calendarEvents: CalendarEvent[];
  meetingCount: number;
  isEmpty: boolean;
}

export type { Meeting, ExtractedTaskSchema };
