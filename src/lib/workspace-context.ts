import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { ApiRouteError } from "@/lib/api-route";
import {
  createWorkspaceMembership,
  findWorkspaceMembership,
  listWorkspaceMembershipsForUser as listMembershipsForUser,
  type WorkspaceMembershipDoc,
} from "@/lib/workspace-memberships";
import { assertWorkspaceAccess } from "@/lib/workspace-authz";
import { createWorkspace, findWorkspaceById } from "@/lib/workspaces";

type UserWorkspaceProjection = {
  _id?: ObjectId;
  id?: string;
  name?: string | null;
  email?: string | null;
  workspace?: { id?: string; name?: string } | null;
  activeWorkspaceId?: string | null;
};

const USERS_COLLECTION = "users";

const normalizeNullableString = (value: unknown) => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (value === null || value === undefined) {
    return null;
  }
  const coerced = String(value).trim();
  return coerced || null;
};

const buildUserLookupFilter = (userId: string) => {
  if (ObjectId.isValid(userId)) {
    return { $or: [{ _id: new ObjectId(userId) }, { id: userId }] };
  }
  return { id: userId };
};

const resolveWorkspaceIdFromUser = (user: UserWorkspaceProjection | null) => {
  if (!user) return null;
  const activeWorkspaceId = normalizeNullableString(user.activeWorkspaceId);
  if (activeWorkspaceId) {
    return activeWorkspaceId;
  }
  return normalizeNullableString(user.workspace?.id);
};

const getUserWorkspaceProjection = async (db: Db, userId: string) =>
  (db.collection(USERS_COLLECTION) as any).findOne(buildUserLookupFilter(userId), {
    projection: {
      _id: 1,
      id: 1,
      name: 1,
      email: 1,
      activeWorkspaceId: 1,
      workspace: 1,
    },
  }) as Promise<UserWorkspaceProjection | null>;

const buildDefaultWorkspaceName = (user: UserWorkspaceProjection) => {
  const workspaceName = normalizeNullableString(user.workspace?.name);
  if (workspaceName) {
    return workspaceName;
  }
  const displayName = normalizeNullableString(user.name);
  if (displayName) {
    return `${displayName}'s Workspace`;
  }
  const normalizedEmail = normalizeNullableString(user.email);
  const emailLocal = normalizedEmail?.split("@")[0]?.trim();
  if (emailLocal) {
    return `${emailLocal}'s Workspace`;
  }
  return "My Workspace";
};

export const getActiveWorkspaceIdForUser = async (db: Db, userId: string) => {
  const user = await getUserWorkspaceProjection(db, userId);
  return resolveWorkspaceIdFromUser(user);
};

export const getActiveWorkspaceForUser = async (db: Db, userId: string) => {
  const user = await getUserWorkspaceProjection(db, userId);
  const activeWorkspaceId = resolveWorkspaceIdFromUser(user);
  if (!activeWorkspaceId) {
    return null;
  }

  const workspace = await findWorkspaceById(db, activeWorkspaceId);
  if (workspace && workspace.status !== "deleted") {
    return { id: workspace._id, name: workspace.name };
  }

  if (user?.workspace?.id === activeWorkspaceId && user.workspace.name) {
    return { id: activeWorkspaceId, name: user.workspace.name };
  }

  return null;
};

export const listWorkspaceMembershipsForUser = async (
  db: Db,
  userId: string
): Promise<WorkspaceMembershipDoc[]> => listMembershipsForUser(db, userId);

export const setActiveWorkspaceForUser = async (
  db: Db,
  userId: string,
  workspaceId: string
) => {
  const { workspace } = await assertWorkspaceAccess(db, userId, workspaceId, "member");
  const result = await (db.collection(USERS_COLLECTION) as any).updateOne(
    buildUserLookupFilter(userId),
    {
      $set: {
        activeWorkspaceId: workspace._id,
        workspace: {
          id: workspace._id,
          name: workspace.name,
        },
        lastUpdated: new Date(),
      },
    }
  );

  if (!result?.matchedCount) {
    throw new ApiRouteError(404, "not_found", "User not found.");
  }

  return { id: workspace._id, name: workspace.name };
};

export const ensureWorkspaceBootstrapForUser = async (db: Db, userId: string) => {
  const user = await getUserWorkspaceProjection(db, userId);
  if (!user) {
    throw new ApiRouteError(404, "not_found", "User not found.");
  }

  const legacyWorkspaceId = normalizeNullableString(user.workspace?.id);
  if (!legacyWorkspaceId) {
    return null;
  }

  const workspaceName = buildDefaultWorkspaceName(user);
  let workspace = await findWorkspaceById(db, legacyWorkspaceId);
  if (!workspace) {
    workspace = await createWorkspace(db, {
      id: legacyWorkspaceId,
      name: workspaceName,
      createdByUserId: userId,
      status: "active",
    });
  }

  const membership = await findWorkspaceMembership(db, workspace._id, userId);
  if (!membership) {
    await createWorkspaceMembership(db, {
      workspaceId: workspace._id,
      userId,
      role: "owner",
      status: "active",
    });
  }

  const activeWorkspaceId = normalizeNullableString(user.activeWorkspaceId);
  const shouldSyncActiveWorkspaceId = !activeWorkspaceId;
  const shouldSyncWorkspaceSnapshot =
    shouldSyncActiveWorkspaceId || user.workspace?.name !== workspace.name;

  if (shouldSyncActiveWorkspaceId || shouldSyncWorkspaceSnapshot) {
    await (db.collection(USERS_COLLECTION) as any).updateOne(
      buildUserLookupFilter(userId),
      {
        $set: {
          ...(shouldSyncActiveWorkspaceId ? { activeWorkspaceId: workspace._id } : {}),
          workspace: {
            id: workspace._id,
            name: workspace.name,
          },
          lastUpdated: new Date(),
        },
      }
    );
  }

  return {
    id: workspace._id,
    name: workspace.name,
  };
};

export { assertWorkspaceAccess };
