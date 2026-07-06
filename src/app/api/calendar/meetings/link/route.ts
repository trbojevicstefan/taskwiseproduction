// src/app/api/calendar/meetings/link/route.ts
/**
 * Priority 10 — POST /api/calendar/meetings/link
 *
 * Links a Google Calendar event to an existing Taskwise meeting by storing
 * the event id as `calendarEventId` on the meeting doc, so future calendar
 * loads match the event by external id (see src/lib/calendar-event-matching).
 *
 * Access rules mirror /api/meetings/[id]: a workspace-tagged meeting requires
 * member access to that workspace; a legacy meeting without workspaceId must
 * belong to the session user.
 */

import { z } from "zod";
import {
  apiError,
  apiSuccess,
  createRouteRequestContext,
  getApiErrorStatus,
  mapApiError,
  parseJsonBody,
} from "@/lib/api-route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import {
  assertWorkspaceAccess,
  ensureWorkspaceBootstrapForUser,
} from "@/lib/workspace-context";

const ROUTE = "/api/calendar/meetings/link";

const linkSchema = z.object({
  meetingId: z.string().trim().min(1).max(128),
  externalEventId: z.string().trim().min(1).max(256),
});

export async function POST(request: Request) {
  const routeContext = createRouteRequestContext({
    request,
    route: ROUTE,
    method: "POST",
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

    const body = await parseJsonBody(
      request,
      linkSchema,
      "Invalid calendar link payload."
    );

    const db = await getDb();
    const lookupFilter = {
      $or: [{ _id: body.meetingId }, { id: body.meetingId }],
    };
    const meeting = await db.collection("meetings").findOne(lookupFilter);
    if (!meeting || meeting.isHidden) {
      emitMetric(404, "error", { reason: "meeting_not_found" });
      return apiError(404, "request_error", "Meeting not found.", undefined, {
        correlationId,
      });
    }

    const workspaceId =
      typeof meeting.workspaceId === "string" ? meeting.workspaceId.trim() : "";
    if (workspaceId) {
      await ensureWorkspaceBootstrapForUser(db as any, userId);
      try {
        await assertWorkspaceAccess(db as any, userId, workspaceId, "member");
      } catch {
        emitMetric(404, "error", { reason: "meeting_access_denied" });
        return apiError(404, "request_error", "Meeting not found.", undefined, {
          correlationId,
        });
      }
    } else if (meeting.userId !== userId) {
      emitMetric(404, "error", { reason: "meeting_access_denied" });
      return apiError(404, "request_error", "Meeting not found.", undefined, {
        correlationId,
      });
    }

    await db
      .collection("meetings")
      .updateOne(meeting._id ? { _id: meeting._id } : lookupFilter, {
        $set: { calendarEventId: body.externalEventId },
      });

    logger.info("api.request.succeeded", {
      status: 200,
      durationMs: durationMs(),
      meetingId: String(meeting._id ?? body.meetingId),
      workspaceId: workspaceId || null,
    });
    emitMetric(200, "success", { workspaceId: workspaceId || null });
    return apiSuccess(
      {
        meetingId: String(meeting._id ?? body.meetingId),
        externalEventId: body.externalEventId,
      },
      { correlationId }
    );
  } catch (error) {
    const statusCode = getApiErrorStatus(error);
    emitMetric(statusCode, "error");
    return mapApiError(error, "Failed to link calendar event to meeting.", {
      correlationId,
      logger,
      context: {
        route: ROUTE,
        method: "POST",
        durationMs: durationMs(),
      },
    });
  }
}
