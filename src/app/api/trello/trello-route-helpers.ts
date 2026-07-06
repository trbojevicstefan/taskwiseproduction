/**
 * Shared guards for the /api/trello/* routes. Not a route file — Next.js
 * only routes `route.ts` files, so this module is plain colocated code.
 */

import type { Db } from "mongodb";
import { ApiRouteError } from "@/lib/api-route";
import { isTrelloConfigured, TrelloApiError, TrelloAuthError } from "@/lib/trelloAPI";
import { findTrelloConnectionForWorkspace } from "@/lib/trello-connections";

export const TRELLO_NOT_CONFIGURED_MESSAGE =
  "Trello is not configured on the server. Set TRELLO_API_KEY and try again.";
export const TRELLO_NOT_CONNECTED_MESSAGE =
  "Trello is not connected for this workspace. Connect Trello first.";
export const TRELLO_AUTH_EXPIRED_MESSAGE =
  "Your Trello authorization is no longer valid. Reconnect Trello and try again.";

export const assertTrelloConfigured = () => {
  if (!isTrelloConfigured()) {
    throw new ApiRouteError(503, "trello_not_configured", TRELLO_NOT_CONFIGURED_MESSAGE);
  }
};

/**
 * Returns the active connection's token for the workspace or throws:
 * - 503 trello_not_configured when TRELLO_API_KEY is missing
 * - 409 trello_not_connected when there is no active connection/token
 */
export const requireActiveTrelloToken = async (
  db: Db,
  workspaceId: string
): Promise<string> => {
  assertTrelloConfigured();
  const connection = await findTrelloConnectionForWorkspace(db, workspaceId);
  if (!connection || connection.status !== "active" || !connection.token) {
    throw new ApiRouteError(409, "trello_not_connected", TRELLO_NOT_CONNECTED_MESSAGE);
  }
  return connection.token;
};

/**
 * Converts Trello client errors into ApiRouteErrors the shared mapApiError
 * handler serializes: token rejection -> 401 trello_auth_expired, other
 * Trello API failures -> 502 trello_api_error. Everything else is returned
 * unchanged.
 */
export const mapTrelloError = (error: unknown): unknown => {
  if (error instanceof TrelloAuthError) {
    return new ApiRouteError(401, "trello_auth_expired", TRELLO_AUTH_EXPIRED_MESSAGE);
  }
  if (error instanceof TrelloApiError) {
    return new ApiRouteError(502, "trello_api_error", error.message);
  }
  return error;
};
