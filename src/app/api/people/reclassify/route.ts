import { NextResponse } from "next/server";
import {
  apiError,
  createRouteRequestContext,
  getApiErrorStatus,
  mapApiError,
} from "@/lib/api-route";
import { getDb } from "@/lib/db";
import { attachCorrelationIdHeader } from "@/lib/observability";
import {
  classifyPersonHeuristic,
  resolveInternalDomains,
  type PersonClassificationType,
} from "@/lib/person-classification";
import { getSessionUserId } from "@/lib/server-auth";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";

const ROUTE = "/api/people/reclassify";

export async function POST(request?: Request) {
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
      logger.warn("api.request.unauthorized", {
        durationMs: durationMs(),
      });
      return apiError(401, "request_error", "Unauthorized", undefined, {
        correlationId,
      });
    }
    setMetricUserId(userId);

    const db = await getDb();
    const { workspaceId, workspaceMemberUserIds } =
      await resolveWorkspaceScopeForUser(db, userId, {
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

    const people = await db
      .collection("people")
      .find(workspaceFallbackScope as any)
      .toArray();
    const internalDomains = await resolveInternalDomains(db, {
      userIds: workspaceMemberUserIds || [],
    });

    const counts: Record<PersonClassificationType, number> = {
      teammate: 0,
      client: 0,
      unknown: 0,
    };
    const operations: any[] = [];
    let scanned = 0;

    for (const person of people as any[]) {
      if (person.personTypeSource === "manual") {
        // Manual classifications are never overwritten by auto-classification.
        const manualType: PersonClassificationType =
          person.personType === "teammate" || person.personType === "client"
            ? person.personType
            : "unknown";
        counts[manualType] += 1;
        continue;
      }

      scanned += 1;
      const { personType, reason } = classifyPersonHeuristic(
        { email: person.email ?? null, slackId: person.slackId ?? null },
        internalDomains
      );
      counts[personType] += 1;

      const existingType = person.personType ?? "unknown";
      if (existingType !== personType) {
        operations.push({
          updateOne: {
            filter: { _id: person._id },
            update: {
              $set: {
                personType,
                personTypeSource: "auto",
                personTypeReason: reason,
              },
            },
          },
        });
      }
    }

    let updated = 0;
    if (operations.length) {
      const result = await db.collection("people").bulkWrite(operations);
      updated = result?.modifiedCount ?? operations.length;
    }

    logger.info("api.request.succeeded", {
      status: 200,
      durationMs: durationMs(),
      scanned,
      updated,
    });
    emitMetric(200, "success", { scanned, updated });
    return attachCorrelationIdHeader(
      NextResponse.json({ ok: true, scanned, updated, counts }),
      correlationId
    );
  } catch (error) {
    const statusCode = getApiErrorStatus(error);
    emitMetric(statusCode, "error");
    return mapApiError(error, "Failed to reclassify people.", {
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
