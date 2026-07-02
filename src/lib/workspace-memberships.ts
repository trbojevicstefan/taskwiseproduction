import { randomUUID } from "crypto";
import type { Db } from "mongodb";
import type { WorkspaceRole } from "@/lib/workspace-roles";

export type WorkspaceMembershipStatus = "active" | "invited" | "suspended" | "left";

export interface WorkspaceMembershipDoc {
  _id: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  status: WorkspaceMembershipStatus;
  joinedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  invitedByUserId?: string | null;
}

const WORKSPACE_MEMBERSHIPS_COLLECTION = "workspaceMemberships";

export const ensureWorkspaceMembershipIndexes = async (db: Db) => {
  const collection = db.collection<WorkspaceMembershipDoc>(
    WORKSPACE_MEMBERSHIPS_COLLECTION
  );
  await Promise.all([
    collection.createIndex({ workspaceId: 1, userId: 1 }, { unique: true }),
    collection.createIndex({ userId: 1, status: 1, updatedAt: -1 }),
    collection.createIndex({ workspaceId: 1, status: 1, role: 1 }),
  ]);
};

export const createWorkspaceMembership = async (
  db: Db,
  input: {
    workspaceId: string;
    userId: string;
    role: WorkspaceRole;
    status?: WorkspaceMembershipStatus;
    invitedByUserId?: string | null;
    joinedAt?: Date | null;
    id?: string;
  }
) => {
  const now = new Date();
  const membership: WorkspaceMembershipDoc = {
    _id: input.id || randomUUID(),
    workspaceId: input.workspaceId,
    userId: input.userId,
    role: input.role,
    status: input.status || "active",
    joinedAt:
      input.joinedAt !== undefined
        ? input.joinedAt
        : input.status === "active" || !input.status
          ? now
          : null,
    createdAt: now,
    updatedAt: now,
    invitedByUserId: input.invitedByUserId || null,
  };

  await db
    .collection<WorkspaceMembershipDoc>(WORKSPACE_MEMBERSHIPS_COLLECTION)
    .insertOne(membership);
  return membership;
};

export const upsertWorkspaceMembership = async (
  db: Db,
  input: {
    workspaceId: string;
    userId: string;
    role: WorkspaceRole;
    status: WorkspaceMembershipStatus;
    invitedByUserId?: string | null;
    joinedAt?: Date | null;
  }
) => {
  const now = new Date();
  const joinedAt =
    input.joinedAt !== undefined
      ? input.joinedAt
      : input.status === "active"
        ? now
        : null;

  await db.collection<WorkspaceMembershipDoc>(WORKSPACE_MEMBERSHIPS_COLLECTION).updateOne(
    { workspaceId: input.workspaceId, userId: input.userId },
    {
      $set: {
        role: input.role,
        status: input.status,
        updatedAt: now,
        invitedByUserId: input.invitedByUserId || null,
        joinedAt,
      },
      $setOnInsert: {
        _id: randomUUID(),
        createdAt: now,
      },
    },
    { upsert: true }
  );

  return db.collection<WorkspaceMembershipDoc>(WORKSPACE_MEMBERSHIPS_COLLECTION).findOne({
    workspaceId: input.workspaceId,
    userId: input.userId,
  });
};

export const findWorkspaceMembership = async (
  db: Db,
  workspaceId: string,
  userId: string
) =>
  db.collection<WorkspaceMembershipDoc>(WORKSPACE_MEMBERSHIPS_COLLECTION).findOne({
    workspaceId,
    userId,
  });

export const findActiveWorkspaceMembership = async (
  db: Db,
  workspaceId: string,
  userId: string
) =>
  db.collection<WorkspaceMembershipDoc>(WORKSPACE_MEMBERSHIPS_COLLECTION).findOne({
    workspaceId,
    userId,
    status: "active",
  });

export const findWorkspaceMembershipById = async (db: Db, membershipId: string) =>
  db.collection<WorkspaceMembershipDoc>(WORKSPACE_MEMBERSHIPS_COLLECTION).findOne({
    _id: membershipId,
  });

export const listWorkspaceMembershipsForUser = async (db: Db, userId: string) =>
  db
    .collection<WorkspaceMembershipDoc>(WORKSPACE_MEMBERSHIPS_COLLECTION)
    .find({ userId })
    .sort({ updatedAt: -1 })
    .toArray();

export const listActiveWorkspaceMembershipsForUser = async (db: Db, userId: string) =>
  db
    .collection<WorkspaceMembershipDoc>(WORKSPACE_MEMBERSHIPS_COLLECTION)
    .find({ userId, status: "active" })
    .sort({ updatedAt: -1 })
    .toArray();

export const listWorkspaceMembershipsForWorkspace = async (
  db: Db,
  workspaceId: string
) =>
  db
    .collection<WorkspaceMembershipDoc>(WORKSPACE_MEMBERSHIPS_COLLECTION)
    .find({ workspaceId })
    .sort({ updatedAt: -1 })
    .toArray();

export const listActiveWorkspaceMembershipsForWorkspace = async (
  db: Db,
  workspaceId: string
) =>
  db
    .collection<WorkspaceMembershipDoc>(WORKSPACE_MEMBERSHIPS_COLLECTION)
    .find({ workspaceId, status: "active" })
    .sort({ updatedAt: -1 })
    .toArray();

export const countActiveWorkspaceOwners = async (db: Db, workspaceId: string) =>
  db
    .collection<WorkspaceMembershipDoc>(WORKSPACE_MEMBERSHIPS_COLLECTION)
    .countDocuments({ workspaceId, status: "active", role: "owner" });

export const countActiveWorkspaceMembershipsForUser = async (db: Db, userId: string) =>
  db
    .collection<WorkspaceMembershipDoc>(WORKSPACE_MEMBERSHIPS_COLLECTION)
    .countDocuments({ userId, status: "active" });

export const updateWorkspaceMembershipById = async (
  db: Db,
  membershipId: string,
  update: Partial<
    Omit<WorkspaceMembershipDoc, "_id" | "workspaceId" | "userId" | "createdAt">
  >
) =>
  db.collection<WorkspaceMembershipDoc>(WORKSPACE_MEMBERSHIPS_COLLECTION).updateOne(
    { _id: membershipId },
    {
      $set: {
        ...update,
        updatedAt: new Date(),
      },
    }
  );
