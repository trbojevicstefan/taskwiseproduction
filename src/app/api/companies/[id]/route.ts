import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api-route";
import {
  findCompanyById,
  serializeCompany,
  updateCompany,
} from "@/lib/companies";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { normalizePersonNameKey } from "@/lib/transcript-utils";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";
import type {
  CompanyMeetingSummary,
  CompanyProfileStats,
  CompanyTaskSummary,
} from "@/types/company";

const MAX_MEETINGS = 20;
const MAX_TASKS = 50;

const patchCompanySchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    domain: z.string().trim().max(200).nullable().optional(),
    aliases: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
    peopleIds: z.array(z.string().trim().min(1).max(200)).max(200).optional(),
  })
  .strict();

const buildWorkspaceFallbackScope = (
  workspaceId: string | null | undefined,
  workspaceMemberUserIds: string[]
) => ({
  $or: [
    { workspaceId },
    {
      workspaceId: { $exists: false },
      userId: { $in: workspaceMemberUserIds },
    },
  ],
});

const toDate = (value: unknown): Date | null => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
};

const toIso = (value: unknown): string | null =>
  toDate(value)?.toISOString() ?? null;

const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeStatus = (status: unknown): string => {
  const raw = typeof status === "string" ? status.toLowerCase().trim() : "";
  if (raw === "in progress" || raw === "in-progress" || raw === "in_progress") {
    return "inprogress";
  }
  if (raw === "done" || raw === "completed" || raw === "complete") return "done";
  if (raw === "recurring") return "recurring";
  return raw || "todo";
};

const serializePersonSummary = (person: any) => ({
  id: String(person._id),
  name: person.name ?? "Unknown person",
  email: person.email ?? null,
  title: person.title ?? null,
  avatarUrl: person.avatarUrl ?? null,
  personType: person.personType ?? "unknown",
  company: person.company ?? null,
  nextFollowUpAt:
    person.nextFollowUpAt?.toISOString?.() || person.nextFollowUpAt || null,
  lastSeenAt: person.lastSeenAt?.toISOString?.() || person.lastSeenAt || null,
});

