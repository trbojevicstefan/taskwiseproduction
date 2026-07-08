/**
 * GET /api/trello/lists?boardId=<id> — open lists on a Trello board.
 * Requires an active workspace Trello connection.
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
import { getSessionUserId } from "@/lib/server-auth";
import { fetchTrelloBoardLists } from "@/lib/trelloAPI";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";
import { mapTrelloError, requireActiveTrelloToken } from "../trello-route-helpers";

const ROUTE = "/api/trello/lists";
const MAX_LISTS = 500;

const boardIdSchema = z
  .string()
  .trim()
  .regex(/^[a-zA-Z0-9]{8,64}$/, "Invalid Trello board id.");

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

    const parsedBoardId = boardIdSchema.safeParse(
      new URL(request.url).searchParams.get("boardId") || ""
    );
    if (!parsedBoardId.success) {
      emitMetric(400, "error", { reason: "invalid_board_id" });
      return apiError(
        400,
        "invalid_payload",
        "A valid boardId query parameter is required.",
        parsedBoardId.error.flatten(),
        { correlationId }
      );
    }

    const db = await getDb();
    const { workspaceId } = await resolveWorkspaceScopeForUser(db, userId, {
      minimumRole: "member",
    });

    const token = await requireActiveTrelloToken(db, workspaceId);

    let lists;
    try {
      lists = await fetchTrelloBoardLists(token, parsedBoardId.data);
    } catch (error) {
      throw mapTrelloError(error);
    }

    logger.info("api.request.succeeded", {
      status: 200,
      durationMs: durationMs(),
      workspaceId,
      listCount: lists.length,
    });
    emitMetric(200, "success");
    return apiSuccess({ lists: lists.slice(0, MAX_LISTS) }, { correlationId });
  } catch (error) {
    const statusCode = getApiErrorStatus(error);
    emitMetric(statusCode, "error");
    return mapApiError(error, "Failed to fetch Trello lists.", {
      correlationId,
      logger,
      context: { route: ROUTE, method: "GET", durationMs: durationMs() },
    });
  }
}
