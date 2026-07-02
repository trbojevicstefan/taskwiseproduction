// src/types/chat.ts
import { z } from 'zod';
import type { AppUser } from '@/contexts/AuthContext';
import { PersonSchema, TranscriptQAOutputSchema } from '@/ai/flows/schemas';
import type { TaskTypeCategory } from '@/lib/task-types';

type AIPersonSchema = z.infer<typeof PersonSchema> & { role?: 'attendee' | 'mentioned' };

export interface TaskEvidence {
  snippet: string;
  speaker?: string | null;
  timestamp?: string | null;
}

// Phase 3 task cleanup (vanity filter) metadata. All fields are additive and
// optional; a task without cleanupStatus is treated as 'active'.
export type TaskCleanupStatus =
  | 'active'
  | 'suggested_expire'
  | 'expired'
  | 'duplicate_suggested'
  | 'completed_suggested'
  | 'dismissed';

export type TaskCleanupCategory =
  | 'scheduling_admin'
  | 'meeting_logistics'
  | 'already_completed'
  | 'duplicate'
  | 'low_specificity'
  | 'stale_follow_up'
  | 'expired_event';

export interface TaskCleanupEvidence {
  sourceType: 'task' | 'transcript' | 'meeting';
  sourceId: string;
  snippet: string;
}

export interface TaskReferenceSchema {
  taskId: string;
  sourceTaskId: string;
  title: string;
  subtasks?: TaskReferenceSchema[] | null;
  // Dynamic status/properties fetched from canonical task
}

export interface TaskComment {
  id: string;
  text: string;
  createdAt: number;
  authorName?: string | null;
  authorId?: string | null;
}

export interface CompletionTarget {
  sourceType: 'task' | 'meeting' | 'chat';
  sourceSessionId: string;
  taskId: string;
  sourceSessionName?: string | null;
}

export interface TaskRevision {
  id: string;
  createdAt: number;
  source: 'ai' | 'user' | 'system';
  summary: string;
  tasksSnapshot: ExtractedTaskSchema[];
}

// Task schema used throughout the application, including AI flows and storage.
export interface ExtractedTaskSchema {
  id: string; // Stable client-side UUID
  title: string;
  description?: string | null;
  priority: 'high' | 'medium' | 'low';
  taskType?: TaskTypeCategory | null;
  dueAt?: string | Date | null;
  status?: 'todo' | 'inprogress' | 'done' | 'recurring';
  subtasks?: ExtractedTaskSchema[] | null;
  assignee?: Partial<AppUser> | null;
  assigneeName?: string | null; // Name from AI, used for matching
  sourceEvidence?: TaskEvidence[] | null;
  aiProvider?: "openai" | null;
  comments?: TaskComment[] | null;

  // UI/Client-side state fields
  addedToProjectId?: string | null;
  addedToProjectName?: string | null;
  addedToBoardId?: string | null;
  addedToBoardName?: string | null;
  reviewStatus?: 'suggested' | 'confirmed' | null;
  reviewedAt?: string | Date | null;
  taskState?: 'active' | 'suggested' | 'archived' | null;

  // AI-generated content
  researchBrief?: string | null;
  aiAssistanceText?: string | null;

  // Provenance
  sourceSessionId?: string; // Links back to the session it originated from
  sourceSessionName?: string | null;
  isPersonGroup?: boolean; // UI hint

  // Completion review metadata
  completionSuggested?: boolean;
  completionConfidence?: number | null;
  completionEvidence?: TaskEvidence[] | null;
  completionTargets?: CompletionTarget[] | null;

  // Task cleanup metadata (Phase 3). Absent cleanupStatus === 'active'.
  cleanupStatus?: TaskCleanupStatus | null;
  cleanupCategory?: TaskCleanupCategory | null;
  cleanupReason?: string | null;
  cleanupConfidence?: number | null;
  cleanupEvidence?: TaskCleanupEvidence[] | null;
  expiresAt?: string | null;
  duplicateOfTaskId?: string | null;
  cleanupReviewedAt?: string | null;
  cleanupReviewedBy?: string | null;
}


export interface Message {
  id: string;
  text: string;
  attachedContent?: string | null;
  sender: 'user' | 'ai';
  timestamp: number;
  avatar?: string;
  name?: string;
  sources?: z.infer<typeof TranscriptQAOutputSchema>['sources'];
}

export interface BaseSession {
  _id?: unknown; // MongoDB ObjectId, kept as unknown for flexibility
  id: string;
  userId?: string;
  workspaceId?: string | null;
  title: string;
  createdAt: any;
  lastActivityAt: any;
  folderId?: string | null;
}

export interface ChatSession extends BaseSession {
  messages: Message[];
  suggestedTasks: ExtractedTaskSchema[];
  people?: AIPersonSchema[];
  sourceMeetingId?: string | null;
  originalAiTasks?: ExtractedTaskSchema[] | null;
  originalAllTaskLevels?: {
    light: ExtractedTaskSchema[];
    medium: ExtractedTaskSchema[];
    detailed: ExtractedTaskSchema[];
  } | null;
  taskRevisions?: TaskRevision[];
  allTaskLevels?: {
    light: ExtractedTaskSchema[],
    medium: ExtractedTaskSchema[],
    detailed: ExtractedTaskSchema[],
  } | null;
}

export interface PlanningSession extends BaseSession {
  inputText: string;
  extractedTasks: ExtractedTaskSchema[];
  projectId?: string;
  sourceMeetingId?: string | null;
  originalAiTasks?: ExtractedTaskSchema[] | null;
  originalAllTaskLevels?: {
    light: ExtractedTaskSchema[];
    medium: ExtractedTaskSchema[];
    detailed: ExtractedTaskSchema[];
  } | null;
  taskRevisions?: TaskRevision[];
  allTaskLevels?: {
    light: ExtractedTaskSchema[],
    medium: ExtractedTaskSchema[],
    detailed: ExtractedTaskSchema[],
  } | null;
}

export interface ExploreSession extends BaseSession {
  inputText: string;
  exploredTasks: ExtractedTaskSchema[];
}

export interface Meeting extends BaseSession {
  originalTranscript: string;
  summary: string;
  attendees: AIPersonSchema[];
  extractedTasks: ExtractedTaskSchema[];
  recordingId?: string;
  recordingUrl?: string;
  shareUrl?: string;
  chatSessionId?: string | null;
  planningSessionId?: string | null;
  originalAiTasks?: ExtractedTaskSchema[] | null;
  originalAllTaskLevels?: {
    light: ExtractedTaskSchema[];
    medium: ExtractedTaskSchema[];
    detailed: ExtractedTaskSchema[];
  } | null;
  taskRevisions?: TaskRevision[];
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
}
