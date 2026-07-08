import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { normalizePersonNameKey } from "@/lib/transcript-utils";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";
import { mergeSourceIdentities, resolveMergeDirection } from "@/lib/people-matching";
import type { Person } from "@/types/person";

const serializePerson = (person: any) => ({
  ...person,
  id: person._id,
  _id: undefined,
  createdAt: person.createdAt?.toISOString?.() || person.createdAt,
  lastSeenAt: person.lastSeenAt?.toISOString?.() || person.lastSeenAt,
  mergeState: person.mergeState || "active",
  sourceIdentities: person.sourceIdentities || [],
});

const collectNameKeys = (person: any): string[] => {
  const keys = new Set<string>();
  const add = (value: any) => {
    if (typeof value !== "string") return;
    const key = normalizePersonNameKey(value);
    if (key) keys.add(key);
  };
  add(person.name);
  (person.aliases || []).forEach((alias: string) => {
    if (typeof alias === "string" && !alias.includes("@")) add(alias);
  });
  return Array.from(keys);
};

const collectRawNames = (person: any): string[] => {
  const names = new Set<string>();
  if (typeof person.name === "string" && person.name.trim()) {
    names.add(person.name.trim());
  }
  (person.aliases || []).forEach((alias: string) => {
    if (typeof alias === "string" && alias.trim() && !alias.includes("@")) {
      names.add(alias.trim());
    }
  });
  return Array.from(names);
};

const collectEmails = (person: any): string[] => {
  const emails = new Set<string>();
  const add = (value: any) => {
    if (typeof value !== "string") return;
    const email = value.trim();
    if (email && email.includes("@")) {
      emails.add(email);
      emails.add(email.toLowerCase());
    }
  };
  add(person.email);
  (person.aliases || []).forEach(add);
  return Array.from(emails);
};

// Rewrites every assignee reference embedded in an extracted-task tree
// (meetings.extractedTasks / chatSessions.suggestedTasks, arbitrarily nested
// subtasks) that points at the merged (source) person. Returns true when
// anything changed.
const rewriteExtractedTaskAssignees = (
  tasks: any[],
  match: { ids: Set<string>; nameKeys: Set<string>; emails: Set<string> },
  target: { uid: string; name: string; email: string | null; photoURL: string | null }
): boolean => {
  if (!Array.isArray(tasks)) return false;
  let changed = false;

  const matchesAssignee = (task: any): boolean => {
    const assignee = task?.assignee;
    const uid = assignee?.uid ?? assignee?.id;
    if (uid && match.ids.has(String(uid))) return true;
    const email =
      typeof assignee?.email === "string" ? assignee.email.toLowerCase() : "";
    if (email && match.emails.has(email)) return true;
    const rawName = task?.assigneeName || assignee?.name;
    if (typeof rawName === "string") {
      const key = normalizePersonNameKey(rawName);
      if (key && match.nameKeys.has(key)) return true;
    }
    return false;
  };

  const walk = (items: any[]) => {
    for (const task of items) {
      if (!task || typeof task !== "object") continue;
      if (matchesAssignee(task)) {
        task.assignee = {
          ...(task.assignee && typeof task.assignee === "object" ? task.assignee : {}),
          uid: target.uid,
          name: target.name,
          email: target.email,
          photoURL: target.photoURL,
        };
        if (task.assigneeName !== undefined || task.assignee) {
          task.assigneeName = target.name;
        }
        changed = true;
      }
      if (Array.isArray(task.subtasks) && task.subtasks.length) {
        walk(task.subtasks);
      }
    }
  };

  walk(tasks);
  return changed;
};

