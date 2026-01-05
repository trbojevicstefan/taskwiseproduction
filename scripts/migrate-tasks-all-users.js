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

const normalizePersonNameKey = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeTask = (task) => {
  if (!task || typeof task !== "object") {
    return {
      id: randomUUID(),
      title: "Untitled Task",
      description: null,
      priority: "medium",
      status: "todo",
      subtasks: null,
    };
  }

  let sanitizedAssignee = null;
  if (task.assignee) {
    sanitizedAssignee = {
      uid: task.assignee.uid ?? null,
      name: task.assignee.name ?? null,
      email: task.assignee.email === undefined ? null : task.assignee.email,
      photoURL: task.assignee.photoURL === undefined ? null : task.assignee.photoURL,
    };
  }

  const sanitizedSubtasks = Array.isArray(task.subtasks)
    ? task.subtasks.map(normalizeTask)
    : null;

  return {
    id: task.id || randomUUID(),
    title: task.title || "Untitled Task",
    description: task.description === undefined ? null : task.description,
    priority: task.priority || "medium",
    taskType: task.taskType === undefined ? null : task.taskType,
    dueAt: task.dueAt === undefined ? null : task.dueAt,
    status: task.status === undefined ? "todo" : task.status,
    assignee: sanitizedAssignee,
    assigneeName: task.assigneeName === undefined ? null : task.assigneeName,
    sourceEvidence: task.sourceEvidence === undefined ? null : task.sourceEvidence,
    aiProvider: task.aiProvider === undefined ? null : task.aiProvider,
    comments: task.comments === undefined ? null : task.comments,
    subtasks: sanitizedSubtasks,
    completionSuggested:
      task.completionSuggested === undefined ? null : task.completionSuggested,
    completionConfidence:
      task.completionConfidence === undefined ? null : task.completionConfidence,
    completionEvidence:
      task.completionEvidence === undefined ? null : task.completionEvidence,
    completionTargets:
      task.completionTargets === undefined ? null : task.completionTargets,
  };
};

const buildTaskRecords = (tasks, options, now) => {
  const records = [];
  const ids = [];
  const origin = options.origin || options.sourceSessionType;

  const walk = (items, parentId) => {
    (items || []).forEach((item, index) => {
      const task = normalizeTask(item);
      ids.push(task.id);

      const assigneeNameRaw = task.assigneeName || task.assignee?.name || null;
      const assigneeNameKey = assigneeNameRaw
        ? normalizePersonNameKey(assigneeNameRaw)
        : null;

      records.push({
        _id: task.id,
        userId: options.userId,
        title: task.title,
        description: task.description || "",
        status: task.status || "todo",
        priority: task.priority || "medium",
        dueAt: task.dueAt ?? null,
        assignee: task.assignee ?? null,
        assigneeName: task.assigneeName ?? null,
        assigneeNameKey,
        sourceEvidence: task.sourceEvidence ?? null,
        aiProvider: task.aiProvider ?? null,
        comments: task.comments ?? null,
        taskType: task.taskType ?? null,
        completionSuggested: task.completionSuggested ?? null,
        completionConfidence: task.completionConfidence ?? null,
        completionEvidence: task.completionEvidence ?? null,
        completionTargets: task.completionTargets ?? null,
        aiSuggested: true,
        origin,
        sourceSessionId: options.sourceSessionId,
        sourceSessionName: options.sourceSessionName ?? null,
        sourceSessionType: options.sourceSessionType,
        sourceTaskId: task.id,
        projectId: null,
        parentId,
        order: index,
        subtaskCount: task.subtasks?.length || 0,
        lastUpdated: now,
      });

      if (task.subtasks?.length) {
        walk(task.subtasks, task.id);
      }
    });
  };

  walk(tasks, null);
  return { records, ids };
};

