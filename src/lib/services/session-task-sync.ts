import type { ExtractedTaskSchema } from "@/types/chat";

export type TaskStatus = "todo" | "inprogress" | "done" | "recurring";

export type TaskListUpdateResult = {
  tasks: ExtractedTaskSchema[];
  updated: boolean;
};

export type SessionUpdateResult = {
  updated: boolean;
  session: any;
  tasks: ExtractedTaskSchema[];
};

type SessionType = "meeting" | "chat";

type SessionConfig = {
  collection: "meetings" | "chatSessions";
  tasksKey: "extractedTasks" | "suggestedTasks";
};

const SESSION_CONFIG: Record<SessionType, SessionConfig> = {
  meeting: {
    collection: "meetings",
    tasksKey: "extractedTasks",
  },
  chat: {
    collection: "chatSessions",
    tasksKey: "suggestedTasks",
  },
};

export const collectSessionIds = (session: any, fallbackId?: string | null) => {
  const ids = new Set<string>();
  if (session?._id) ids.add(String(session._id));
  if (session?.id) ids.add(String(session.id));
  if (fallbackId) ids.add(String(fallbackId));
  return Array.from(ids);
};

const updateSessionTasks = async (
  db: any,
  userId: string,
  sessionType: SessionType,
  sessionId: string,
  updater: (tasks: ExtractedTaskSchema[]) => TaskListUpdateResult,
  options?: { touch?: boolean }
): Promise<SessionUpdateResult | null> => {
  const config = SESSION_CONFIG[sessionType];
  const filter = {
    userId,
    $or: [{ _id: sessionId }, { id: sessionId }],
  };

  const session = await db.collection(config.collection).findOne(filter);
  if (!session) return null;

  const currentTasks = Array.isArray(session[config.tasksKey])
    ? (session[config.tasksKey] as ExtractedTaskSchema[])
    : [];
  const result = updater(currentTasks);
  if (!result.updated) {
    return { updated: false, session, tasks: currentTasks };
  }

  const set: Record<string, any> = {
    [config.tasksKey]: result.tasks,
  };
  if (options?.touch !== false) {
    set.lastActivityAt = new Date();
  }
  await db.collection(config.collection).updateOne(filter, { $set: set });
  return { updated: true, session, tasks: result.tasks };
};

export const updateMeetingTasks = async (
  db: any,
  userId: string,
  meetingId: string,
  updater: (tasks: ExtractedTaskSchema[]) => TaskListUpdateResult,
  options?: { touch?: boolean }
) => updateSessionTasks(db, userId, "meeting", meetingId, updater, options);

export const updateChatTasks = async (
  db: any,
  userId: string,
  sessionId: string,
  updater: (tasks: ExtractedTaskSchema[]) => TaskListUpdateResult,
  options?: { touch?: boolean }
) => updateSessionTasks(db, userId, "chat", sessionId, updater, options);

export const updateTaskStatusInList = (
  tasks: ExtractedTaskSchema[],
  taskId: string,
  status: TaskStatus
): TaskListUpdateResult => {
  let updated = false;

  const walk = (items: ExtractedTaskSchema[]): ExtractedTaskSchema[] =>
    items.map((task: any) => {
      let nextTask = task;
      let childUpdated = false;

      if (task.subtasks && task.subtasks.length) {
        const updatedSubtasks = walk(task.subtasks);
        if (updatedSubtasks !== task.subtasks) {
          childUpdated = true;
          nextTask = { ...nextTask, subtasks: updatedSubtasks };
        }
      }

      if (task.id === taskId) {
        updated = true;
        return { ...nextTask, status };
      }

      if (childUpdated) {
        updated = true;
        return nextTask;
      }

      return task;
    });

  return { tasks: walk(tasks), updated };
};

export const updateLinkedChatSessions = async (
  db: any,
  userId: string,
  meeting: any,
  tasks: ExtractedTaskSchema[]
) => {
  const meetingIds = collectSessionIds(meeting);
  const chatFilters: any[] = [];
  if (meeting?.chatSessionId) {
    const chatId = String(meeting.chatSessionId);
    chatFilters.push({ _id: chatId }, { id: chatId });
  }
  if (meetingIds.length > 0) {
    chatFilters.push({ sourceMeetingId: { $in: meetingIds } });
  }
  if (!chatFilters.length) return [];

  const filter = { userId, $or: chatFilters };
  const sessions = await db.collection("chatSessions").find(filter).toArray();
  if (!sessions.length) return [];

  await db.collection("chatSessions").updateMany(filter, {
    $set: { suggestedTasks: tasks, lastActivityAt: new Date() },
  });
  return sessions;
};

export const cleanupChatTasksForSessions = async (
  db: any,
  userId: string,
  sessions: any[]
) => {
  if (!sessions.length) return;
  const sessionIds = new Set<string>();
  sessions.forEach((session: any) => {
    if (session?._id) sessionIds.add(String(session._id));
    if (session?.id) sessionIds.add(String(session.id));
  });
  if (!sessionIds.size) return;
  await db.collection("tasks").deleteMany({
    userId,
    sourceSessionType: "chat",
    sourceSessionId: { $in: Array.from(sessionIds) },
  });
};