export async function POST(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return apiError(401, "request_error", "Unauthorized");
  }

  const body = await request.json().catch(() => ({}));
  const sourceId = typeof body.sourceId === "string" ? body.sourceId : "";
  const targetId = typeof body.targetId === "string" ? body.targetId : "";

  if (!sourceId || !targetId) {
    return apiError(400, "request_error", "sourceId and targetId are required.");
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

  let source = await db.collection("people").findOne({
    $and: [workspaceFallbackScope as any, { $or: [{ _id: sourceId }, { id: sourceId }, { slackId: sourceId }] }],
  } as any);
  let target = await db.collection("people").findOne({
    $and: [workspaceFallbackScope as any, { $or: [{ _id: targetId }, { id: targetId }, { slackId: targetId }] }],
  } as any);

  if (!source || !target) {
    return apiError(404, "request_error", "Person not found.");
  }
  if (String(source._id) === String(target._id)) {
    return apiError(400, "request_error", "Cannot merge the same person.");
  }
  if (source.mergeState === "merged" || target.mergeState === "merged") {
    return apiError(400, "request_error", "One of these people was already merged.");
  }

  // Canonical precedence: Slack-backed people always win as merge target,
  // even if the caller passed them as the source.
  const direction = resolveMergeDirection(
    { ...(source as any), id: String(source._id) } as Person,
    { ...(target as any), id: String(target._id) } as Person
  );
  if (String((direction.target as any)._id ?? direction.target.id) === String(source._id)) {
    const swap = source;
    source = target;
    target = swap;
  }

  const aliasSet = new Set<string>([
    ...(target.aliases || []),
    ...(source.aliases || []),
  ]);
  if (source.name) aliasSet.add(source.name);
  if (source.email) aliasSet.add(source.email);

  const update: Record<string, any> = {
    aliases: Array.from(aliasSet).filter(Boolean),
    lastSeenAt: new Date(),
    mergeState: "active",
    sourceIdentities: mergeSourceIdentities(
      target.sourceIdentities,
      source.sourceIdentities
    ),
  };
  const sourceSessions = new Set<string>([
    ...(target.sourceSessionIds || []),
    ...(source.sourceSessionIds || []),
  ]);
  update.sourceSessionIds = Array.from(sourceSessions);
  if (!target.email && source.email) update.email = source.email;
  if (!target.title && source.title) update.title = source.title;
  if (!target.avatarUrl && source.avatarUrl) update.avatarUrl = source.avatarUrl;
  if (!target.slackId && source.slackId) update.slackId = source.slackId;
  // Client grouping: keep the target's company, inherit the source's if unset.
  if (!target.company && source.company) update.company = source.company;
  if (!target.primarySource && (update.slackId || target.slackId)) {
    update.primarySource = "slack";
  }
  // Merging two people clears any block between them; keep other blocks.
  const targetBlockedIds = (target.blockedMergePersonIds || []).filter(
    (id: string) => String(id) !== String(source._id)
  );
  const sourceBlockedIds = (source.blockedMergePersonIds || []).filter(
    (id: string) => String(id) !== String(target._id)
  );
  update.blockedMergePersonIds = Array.from(
    new Set([...targetBlockedIds, ...sourceBlockedIds])
  );

  await db.collection("people").updateOne({ _id: target._id }, { $set: update });

  const sourceAssigneeIds = Array.from(
    new Set([
      String(source._id || ""),
      String(source.id || ""),
      String(sourceId || ""),
      String(targetId || ""),
      String(source.slackId || ""),
    ].filter(Boolean))
  );
  // The caller-provided ids might have referenced either doc pre-swap; never
  // rewrite tasks already pointing at the surviving person.
  const survivingIds = new Set(
    [String(target._id || ""), String(target.id || ""), String(target.slackId || "")].filter(Boolean)
  );
  const loserAssigneeIds = sourceAssigneeIds.filter((id) => !survivingIds.has(id));

  const targetAssignee = {
    uid: String(target._id || target.id),
    name: target.name,
    email: target.email ?? update.email ?? null,
    photoURL: target.avatarUrl ?? update.avatarUrl ?? null,
  };
  const targetNameKey = target.name ? normalizePersonNameKey(target.name) : null;

  const sourceNameKeys = collectNameKeys(source);
  const sourceRawNames = collectRawNames(source);
  const sourceEmails = collectEmails(source);

  const taskWorkspaceScope = {
    $or: [
      { workspaceId },
      {
        workspaceId: { $exists: false },
        userId: { $in: workspaceMemberUserIds },
      },
    ],
  };

  // 1) Tasks referenced by assignee uid.
  await db.collection("tasks").updateMany(
    {
      $and: [
        taskWorkspaceScope,
        { "assignee.uid": { $in: loserAssigneeIds } },
      ],
    } as any,
    {
      $set: {
        assignee: targetAssignee,
        assigneeName: targetAssignee.name,
        assigneeNameKey: targetNameKey,
      },
    }
  );

  // 2) Tasks referenced only by assignee name keys / raw names / emails.
  const nameOrClauses: any[] = [];
  if (sourceNameKeys.length) {
    nameOrClauses.push({ assigneeNameKey: { $in: sourceNameKeys } });
  }
  const nameMatchValues = Array.from(new Set([...sourceRawNames, ...sourceNameKeys]));
  if (nameMatchValues.length) {
    nameOrClauses.push({ assigneeName: { $in: nameMatchValues } });
    nameOrClauses.push({ "assignee.name": { $in: nameMatchValues } });
  }
  if (sourceEmails.length) {
    nameOrClauses.push({ "assignee.email": { $in: sourceEmails } });
    nameOrClauses.push({ assigneeEmail: { $in: sourceEmails } });
  }
  if (nameOrClauses.length) {
    await db.collection("tasks").updateMany(
      {
        $and: [taskWorkspaceScope, { $or: nameOrClauses }],
      } as any,
      {
        $set: {
          assignee: targetAssignee,
          assigneeName: targetAssignee.name,
          assigneeNameKey: targetNameKey,
        },
      }
    );
  }

  // 3) Meeting attendees + extracted task assignees embedded in meetings.
  const embeddedMatch = {
    ids: new Set(loserAssigneeIds),
    nameKeys: new Set(sourceNameKeys),
    emails: new Set(sourceEmails.map((email) => email.toLowerCase())),
  };
  const meetingReferenceQuery = {
    $and: [
      workspaceFallbackScope,
      {
        $or: [
          ...(sourceRawNames.length ? [{ "attendees.name": { $in: sourceRawNames } }] : []),
          ...(sourceEmails.length ? [{ "attendees.email": { $in: sourceEmails } }] : []),
          ...(nameMatchValues.length
            ? [
                { "extractedTasks.assigneeName": { $in: nameMatchValues } },
                { "extractedTasks.assignee.name": { $in: nameMatchValues } },
                { "extractedTasks.subtasks.assigneeName": { $in: nameMatchValues } },
              ]
            : []),
          { "extractedTasks.assignee.uid": { $in: loserAssigneeIds } },
        ],
      },
    ],
  };
  const meetings = await db
    .collection("meetings")
    .find(meetingReferenceQuery as any)
    .project({ attendees: 1, extractedTasks: 1 })
    .toArray();

  for (const meeting of meetings) {
    const meetingUpdate: Record<string, any> = {};

    if (Array.isArray(meeting.attendees)) {
      let attendeesChanged = false;
      const seen = new Set<string>();
      const rewritten: any[] = [];
      for (const attendee of meeting.attendees) {
        if (!attendee || typeof attendee !== "object") {
          rewritten.push(attendee);
          continue;
        }
        const attendeeName = typeof attendee.name === "string" ? attendee.name : "";
        const attendeeEmail =
          typeof attendee.email === "string" ? attendee.email.toLowerCase() : "";
        const nameKey = attendeeName ? normalizePersonNameKey(attendeeName) : "";
        const matches =
          (nameKey && embeddedMatch.nameKeys.has(nameKey)) ||
          (attendeeEmail && embeddedMatch.emails.has(attendeeEmail));
        const next = matches
          ? {
              ...attendee,
              name: target.name,
              email: target.email ?? update.email ?? attendee.email ?? null,
            }
          : attendee;
        if (matches) attendeesChanged = true;
        const nextNameKey = normalizePersonNameKey(next.name || "");
        const nextEmailKey = (next.email || "").toLowerCase();
        if (nextNameKey || nextEmailKey) {
          const dedupeKey = `${nextNameKey}|${nextEmailKey}`;
          if (seen.has(dedupeKey)) {
            // Rewriting produced a duplicate of an attendee already present
            // (the surviving person) — collapse it.
            attendeesChanged = true;
            continue;
          }
          seen.add(dedupeKey);
        }
        rewritten.push(next);
      }
      if (attendeesChanged) {
        meetingUpdate.attendees = rewritten;
      }
    }

    if (
      Array.isArray(meeting.extractedTasks) &&
      rewriteExtractedTaskAssignees(meeting.extractedTasks, embeddedMatch, targetAssignee)
    ) {
      meetingUpdate.extractedTasks = meeting.extractedTasks;
    }

    if (Object.keys(meetingUpdate).length) {
      await db
        .collection("meetings")
        .updateOne({ _id: meeting._id }, { $set: meetingUpdate });
    }
  }

  // 4) Extracted task assignees embedded in chat sessions.
  if (nameMatchValues.length || loserAssigneeIds.length) {
    const chatReferenceQuery = {
      $and: [
        workspaceFallbackScope,
        {
          $or: [
            ...(nameMatchValues.length
              ? [
                  { "suggestedTasks.assigneeName": { $in: nameMatchValues } },
                  { "suggestedTasks.assignee.name": { $in: nameMatchValues } },
                  { "suggestedTasks.subtasks.assigneeName": { $in: nameMatchValues } },
                ]
              : []),
            { "suggestedTasks.assignee.uid": { $in: loserAssigneeIds } },
          ],
        },
      ],
    };
    const chatSessions = await db
      .collection("chatSessions")
      .find(chatReferenceQuery as any)
      .project({ suggestedTasks: 1 })
      .toArray();
    for (const session of chatSessions) {
      if (
        Array.isArray(session.suggestedTasks) &&
        rewriteExtractedTaskAssignees(session.suggestedTasks, embeddedMatch, targetAssignee)
      ) {
        await db
          .collection("chatSessions")
          .updateOne({ _id: session._id }, { $set: { suggestedTasks: session.suggestedTasks } });
      }
    }
  }

  // 5) Tombstone the loser instead of deleting it — merges stay reversible
  //    and auditable. GET /api/people hides mergeState "merged" docs.
  await db.collection("people").updateOne(
    { _id: source._id },
    {
      $set: {
        mergeState: "merged",
        mergedIntoPersonId: String(target._id),
        canonicalPersonId: String(target._id),
        lastSeenAt: new Date(),
      },
    }
  );

  const refreshed = await db.collection("people").findOne({ _id: target._id });
  return NextResponse.json({ ok: true, person: serializePerson(refreshed) });
}
