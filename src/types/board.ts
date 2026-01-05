export type BoardPriority = "low" | "medium" | "high";
export type BoardStatusCategory = "todo" | "inprogress" | "done" | "recurring";

export interface Board {
  id: string;
  workspaceId: string;
  userId: string;
  name: string;
  description?: string | null;
  color?: string | null;
  templateId?: string | null;
  isDefault?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BoardStatus {
  id: string;
  workspaceId: string;
  userId: string;
  boardId: string;
  label: string;
  color: string;
  category: BoardStatusCategory;
  order: number;
  isTerminal: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BoardItem {
  id: string;
  boardId: string;
  workspaceId: string;
  userId: string;
  taskId: string;
  statusId: string;
  rank: number;
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
