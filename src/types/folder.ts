// src/types/folder.ts
export interface Folder {
  id: string; // Firestore document ID
  name: string;
  userId: string; // ID of the user who owns this folder
  createdAt: any; // Firestore Timestamp or number for client-side sorting
  parentId?: string | null; // ID of the parent folder, null for root folders
}