const syncTasksForSource = async (db, tasks, options) => {
  const now = new Date();
  const { records, ids } = buildTaskRecords(tasks, options, now);
  const userIdQuery = buildIdQuery(options.userId);
  const sessionIdQuery = buildIdQuery(options.sourceSessionId);

  await Promise.all(
    records.map(({ _id, ...rest }) =>
      db.collection("tasks").updateOne(
        { _id, userId: userIdQuery },
        { $set: rest, $setOnInsert: { createdAt: now } },
        { upsert: true }
      )
    )
  );

  const deleteFilter = {
    userId: userIdQuery,
    sourceSessionType: options.sourceSessionType,
    $or: [
      { sourceSessionId: sessionIdQuery },
      { sourceSessionId: options.sourceSessionId },
    ],
  };

  if (ids.length > 0) {
    deleteFilter._id = { $nin: ids };
  }

  const deleteResult = await db.collection("tasks").deleteMany(deleteFilter);
  return { upserted: records.length, deleted: deleteResult.deletedCount || 0 };
};

const resolveUserId = (user) =>
  user?._id?.toString?.() || user?.id || user?.uid || null;

const run = async () => {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  const users = await db
    .collection("users")
    .find({})
    .project({ _id: 1, id: 1, uid: 1, email: 1 })
    .toArray();

  let totals = {
    users: 0,
    meetings: 0,
    chats: 0,
    upserted: 0,
    deleted: 0,
  };

  for (const user of users) {
    const userId = resolveUserId(user);
    if (!userId) {
      console.warn("Skipping user without id:", user);
      continue;
    }

    totals.users += 1;
    const userIdQuery = buildIdQuery(userId);

    const meetings = await db
      .collection("meetings")
      .find({ userId: userIdQuery })
      .project({ _id: 1, id: 1, title: 1, extractedTasks: 1, chatSessionId: 1 })
      .toArray();
    const chatSessions = await db
      .collection("chatSessions")
      .find({ userId: userIdQuery })
      .project({ _id: 1, id: 1, title: 1, suggestedTasks: 1, sourceMeetingId: 1 })
      .toArray();

    let userUpserted = 0;
    let userDeleted = 0;

    const skipChatIds = new Set();
    for (const meeting of meetings) {
      const result = await syncTasksForSource(db, meeting.extractedTasks || [], {
        userId,
        sourceSessionId: String(meeting._id),
        sourceSessionType: "meeting",
        sourceSessionName: meeting.title,
        origin: "meeting",
      });
      totals.meetings += 1;
      userUpserted += result.upserted;
      userDeleted += result.deleted;
      if (meeting.chatSessionId) {
        skipChatIds.add(String(meeting.chatSessionId));
      }
    }

    chatSessions.forEach((session) => {
      if (session.sourceMeetingId) {
        if (session._id) skipChatIds.add(String(session._id));
        if (session.id) skipChatIds.add(String(session.id));
      }
    });

    if (skipChatIds.size) {
      const cleanup = await db.collection("tasks").deleteMany({
        userId: userIdQuery,
        sourceSessionType: "chat",
        sourceSessionId: { $in: Array.from(skipChatIds) },
      });
      userDeleted += cleanup.deletedCount || 0;
    }

    for (const session of chatSessions) {
      const sessionId = String(session._id ?? session.id);
      if (skipChatIds.has(sessionId)) {
        continue;
      }
      const result = await syncTasksForSource(db, session.suggestedTasks || [], {
        userId,
        sourceSessionId: sessionId,
        sourceSessionType: "chat",
        sourceSessionName: session.title,
        origin: "chat",
      });
      totals.chats += 1;
      userUpserted += result.upserted;
      userDeleted += result.deleted;
    }

    totals.upserted += userUpserted;
    totals.deleted += userDeleted;
    console.log(
      `User ${user.email || userId}: synced ${meetings.length} meetings, ${chatSessions.length} chats (${userUpserted} upserted, ${userDeleted} deleted)`
    );
  }

  console.log(
    `Done. Users: ${totals.users}, Meetings: ${totals.meetings}, Chats: ${totals.chats}, Upserted: ${totals.upserted}, Deleted: ${totals.deleted}`
  );

  await client.close();
};

run().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
