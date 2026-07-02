export const syncBoardItemsToStatusByTaskId = async (
  db: any,
  userId: string,
  taskId: string,
  nextStatus: string
) => {
  if (!taskId || !nextStatus) return;
  const items = await db
    .collection("boardItems")
    .find({ userId, taskId })
    .toArray();
  if (!items.length) return;

  const boardIds = Array.from(new Set(items.map((item: any) => String(item.boardId))));
  const statuses = await db
    .collection("boardStatuses")
    .find({
      userId,
      boardId: { $in: boardIds },
      category: nextStatus,
    })
    .toArray();
  if (!statuses.length) return;

  const statusByBoard = new Map<string, string>();
  statuses.forEach((status: any) => {
    const boardId = String(status.boardId);
    const statusId = status._id?.toString?.() || status._id;
    statusByBoard.set(boardId, statusId);
  });

  const now = new Date();
  const rankByStatus = new Map<string, number>();
  for (const status of statuses) {
    const boardId = String(status.boardId);
    const statusId = status._id?.toString?.() || status._id;
    const key = `${boardId}:${statusId}`;
    const lastItem = await db
      .collection("boardItems")
      .find({ userId, boardId, statusId })
      .sort({ rank: -1 })
      .limit(1)
      .toArray();
    const baseRank = typeof lastItem[0]?.rank === "number" ? lastItem[0].rank : 0;
    rankByStatus.set(key, baseRank);
  }

  const operations = items
    .map((item: any) => {
      const boardId = String(item.boardId);
      const targetStatusId = statusByBoard.get(boardId);
      if (!targetStatusId) return null;
      const key = `${boardId}:${targetStatusId}`;
      const nextRank = (rankByStatus.get(key) || 0) + 1000;
      rankByStatus.set(key, nextRank);
      return {
        updateOne: {
          filter: { _id: item._id },
          update: {
            $set: {
              statusId: targetStatusId,
              rank: nextRank,
              updatedAt: now,
            },
          },
        },
      };
    })
    .filter(Boolean);

  if (operations.length) {
    await db.collection("boardItems").bulkWrite(operations as any[], {
      ordered: false,
    });
  }
};

export const syncBoardItemsToStatusByTaskRecord = async (
  db: any,
  userId: string,
  taskRecord: any,
  nextStatus: string
) => {
  const taskId =
    taskRecord?._id?.toString?.() ||
    taskRecord?._id ||
    taskRecord?.id ||
    taskRecord?.sourceTaskId;
  if (!taskId) return;
  await syncBoardItemsToStatusByTaskId(db, userId, String(taskId), nextStatus);
};
