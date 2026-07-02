import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { normalizePersonNameKey } from "@/lib/transcript-utils";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";

const serializePerson = (person: any) => ({
  ...person,
  id: person._id,
  _id: undefined,
  createdAt: person.createdAt?.toISOString?.() || person.createdAt,
  lastSeenAt: person.lastSeenAt?.toISOString?.() || person.lastSeenAt,
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = await getSessionUserId();
  if (!userId) {
    return apiError(401, "request_error", "Unauthorized");
  }

  const db = await getDb();
  const { workspaceId, workspaceMemberUserIds } = await resolveWorkspaceScopeForUser(db, userId, {
    minimumRole: "member",
    adminVisibilityKey: "people",
    includeMemberUserIds: true,
  });
  const workspaceFallbackScope = {
    $or: [
      { workspaceId },
      {
        workspaceId: { $exists: false },
        userId: { $in: workspaceMemberUserIds },
      },
    ],
  };
  const person = await db
    .collection("people")
    .findOne({
      $and: [workspaceFallbackScope as any, { $or: [{ _id: id }, { id }, { slackId: id }] }],
    } as any);
  if (!person) {
    return apiError(404, "request_error", "Person not found");
  }

  type TaskStatus = "todo" | "inprogress" | "done" | "recurring";
  const emptyCounts = () => ({
    total: 0,
    open: 0,
    todo: 0,
    inprogress: 0,
    done: 0,
    recurring: 0,
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
  const increment = (counts: ReturnType<typeof emptyCounts>, status: TaskStatus) => {
    counts.total += 1;
    counts[status] += 1;
    if (status !== "done") {
      counts.open += 1;
    }
  };

  const assigneeId = person.id ?? person._id ?? id;
  const assigneeQuery = String(assigneeId);
  const nameKeys = new Set<string>();
  if (person.name) {
    const normalized = normalizePersonNameKey(person.name);
    if (normalized) nameKeys.add(normalized);
  }
  if (Array.isArray(person.aliases)) {
    person.aliases.forEach((alias: string) => {
      const normalized = normalizePersonNameKey(alias);
      if (normalized) nameKeys.add(normalized);
    });
  }
  const nameKeyList = Array.from(nameKeys).filter(Boolean);

  const tasks = await db
    .collection("tasks")
    .find({
      $and: [
        {
          $or: [
            { workspaceId },
            {
              workspaceId: { $exists: false },
              userId: { $in: workspaceMemberUserIds },
            },
          ],
        },
        {
          $or: [
            { "assignee.uid": assigneeQuery },
            ...(person.email ? [{ "assignee.email": person.email }] : []),
            ...(nameKeyList.length
              ? [
                  { assigneeNameKey: { $in: nameKeyList } },
                  { assigneeName: { $in: nameKeyList } },
                  { "assignee.name": { $in: nameKeyList } },
                ]
              : []),
          ],
        },
      ],
    } as any)
    .toArray();

  const taskCounts = emptyCounts();
  tasks.forEach((task: any) => {
    increment(taskCounts, normalizeStatus(task?.status));
  });

  return NextResponse.json({
    ...serializePerson(person),
    taskCount: taskCounts.open,
    taskCounts,
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = await getSessionUserId();
  if (!userId) {
    return apiError(401, "request_error", "Unauthorized");
  }

  const body = await request.json().catch(() => ({}));
  const update = { ...body, lastSeenAt: new Date() };

  const db = await getDb();
  const { workspaceId, workspaceMemberUserIds } = await resolveWorkspaceScopeForUser(db, userId, {
    minimumRole: "admin",
    includeMemberUserIds: true,
  });
  const workspaceFallbackScope = {
    $or: [
      { workspaceId },
      {
        workspaceId: { $exists: false },
        userId: { $in: workspaceMemberUserIds },
      },
    ],
  };
  const existing = await db
    .collection("people")
    .findOne({
      $and: [workspaceFallbackScope as any, { $or: [{ _id: id }, { id }, { slackId: id }] }],
    } as any);
  if (!existing) {
    return apiError(404, "request_error", "Person not found");
  }

  await db.collection("people").updateOne(
    { _id: existing._id },
    { $set: update }
  );

  const person = await db
    .collection("people")
    .findOne({ _id: existing._id });
  type TaskStatus = "todo" | "inprogress" | "done" | "recurring";
  const emptyCounts = () => ({
    total: 0,
    open: 0,
    todo: 0,
    inprogress: 0,
    done: 0,
    recurring: 0,
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
  const increment = (counts: ReturnType<typeof emptyCounts>, status: TaskStatus) => {
    counts.total += 1;
    counts[status] += 1;
    if (status !== "done") {
      counts.open += 1;
    }
  };

  const assigneeId = person.id ?? person._id ?? id;
  const assigneeQuery = String(assigneeId);
  const nameKeys = new Set<string>();
  if (person.name) {
    const normalized = normalizePersonNameKey(person.name);
    if (normalized) nameKeys.add(normalized);
  }
  if (Array.isArray(person.aliases)) {
    person.aliases.forEach((alias: string) => {
      const normalized = normalizePersonNameKey(alias);
      if (normalized) nameKeys.add(normalized);
    });
  }
  const nameKeyList = Array.from(nameKeys).filter(Boolean);

  const tasks = await db
    .collection("tasks")
    .find({
      $and: [
        {
          $or: [
            { workspaceId },
            {
              workspaceId: { $exists: false },
              userId: { $in: workspaceMemberUserIds },
            },
          ],
        },
        {
          $or: [
            { "assignee.uid": assigneeQuery },
            ...(person.email ? [{ "assignee.email": person.email }] : []),
            ...(nameKeyList.length
              ? [
                  { assigneeNameKey: { $in: nameKeyList } },
                  { assigneeName: { $in: nameKeyList } },
                  { "assignee.name": { $in: nameKeyList } },
                ]
              : []),
          ],
        },
      ],
    } as any)
    .toArray();

  const taskCounts = emptyCounts();
  tasks.forEach((task: any) => {
    increment(taskCounts, normalizeStatus(task?.status));
  });

  return NextResponse.json({
    ...serializePerson(person),
    taskCount: taskCounts.open,
    taskCounts,
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = await getSessionUserId();
  if (!userId) {
    return apiError(401, "request_error", "Unauthorized");
  }

  const db = await getDb();
  const { workspaceId, workspaceMemberUserIds } = await resolveWorkspaceScopeForUser(db, userId, {
    minimumRole: "admin",
    includeMemberUserIds: true,
  });
  const workspaceFallbackScope = {
    $or: [
      { workspaceId },
      {
        workspaceId: { $exists: false },
        userId: { $in: workspaceMemberUserIds },
      },
    ],
  };

  const person = await db
    .collection("people")
    .findOne({
      $and: [workspaceFallbackScope as any, { $or: [{ _id: id }, { id }, { slackId: id }] }],
    } as any);
  if (!person) {
    return apiError(404, "request_error", "Person not found");
  }

  await db.collection("people").deleteOne({ _id: person._id });
  const assigneeId = person.id ?? person._id ?? id;
  const assigneeQuery = String(assigneeId);
  await db.collection("tasks").updateMany(
    {
      $and: [
        {
          $or: [
            { workspaceId },
            {
              workspaceId: { $exists: false },
              userId: { $in: workspaceMemberUserIds },
            },
          ],
        },
        { "assignee.uid": assigneeQuery },
      ],
    } as any,
    { $set: { assignee: null, assigneeName: null } }
  );

  const nameMatches = new Set<string>();
  if (person.name) nameMatches.add(person.name);
  if (Array.isArray(person.aliases)) {
    person.aliases.forEach((alias: string) => {
      if (alias) nameMatches.add(alias);
    });
  }
  const emailMatches = new Set<string>();
  if (person.email) emailMatches.add(person.email);

  if (nameMatches.size || emailMatches.size) {
    const nameList = Array.from(nameMatches);
    const emailList = Array.from(emailMatches);
    await db.collection("meetings").updateMany(
      workspaceFallbackScope as any,
      {
        $pull: {
          attendees: {
            $or: [
              ...(nameList.length ? [{ name: { $in: nameList } }] : []),
              ...(emailList.length ? [{ email: { $in: emailList } }] : []),
            ],
          },
        },
      }
    );
    await db.collection("chatSessions").updateMany(
      workspaceFallbackScope as any,
      {
        $pull: {
          people: {
            $or: [
              ...(nameList.length ? [{ name: { $in: nameList } }] : []),
              ...(emailList.length ? [{ email: { $in: emailList } }] : []),
            ],
          },
        },
      }
    );
  }

  return NextResponse.json({ ok: true });
}




