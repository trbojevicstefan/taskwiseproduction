import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { normalizePersonNameKey } from "@/lib/transcript-utils";
import type { ExtractedTaskSchema } from "@/types/chat";
import type { ObjectId, Db, WithId, Document } from "mongodb";

interface TaskDocument {
  _id?: ObjectId | string;
  id?: string;
  title?: string;
  status?: string;
  priority?: string;
  createdAt?: Date | string;
  lastUpdated?: Date | string;
  researchBrief?: string;
  aiAssistanceText?: string;
  sourceSessionType?: string;
  sourceSessionId?: string | null;
  sourceSessionName?: string | null;
  sourceTaskId?: string;
  origin?: string;
  assignee?: { uid?: string; email?: string; name?: string };
  assigneeName?: string;
  assigneeNameKey?: string;
}

interface MeetingDocument extends Document {
  _id?: ObjectId | string;
  id?: string;
  title?: string;
  extractedTasks?: ExtractedTaskSchema[];
}

interface ChatSessionDocument extends Document {
  _id?: ObjectId | string;
  id?: string;
  title?: string;
  suggestedTasks?: ExtractedTaskSchema[];
  sourceMeetingId?: string | null;
}

interface PersonDocument extends Document {
  _id?: ObjectId | string;
  id?: string;
  name?: string;
  email?: string;
  aliases?: string[];
  slackId?: string;
}

const serializeTask = (task: TaskDocument) => ({
  ...task,
  id: task._id,
  _id: undefined,
  createdAt: (task.createdAt as Date & { toISOString?: () => string })?.toISOString?.() || task.createdAt,
  lastUpdated: (task.lastUpdated as Date & { toISOString?: () => string })?.toISOString?.() || task.lastUpdated,
});

const normalizeId = (value: unknown): string => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof (value as { toString?: () => string }).toString === "function") return (value as { toString: () => string }).toString();
  return String(value);
};

const hasText = (value: unknown): boolean =>
  typeof value === "string" && value.trim().length > 0;

