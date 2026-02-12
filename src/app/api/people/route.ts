import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { buildIdQuery } from "@/lib/mongo-id";
import { normalizePersonNameKey } from "@/lib/transcript-utils";
import type { ExtractedTaskSchema } from "@/types/chat";

const serializePerson = (person: any) => ({
  ...person,
  id: person._id,
  _id: undefined,
  createdAt: person.createdAt?.toISOString?.() || person.createdAt,
  lastSeenAt: person.lastSeenAt?.toISOString?.() || person.lastSeenAt,
});

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  const userIdQuery = buildIdQuery(userId);
  const people = await db
    .collection<any>("people")
    .find({ userId: userIdQuery })
    .sort({ lastSeenAt: -1 })
    .toArray();

  const tasks = await db
    .collection<any>("tasks")
    .find({ userId: userIdQuery })
    .project({
      _id: 1,
      status: 1,
      sourceSessionType: 1,
      sourceSessionId: 1,
      assignee: 1,
      assigneeId: 1,
      assigneeEmail: 1,
      assigneeName: 1,
      assigneeNameKey: 1,
    })
    .toArray();
  const meetings = await db
    .collection<any>("meetings")
    .find({ userId: userIdQuery })
    .project({ _id: 1, extractedTasks: 1 })
    .toArray();
  const chatSessions = await db
    .collection<any>("chatSessions")
    .find({ userId: userIdQuery })
    .project({ _id: 1, suggestedTasks: 1 })
    .toArray();

  type TaskStatus = "todo" | "inprogress" | "done" | "recurring";
  const emptyCounts = () => ({
    total: 0,
    open: 0,
    todo: 0,
    inprogress: 0,
    done: 0,
    recurring: 0,
  });

  const statusCounts = new Map<string, ReturnType<typeof emptyCounts>>();
  const emailToId = new Map<string, string>();
  const nameToId = new Map<string, string>();

  people.forEach((person: any) => {
    const personId = String(person._id);
    statusCounts.set(personId, emptyCounts());
    if (person.email) {
      const emailKey = person.email.toLowerCase();
      if (!emailToId.has(emailKey)) emailToId.set(emailKey, personId);
    }
    if (person.name) {
      const nameKey = normalizePersonNameKey(person.name);
      if (nameKey && !nameToId.has(nameKey)) nameToId.set(nameKey, personId);
    }
    if (Array.isArray(person.aliases)) {
      person.aliases.forEach((alias: string) => {
        const aliasKey = normalizePersonNameKey(alias);
        if (aliasKey && !nameToId.has(aliasKey)) nameToId.set(aliasKey, personId);
      });
    }
  });

  const normalizeStatus = (status: any): TaskStatus => {
    const raw = typeof status === "string" ? status.toLowerCase().trim() : "";
    if (raw === "in progress" || raw === "in-progress" || raw === "in_progress") {
      return "inprogress";
    }
    if (raw === "todo" || raw === "to do" || raw === "to-do") {
      return "todo";
    }
    if (raw === "done" || raw === "completed" || raw === "complete") {
      return "done";
    }
    if (raw === "recurring") {
      return "recurring";
    }
    if (status === "todo" || status === "inprogress" || status === "done" || status === "recurring") {
      return status;
    }
    return "todo";
  };

  const increment = (personId: string, status: TaskStatus) => {
    const key = String(personId);
    const counts = statusCounts.get(key);
    if (!counts) return;
    counts.total += 1;
    counts[status] += 1;
    if (status !== "done") {
      counts.open += 1;
    }
  };

  const resolvePersonId = (task: any) => {
    const assigneeId =
      task?.assignee?.uid ?? task?.assignee?.id ?? task?.assigneeId ?? null;
    if (assigneeId && statusCounts.has(String(assigneeId))) {
      return String(assigneeId);
    }
    const emailKey =
      task?.assignee?.email?.toLowerCase?.() ??
      task?.assigneeEmail?.toLowerCase?.();
    if (emailKey && emailToId.has(emailKey)) {
      return emailToId.get(emailKey) || null;
    }
    const nameKeyRaw = task?.assigneeNameKey || task?.assigneeName || task?.assignee?.name;
    if (nameKeyRaw) {
      const nameKey = task?.assigneeNameKey || normalizePersonNameKey(nameKeyRaw);
      if (nameKey && nameToId.has(nameKey)) {
        return nameToId.get(nameKey) || null;
      }
    }
    return null;
  };

  const matchTaskToPerson = (task: any) => {
    const personId = resolvePersonId(task);
    if (!personId) return;
    increment(personId, normalizeStatus(task?.status));
  };

  const flattenExtractedTasks = (items: ExtractedTaskSchema[] = []) => {
    const result: ExtractedTaskSchema[] = [];
    const walk = (tasksToWalk: ExtractedTaskSchema[]) => {
      tasksToWalk.forEach((task) => {
        result.push(task);
        if (task.subtasks && task.subtasks.length) {
          walk(task.subtasks);
        }
      });
    };
    walk(items);
    return result;
  };

  const meetingSessionsWithTasks = new Set<string>();
  const chatSessionsWithTasks = new Set<string>();

  tasks.forEach((task: any) => {
    if (task?.sourceSessionType === "meeting" && task.sourceSessionId) {
      meetingSessionsWithTasks.add(String(task.sourceSessionId));
    }
    if (task?.sourceSessionType === "chat" && task.sourceSessionId) {
      chatSessionsWithTasks.add(String(task.sourceSessionId));
    }
    matchTaskToPerson(task);
  });

  meetings.forEach((meeting: any) => {
    const meetingId = String(meeting._id ?? meeting.id);
    if (meetingSessionsWithTasks.has(meetingId)) return;
    const flattened = flattenExtractedTasks(meeting.extractedTasks || []);
    flattened.forEach(matchTaskToPerson);
  });

  chatSessions.forEach((session: any) => {
    const sessionId = String(session._id ?? session.id);
    if (chatSessionsWithTasks.has(sessionId)) return;
    const flattened = flattenExtractedTasks(session.suggestedTasks || []);
    flattened.forEach(matchTaskToPerson);
  });

  const peopleWithCounts = people.map((person: any) => {
    const counts = statusCounts.get(String(person._id)) || emptyCounts();
    return {
      ...serializePerson(person),
      taskCount: counts.open,
      taskCounts: counts,
    };
  });

  return NextResponse.json(peopleWithCounts);
}

