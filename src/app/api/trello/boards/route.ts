/**
 * GET /api/trello/boards — open Trello boards for the connected workspace
 * account. Requires an active workspace Trello connection.
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
import { fetchTrelloBoards } from "@/lib/trelloAPI";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";
import { mapTrelloError, requireActiveTrelloToken } from "../trello-route-helpers";

const ROUTE = "/api/trello/boards";
const MAX_BOARDS = 200;

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
      return apiError(401, "request_error", "Unauthorized", undefined, {
        correlationId,
      });
    }
    setMetricUserId(userId);

    const db = await getDb();
    const { workspaceId } = await resolveWorkspaceScopeForUser(db, userId, {
      minimumRole: "member",
    });

    const token = await requireActiveTrelloToken(db, workspaceId);

    let boards;
    try {
      boards = await fetchTrelloBoards(token);
    } catch (error) {
      throw mapTrelloError(error);
    }

    logger.info("api.request.succeeded", {
      status: 200,
      durationMs: durationMs(),
      workspaceId,
      boardCount: boards.length,
    });
    emitMetric(200, "success");
    return apiSuccess({ boards: boards.slice(0, MAX_BOARDS) }, { correlationId });
  } catch (error) {
    const statusCode = getApiErrorStatus(error);
    emitMetric(statusCode, "error");
    return mapApiError(error, "Failed to fetch Trello boards.", {
      correlationId,
      logger,
      context: { route: ROUTE, method: "GET", durationMs: durationMs() },
    });
  }
}