const toTime = (value: unknown): number => {
  if (!value) return 0;
  if (typeof value === "number") return value;
  const date = value instanceof Date ? value : new Date(value as string | number);
  const time = date.getTime();
  return Number.isNaN(time) ? 0 : time;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTask = Record<string, any>;

const buildTaskKey = (task: AnyTask): string => {
  const sessionId = normalizeId(task?.sourceSessionId);
  const sourceTaskId = normalizeId(task?.sourceTaskId);
  const taskId = normalizeId(task?.id ?? task?._id);
  if (sessionId && sourceTaskId) return `${sessionId}:${sourceTaskId}`;
  if (sourceTaskId) return sourceTaskId;
  if (taskId.includes(":")) return taskId;
  return taskId;
};

const pickPreferredTask = (current: AnyTask | undefined, candidate: AnyTask | undefined): AnyTask | undefined => {
  if (!current) return candidate;
  if (!candidate) return current;

  const currentScore =
    (hasText(current.researchBrief) ? 4 : 0) +
    (hasText(current.aiAssistanceText) ? 2 : 0) +
    (current.sourceSessionType ? 1 : 0);
  const candidateScore =
    (hasText(candidate.researchBrief) ? 4 : 0) +
    (hasText(candidate.aiAssistanceText) ? 2 : 0) +
    (candidate.sourceSessionType ? 1 : 0);

  if (candidateScore !== currentScore) {
    return candidateScore > currentScore ? candidate : current;
  }

  const currentTime = Math.max(
    toTime(current.lastUpdated),
    toTime(current.createdAt)
  );
  const candidateTime = Math.max(
    toTime(candidate.lastUpdated),
    toTime(candidate.createdAt)
  );

  if (candidateTime !== currentTime) {
    return candidateTime > currentTime ? candidate : current;
  }

  return current;
};

const flattenExtractedTasks = (
  tasks: ExtractedTaskSchema[] = []
): ExtractedTaskSchema[] => {
  const result: ExtractedTaskSchema[] = [];
  const walk = (items: ExtractedTaskSchema[]) => {
    items.forEach((task: any) => {
      result.push(task);
      if (task.subtasks && task.subtasks.length) {
        walk(task.subtasks);
      }
    });
  };
  walk(tasks);
  return result;
};

const toTaskShape = (
  task: ExtractedTaskSchema,
  context: { id: string; title: string; userId: string; sourceType: "meeting" | "chat" }
) => {
  const derivedId = `${context.id}:${task.id}`;
  return {
    id: derivedId,
    title: task.title,
    description: task.description ?? undefined,
    status: task.status || "todo",
    priority: task.priority || "medium",
    dueAt: task.dueAt ?? null,
    assignee: task.assignee ?? null,
    comments: task.comments ?? null,
    aiSuggested: true,
    projectId: context.id,
    userId: context.userId,
    sourceSessionId: context.id,
    sourceSessionName: context.title,
    sourceSessionType: context.sourceType,
    sourceTaskId: task.id,
  };
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  const assigneeQuery = id;

  const person = await (db as Db).collection<PersonDocument>("people").findOne({
    userId,
    $or: [{ _id: assigneeQuery }, { id }, { slackId: id }],
  } as import("mongodb").Filter<PersonDocument>);

  if (!person) {
    return NextResponse.json({ error: "Person not found" }, { status: 404 });
  }

  const nameKeys = new Set<string>();
  const nameVariants = new Set<string>();
  if (person.name) {
    nameKeys.add(normalizePersonNameKey(person.name));
    nameVariants.add(person.name.trim());
  }
  if (Array.isArray(person.aliases)) {
    person.aliases.forEach((alias: string) => {
      const normalized = normalizePersonNameKey(alias);
      if (normalized) nameKeys.add(normalized);
      if (alias && alias.trim()) nameVariants.add(alias.trim());
    });
  }

  const matchesTaskAssignee = (task: ExtractedTaskSchema) => {
    if (task.assignee?.uid && task.assignee.uid === person._id) return true;
    if (task.assignee?.uid && String(task.assignee.uid) === String(person._id)) return true;
    if (task.assignee?.email && person.email && task.assignee.email === person.email) return true;
    if (task.assigneeName) {
      const normalized = normalizePersonNameKey(task.assigneeName);
      if (normalized && nameKeys.has(normalized)) return true;
    }
    return false;
  };

  const nameKeyList = Array.from(nameKeys).filter(Boolean);
  const nameVariantList = Array.from(nameVariants).filter(Boolean);

  const tasks = await (db as Db)
    .collection<TaskDocument>("tasks")
    .find({
      userId,
      $or: [
        { "assignee.uid": assigneeQuery },
        ...(person.email ? [{ "assignee.email": person.email }] : []),
        ...(nameKeyList.length
          ? [{ assigneeNameKey: { $in: nameKeyList } }]
          : []),
        ...(nameVariantList.length
          ? [
            { assigneeName: { $in: nameVariantList } },
            { "assignee.name": { $in: nameVariantList } },
          ]
          : []),
      ],
    } as import("mongodb").Filter<TaskDocument>)
    .sort({ createdAt: -1 })
    .toArray();

  const meetingSessionsWithTasks = new Set<string>();
  const chatSessionsWithTasks = new Set<string>();
  tasks.forEach((task: WithId<TaskDocument>) => {
    const sourceType = task?.sourceSessionType || task?.origin;
    const sessionId = normalizeId(task?.sourceSessionId);
    if (sourceType === "meeting" && sessionId) {
      meetingSessionsWithTasks.add(sessionId);
    }
    if (sourceType === "chat" && sessionId) {
      chatSessionsWithTasks.add(sessionId);
    }
  });

  const meetings = await (db as Db)
    .collection<MeetingDocument>("meetings")
    .find({ userId, isHidden: { $ne: true } } as import("mongodb").Filter<MeetingDocument>)
    .project({ _id: 1, title: 1, extractedTasks: 1 })
    .toArray();

  const chatSessions = await (db as Db)
    .collection<ChatSessionDocument>("chatSessions")
    .find({ userId } as import("mongodb").Filter<ChatSessionDocument>)
    .project({ _id: 1, title: 1, suggestedTasks: 1, sourceMeetingId: 1 })
    .toArray();

  const meetingTasks = (meetings as WithId<MeetingDocument>[]).flatMap((meeting: WithId<MeetingDocument>) => {
    const meetingId = String(meeting._id ?? meeting.id);
    if (meetingSessionsWithTasks.has(meetingId)) return [];
    const extracted = flattenExtractedTasks(meeting.extractedTasks || []);
    return extracted
      .filter(matchesTaskAssignee)
      .map((task: any) =>
        toTaskShape(task, {
          id: meetingId,
          title: meeting.title || "",
          userId,
          sourceType: "meeting",
        })
      );
  });

  const chatTasks = (chatSessions as WithId<ChatSessionDocument>[]).flatMap((session: WithId<ChatSessionDocument>) => {
    const sessionId = String(session._id ?? session.id);
    if (chatSessionsWithTasks.has(sessionId)) return [];
    // Skip chat sessions that are linked to a meeting - their tasks already exist in the meeting
    if (session.sourceMeetingId) return [];
    const extracted = flattenExtractedTasks(session.suggestedTasks || []);
    return extracted
      .filter(matchesTaskAssignee)
      .map((task: any) =>
        toTaskShape(task, {
          id: sessionId,
          title: session.title || "",
          userId,
          sourceType: "chat",
        })
      );
  });

  const normalizedTasks = [
    ...tasks.map((task: WithId<TaskDocument>) => ({
      ...serializeTask(task),
      sourceSessionType: task.sourceSessionType || task.origin || "task",
      sourceSessionId: task.sourceSessionId ?? null,
      sourceSessionName: task.sourceSessionName ?? null,
      sourceTaskId: task.sourceTaskId ?? (task._id?.toString?.() || task.id),
    })),
    ...meetingTasks,
    ...chatTasks,
  ];

  const dedupedMap = new Map<string, AnyTask>();
  normalizedTasks.forEach((task: any) => {
    const key = buildTaskKey(task);
    if (!key) return;
    const existing = dedupedMap.get(key);
    dedupedMap.set(key, pickPreferredTask(existing, task)!);
  });

  return NextResponse.json(Array.from(dedupedMap.values()));
}


