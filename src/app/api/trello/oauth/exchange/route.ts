/**
 * POST /api/trello/oauth/exchange
 *
 * Accepts the Trello member token the user copied from Trello's client-side
 * authorize page (`response_type=token`), validates it against
 * `GET /1/members/me`, and stores the single workspace Trello connection.
 * The token is never returned in the response.
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
import { fetchTrelloMember, TrelloAuthError } from "@/lib/trelloAPI";
import {
  serializeTrelloConnection,
  upsertTrelloConnection,
} from "@/lib/trello-connections";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";
import { assertTrelloConfigured, mapTrelloError } from "../../trello-route-helpers";

const ROUTE = "/api/trello/oauth/exchange";

const exchangeRequestSchema = z.object({
  token: z
    .string()
    .trim()
    .min(8, "Trello token looks too short.")
    .max(512, "Trello token looks too long."),
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
      return apiError(401, "request_error", "Unauthorized", undefined, {
        correlationId,
      });
    }
    setMetricUserId(userId);

    const db = await getDb();
    const { workspaceId } = await resolveWorkspaceScopeForUser(db, userId, {
      minimumRole: "member",
      adminVisibilityKey: "integrations",
    });

    assertTrelloConfigured();

    const body = await parseJsonBody(
      request,
      exchangeRequestSchema,
      "Invalid Trello connect payload."
    );

    let member;
    try {
      member = await fetchTrelloMember(body.token);
    } catch (error) {
      if (error instanceof TrelloAuthError) {
        emitMetric(400, "error", { reason: "invalid_token" });
        return apiError(
          400,
          "invalid_token",
          "Trello rejected this token. Copy the full token from the Trello authorize page and try again.",
          undefined,
          { correlationId }
        );
      }
      throw mapTrelloError(error);
    }

    const connection = await upsertTrelloConnection(db, {
      workspaceId,
      userId,
      token: body.token,
      memberId: member.id,
      memberUsername: member.username || null,
      memberFullName: member.fullName || null,
    });

    logger.info("api.request.succeeded", {
      status: 200,
      durationMs: durationMs(),
      workspaceId,
    });
    emitMetric(200, "success");
    return apiSuccess(
      { connection: serializeTrelloConnection(connection) },
      { correlationId }
    );
  } catch (error) {
    const statusCode = getApiErrorStatus(error);
    emitMetric(statusCode, "error");
    return mapApiError(error, "Failed to connect Trello.", {
      correlationId,
      logger,
      context: { route: ROUTE, method: "POST", durationMs: durationMs() },
    });
  }
}
