import { randomUUID } from "crypto";
import type { Db } from "mongodb";

export type WorkspaceInvitationStatus =
  | "pending"
  | "accepted"
  | "revoked"
  | "expired";

export interface WorkspaceInvitationDoc {
  _id: string;
  workspaceId: string;
  workspaceName: string;
  inviterUserId: string;
  inviterEmail: string | null;
  invitedEmail: string | null;
  status: WorkspaceInvitationStatus;
  createdAt: Date;
  expiresAt: Date;
  acceptedAt?: Date | null;
  acceptedByUserId?: string | null;
  revokedAt?: Date | null;
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
    expiresAt: Date;
  }
) => {
  const now = new Date();
  const invitation: WorkspaceInvitationDoc = {
    _id: randomUUID(),
    workspaceId: input.workspaceId,
    workspaceName: input.workspaceName,
    inviterUserId: input.inviterUserId,
    inviterEmail: normalizeInviteEmail(input.inviterEmail),
    invitedEmail: normalizeInviteEmail(input.invitedEmail),
    status: "pending",
    createdAt: now,
    expiresAt: input.expiresAt,
    acceptedAt: null,
    acceptedByUserId: null,
    revokedAt: null,
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
  acceptedByUserId: string
) =>
  db.collection<WorkspaceInvitationDoc>(WORKSPACE_INVITATIONS_COLLECTION).updateOne(
    { _id: token, status: "pending" },
    {
      $set: {
        status: "accepted",
        acceptedAt: new Date(),
        acceptedByUserId,
      },
    }
  );

