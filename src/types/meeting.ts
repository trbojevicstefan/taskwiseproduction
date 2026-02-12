
// src/types/meeting.ts
import type { BaseSession } from './chat';
import type { PersonSchemaType } from '@/ai/flows/schemas';
import type { ExtractedTaskSchema, TaskRevision, TaskReferenceSchema } from './chat';

/**
 * Represents a single meeting record in the database, aligning with the new ingestion pipeline.
 */
export interface Meeting extends BaseSession {
  // Core Identifiers from APIs
  conferenceId?: string;
  calendarEventId?: string;
  recordingId?: string;
  recordingUrl?: string;
  shareUrl?: string;

  // Meeting Details
  organizerEmail?: string;
  startTime?: any; // Timestamp
  endTime?: any; // Timestamp

  // Ingestion & Processing State
  state?: 'raw_data_in' | 'processing' | 'tasks_ready' | 'error';
  ingestSource?: 'fathom' | 'manual' | 'google' | 'import';
  fathomNotificationReadAt?: string | null;
  recordingIdHash?: string | null;
  isHidden?: boolean;
  hiddenAt?: any;

  // Artifacts (references to raw files)
  artifacts?: {
    artifactId: string;
    type: 'transcript' | 'recording' | 'attendance' | 'chat' | 'transcript_translation';
    driveFileId: string;
    storagePath: string; // GCS path
    processedText?: string;
    status: 'available' | 'exported';
    language?: string | null;
    createdAt?: string | null;
  }[];

  // AI-Generated Content (remains the same)
  originalTranscript: string;
  summary: string;
  attendees: Array<PersonSchemaType & { role: 'attendee' | 'mentioned' }>;
  extractedTasks: (ExtractedTaskSchema | TaskReferenceSchema)[];
  originalAiTasks?: ExtractedTaskSchema[] | null;
  originalAllTaskLevels?: {
    light: ExtractedTaskSchema[];
    medium: ExtractedTaskSchema[];
    detailed: ExtractedTaskSchema[];
  } | null;
  taskRevisions?: TaskRevision[];

  // Links to other parts of the app
  chatSessionId?: string | null;
  planningSessionId?: string | null;
  previousMeetingId?: string | null; // For recurring meeting series

  // Optional metadata
  tags?: string[];
  keyMoments?: { timestamp: string; description: string }[];
  duration?: number;
  overallSentiment?: number;
  speakerActivity?: { name: string; wordCount: number }[];
  meetingMetadata?: {
    type: "SALES_DISCOVERY" | "ENGINEERING_SCRUM" | "GENERAL_INTERNAL";
    confidence?: number;
    reasoning?: string;
    dealIntelligence?: {
      painPoints?: string[];
      economicBuyer?: string;
      timeline?: string;
    };
    sprintHealth?: "ON_TRACK" | "AT_RISK";
    blockers?: string[];
  };
  allTaskLevels?: {
    light: ExtractedTaskSchema[],
    medium: ExtractedTaskSchema[],
    detailed: ExtractedTaskSchema[],
  } | null;
}
