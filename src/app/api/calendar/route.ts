// src/app/api/calendar/route.ts
/**
 * Phase 4 — calendar data endpoint.
 *
 * GET /api/calendar?from=<ISO>&to=<ISO> (both required, span <= 62 days)
 * -> apiSuccess {
 *      meetings: [{ id, title, startTime, attendeeCount, isClientMeeting,
 *                   calendarEventId, organizerEmail, attendees[{name,email}] }],
 *      tasks:    [{ id, title, dueAt, status, priorityLabel, priorityScore,
 *                   cleanupStatus, assigneeName, sourceSessionId, overdue }],
 *      reminders: [{ id, taskId, taskTitle, kind, runAt, status: 'scheduled' }],
 *      warnings: { overdueCount, cleanupSuggestedCount, expiredCount }
 *    }
 *
 * `reminders` is additive (Phase 10): the workspace's scheduled Slack task
 * reminders with runAt inside [from, to]. runAt is always a Date (written by
 * src/lib/task-reminders.ts), so a typed Mongo range query is safe here.
 *
 * Meetings are workspace-scoped (same fallback $or + isHidden semantics as
 * GET /api/meetings) with startTime inside [from, to]; startTime may be
 * stored as a Date OR an ISO string, so the range is queried as a $or of
 * both types (ISO strings compare lexicographically). Tasks are the open
 * window (taskState != 'archived', cleanupStatus != 'expired') with a
 * non-null dueAt, range-filtered server-side in JS because dueAt is
 * schemaless (string|Date). Warnings are counted over the WHOLE open scope,
 * not just the requested range.
 */

import {
  apiError,
  apiSuccess,
  createRouteRequestContext,
  getApiErrorStatus,
  mapApiError,
} from "@/lib/api-route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { normalizePersonNameKey } from "@/lib/transcript-utils";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";

const ROUTE = "/api/calendar";

const MAX_RANGE_DAYS = 62;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_TASKS = 500;
const MAX_MEETINGS = 1000;
const MAX_REMINDERS = 500;

const SUGGESTED_CLEANUP_STATUSES = [
  "suggested_expire",
  "duplicate_suggested",
  "completed_suggested",
] as const;

const MEETING_PROJECTION = {
  _id: 1,
  title: 1,
  startTime: 1,
  attendees: 1,
  userId: 1,
  workspaceId: 1,
  calendarEventId: 1,
  organizerEmail: 1,
} as const;

/** Cap the additive per-meeting attendee list sent to the calendar drawer. */
const MAX_MEETING_ATTENDEES = 25;

const TASK_PROJECTION = {
  _id: 1,
  title: 1,
  dueAt: 1,
  status: 1,
  priorityLabel: 1,
  priorityScore: 1,
  cleanupStatus: 1,
  assigneeName: 1,
  sourceSessionId: 1,
} as const;

const REMINDER_PROJECTION = {
  _id: 1,
  taskId: 1,
  taskTitle: 1,
  kind: 1,
  runAt: 1,
} as const;

