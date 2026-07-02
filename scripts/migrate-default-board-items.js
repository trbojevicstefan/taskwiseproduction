const dotenv = require("dotenv");
const { MongoClient, ObjectId } = require("mongodb");
const { randomUUID } = require("crypto");

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || "taskwise";

if (!uri) {
  console.error("MONGODB_URI is not set. Update your .env.local first.");
  process.exit(1);
}

const BASIC_KANBAN_TEMPLATE = {
  id: "kanban-basic",
  name: "Basic Kanban",
  statuses: [
    { label: "To do", color: "#3b82f6", category: "todo", isTerminal: false },
    { label: "In progress", color: "#f59e0b", category: "inprogress", isTerminal: false },
    { label: "Review", color: "#8b5cf6", category: "inprogress", isTerminal: false },
    { label: "Done", color: "#10b981", category: "done", isTerminal: true },
  ],
};

const buildIdQuery = (id) => {
  if (!id) return id;
  if (ObjectId.isValid(id)) {
    try {
      return { $in: [id, new ObjectId(id)] };
    } catch {
      return id;
    }
  }
  return id;
};

const resolveUserId = (user) =>
  user?._id?.toString?.() || user?.id || user?.uid || null;

const ensureWorkspaceId = async (db, user) => {
  if (user?.workspace?.id) return user.workspace.id;
  const fallbackName =
    user?.workspace?.name ||
    user?.name ||
    user?.email ||
    "Workspace";
  const workspace = { id: randomUUID(), name: `${fallbackName}'s Workspace` };
  await db.collection("users").updateOne(
    { _id: user._id },
    { $set: { workspace } }
  );
  return workspace.id;
};

const ensureBoardStatuses = async (db, userId, workspaceId, boardId) => {
  const userIdQuery = buildIdQuery(userId);
  const existing = await db
    .collection("boardStatuses")
    .find({ userId: userIdQuery, workspaceId, boardId })
    .sort({ order: 1 })
    .toArray();

  if (existing.length) return existing;

  const now = new Date();
  const statuses = BASIC_KANBAN_TEMPLATE.statuses.map((status, index) => ({
    _id: randomUUID(),
    userId,
    workspaceId,
    boardId,
    label: status.label,
    color: status.color,
    category: status.category,
    order: index,
    isTerminal: Boolean(status.isTerminal),
    createdAt: now,
    updatedAt: now,
  }));

  await db.collection("boardStatuses").insertMany(statuses);
  return statuses;
};

const ensureDefaultBoard = async (db, userId, workspaceId) => {
  const userIdQuery = buildIdQuery(userId);
  const boards = await db
    .collection("boards")
    .find({ userId: userIdQuery, workspaceId })
    .sort({ createdAt: 1 })
    .toArray();

  let board = boards.find((item) => item.isDefault);
  if (!board && boards.length) {
    board = boards[0];
    await db.collection("boards").updateOne(
      { _id: board._id },
      { $set: { isDefault: true, updatedAt: new Date() } }
    );
  }

  if (!board) {
    const now = new Date();
    board = {
      _id: randomUUID(),
      userId,
      workspaceId,
      name: BASIC_KANBAN_TEMPLATE.name,
      description: null,
      color: BASIC_KANBAN_TEMPLATE.statuses[0].color,
      templateId: BASIC_KANBAN_TEMPLATE.id,
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    };
    await db.collection("boards").insertOne(board);
  }

  return board;
};

const run = async () => {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  const users = await db
    .collection("users")
    .find({})
    .project({ _id: 1, id: 1, uid: 1, email: 1, name: 1, workspace: 1 })
    .toArray();

  const totals = {
    users: 0,
    tasksSeen: 0,
    itemsCreated: 0,
  };

  for (const user of users) {
    const userId = resolveUserId(user);
    if (!userId) {
      console.warn("Skipping user without id:", user);
      continue;
    }

    totals.users += 1;
    const workspaceId = await ensureWorkspaceId(db, user);
    const board = await ensureDefaultBoard(db, userId, workspaceId);
    const boardId = board._id?.toString?.() || board._id;
    const statuses = await ensureBoardStatuses(db, userId, workspaceId, boardId);

    const statusByCategory = new Map();
    statuses.forEach((status) => {
      const statusId = status._id?.toString?.() || status._id;
      statusByCategory.set(status.category || "todo", statusId);
    });
    const fallbackStatusId = statuses[0]?._id?.toString?.() || statuses[0]?._id;

    const userIdQuery = buildIdQuery(userId);
    await db.collection("tasks").updateMany(
      {
        userId: userIdQuery,
        $or: [{ workspaceId: { $exists: false } }, { workspaceId: null }, { workspaceId: "" }],
      },
      { $set: { workspaceId } }
    );

    const tasks = await db
      .collection("tasks")
      .find({
        userId: userIdQuery,
        workspaceId,
        taskState: { $ne: "archived" },
        $or: [{ parentId: null }, { parentId: { $exists: false } }, { parentId: "" }],
      })
      .project({ _id: 1, id: 1, status: 1, createdAt: 1 })
      .toArray();

    totals.tasksSeen += tasks.length;
    if (!tasks.length) {
      console.log(`User ${user.email || userId}: no tasks found.`);
      continue;
    }

    const taskIds = tasks.map((task) => String(task._id || task.id));
    const existingItems = await db
      .collection("boardItems")
      .find({
        userId: userIdQuery,
        workspaceId,
        boardId,
        taskId: { $in: taskIds },
      })
      .project({ taskId: 1 })
      .toArray();
    const existingTaskIds = new Set(existingItems.map((item) => String(item.taskId)));

    const ranksByStatus = new Map();
    for (const status of statuses) {
      const lastItem = await db
        .collection("boardItems")
        .find({
          userId: userIdQuery,
          workspaceId,
          boardId,
          statusId: status._id?.toString?.() || status._id,
        })
        .sort({ rank: -1 })
        .limit(1)
        .toArray();
      const baseRank = typeof lastItem[0]?.rank === "number" ? lastItem[0].rank : 0;
      ranksByStatus.set(String(status._id?.toString?.() || status._id), baseRank);
    }

    const now = new Date();
    const itemsToInsert = [];
    tasks.forEach((task) => {
      const taskId = String(task._id || task.id);
      if (existingTaskIds.has(taskId)) return;
      const statusCategory = task.status || "todo";
      const statusId = statusByCategory.get(statusCategory) || fallbackStatusId;
      if (!statusId) return;
      const nextRank = (ranksByStatus.get(String(statusId)) || 0) + 1000;
      ranksByStatus.set(String(statusId), nextRank);
      itemsToInsert.push({
        _id: randomUUID(),
        userId,
        workspaceId,
        boardId,
        taskId,
        statusId,
        rank: nextRank,
        createdAt: now,
        updatedAt: now,
      });
    });

    if (itemsToInsert.length) {
      await db.collection("boardItems").insertMany(itemsToInsert);
    }

    totals.itemsCreated += itemsToInsert.length;
    console.log(
      `User ${user.email || userId}: added ${itemsToInsert.length} items to ${board.name}`
    );
  }

  console.log(
    `Done. Users: ${totals.users}, Tasks: ${totals.tasksSeen}, Items created: ${totals.itemsCreated}`
  );
  await client.close();
};

run().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
