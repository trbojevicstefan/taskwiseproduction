import { ApiRouteError } from "@/lib/api-route";

export const WORKSPACE_ERROR_CODE = {
  UNAUTHORIZED: "workspace_unauthorized",
  FORBIDDEN: "workspace_forbidden",
  NOT_FOUND: "workspace_not_found",
  CONFLICT: "workspace_conflict",
} as const;

export const workspaceUnauthorizedError = (message = "Unauthorized") =>
  new ApiRouteError(401, WORKSPACE_ERROR_CODE.UNAUTHORIZED, message);

export const workspaceForbiddenError = (message = "Forbidden") =>
  new ApiRouteError(403, WORKSPACE_ERROR_CODE.FORBIDDEN, message);

export const workspaceNotFoundError = (message = "Workspace not found.") =>
  new ApiRouteError(404, WORKSPACE_ERROR_CODE.NOT_FOUND, message);

export const workspaceConflictError = (
  message = "Workspace conflict.",
  details?: unknown
) => new ApiRouteError(409, WORKSPACE_ERROR_CODE.CONFLICT, message, details);
