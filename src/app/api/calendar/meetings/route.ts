// src/app/api/calendar/meetings/route.ts
/**
 * Priority 10 — POST /api/calendar/meetings
 *
 * Narrow calendar wrapper for creating a Taskwise meeting from a calendar
 * (Google overlay) event. POST /api/meetings exists but is tuned for
 * transcript-first manual imports (no startTime / calendarEventId support and
 * a heavyweight completion-suggestion pass), so this route creates a minimal
 * meeting doc directly:
 *   { title, startTime, endTime?, attendees, summary?, calendarEventId?,
 *     ingestSource: "manual" }
 * and publishes the same ingestion domain events the manual path publishes
 * (runMeetingIngestionCommand mode "always-event"), so Calendar / Planning /
 * People ride the existing rails.
 *
 * Idempotency: when externalEventId is provided and a visible meeting in the
 * workspace already stores it as calendarEventId, that meeting is returned
 * with { created: false } instead of inserting a duplicate.
 */

import { randomUUID } from "crypto";
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
import { serializeError } from "@/lib/observability";
import { getSessionUserId } from "@/lib/server-auth";
import { runMeetingIngestionCommand } from "@/lib/services/meeting-ingestion-command";
import { getWorkspaceIdForUser } from "@/lib/workspace";
import {
  assertWorkspaceAccess,
  ensureWorkspaceBootstrapForUser,
} from "@/lib/workspace-context";

const ROUTE = "/api/calendar/meetings";

const MAX_ATTENDEES = 50;

const isoDateString = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((value) => !Number.isNaN(new Date(value).getTime()), {
    message: "Must be a valid ISO date.",
  });

const attendeeSchema = z.object({
  name: z.string().trim().max(200).nullish(),
  email: z.string().trim().max(320).nullish(),
});

const createFromEventSchema = z.object({
  title: z.string().trim().min(1).max(300),
  startTime: isoDateString,
  endTime: isoDateString.nullish(),
  attendees: z.array(attendeeSchema).max(MAX_ATTENDEES).optional(),
  description: z.string().max(5_000).nullish(),
  externalEventId: z.string().trim().min(1).max(256).nullish(),
});

const serializeCreatedMeeting = (meeting: any) => ({
  id: String(meeting._id),
  title: meeting.title,
  startTime:
    meeting.startTime instanceof Date
      ? meeting.startTime.toISOString()
      : meeting.startTime ?? null,
  calendarEventId: meeting.calendarEventId ?? null,
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
      createFromEventSchema,
      "Invalid calendar meeting payload."
    );

    const db = await getDb();
    await ensureWorkspaceBootstrapForUser(db as any, userId);
    const workspaceId = await getWorkspaceIdForUser(db, userId);
    if (!workspaceId) {
      emitMetric(400, "error", { reason: "workspace_missing" });
      return apiError(
        400,
        "request_error",
        "Workspace is not configured.",
        undefined,
        { correlationId }
      );
    }
    await assertWorkspaceAccess(db as any, userId, workspaceId, "member");

    const meetingsCollection = db.collection("meetings");
    const externalEventId = body.externalEventId?.trim() || null;

    if (externalEventId) {
      const existing = await meetingsCollection.findOne(
        {
          workspaceId,
          calendarEventId: externalEventId,
          isHidden: { $ne: true },
        },
        { projection: { _id: 1, title: 1, startTime: 1, calendarEventId: 1 } }
      );
      if (existing) {
        logger.info("api.request.succeeded", {
          status: 200,
          durationMs: durationMs(),
          meetingId: String(existing._id),
          workspaceId,
          created: false,
        });
        emitMetric(200, "success", { created: false, workspaceId });
        return apiSuccess(
          { meeting: serializeCreatedMeeting(existing), created: false },
          { correlationId }
        );
      }
    }

    const now = new Date();
    const attendees = (body.attendees ?? []).flatMap((attendee) => {
      const name = attendee.name?.trim() || "";
      const email = attendee.email?.trim() || "";
      if (!name && !email) return [];
      return [
        {
          name: name || email,
          email: email || null,
          role: "attendee" as const,
        },
      ];
    });

    const meeting = {
      _id: randomUUID(),
      userId,
      workspaceId,
      title: body.title,
      startTime: new Date(body.startTime),
      endTime: body.endTime ? new Date(body.endTime) : null,
      attendees,
      originalTranscript: "",
      summary: body.description?.trim() || "",
      extractedTasks: [],
      calendarEventId: externalEventId,
      ingestSource: "manual" as const,
      createdAt: now,
      lastActivityAt: now,
    };

    await meetingsCollection.insertOne(meeting);

    try {
      await runMeetingIngestionCommand(db, {
        mode: "always-event",
        userId,
        payload: {
          meetingId: String(meeting._id),
          workspaceId,
          title: meeting.title,
          attendees: meeting.attendees,
          extractedTasks: [],
        },
      });
    } catch (error) {
      logger.warn("api.request.side_effect_failed", {
        sideEffect: "meeting_ingestion_command",
        error: serializeError(error),
        durationMs: durationMs(),
      });
    }

    logger.info("api.request.succeeded", {
      status: 200,
      durationMs: durationMs(),
      meetingId: meeting._id,
      workspaceId,
      created: true,
    });
    emitMetric(200, "success", { created: true, workspaceId });
    return apiSuccess(
      { meeting: serializeCreatedMeeting(meeting), created: true },
      { correlationId }
    );
  } catch (error) {
    const statusCode = getApiErrorStatus(error);
    emitMetric(statusCode, "error");
    return mapApiError(error, "Failed to create meeting from calendar event.", {
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
