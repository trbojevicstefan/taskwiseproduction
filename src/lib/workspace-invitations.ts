import { randomUUID } from "crypto";
import type { Db } from "mongodb";
import type { WorkspaceRole } from "@/lib/workspace-roles";

export type WorkspaceInvitationStatus =
  | "pending"
  | "accepted"
  | "revoked"
  | "expired";

export interface WorkspaceInvitationDoc {
  _id: string;
  workspaceId: string;
  workspaceName: string;
  role?: Extract<WorkspaceRole, "admin" | "member">;
  inviterUserId: string;
  inviterEmail: string | null;
  invitedEmail: string | null;
  status: WorkspaceInvitationStatus;
  createdAt: Date;
  expiresAt: Date;
  acceptedAt?: Date | null;
  acceptedByUserId?: string | null;
  acceptedMembershipId?: string | null;
  revokedAt?: Date | null;
  revokedByUserId?: string | null;
  tokenHash?: string | null;
}

const WORKSPACE_INVITATIONS_COLLECTION = "workspaceInvitations";

export const normalizeInviteEmail = (email?: string | null) => {
  if (!email) return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed || null;
};

export const isWorkspaceInvitationExpired = (
  invitation: Pick<WorkspaceInvitationDoc, "expiresAt">
) => {
  const expiresAt =
    invitation.expiresAt instanceof Date
      ? invitation.expiresAt
      : new Date(invitation.expiresAt as any);
  return Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now();
};

export const ensureWorkspaceInvitationIndexes = async (db: Db) => {
  const collection = db.collection<WorkspaceInvitationDoc>(
    WORKSPACE_INVITATIONS_COLLECTION
  );
  await Promise.all([
    collection.createIndex({ workspaceId: 1, status: 1, createdAt: -1 }),
    collection.createIndex({ invitedEmail: 1, status: 1, createdAt: -1 }),
    collection.createIndex({ workspaceId: 1, invitedEmail: 1, status: 1 }),
    collection.createIndex({ inviterUserId: 1, createdAt: -1 }),
    collection.createIndex({ expiresAt: 1 }),
  ]);
};

export const createWorkspaceInvitation = async (
  db: Db,
  input: {
    workspaceId: string;
    workspaceName: string;
    inviterUserId: string;
    inviterEmail?: string | null;
    invitedEmail?: string | null;
    role?: Extract<WorkspaceRole, "admin" | "member">;
    expiresAt: Date;
  }
) => {
  const now = new Date();
  const invitation: WorkspaceInvitationDoc = {
    _id: randomUUID(),
    workspaceId: input.workspaceId,
    workspaceName: input.workspaceName,
    role: input.role || "member",
    inviterUserId: input.inviterUserId,
    inviterEmail: normalizeInviteEmail(input.inviterEmail),
    invitedEmail: normalizeInviteEmail(input.invitedEmail),
    status: "pending",
    createdAt: now,
    expiresAt: input.expiresAt,
    acceptedAt: null,
    acceptedByUserId: null,
    acceptedMembershipId: null,
    revokedAt: null,
    revokedByUserId: null,
    tokenHash: null,
  };

  await db
    .collection<WorkspaceInvitationDoc>(WORKSPACE_INVITATIONS_COLLECTION)
    .insertOne(invitation);
  return invitation;
};

export const findWorkspaceInvitationByToken = async (db: Db, token: string) =>
  db
    .collection<WorkspaceInvitationDoc>(WORKSPACE_INVITATIONS_COLLECTION)
    .findOne({ _id: token });

export const listWorkspaceInvitations = async (
  db: Db,
  workspaceId: string,
  options?: { status?: WorkspaceInvitationStatus | WorkspaceInvitationStatus[] }
) => {
  const statusFilter = Array.isArray(options?.status)
    ? { $in: options?.status }
    : options?.status;
  return db
    .collection<WorkspaceInvitationDoc>(WORKSPACE_INVITATIONS_COLLECTION)
    .find({
      workspaceId,
      ...(statusFilter ? { status: statusFilter } : {}),
    })
    .sort({ createdAt: -1 })
    .toArray();
};

export const markWorkspaceInvitationExpired = async (db: Db, token: string) =>
  db.collection<WorkspaceInvitationDoc>(WORKSPACE_INVITATIONS_COLLECTION).updateOne(
    { _id: token, status: "pending" },
    {
      $set: {
        status: "expired",
        revokedAt: new Date(),
      },
    }
  );

export const markWorkspaceInvitationAccepted = async (
  db: Db,
  token: string,
  acceptedByUserId: string,
  options?: { acceptedMembershipId?: string | null }
) =>
  db.collection<WorkspaceInvitationDoc>(WORKSPACE_INVITATIONS_COLLECTION).updateOne(
    { _id: token, status: "pending" },
    {
      $set: {
        status: "accepted",
        acceptedAt: new Date(),
        acceptedByUserId,
        ...(options?.acceptedMembershipId !== undefined
          ? { acceptedMembershipId: options.acceptedMembershipId }
          : {}),
      },
    }
  );

export const revokeWorkspaceInvitation = async (
  db: Db,
  token: string,
  revokedByUserId: string
) =>
  db.collection<WorkspaceInvitationDoc>(WORKSPACE_INVITATIONS_COLLECTION).updateOne(
    { _id: token, status: "pending" },
    {
      $set: {
        status: "revoked",
        revokedAt: new Date(),
        revokedByUserId,
      },
    }
  );
