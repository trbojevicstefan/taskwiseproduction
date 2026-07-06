// src/app/api/planning/upcoming-meetings/route.ts
/**
 * Priority 12 — upcoming-meetings feed for the planning workspace.
 *
 * GET /api/planning/upcoming-meetings?days=14&limit=25
 * -> apiSuccess {
 *      meetings: UpcomingMeetingItem[],   // see src/lib/planning-upcoming.ts
 *      counts: { total, needsAgenda },
 *      googleConnected: boolean,
 *      googleError: string | null,       // Google fetch failed (non-fatal)
 *    }
 *
 * Sources merged (dedup by calendarEventId/conferenceId, then title+time):
 *  - Taskwise meetings with startTime >= now within the window (workspace
 *    fallback scope, hidden excluded; startTime is schemaless so the range
 *    query covers Date and ISO-string storage).
 *  - Google Calendar events via fetchGoogleUpcomingEvents with the allEvents
 *    opt-in (default hangoutLink-only contract untouched). Google being
 *    disconnected or erroring never fails the request.
 *
 * Each item carries needsAgenda (no `agenda` sections yet) and the count of
 * open tasks (status != done, not archived/expired) whose assignee matches a
 * meeting attendee by email or normalized name.
 */

import { z } from "zod";
import {
  apiError,
  apiSuccess,
  createRouteRequestContext,
  getApiErrorStatus,
  mapApiError,
} from "@/lib/api-route";
import { getDb } from "@/lib/db";
import { fetchGoogleUpcomingEvents } from "@/lib/google-calendar-upcoming";
import { buildUpcomingMeetingItems } from "@/lib/planning-upcoming";
import { getSessionUserId } from "@/lib/server-auth";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";

const ROUTE = "/api/planning/upcoming-meetings";

const MAX_TASKS = 500;
const MAX_MEETINGS = 100;

const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(31).default(14),
  limit: z.coerce.number().int().min(1).max(50).default(25),
});

const MEETING_PROJECTION = {
  _id: 1,
  id: 1,
  title: 1,
  startTime: 1,
  endTime: 1,
  attendees: 1,
  agenda: 1,
  calendarEventId: 1,
  conferenceId: 1,
  organizerEmail: 1,
} as const;

const TASK_PROJECTION = {
  _id: 1,
  assignee: 1,
  assigneeName: 1,
  assigneeNameKey: 1,
  assigneeEmail: 1,
} as const;

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
      days: url.searchParams.get("days") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!parsedQuery.success) {
      emitMetric(400, "error", { reason: "invalid_query" });
      return apiError(
        400,
        "request_error",
        "Invalid query parameters.",
        undefined,
        { correlationId }
      );
    }
    const { days, limit } = parsedQuery.data;

    const db = await getDb();
    const { workspaceId, workspaceMemberUserIds } =
      await resolveWorkspaceScopeForUser(db, userId, {
        minimumRole: "member",
        adminVisibilityKey: "tasks",
        includeMemberUserIds: true,
      });

    const scopeFilter = buildScopeFilter(workspaceId, workspaceMemberUserIds);

    const now = new Date();
    const windowEnd = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    const nowIso = now.toISOString();
    const windowEndIso = windowEnd.toISOString();

    const openTaskFilter = {
      ...scopeFilter,
      status: { $ne: "done" },
      taskState: { $ne: "archived" },
      cleanupStatus: { $ne: "expired" },
    };

    // startTime is schemaless (Date OR ISO string) — query both range types,
    // same pattern as /api/calendar.
    const upcomingMeetingFilter = {
      ...scopeFilter,
      isHidden: { $ne: true },
      $and: [
        {
          $or: [
            { startTime: { $gte: now, $lte: windowEnd } },
            { startTime: { $gte: nowIso, $lte: windowEndIso } },
          ],
        },
      ],
    };

    const [taskDocs, meetingDocs] = await Promise.all([
      db
        .collection("tasks")
        .find(openTaskFilter, { projection: TASK_PROJECTION })
        .sort({ createdAt: -1, _id: -1 })
        .limit(MAX_TASKS)
        .toArray(),
      db
        .collection("meetings")
        .find(upcomingMeetingFilter, { projection: MEETING_PROJECTION })
        .sort({ startTime: 1, _id: 1 })
        .limit(MAX_MEETINGS)
        .toArray(),
    ]);

    let googleConnected = false;
    let googleError: string | null = null;
    let googleEvents: Awaited<
      ReturnType<typeof fetchGoogleUpcomingEvents>
    >["events"] = [];
    try {
      const googleResult = await fetchGoogleUpcomingEvents(userId, {
        start: now,
        end: windowEnd,
        includeAllEvents: true,
      });
      googleConnected = googleResult.connected;
      googleEvents = googleResult.events;
    } catch (error) {
      googleError =
        error instanceof Error && error.message
          ? error.message
          : "Failed to fetch Google Calendar events.";
      logger.warn("api.request.partial_source_failed", {
        source: "google_calendar",
        error: googleError,
        durationMs: durationMs(),
      });
    }

    const meetings = buildUpcomingMeetingItems({
      taskwiseMeetings: meetingDocs,
      googleEvents,
      openTasks: taskDocs,
      now,
      limit,
    });
    const counts = {
      total: meetings.length,
      needsAgenda: meetings.filter((item) => item.needsAgenda).length,
    };

    logger.info("api.request.succeeded", {
      status: 200,
      durationMs: durationMs(),
      meetingCount: meetings.length,
      googleConnected,
      workspaceId,
    });
    emitMetric(200, "success", { meetingCount: meetings.length });
    return apiSuccess(
      { meetings, counts, googleConnected, googleError },
      { correlationId }
    );
  } catch (error) {
    const statusCode = getApiErrorStatus(error);
    emitMetric(statusCode, "error");
    return mapApiError(error, "Failed to load upcoming meetings.", {
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