/**
 * Company profile aggregate: the company plus its people, recent meetings
 * (matched by attendee email/name, organizer, source session, or company
 * domain), open commitments (tasks assigned to the company's people), last
 * contacted, and next follow-up.
 */
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
  const { workspaceId, workspaceMemberUserIds } =
    await resolveWorkspaceScopeForUser(db, userId, {
      minimumRole: "member",
      adminVisibilityKey: "people",
      includeMemberUserIds: true,
    });
  if (!workspaceId) {
    return apiError(404, "request_error", "Company not found");
  }

  const company = await findCompanyById(db, workspaceId, id);
  if (!company) {
    return apiError(404, "request_error", "Company not found");
  }

  const scopeFilter = buildWorkspaceFallbackScope(
    workspaceId,
    workspaceMemberUserIds
  );

  const peopleIds = (company.peopleIds || []).map(String);
  const people = peopleIds.length
    ? await db
        .collection("people")
        .find({
          $and: [
            scopeFilter,
            { _id: { $in: peopleIds } },
            { mergeState: { $ne: "merged" } },
          ],
        } as any)
        .sort({ lastSeenAt: -1 })
        .toArray()
    : [];

  const emails: string[] = [];
  const names: string[] = [];
  const nameKeys = new Set<string>();
  const sessionIds = new Set<string>();
  let nextFollowUpAt: string | null = null;
  for (const person of people) {
    if (typeof person.email === "string" && person.email.trim()) {
      emails.push(person.email.trim().toLowerCase());
    }
    const aliasNames = [
      person.name,
      ...(Array.isArray(person.aliases) ? person.aliases : []),
    ];
    for (const name of aliasNames) {
      if (typeof name !== "string" || !name.trim()) continue;
      names.push(name.trim());
      const key = normalizePersonNameKey(name);
      if (key) nameKeys.add(key);
    }
    if (Array.isArray(person.sourceSessionIds)) {
      person.sourceSessionIds.forEach((sessionId: any) => {
        if (sessionId) sessionIds.add(String(sessionId));
      });
    }
    const followUp = toIso(person.nextFollowUpAt);
    if (followUp && (!nextFollowUpAt || followUp < nextFollowUpAt)) {
      nextFollowUpAt = followUp;
    }
  }

  // --- Meetings -------------------------------------------------------------
  const meetingClauses: Record<string, any>[] = [];
  if (sessionIds.size) meetingClauses.push({ _id: { $in: Array.from(sessionIds) } });
  if (emails.length) {
    meetingClauses.push({ "attendees.email": { $in: emails } });
    meetingClauses.push({ organizerEmail: { $in: emails } });
  }
  if (names.length) meetingClauses.push({ "attendees.name": { $in: names } });
  if (company.domain) {
    const domainRegex = new RegExp(`@${escapeRegex(company.domain)}$`, "i");
    meetingClauses.push({ "attendees.email": domainRegex });
    meetingClauses.push({ organizerEmail: domainRegex });
  }

  const meetings = meetingClauses.length
    ? await db
        .collection("meetings")
        .find({
          $and: [scopeFilter, { isHidden: { $ne: true } }, { $or: meetingClauses }],
        } as any)
        .project({ _id: 1, title: 1, startTime: 1, attendees: 1 })
        .sort({ startTime: -1, lastActivityAt: -1, _id: -1 })
        .limit(MAX_MEETINGS)
        .toArray()
    : [];

  const meetingSummaries: CompanyMeetingSummary[] = meetings.map(
    (meeting: any) => ({
      id: String(meeting._id),
      title:
        typeof meeting.title === "string" && meeting.title.trim()
          ? meeting.title.trim()
          : "Untitled meeting",
      startTime: toIso(meeting.startTime),
      attendeeCount: Array.isArray(meeting.attendees)
        ? meeting.attendees.length
        : 0,
    })
  );

  const lastContactedAt = meetingSummaries.reduce<string | null>(
    (latest, meeting) =>
      meeting.startTime && (!latest || meeting.startTime > latest)
        ? meeting.startTime
        : latest,
    null
  );

  // --- Tasks ------------------------------------------------------------
  const nameMatchers = Array.from(new Set([...names, ...nameKeys]));
  const taskClauses: Record<string, any>[] = [];
  if (peopleIds.length) taskClauses.push({ "assignee.uid": { $in: peopleIds } });
  if (emails.length) taskClauses.push({ "assignee.email": { $in: emails } });
  if (nameMatchers.length) {
    taskClauses.push({ assigneeNameKey: { $in: nameMatchers } });
    taskClauses.push({ assigneeName: { $in: nameMatchers } });
    taskClauses.push({ "assignee.name": { $in: nameMatchers } });
  }

  const tasks = taskClauses.length
    ? await db
        .collection("tasks")
        .find({
          $and: [
            scopeFilter,
            { taskState: { $ne: "archived" } },
            { $or: taskClauses },
          ],
        } as any)
        .project({
          _id: 1,
          title: 1,
          status: 1,
          dueAt: 1,
          assigneeName: 1,
          sourceSessionId: 1,
          lastUpdated: 1,
        })
        .sort({ lastUpdated: -1, _id: -1 })
        .limit(300)
        .toArray()
    : [];

  const now = Date.now();
  const openTasks: CompanyTaskSummary[] = [];
  let overdueTaskCount = 0;
  let completedTaskCount = 0;
  for (const task of tasks) {
    const status = normalizeStatus(task.status);
    if (status === "done") {
      completedTaskCount += 1;
      continue;
    }
    const dueAt = toDate(task.dueAt);
    const overdue = Boolean(dueAt) && dueAt!.getTime() < now;
    if (overdue) overdueTaskCount += 1;
    if (openTasks.length < MAX_TASKS) {
      openTasks.push({
        id: String(task._id),
        title:
          typeof task.title === "string" && task.title.trim()
            ? task.title.trim()
            : "Untitled task",
        status,
        dueAt: toIso(task.dueAt),
        assigneeName:
          typeof task.assigneeName === "string" && task.assigneeName.trim()
            ? task.assigneeName.trim()
            : null,
        overdue,
        sourceSessionId: task.sourceSessionId
          ? String(task.sourceSessionId)
          : null,
      });
    }
  }
  openTasks.sort((a, b) => Number(b.overdue) - Number(a.overdue));

  const stats: CompanyProfileStats = {
    peopleCount: people.length,
    openTaskCount: openTasks.length,
    overdueTaskCount,
    completedTaskCount,
    lastContactedAt,
    nextFollowUpAt,
  };

  return NextResponse.json({
    company: serializeCompany(company),
    people: people.map(serializePersonSummary),
    meetings: meetingSummaries,
    openTasks,
    stats,
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
  const parsed = patchCompanySchema.safeParse(body);
  if (!parsed.success) {
    return apiError(
      400,
      "request_error",
      "Invalid company payload.",
      parsed.error.flatten()
    );
  }

  const db = await getDb();
  const { workspaceId } = await resolveWorkspaceScopeForUser(db, userId, {
    minimumRole: "admin",
  });
  if (!workspaceId) {
    return apiError(404, "request_error", "Company not found");
  }

  const updated = await updateCompany(db, workspaceId, id, parsed.data);
  if (!updated) {
    return apiError(404, "request_error", "Company not found");
  }

  return NextResponse.json(serializeCompany(updated));
}
