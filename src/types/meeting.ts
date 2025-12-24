
// src/types/meeting.ts
import type { BaseSession } from './chat';
import type { PersonSchemaType } from '@/ai/flows/schemas';
import type { ExtractedTaskSchema, TaskRevision } from './chat';

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
  startTime?: any; // Firestore Timestamp
  endTime?: any; // Firestore Timestamp
  
  // Ingestion & Processing State
  state?: 'raw_data_in' | 'processing' | 'tasks_ready' | 'error';
  
  // Artifacts (references to raw files)
  artifacts?: {
    artifactId: string;
    type: 'transcript' | 'recording' | 'attendance' | 'chat';
    driveFileId: string;
    storagePath: string; // GCS path
    processedText?: string;
    status: 'available' | 'exported';
  }[];

  // AI-Generated Content (remains the same)
  originalTranscript: string;
  summary: string;
  attendees: Array<PersonSchemaType & { role: 'attendee' | 'mentioned' }>;
  extractedTasks: ExtractedTaskSchema[];
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
  
  // Optional metadata
  tags?: string[];
  keyMoments?: { timestamp: string; description: string }[];
  duration?: number;
  overallSentiment?: number; 
  speakerActivity?: { name: string; wordCount: number }[]; 
  allTaskLevels?: { 
    light: ExtractedTaskSchema[],
    medium: ExtractedTaskSchema[],
    detailed: ExtractedTaskSchema[],
  } | null;
}
