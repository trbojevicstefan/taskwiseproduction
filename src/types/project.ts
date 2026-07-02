// src/types/project.ts
import type { AppUser } from '@/contexts/AuthContext';
import type {
  CompletionTarget,
  TaskCleanupCategory,
  TaskCleanupEvidence,
  TaskCleanupStatus,
  TaskComment,
  TaskEvidence,
  TaskPriorityLabel,
} from '@/types/chat';

export interface Project {
  id: string; // Document ID
  name: string;
  userId: string; // ID of the user who owns this project
  createdAt: any; // Timestamp or number for client-side sorting
  description?: string;
  // Add other project-specific fields if needed, e.g., color, icon
}

export interface Task {
  id: string;
  workspaceId?: string | null;
  title: string;
  description?: string;
  status: 'todo' | 'inprogress' | 'done' | 'recurring';
  priority: 'high' | 'medium' | 'low';
  dueAt?: string | Date | null;
  assignee?: Partial<AppUser>; 
  assigneeName?: string | null;
  assigneeNameKey?: string | null;
  aiSuggested?: boolean;
  origin?: "manual" | "meeting" | "chat";
  projectId: string; 
  userId: string; // Ensure this is part of the base Task type
  parentId?: string | null; 
  order?: number;
  subtaskCount?: number;
  sourceSessionId?: string | null; // New field
  sourceSessionName?: string | null; // New field
  sourceSessionType?: 'task' | 'meeting' | 'chat' | null;
  sourceTaskId?: string | null;
  comments?: TaskComment[] | null;
  completionSuggested?: boolean | null;
  completionConfidence?: number | null;
  completionEvidence?: TaskEvidence[] | null;
  completionTargets?: CompletionTarget[] | null;
  taskState?: "active" | "suggested" | "archived" | null;
  researchBrief?: string | null;
  aiAssistanceText?: string | null;
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
  // Task prioritization metadata (Phase 9). Computed deterministically by
  // src/lib/task-priority.ts.
  priorityScore?: number | null;
  priorityLabel?: TaskPriorityLabel | null;
  priorityReason?: string | null;
  priorityUpdatedAt?: string | null;
}
