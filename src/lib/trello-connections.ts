/**
 * Trello connection storage — one connection per workspace, following the
 * `meetingConnections` precedent (src/lib/meeting-connections.ts).
 *
 * Collection: `trelloConnections`. String UUID `_id`s. One connection per
 * workspaceId (unique index); reconnecting reactivates/updates the existing
 * doc instead of inserting a second one.
 *
 * Secrets: `token` is stored as-is on the doc, matching the
 * fathomConnections/meetingConnections plaintext precedent. The serializer
 * redacts it unless `includeSecrets` is passed — API responses must never
 * contain the token.
 */

import { randomUUID } from "crypto";
import type { Db } from "mongodb";

export type TrelloConnectionStatus = "active" | "revoked";

export interface TrelloConnectionDoc {
  _id: string;
  workspaceId: string;
  /** User who connected the integration. */
  userId: string;
  status: TrelloConnectionStatus;
  /** Trello member token, stored as-is (plaintext connection precedent). */
  token: string | null;
  /** Trello member the token belongs to (from /1/members/me at connect time). */
  memberId: string | null;
  memberUsername: string | null;
  memberFullName: string | null;
  createdAt: Date;
  updatedAt: Date;
  revokedAt?: Date | null;
}

const TRELLO_CONNECTIONS_COLLECTION = "trelloConnections";

const getTrelloConnectionsCollection = (db: Db) =>
  db.collection<TrelloConnectionDoc>(TRELLO_CONNECTIONS_COLLECTION);

let trelloConnectionIndexesPromise: Promise<void> | null = null;

export const ensureTrelloConnectionIndexes = async (db: Db) => {
  if (trelloConnectionIndexesPromise) {
    await trelloConnectionIndexesPromise;
    return;
  }

  trelloConnectionIndexesPromise = (async () => {
    const collection = getTrelloConnectionsCollection(db);
    if (!collection || typeof collection.createIndex !== "function") {
      return;
    }
    try {
      await collection.createIndex(
        { workspaceId: 1 },
        { unique: true, name: "trello_connections_workspace_unique" }
      );
    } catch (error) {
      console.warn("Failed to ensure trelloConnections indexes:", error);
    }
  })();

  await trelloConnectionIndexesPromise;
};

export const findTrelloConnectionForWorkspace = async (
  db: Db,
  workspaceId: string
) => getTrelloConnectionsCollection(db).findOne({ workspaceId } as any);

/**
 * Create or reactivate the single connection for a workspace. Reconnecting
 * replaces the token/member info and flips status back to active.
 */
export const upsertTrelloConnection = async (
  db: Db,
  input: {
    workspaceId: string;
    userId: string;
    token: string;
    memberId?: string | null;
    memberUsername?: string | null;
    memberFullName?: string | null;
  }
): Promise<TrelloConnectionDoc> => {
  await ensureTrelloConnectionIndexes(db);
  const now = new Date();
  const existing = await findTrelloConnectionForWorkspace(db, input.workspaceId);

  if (existing) {
    const update: Partial<TrelloConnectionDoc> = {
      userId: input.userId,
      status: "active",
      token: input.token,
      memberId: input.memberId || null,
      memberUsername: input.memberUsername || null,
      memberFullName: input.memberFullName || null,
      revokedAt: null,
      updatedAt: now,
    };
    await getTrelloConnectionsCollection(db).updateOne(
      { _id: existing._id } as any,
      { $set: update }
    );
    return { ...existing, ...update } as TrelloConnectionDoc;
  }

  const connection: TrelloConnectionDoc = {
    _id: randomUUID(),
    workspaceId: input.workspaceId,
    userId: input.userId,
    status: "active",
    token: input.token,
    memberId: input.memberId || null,
    memberUsername: input.memberUsername || null,
    memberFullName: input.memberFullName || null,
    createdAt: now,
    updatedAt: now,
    revokedAt: null,
  };
  await getTrelloConnectionsCollection(db).insertOne(connection as any);
  return connection;
};

/**
 * Mark the workspace Trello connection as revoked (soft delete) and drop the
 * stored token so a revoked doc can never be used to call Trello.
 */
export const revokeTrelloConnection = async (
  db: Db,
  workspaceId: string
): Promise<TrelloConnectionDoc | null> => {
  const existing = await findTrelloConnectionForWorkspace(db, workspaceId);
  if (!existing) return null;
  const now = new Date();
  const update: Partial<TrelloConnectionDoc> = {
    status: "revoked",
    token: null,
    revokedAt: now,
    updatedAt: now,
  };
  await getTrelloConnectionsCollection(db).updateOne(
    { _id: existing._id } as any,
    { $set: update }
  );
  return { ...existing, ...update } as TrelloConnectionDoc;
};

const serializeDate = (value: Date | string | null | undefined) => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
};

/** Never returns the token unless includeSecrets is set. */
export const serializeTrelloConnection = (
  connection: TrelloConnectionDoc | null,
  options: { includeSecrets?: boolean } = {}
) => {
  if (!connection) return null;
  return {
    id: connection._id,
    workspaceId: connection.workspaceId,
    userId: connection.userId,
    status: connection.status,
    hasToken: Boolean(connection.token),
    memberId: connection.memberId || null,
    memberUsername: connection.memberUsername || null,
    memberFullName: connection.memberFullName || null,
    ...(options.includeSecrets ? { token: connection.token || null } : {}),
    createdAt: serializeDate(connection.createdAt),
    updatedAt: serializeDate(connection.updatedAt),
    revokedAt: serializeDate(connection.revokedAt),
  };
};
