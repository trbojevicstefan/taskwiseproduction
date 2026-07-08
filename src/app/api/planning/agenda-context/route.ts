// src/app/api/planning/agenda-context/route.ts
/**
 * Priority 12 — everything the agenda workspace needs for one future meeting.
 *
 * GET /api/planning/agenda-context?meetingId=<id>
 * -> apiSuccess {
 *      meeting: { id, title, startTime, endTime, attendees, agenda,
 *                 organizerEmail },
 *      relatedPeople: [{ id, name, email, personType, company }],
 *      client: { personId, name, company } | null,
 *      openTasks: [{ id, title, dueAt, status, assigneeName, priorityLabel,
 *                    priorityScore, sourceSessionId }],   // attendee-matched
 *      suggestedTopics: SuggestedAgendaTopic[],           // deterministic
 *      carryOver: { meetingId, meetingTitle, startTime } | null,
 *    }
 *
 * Suggested topics are deterministic (no LLM): open tasks assigned to the
 * attendees + carry-over items (agenda sections / still-open tasks) from the
 * most recent past meeting with the same title or overlapping attendees.
 * They are suggestions only — nothing is written; the client applies the
 * user-checked subset via PATCH /api/meetings/[id]/agenda.
 */

import { z } from "zod";
import {
  apiError,
  apiSuccess,
  createRouteRequestContext,
  getApiErrorStatus,
  mapApiError,
} from "@/lib/api-route";
import {
  buildCarryOverSource,
  buildSuggestedAgendaTopics,
  findCarryOverMeeting,
} from "@/lib/agenda-suggestions";
import { getDb } from "@/lib/db";
import { readMeetingAgenda } from "@/lib/meeting-agenda";
import {
  buildAttendeeKeySets,
  collectOpenTasksForAttendees,
  normalizeUpcomingAttendees,
  toDateSafe,
} from "@/lib/planning-upcoming";
import { getSessionUserId } from "@/lib/server-auth";
import { TASK_LIST_PROJECTION } from "@/lib/task-projections";
import { normalizePersonNameKey } from "@/lib/transcript-utils";
import { getWorkspaceIdForUser } from "@/lib/workspace";
import {
  assertWorkspaceAccess,
  ensureWorkspaceBootstrapForUser,
} from "@/lib/workspace-context";

const ROUTE = "/api/planning/agenda-context";

const MAX_OPEN_TASKS = 500;
const MAX_RETURNED_TASKS = 25;
const MAX_PAST_MEETING_CANDIDATES = 50;
const MAX_CARRY_OVER_TASKS = 10;

const querySchema = z.object({
  meetingId: z.string().trim().min(1).max(200),
});

const resolveMeetingAccess = async (db: any, userId: string, id: string) => {
  const lookupFilter = {
    $or: [{ _id: id }, { id }],
  };
  const meeting = await db.collection("meetings").findOne(lookupFilter);
  if (!meeting) return null;

  const workspaceId =
    typeof meeting.workspaceId === "string" ? meeting.workspaceId.trim() : "";
  if (workspaceId) {
    await ensureWorkspaceBootstrapForUser(db as any, userId);
    try {
      await assertWorkspaceAccess(db as any, userId, workspaceId, "member");
    } catch {
      return { accessDenied: true as const };
    }
  } else if (meeting.userId !== userId) {
    return null;
  }

  const ownerUserId =
    typeof meeting.userId === "string" && meeting.userId.trim()
      ? meeting.userId.trim()
      : userId;

  return {
    meeting,
    workspaceId,
    ownerUserId,
    accessDenied: false as const,
  };
};

const buildScopeFilter = (
  workspaceId: string | null,
  ownerUserId: string
): Record<string, any> =>
  workspaceId
    ? {
        $or: [
          { workspaceId },
          { workspaceId: { $exists: false }, userId: ownerUserId },
        ],
      }
    : { userId: ownerUserId };

