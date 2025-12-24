// src/components/dashboard/explore/types.ts

import type { ExtractedTaskSchema } from '@/types/chat';
import type { Meeting } from '@/types/meeting';

export interface DayData {
  date: Date;
  meetings: Meeting[];
  meetingCount: number;
  isEmpty: boolean;
}

export type { Meeting, ExtractedTaskSchema };
