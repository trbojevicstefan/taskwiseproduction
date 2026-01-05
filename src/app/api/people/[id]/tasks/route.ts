import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { buildIdQuery } from "@/lib/mongo-id";
import { normalizePersonNameKey } from "@/lib/transcript-utils";
import type { ExtractedTaskSchema } from "@/types/chat";

const serializeTask = (task: any) => ({
  ...task,
  id: task._id,
  _id: undefined,
  createdAt: task.createdAt?.toISOString?.() || task.createdAt,
  lastUpdated: task.lastUpdated?.toISOString?.() || task.lastUpdated,
});

const flattenExtractedTasks = (
  tasks: ExtractedTaskSchema[] = []
): ExtractedTaskSchema[] => {
  const result: ExtractedTaskSchema[] = [];
  const walk = (items: ExtractedTaskSchema[]) => {
    items.forEach((task) => {
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
  const userIdQuery = buildIdQuery(userId);
  const assigneeQuery = buildIdQuery(id);

  const person = await db.collection<any>("people").findOne({
    userId: userIdQuery,
    $or: [{ _id: assigneeQuery }, { id }, { slackId: id }],
  });

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

  const tasks = await db
    .collection<any>("tasks")
    .find({
      userId: userIdQuery,
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
    })
    .sort({ createdAt: -1 })
    .toArray();

  const meetingSessionsWithTasks = new Set<string>();
  const chatSessionsWithTasks = new Set<string>();
  tasks.forEach((task) => {
    if (task?.sourceSessionType === "meeting" && task.sourceSessionId) {
      meetingSessionsWithTasks.add(String(task.sourceSessionId));
    }
    if (task?.sourceSessionType === "chat" && task.sourceSessionId) {
      chatSessionsWithTasks.add(String(task.sourceSessionId));
    }
  });

  const meetings = await db
    .collection<any>("meetings")
    .find({ userId: userIdQuery, isHidden: { $ne: true } })
    .project({ _id: 1, title: 1, extractedTasks: 1 })
    .toArray();

  const chatSessions = await db
    .collection<any>("chatSessions")
    .find({ userId: userIdQuery })
    .project({ _id: 1, title: 1, suggestedTasks: 1 })
    .toArray();

  const meetingTasks = meetings.flatMap((meeting) => {
    const meetingId = String(meeting._id ?? meeting.id);
    if (meetingSessionsWithTasks.has(meetingId)) return [];
    const extracted = flattenExtractedTasks(meeting.extractedTasks || []);
    return extracted
      .filter(matchesTaskAssignee)
      .map((task) =>
        toTaskShape(task, {
          id: meetingId,
          title: meeting.title,
          userId,
          sourceType: "meeting",
        })
      );
  });

  const chatTasks = chatSessions.flatMap((session) => {
    const sessionId = String(session._id ?? session.id);
    if (chatSessionsWithTasks.has(sessionId)) return [];
    const extracted = flattenExtractedTasks(session.suggestedTasks || []);
    return extracted
      .filter(matchesTaskAssignee)
      .map((task) =>
        toTaskShape(task, {
          id: sessionId,
          title: session.title,
          userId,
          sourceType: "chat",
        })
      );
  });

  const normalizedTasks = [
    ...tasks.map((task) => ({
      ...serializeTask(task),
      sourceSessionType: task.sourceSessionType || task.origin || "task",
      sourceSessionId: task.sourceSessionId ?? null,
      sourceSessionName: task.sourceSessionName ?? null,
      sourceTaskId: task.sourceTaskId ?? (task._id?.toString?.() || task.id),
    })),
    ...meetingTasks,
    ...chatTasks,
  ];

  return NextResponse.json(normalizedTasks);
}
