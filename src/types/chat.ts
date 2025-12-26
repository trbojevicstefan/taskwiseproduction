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

export interface TaskRevision {
  id: string;
  createdAt: number;
  source: 'ai' | 'user' | 'system';
  summary: string;
  tasksSnapshot: ExtractedTaskSchema[];
}

// Task schema used throughout the application, including AI flows and Firestore.
export interface ExtractedTaskSchema {
  id: string; // Stable client-side UUID
  title: string;
  description?: string | null;
  priority: 'high' | 'medium' | 'low';
  taskType?: TaskTypeCategory | null;
  dueAt?: string | Date | null;
  subtasks?: ExtractedTaskSchema[] | null;
  assignee?: Partial<AppUser> | null;
  assigneeName?: string | null; // Name from AI, used for matching
  sourceEvidence?: TaskEvidence[] | null;
  aiProvider?: 'gemini' | 'openai' | null;
  
  // UI/Client-side state fields
  addedToProjectId?: string | null;
  addedToProjectName?: string | null;
  firestoreTaskId?: string | null;
  
  // AI-generated content
  researchBrief?: string | null;
  aiAssistanceText?: string | null;
  
  // Provenance
  sourceSessionId?: string; // Links back to the session it originated from
  sourceSessionName?: string | null;
  isPersonGroup?: boolean; // UI hint
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
    id: string;
    userId?: string;
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
