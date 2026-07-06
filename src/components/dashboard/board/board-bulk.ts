// src/components/dashboard/board/board-bulk.ts
//
// Pure helpers behind the board's bulk actions (Priority 11). The component
// wires these plans into the existing endpoints:
//   POST /api/workspaces/:workspaceId/boards/:boardId/items/bulk
// which accepts { taskIds, updates?, statusId? }.

import type { BoardStatus } from "@/types/board";
import type { Task } from "@/types/project";

type BulkBoardTask = Task & { boardStatusId?: string; boardRank?: number };

export const buildBulkItemsEndpoint = (
  workspaceId: string,
  boardId: string
): string => `/api/workspaces/${workspaceId}/boards/${boardId}/items/bulk`;

/** First done-category column by board order, or null when there is none. */
export const findDoneStatus = (statuses: BoardStatus[]): BoardStatus | null =>
  [...statuses].sort((a, b) => a.order - b.order).find(
    (status) => status.category === "done"
  ) ?? null;

export interface BulkMovePlan {
  statusId: string;
  /** Tasks that actually change columns (already-there tasks are skipped). */
  taskIds: string[];
  /** Body for POST .../items/bulk. */
  payload: { taskIds: string[]; statusId: string };
}

/**
 * Plans a bulk move of the selected tasks into `targetStatusId`. Returns null
 * when nothing would change.
 */
export const computeBulkMovePlan = (
  selectedTasks: BulkBoardTask[],
  targetStatusId: string
): BulkMovePlan | null => {
  if (!targetStatusId) return null;
  const taskIds = selectedTasks
    .filter((task) => task.boardStatusId !== targetStatusId)
    .map((task) => task.id);
  if (!taskIds.length) return null;
  return {
    statusId: targetStatusId,
    taskIds,
    payload: { taskIds, statusId: targetStatusId },
  };
};

/**
 * Plans "bulk mark done": move the selected tasks into the board's done
 * column. Returns null when the board has no done column or nothing changes.
 */
export const computeBulkMarkDonePlan = (
  selectedTasks: BulkBoardTask[],
  statuses: BoardStatus[]
): BulkMovePlan | null => {
  const doneStatus = findDoneStatus(statuses);
  if (!doneStatus) return null;
  return computeBulkMovePlan(selectedTasks, doneStatus.id);
};