// Same defensive coercion as src/lib/task-priority.ts (not exported there):
// stored dates may be Date objects or strings.
const toDate = (value: unknown): Date | null => {
  if (!value) return null;
  const date =
    value instanceof Date ? value : new Date(value as string | number);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * Same fallback semantics the workspace-scoped list routes use: docs tagged
 * with the workspace id, plus legacy docs without a workspaceId that belong
 * to a workspace member.
 */
const buildScopeFilter = (
  workspaceId: string,
  memberUserIds: string[]
): Record<string, any> => ({
  $or: [
    { workspaceId },
    {
      workspaceId: { $exists: false },
      userId: { $in: memberUserIds },
    },
  ],
});

const parseRangeBound = (value: string | null): Date | null => {
  if (!value || !value.trim()) return null;
  return toDate(value.trim());
};

type ClientPersonIndex = {
  emails: Set<string>;
  nameKeys: Set<string>;
};

const buildClientPersonIndex = (people: any[]): ClientPersonIndex => {
  const emails = new Set<string>();
  const nameKeys = new Set<string>();
  for (const person of people) {
    const email =
      typeof person?.email === "string" ? person.email.trim().toLowerCase() : "";
    if (email) emails.add(email);
    const names = [
      person?.name,
      ...(Array.isArray(person?.aliases) ? person.aliases : []),
    ];
    for (const name of names) {
      if (typeof name !== "string") continue;
      const key = normalizePersonNameKey(name);
      if (key) nameKeys.add(key);
    }
  }
  return { emails, nameKeys };
};

const isClientMeeting = (
  attendees: any[],
  clients: ClientPersonIndex
): boolean => {
  if (clients.emails.size === 0 && clients.nameKeys.size === 0) return false;
  return attendees.some((attendee) => {
    const email =
      typeof attendee?.email === "string"
        ? attendee.email.trim().toLowerCase()
        : "";
    if (email && clients.emails.has(email)) return true;
    const nameKey =
      typeof attendee?.name === "string"
        ? normalizePersonNameKey(attendee.name)
        : "";
    return Boolean(nameKey) && clients.nameKeys.has(nameKey);
  });
};

export async function GET(request: Request) {
  const routeContext = createRouteRequestContext({
    request,
    route: ROUTE,
    method: "GET",
  });
  const { correlationId, logger, durationMs, setMetricUserId, emitMetric } =
    routeContext;

  try {
    const userId = await getSessionUserId();
    if (!userId) {
      emitMetric(401, "error", { reason: "unauthorized" });
      logger.warn("api.request.unauthorized", {
        durationMs: durationMs(),
      });
      return apiError(401, "request_error", "Unauthorized", undefined, {
        correlationId,
      });
    }
    setMetricUserId(userId);

    const searchParams = new URL(request.url).searchParams;
    const from = parseRangeBound(searchParams.get("from"));
    const to = parseRangeBound(searchParams.get("to"));
    if (!from || !to) {
      emitMetric(400, "error", { reason: "invalid_range" });
      return apiError(
        400,
        "request_error",
        "Both 'from' and 'to' must be valid ISO dates.",
        undefined,
        { correlationId }
      );
    }
    if (to.getTime() < from.getTime()) {
      emitMetric(400, "error", { reason: "inverted_range" });
      return apiError(
        400,
        "request_error",
        "'to' must not be before 'from'.",
        undefined,
        { correlationId }
      );
    }
    if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY_MS) {
      emitMetric(400, "error", { reason: "range_too_large" });
      return apiError(
        400,
        "request_error",
        `Requested range must not exceed ${MAX_RANGE_DAYS} days.`,
        undefined,
        { correlationId }
      );
    }

    const db = await getDb();
    const { workspaceId, workspaceMemberUserIds } =
      await resolveWorkspaceScopeForUser(db, userId, {
        minimumRole: "member",
        adminVisibilityKey: "tasks",
        includeMemberUserIds: true,
      });

    const scopeFilter = buildScopeFilter(workspaceId, workspaceMemberUserIds);
    const fromIso = from.toISOString();
    const toIso = to.toISOString();

    // startTime is schemaless (Date OR ISO string) — query both range types.
    const meetingsFilter = {
      $and: [
        scopeFilter,
        { isHidden: { $ne: true } },
        {
          $or: [
            { startTime: { $gte: from, $lte: to } },
            { startTime: { $gte: fromIso, $lte: toIso } },
          ],
        },
      ],
    };

    const meetingsCollection = db.collection("meetings");
    const tasksCollection = db.collection("tasks");
    const peopleCollection = db.collection("people");

    const openTaskFilter = {
      ...scopeFilter,
      taskState: { $ne: "archived" },
      cleanupStatus: { $ne: "expired" },
    };

    const now = new Date();
    const nowIso = now.toISOString();

    const [
      meetingDocs,
      taskDocs,
      reminderDocs,
      clientPeople,
      overdueCount,
      cleanupSuggestedCount,
      expiredCount,
    ] = await Promise.all([
      meetingsCollection
        .find(meetingsFilter, { projection: MEETING_PROJECTION })
        .sort({ startTime: 1, _id: 1 })
        .limit(MAX_MEETINGS)
        .toArray(),
      tasksCollection
        .find(
          { ...openTaskFilter, dueAt: { $ne: null } },
          { projection: TASK_PROJECTION }
        )
        .sort({ dueAt: 1, _id: 1 })
        .limit(MAX_TASKS)
        .toArray(),
      // Phase 10 additive: scheduled Slack reminders in range. Reminder docs
      // are always tagged with a workspaceId (or null for personal scope), so
      // no legacy $or fallback is needed here.
      db
        .collection("taskReminders")
        .find(
          {
            workspaceId,
            status: "scheduled",
            runAt: { $gte: from, $lte: to },
          },
          { projection: REMINDER_PROJECTION }
        )
        .sort({ runAt: 1, _id: 1 })
        .limit(MAX_REMINDERS)
        .toArray(),
      peopleCollection
        .find(
          { ...scopeFilter, personType: "client" },
          { projection: { name: 1, email: 1, aliases: 1 } }
        )
        .toArray(),
      // Warnings run over the WHOLE open scope, not the requested range.
      tasksCollection.countDocuments({
        ...openTaskFilter,
        status: { $ne: "done" },
        $and: [
          {
            $or: [
              { dueAt: { $lt: now } },
              { dueAt: { $gt: "", $lt: nowIso } },
            ],
          },
        ],
      }),
      tasksCollection.countDocuments({
        ...scopeFilter,
        taskState: { $ne: "archived" },
        cleanupStatus: { $in: [...SUGGESTED_CLEANUP_STATUSES] },
      }),
      tasksCollection.countDocuments({
        ...scopeFilter,
        taskState: { $ne: "archived" },
        cleanupStatus: "expired",
      }),
    ]);

    const clients = buildClientPersonIndex(clientPeople);

    const meetings = meetingDocs.map((meeting: any) => {
      const attendees = Array.isArray(meeting.attendees)
        ? meeting.attendees
        : [];
      return {
        id: meeting._id,
        title: meeting.title || "Untitled Meeting",
        startTime: toDate(meeting.startTime)?.toISOString() ?? null,
        attendeeCount: attendees.length,
        isClientMeeting: isClientMeeting(attendees, clients),
        // Additive (Priority 10): the event-detail drawer shows attendees and
        // matches Google overlay events by external event id / organizer.
        calendarEventId:
          typeof meeting.calendarEventId === "string" && meeting.calendarEventId
            ? meeting.calendarEventId
            : null,
        organizerEmail:
          typeof meeting.organizerEmail === "string" && meeting.organizerEmail
            ? meeting.organizerEmail
            : null,
        attendees: attendees
          .slice(0, MAX_MEETING_ATTENDEES)
          .map((attendee: any) => ({
            name: typeof attendee?.name === "string" ? attendee.name : null,
            email: typeof attendee?.email === "string" ? attendee.email : null,
          })),
      };
    });

    // dueAt is schemaless — coerce in JS and range-filter here rather than
    // trusting a typed Mongo range query.
    const tasks = taskDocs.flatMap((task: any) => {
      const due = toDate(task.dueAt);
      if (!due || due.getTime() < from.getTime() || due.getTime() > to.getTime()) {
        return [];
      }
      return [
        {
          id: task._id,
          title: task.title || "",
          dueAt: due.toISOString(),
          status: task.status ?? null,
          priorityLabel: task.priorityLabel ?? null,
          priorityScore:
            typeof task.priorityScore === "number" ? task.priorityScore : null,
          cleanupStatus: task.cleanupStatus ?? null,
          assigneeName: task.assigneeName ?? null,
          sourceSessionId: task.sourceSessionId ?? null,
          overdue: due.getTime() < now.getTime() && task.status !== "done",
        },
      ];
    });

    const reminders = reminderDocs.flatMap((reminder: any) => {
      const runAt = toDate(reminder.runAt);
      if (!runAt) return [];
      return [
        {
          id: String(reminder._id),
          taskId: reminder.taskId ?? null,
          taskTitle: reminder.taskTitle || "",
          kind: reminder.kind ?? null,
          runAt: runAt.toISOString(),
          status: "scheduled" as const,
        },
      ];
    });

    const warnings = {
      overdueCount,
      cleanupSuggestedCount,
      expiredCount,
    };

    logger.info("api.request.succeeded", {
      status: 200,
      durationMs: durationMs(),
      meetingCount: meetings.length,
      taskCount: tasks.length,
      reminderCount: reminders.length,
      workspaceId,
    });
    emitMetric(200, "success", {
      meetingCount: meetings.length,
      taskCount: tasks.length,
    });
    return apiSuccess({ meetings, tasks, reminders, warnings }, { correlationId });
  } catch (error) {
    const statusCode = getApiErrorStatus(error);
    emitMetric(statusCode, "error");
    return mapApiError(error, "Failed to load calendar data.", {
      correlationId,
      logger,
      context: {
        route: ROUTE,
        method: "GET",
        durationMs: durationMs(),
      },
    });
  }
}
