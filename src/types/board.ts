export type BoardPriority = "low" | "medium" | "high";

export interface BoardStatus {
  id: string;
  workspaceId: string;
  userId: string;
  label: string;
  color: string;
  order: number;
  isTerminal: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BoardTask {
  id: string;
  workspaceId: string;
  userId: string;
  title: string;
  description?: string | null;
  statusId: string;
  priority: BoardPriority;
  assigneeId?: string | null;
  assigneeName?: string | null;
  dueAt?: string | null;
  order: number;
  createdAt: string;
  updatedAt: string;
}
