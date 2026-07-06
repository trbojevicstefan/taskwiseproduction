// src/app/api/meetings/[id]/agenda/route.ts
/**
 * Priority 12 — user-editable agenda persisted on the meeting doc.
 *
 * PATCH /api/meetings/[id]/agenda
 *   body: { agenda: Array<{ id, title, notes?, order }> }  (zod, capped)
 *   -> { agenda }  // normalized: sorted by order, order re-numbered
 *
 * Additive `agenda` field only — never touches extractedTasks or any other
 * meeting field. Same per-meeting access rules as the sibling meeting routes
 * (workspace member when the meeting has a workspaceId, owner otherwise).
 */

import { NextResponse } from "next/server";
import { apiError, mapApiError, parseJsonBody } from "@/lib/api-route";
import { getDb } from "@/lib/db";
import {
  agendaPatchSchema,
  normalizeAgendaSections,
} from "@/lib/meeting-agenda";
import { getSessionUserId } from "@/lib/server-auth";
import {
  assertWorkspaceAccess,
  ensureWorkspaceBootstrapForUser,
} from "@/lib/workspace-context";

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

  return {
    meeting,
    filter: meeting?._id ? { _id: meeting._id } : lookupFilter,
    accessDenied: false as const,
  };
};

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = await getSessionUserId();
  if (!userId) {
    return apiError(401, "request_error", "Unauthorized");
  }

  try {
    const body = await parseJsonBody(
      request,
      agendaPatchSchema,
      "Invalid agenda payload."
    );
    const agenda = normalizeAgendaSections(body.agenda);

    const db = await getDb();
    const access = await resolveMeetingAccess(db, userId, id);
    if (!access) {
      return apiError(404, "request_error", "Meeting not found.");
    }
    if (access.accessDenied) {
      return apiError(403, "forbidden", "Forbidden");
    }
    if (access.meeting.isHidden) {
      return apiError(404, "request_error", "Meeting not found.");
    }

    const now = new Date();
    await db.collection("meetings").updateOne(access.filter, {
      $set: {
        agenda,
        agendaUpdatedAt: now,
        lastActivityAt: now,
      },
    });

    return NextResponse.json({ agenda });
  } catch (error) {
    return mapApiError(error, "Failed to update the meeting agenda.");
  }
}
