import { apiFetch } from "@/lib/api";

export const moveTaskToBoard = async (
  workspaceId: string,
  taskId: string,
  boardId: string
) =>
  apiFetch(`/api/workspaces/${workspaceId}/boards/move-task`, {
    method: "POST",
    body: JSON.stringify({ taskId, boardId }),
  });

export const getTaskBoardMembership = async (
  workspaceId: string,
  taskId: string
) =>
  apiFetch<{ boardId?: string | null; boardIds?: string[] }>(
    `/api/workspaces/${workspaceId}/boards/by-task/${encodeURIComponent(taskId)}`
  );
