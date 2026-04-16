import { z } from "zod";
import { apiError, apiSuccess, mapApiError, parseJsonBody } from "@/lib/api-route";
import {
  logGoogleIntegration,
  listGoogleIntegrationLogsForWorkspace,
  serializeGoogleIntegrationLog,
} from "@/lib/google-logs";
import { requireWorkspaceRouteAccess } from "@/lib/workspace-route-access";

const parseLimit = (value: string | null, fallback = 50) => {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(200, parsed));
};

const createGoogleLogSchema = z.object({
  level: z.enum(["info", "warn", "error"]).default("error"),
  event: z.string().trim().min(1).max(120),
  message: z.string().trim().min(1).max(500),
  metadata: z.record(z.unknown()).optional(),
});

export async function GET(
  request: Request,
  {
    params,
  }: {
    params: { workspaceId: string } | Promise<{ workspaceId: string }>;
  }
) {
  try {
    const { workspaceId: rawWorkspaceId } = await Promise.resolve(params);
    const workspaceId = rawWorkspaceId?.trim();
    if (!workspaceId) {
      return apiError(400, "request_error", "Workspace ID is required.");
    }

    const access = await requireWorkspaceRouteAccess(workspaceId, "member", {
      adminVisibilityKey: "integrations",
    });
    if (!access.ok) {
      return access.response;
    }

    const searchParams = new URL(request.url).searchParams;
    const limit = parseLimit(searchParams.get("limit"), 50);
    const logs = await listGoogleIntegrationLogsForWorkspace(access.db as any, workspaceId, limit);

    return apiSuccess({
      workspaceId,
      logs: logs.map((log) => serializeGoogleIntegrationLog(log)),
      totalCount: logs.length,
    });
  } catch (error) {
    return mapApiError(error, "Failed to load Google integration logs.");
  }
}

export async function POST(
  request: Request,
  {
    params,
  }: {
    params: { workspaceId: string } | Promise<{ workspaceId: string }>;
  }
) {
  try {
    const { workspaceId: rawWorkspaceId } = await Promise.resolve(params);
    const workspaceId = rawWorkspaceId?.trim();
    if (!workspaceId) {
      return apiError(400, "request_error", "Workspace ID is required.");
    }

    const access = await requireWorkspaceRouteAccess(workspaceId, "member", {
      adminVisibilityKey: "integrations",
    });
    if (!access.ok) {
      return access.response;
    }

    const payload = await parseJsonBody(
      request,
      createGoogleLogSchema,
      "Invalid Google integration log payload."
    );

    await logGoogleIntegration({
      workspaceId,
      userId: access.userId,
      actorUserId: access.userId,
      level: payload.level,
      event: payload.event,
      message: payload.message,
      metadata: payload.metadata || null,
    });

    return apiSuccess({
      workspaceId,
      logged: true,
    });
  } catch (error) {
    return mapApiError(error, "Failed to write Google integration log.");
  }
}
