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

  const counts = new Map<string, number>();
  const emailToId = new Map<string, string>();
  const nameToId = new Map<string, string>();

  people.forEach((person) => {
    const personId = String(person._id);
    counts.set(personId, 0);
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

  const increment = (personId?: string | null) => {
    if (!personId) return;
    const key = String(personId);
    if (!counts.has(key)) return;
    counts.set(key, (counts.get(key) || 0) + 1);
  };

  const matchTaskToPerson = (task: any) => {
    const assigneeId = task.assignee?.uid;
    if (assigneeId && counts.has(String(assigneeId))) {
      increment(String(assigneeId));
      return;
    }
    const emailKey = task.assignee?.email?.toLowerCase?.();
    if (emailKey && emailToId.has(emailKey)) {
      increment(emailToId.get(emailKey));
      return;
    }
    const nameKeyRaw = task.assigneeName || task.assignee?.name;
    if (nameKeyRaw) {
      const nameKey = normalizePersonNameKey(nameKeyRaw);
      if (nameKey && nameToId.has(nameKey)) {
        increment(nameToId.get(nameKey));
      }
    }
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

  tasks.forEach(matchTaskToPerson);
  meetings.forEach((meeting) => {
    const flattened = flattenExtractedTasks(meeting.extractedTasks || []);
    flattened.forEach(matchTaskToPerson);
  });
  chatSessions.forEach((session) => {
    const flattened = flattenExtractedTasks(session.suggestedTasks || []);
    flattened.forEach(matchTaskToPerson);
  });

  const peopleWithCounts = people.map((person) => {
    const taskCount = counts.get(String(person._id)) || 0;
    return { ...serializePerson(person), taskCount };
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

