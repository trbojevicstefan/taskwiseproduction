import { ObjectId } from "mongodb";
import { apiError, apiSuccess, mapApiError } from "@/lib/api-route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import {
  assertWorkspaceAccess,
  ensureWorkspaceBootstrapForUser,
} from "@/lib/workspace-context";
import {
  countActiveWorkspaceOwners,
  listWorkspaceMembershipsForWorkspace,
} from "@/lib/workspace-memberships";
import { canWorkspaceRole } from "@/lib/workspace-roles";

type SerializableMember = {
  membershipId: string;
  userId: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
  role: "owner" | "admin" | "member";
  status: "active" | "invited" | "suspended" | "left";
  joinedAt: string | null;
  updatedAt: string | null;
  isCurrentUser: boolean;
  isLastOwner: boolean;
  canEditRole: boolean;
  canRemove: boolean;
};

const ROLE_SORT_ORDER: Record<string, number> = {
  owner: 0,
  admin: 1,
  member: 2,
};

const STATUS_SORT_ORDER: Record<string, number> = {
  active: 0,
  invited: 1,
  suspended: 2,
  left: 3,
};

const getManageability = (input: {
  actingRole: "owner" | "admin" | "member";
  targetRole: "owner" | "admin" | "member";
  targetUserId: string;
  currentUserId: string;
}) => {
  if (input.actingRole === "owner") {
    return { canEditRole: true, canRemove: true };
  }
  if (input.actingRole === "admin") {
    const canManage = input.targetRole === "member" && input.targetUserId !== input.currentUserId;
    return {
      canEditRole: canManage,
      canRemove: canManage,
    };
  }
  return { canEditRole: false, canRemove: false };
};

const loadUserSnapshots = async (db: Awaited<ReturnType<typeof getDb>>, userIds: string[]) => {
  if (!userIds.length) {
    return new Map<
      string,
      { name: string | null; email: string | null; avatarUrl: string | null }
    >();
  }

  const objectIds = userIds
    .filter((userId) => ObjectId.isValid(userId))
    .map((userId) => new ObjectId(userId));
  const users = await db
    .collection("users")
    .find(
      {
        $or: [
          ...(objectIds.length ? [{ _id: { $in: objectIds } }] : []),
          { id: { $in: userIds } },
        ],
      },
      {
        projection: {
          _id: 1,
          id: 1,
          name: 1,
          email: 1,
          avatarUrl: 1,
        },
      }
    )
    .toArray();

  const map = new Map<
    string,
    { name: string | null; email: string | null; avatarUrl: string | null }
  >();
  for (const user of users as any[]) {
    const snapshot = {
      name: user?.name || null,
      email: user?.email || null,
      avatarUrl: user?.avatarUrl || null,
    };
    const aliases = [user?._id?.toString?.(), user?.id].filter(
      (value): value is string => Boolean(value)
    );
    for (const alias of aliases) {
      map.set(alias, snapshot);
    }
  }
  return map;
};

export async function GET(
  _request: Request,
  {
    params,
  }: { params: { workspaceId: string } | Promise<{ workspaceId: string }> }
) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return apiError(401, "request_error", "Unauthorized");
    }

    const { workspaceId: rawWorkspaceId } = await Promise.resolve(params);
    const workspaceId = rawWorkspaceId?.trim();
    if (!workspaceId) {
      return apiError(400, "request_error", "Workspace ID is required.");
    }

    const db = await getDb();
    await ensureWorkspaceBootstrapForUser(db as any, userId);
    const access = await assertWorkspaceAccess(db as any, userId, workspaceId, "admin");
    if (!canWorkspaceRole(access.membership.role, "workspace.members.read")) {
      return apiError(403, "forbidden", "Forbidden");
    }

    const [memberships, activeOwnerCount] = await Promise.all([
      listWorkspaceMembershipsForWorkspace(db as any, workspaceId),
      countActiveWorkspaceOwners(db as any, workspaceId),
    ]);

    const userIds = Array.from(
      new Set(memberships.map((membership: any) => membership.userId).filter(Boolean))
    );
    const userById = await loadUserSnapshots(db, userIds);

    const sorted = [...memberships].sort((a: any, b: any) => {
      const statusDelta =
        (STATUS_SORT_ORDER[a.status] ?? Number.MAX_SAFE_INTEGER) -
        (STATUS_SORT_ORDER[b.status] ?? Number.MAX_SAFE_INTEGER);
      if (statusDelta !== 0) return statusDelta;

      const roleDelta =
        (ROLE_SORT_ORDER[a.role] ?? Number.MAX_SAFE_INTEGER) -
        (ROLE_SORT_ORDER[b.role] ?? Number.MAX_SAFE_INTEGER);
      if (roleDelta !== 0) return roleDelta;

      return (a.userId || "").localeCompare(b.userId || "");
    });

    const members: SerializableMember[] = sorted.map((membership: any) => {
      const user = userById.get(membership.userId);
      const manageability = getManageability({
        actingRole: access.membership.role,
        targetRole: membership.role,
        targetUserId: membership.userId,
        currentUserId: userId,
      });
      const isActiveMembership = membership.status === "active";

      return {
        membershipId: membership._id,
        userId: membership.userId,
        name: user?.name || user?.email || "Unknown user",
        email: user?.email || null,
        avatarUrl: user?.avatarUrl || null,
        role: membership.role,
        status: membership.status,
        joinedAt: membership.joinedAt?.toISOString?.() || null,
        updatedAt: membership.updatedAt?.toISOString?.() || null,
        isCurrentUser: membership.userId === userId,
        isLastOwner:
          membership.role === "owner" &&
          isActiveMembership &&
          activeOwnerCount <= 1,
        canEditRole: isActiveMembership && manageability.canEditRole,
        canRemove: isActiveMembership && manageability.canRemove,
      };
    });

    return apiSuccess({
      workspace: {
        id: access.workspace._id,
        name: access.workspace.name,
      },
      currentUserMembership: {
        membershipId: access.membership._id,
        role: access.membership.role,
        status: access.membership.status,
      },
      permissions: {
        canInvite: canWorkspaceRole(access.membership.role, "workspace.invite"),
        canReadMembers: canWorkspaceRole(access.membership.role, "workspace.members.read"),
        canUpdateMembers: canWorkspaceRole(access.membership.role, "workspace.members.update"),
        canRemoveMembers: canWorkspaceRole(access.membership.role, "workspace.members.remove"),
      },
      members,
    });
  } catch (error) {
    return mapApiError(error, "Failed to load workspace members.");
  }
}