const serializeTask = (task: any) => ({
  id: String(task._id ?? task.id ?? ""),
  title: task.title ?? "",
  dueAt: task.dueAt ?? null,
  status: task.status ?? null,
  assigneeName:
    task.assigneeName || task.assignee?.name || task.assignee?.displayName || null,
  priorityLabel: task.priorityLabel ?? null,
  priorityScore:
    typeof task.priorityScore === "number" ? task.priorityScore : null,
  sourceSessionId: task.sourceSessionId ?? null,
});

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
      logger.warn("api.request.unauthorized", { durationMs: durationMs() });
      return apiError(401, "request_error", "Unauthorized", undefined, {
        correlationId,
      });
    }
    setMetricUserId(userId);

    const url = new URL(request.url);
    const parsedQuery = querySchema.safeParse({
      meetingId: url.searchParams.get("meetingId") ?? undefined,
    });
    if (!parsedQuery.success) {
      emitMetric(400, "error", { reason: "invalid_query" });
      return apiError(400, "request_error", "meetingId is required.", undefined, {
        correlationId,
      });
    }
    const { meetingId } = parsedQuery.data;

    const db = await getDb();
    const access = await resolveMeetingAccess(db, userId, meetingId);
    if (!access || (!access.accessDenied && access.meeting.isHidden)) {
      emitMetric(404, "error", { reason: "meeting_not_found" });
      return apiError(404, "request_error", "Meeting not found.", undefined, {
        correlationId,
      });
    }
    if (access.accessDenied) {
      emitMetric(403, "error", { reason: "forbidden" });
      return apiError(403, "forbidden", "Forbidden", undefined, {
        correlationId,
      });
    }

    const { meeting, ownerUserId } = access;
    const workspaceId =
      access.workspaceId ||
      (await getWorkspaceIdForUser(db, ownerUserId)) ||
      null;
    const scopeFilter = buildScopeFilter(workspaceId, ownerUserId);

    const attendees = normalizeUpcomingAttendees(meeting.attendees);
    const attendeeKeys = buildAttendeeKeySets(attendees);

    const openTaskFilter = {
      ...scopeFilter,
      status: { $ne: "done" },
      taskState: { $ne: "archived" },
      cleanupStatus: { $ne: "expired" },
    };

    const [openTaskDocs, peopleDocs, pastMeetingDocs] = await Promise.all([
      db
        .collection("tasks")
        .find(openTaskFilter, { projection: TASK_LIST_PROJECTION })
        .sort({ createdAt: -1, _id: -1 })
        .limit(MAX_OPEN_TASKS)
        .toArray(),
      db
        .collection("people")
        .find(scopeFilter, {
          projection: {
            _id: 1,
            name: 1,
            email: 1,
            aliases: 1,
            personType: 1,
            company: 1,
          },
        })
        .toArray(),
      db
        .collection("meetings")
        .find(
          {
            ...scopeFilter,
            isHidden: { $ne: true },
            _id: { $ne: meeting._id },
          },
          {
            projection: {
              _id: 1,
              id: 1,
              title: 1,
              attendees: 1,
              agenda: 1,
              startTime: 1,
              createdAt: 1,
            },
          }
        )
        .sort({ lastActivityAt: -1, _id: -1 })
        .limit(MAX_PAST_MEETING_CANDIDATES)
        .toArray(),
    ]);

    // Related people: workspace people matched to attendees by email or
    // normalized name/alias.
    const relatedPeople = peopleDocs
      .filter((person: any) => {
        const email =
          typeof person?.email === "string"
            ? person.email.trim().toLowerCase()
            : "";
        if (email && attendeeKeys.emails.has(email)) return true;
        const names = [
          person?.name,
          ...(Array.isArray(person?.aliases) ? person.aliases : []),
        ];
        return names.some((name: unknown) => {
          if (typeof name !== "string") return false;
          const key = normalizePersonNameKey(name);
          return Boolean(key && attendeeKeys.nameKeys.has(key));
        });
      })
      .map((person: any) => ({
        id: String(person._id),
        name: person.name ?? null,
        email: person.email ?? null,
        personType: person.personType ?? null,
        company: person.company ?? null,
      }));

    const clientPerson = relatedPeople.find(
      (person: any) => person.personType === "client"
    );
    const client = clientPerson
      ? {
          personId: clientPerson.id,
          name: clientPerson.name,
          company: clientPerson.company,
        }
      : null;

    // Open tasks assigned to the attendees.
    const { taskIds } = collectOpenTasksForAttendees(attendees, openTaskDocs);
    const matchedIds = new Set(taskIds);
    const openTasks = openTaskDocs
      .filter((task: any) => matchedIds.has(String(task._id ?? task.id ?? "")))
      .slice(0, MAX_RETURNED_TASKS)
      .map(serializeTask);

    // Carry-over: most recent PAST meeting with the same title/attendees.
    const meetingStart = toDateSafe(meeting.startTime);
    const now = new Date();
    const pastCandidates = pastMeetingDocs.filter((candidate: any) => {
      const candidateDate =
        toDateSafe(candidate.startTime) ?? toDateSafe(candidate.createdAt);
      if (!candidateDate) return false;
      const boundary = meetingStart ?? now;
      return candidateDate.getTime() < boundary.getTime();
    });
    const carryOverMeeting = findCarryOverMeeting(pastCandidates, {
      title: meeting.title,
      attendees: meeting.attendees,
    });

    let carryOverSource = null;
    if (carryOverMeeting) {
      const carryOverId = String(
        carryOverMeeting._id ?? carryOverMeeting.id ?? ""
      );
      const carryOverOpenTasks = await db
        .collection("tasks")
        .find(
          {
            ...scopeFilter,
            sourceSessionType: "meeting",
            sourceSessionId: carryOverId,
            status: { $ne: "done" },
            taskState: { $ne: "archived" },
            cleanupStatus: { $ne: "expired" },
          },
          { projection: { _id: 1, title: 1 } }
        )
        .limit(MAX_CARRY_OVER_TASKS)
        .toArray();
      carryOverSource = buildCarryOverSource(
        carryOverMeeting,
        carryOverOpenTasks.map((task: any) => task.title || "")
      );
    }

    const suggestedTopics = buildSuggestedAgendaTopics({
      openTasks: openTasks.map((task: any) => ({
        id: task.id,
        title: task.title,
        dueAt: task.dueAt,
        assigneeName: task.assigneeName,
      })),
      carryOver: carryOverSource,
    });

    logger.info("api.request.succeeded", {
      status: 200,
      durationMs: durationMs(),
      meetingId,
      openTaskCount: openTasks.length,
      suggestedTopicCount: suggestedTopics.length,
    });
    emitMetric(200, "success", { meetingId });
    return apiSuccess(
      {
        meeting: {
          id: String(meeting._id ?? meeting.id ?? meetingId),
          title: meeting.title ?? "Meeting",
          startTime: toDateSafe(meeting.startTime)?.toISOString() ?? null,
          endTime: toDateSafe(meeting.endTime)?.toISOString() ?? null,
          attendees,
          agenda: readMeetingAgenda(meeting),
          organizerEmail: meeting.organizerEmail ?? null,
        },
        relatedPeople,
        client,
        openTasks,
        suggestedTopics,
        carryOver: carryOverSource
          ? {
              meetingId: carryOverSource.meetingId,
              meetingTitle: carryOverSource.meetingTitle,
              startTime: carryOverSource.startTime,
            }
          : null,
      },
      { correlationId }
    );
  } catch (error) {
    const statusCode = getApiErrorStatus(error);
    emitMetric(statusCode, "error");
    return mapApiError(error, "Failed to load agenda context.", {
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
