import { ObjectId } from "mongodb";
import { z } from "zod";
import { ApiRouteError, apiError, apiSuccess, mapApiError } from "@/lib/api-route";
import { revokeGoogleTokensForUser } from "@/lib/google-auth";
import { listActiveWorkspaceMembershipsForWorkspace } from "@/lib/workspace-memberships";
import { requireWorkspaceRouteAccess } from "@/lib/workspace-route-access";

const revokeBodySchema = z.object({
  targetUserId: z.string().trim().min(1).optional(),
});

const canManageWorkspaceGoogleConnections = (role: string | null | undefined) =>
  role === "owner" || role === "admin";

const roleRank = (role: string | null | undefined) => {
  if (role === "owner") return 3;
  if (role === "admin") return 2;
  if (role === "member") return 1;
  return 0;
};

const parseOptionalJsonBody = async (request: Request) => {
  const raw = await request.text().catch(() => "");
  if (!raw.trim()) {
    return {};
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new ApiRouteError(400, "invalid_json", "Invalid JSON body.");
  }
};

const resolveActiveWorkspaceGoogleConnection = async (db: any, workspaceId: string) => {
  const memberships = await listActiveWorkspaceMembershipsForWorkspace(db, workspaceId);
  if (!memberships.length) {
    return {
      activeMemberUserIds: new Set<string>(),
      connectedUserId: null as string | null,
    };
  }

  const activeMemberUserIds = new Set(
    memberships.map((membership) => String(membership.userId)).filter(Boolean)
  );
  const validObjectIds = Array.from(activeMemberUserIds).filter((value) => ObjectId.isValid(value));
  if (!validObjectIds.length) {
    return { activeMemberUserIds, connectedUserId: null as string | null };
  }

  const users = await db
    .collection("users")
    .find(
      {
        _id: {
          $in: validObjectIds.map((value) => new ObjectId(value)),
        },
      },
      {
        projection: {
          _id: 1,
          googleConnected: 1,
        },
      }
    )
    .toArray();

  const membershipByUserId = new Map<string, any>();
  memberships.forEach((membership) => {
    membershipByUserId.set(String(membership.userId), membership);
  });

  const sortedUsers = [...users].sort((left: any, right: any) => {
    const leftRole = membershipByUserId.get(String(left._id))?.role;
    const rightRole = membershipByUserId.get(String(right._id))?.role;
    return roleRank(rightRole) - roleRank(leftRole);
  });

  const connectedUser = sortedUsers.find((candidate: any) => Boolean(candidate.googleConnected));
  return {
    activeMemberUserIds,
    connectedUserId: connectedUser ? String(connectedUser._id) : null,
  };
};

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

    const parsedBody = await parseOptionalJsonBody(request);
    const body = revokeBodySchema.safeParse(parsedBody);
    if (!body.success) {
      return apiError(400, "invalid_payload", "Invalid revoke payload.", body.error.flatten());
    }

    const callerRole = access.membership?.role || null;
    const canManageOthers = canManageWorkspaceGoogleConnections(callerRole);
    const resolvedWorkspaceState = await resolveActiveWorkspaceGoogleConnection(
      access.db as any,
      workspaceId
    );

    const requestedTarget = body.data.targetUserId || null;
    if (requestedTarget && requestedTarget !== access.userId && !canManageOthers) {
      return apiError(
        403,
        "forbidden",
        "You do not have access to disconnect another member's Google integration."
      );
    }

    const targetUserId =
      requestedTarget ||
      (canManageOthers
        ? resolvedWorkspaceState.connectedUserId || access.userId
        : access.userId);

    if (!resolvedWorkspaceState.activeMemberUserIds.has(targetUserId)) {
      return apiError(404, "not_found", "Target user is not an active workspace member.");
    }

    if (targetUserId !== access.userId && !canManageOthers) {
      return apiError(
        403,
        "forbidden",
        "You do not have access to disconnect another member's Google integration."
      );
    }

    const revokeResult = await revokeGoogleTokensForUser(targetUserId, {
      workspaceId,
      actorUserId: access.userId,
    });

    return apiSuccess({
      workspaceId,
      revokedUserId: revokeResult.revokedUserId,
      remotelyRevoked: revokeResult.remotelyRevoked,
      ...(revokeResult.warning ? { warning: revokeResult.warning } : {}),
    });
  } catch (error) {
    return mapApiError(error, "Failed to disconnect Google integration for workspace.");
  }
}