export async function POST(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const sourceSessionId = typeof body.sourceSessionId === "string" ? body.sourceSessionId : null;

  if (!name) {
    return NextResponse.json({ error: "Person name is required." }, { status: 400 });
  }

  const db = await getDb();
  const userIdQuery = buildIdQuery(userId);
  const existing = await db
    .collection<any>("people")
    .findOne({ userId: userIdQuery, name });
  const now = new Date();

  if (existing) {
    const updatedSourceSessions = new Set(existing.sourceSessionIds || []);
    if (sourceSessionId) updatedSourceSessions.add(sourceSessionId);

    await db.collection<any>("people").updateOne(
      { _id: existing._id, userId: userIdQuery },
      {
        $set: {
          lastSeenAt: now,
          ...(body.email ? { email: body.email } : {}),
          ...(body.title ? { title: body.title } : {}),
          ...(body.avatarUrl ? { avatarUrl: body.avatarUrl } : {}),
          sourceSessionIds: Array.from(updatedSourceSessions),
        },
      }
    );

    const refreshed = await db
      .collection<any>("people")
      .findOne({ _id: existing._id, userId: userIdQuery });
    return NextResponse.json(serializePerson(refreshed));
  }

  const person = {
    _id: randomUUID(),
    userId,
    name,
    email: body.email || null,
    title: body.title || null,
    avatarUrl: body.avatarUrl || null,
    slackId: null,
    firefliesId: null,
    phantomBusterId: null,
    aliases: body.aliases || [],
    isBlocked: Boolean(body.isBlocked),
    sourceSessionIds: sourceSessionId ? [sourceSessionId] : [],
    createdAt: now,
    lastSeenAt: now,
  };

  await db.collection<any>("people").insertOne(person);

  return NextResponse.json(serializePerson(person));
}

