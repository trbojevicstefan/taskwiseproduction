// src/types/person.ts

export interface Person {
  id: string; // Firestore document ID
  userId: string; // The TaskWiseAI user who this person belongs to
  name: string;
  email?: string | null;
  title?: string | null; // e.g., "Project Manager"
  avatarUrl?: string | null;
  slackId?: string | null;
  firefliesId?: string | null;
  phantomBusterId?: string | null;
  aliases?: string[]; 
  isBlocked?: boolean | null;
  sourceSessionIds: string[]; // List of session IDs where this person was identified
  createdAt: any; // Firestore Timestamp
  lastSeenAt: any; // Firestore Timestamp
}

export interface PersonWithTaskCount extends Person {
    taskCount: number;
}
