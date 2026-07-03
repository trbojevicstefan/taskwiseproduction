/**
 * Phase 7 — generic connection storage for adapter-based meeting providers
 * (Fireflies, Grain). Fathom keeps its legacy `fathomConnections` collection
 * (dual-write hazard — DO NOT migrate it here).
 *
 * Collection: `meetingConnections`. String UUID `_id`s. One connection per
 * (workspaceId, provider) — enforced by a unique index; reconnecting
 * reactivates/updates the existing doc instead of inserting a second one.
 *
 * Secrets: `apiKey` and `webhookSecret` are stored as-is on the doc, matching
 * the fathomConnections precedent (plaintext oauth tokens). The serializer
 * redacts them unless `includeSecrets` is passed, again matching
 * `serializeFathomConnection`. `webhookToken` is the routing key embedded in
 * the provider webhook URL (`/api/webhooks/[provider]?token=...`) — like
 * fathom's `webhook.webhookUrl` (which embeds its token) it is exposed by
 * default so users can configure the provider side.
 */

import { randomUUID } from "crypto";
import type { Db } from "mongodb";
import type { MeetingProviderId } from "@/lib/meeting-providers/types";

export type MeetingConnectionStatus = "active" | "revoked";

export interface MeetingConnectionDoc {
  _id: string;
  workspaceId: string;
  /** User who connected the integration; owns ingested meetings and jobs. */
  userId: string;
  provider: MeetingProviderId;
  status: MeetingConnectionStatus;
  /** Provider API key, stored as-is (fathomConnections plaintext precedent). */
  apiKey: string | null;
  /** Provider-side account label returned by validateCredentials. */
  accountName: string | null;
  /** Optional webhook signing secret; null follows the fathom "no secret => accept" precedent. */
  webhookSecret: string | null;
  /** Routing token for /api/webhooks/[provider]?token=<webhookToken>. */
  webhookToken: string | null;
  createdAt: Date;
  updatedAt: Date;
  revokedAt?: Date | null;
}

const MEETING_CONNECTIONS_COLLECTION = "meetingConnections";

const getMeetingConnectionsCollection = (db: Db) =>
  db.collection<MeetingConnectionDoc>(MEETING_CONNECTIONS_COLLECTION);

let meetingConnectionIndexesPromise: Promise<void> | null = null;

export const ensureMeetingConnectionIndexes = async (db: Db) => {
  if (meetingConnectionIndexesPromise) {
    await meetingConnectionIndexesPromise;
    return;
  }

  meetingConnectionIndexesPromise = (async () => {
    const collection = getMeetingConnectionsCollection(db);
    if (!collection || typeof collection.createIndex !== "function") {
      return;
    }
    try {
      await Promise.all([
        collection.createIndex(
          { workspaceId: 1, provider: 1 },
          { unique: true, name: "meeting_connections_workspace_provider_unique" }
        ),
        collection.createIndex(
          { webhookToken: 1 },
          {
            unique: true,
            sparse: true,
            name: "meeting_connections_webhook_token_unique",
            partialFilterExpression: { webhookToken: { $type: "string" } },
          }
        ),
        collection.createIndex(
          { provider: 1, status: 1 },
          { name: "meeting_connections_provider_status" }
        ),
      ]);
    } catch (error) {
      console.warn("Failed to ensure meetingConnections indexes:", error);
    }
  })();

  await meetingConnectionIndexesPromise;
};

export const findMeetingConnectionForWorkspace = async (
  db: Db,
  workspaceId: string,
  provider: MeetingProviderId
) =>
  getMeetingConnectionsCollection(db).findOne({ workspaceId, provider } as any);

export const findMeetingConnectionById = async (db: Db, connectionId: string) =>
  getMeetingConnectionsCollection(db).findOne({ _id: connectionId } as any);

export const findMeetingConnectionByWebhookToken = async (
  db: Db,
  provider: MeetingProviderId,
  token: string
) =>
  getMeetingConnectionsCollection(db).findOne({
    provider,
    webhookToken: token,
  } as any);

export const listActiveMeetingConnectionsForProvider = async (
  db: Db,
  provider: MeetingProviderId
) =>
  getMeetingConnectionsCollection(db)
    .find({ provider, status: "active" } as any)
    .sort({ updatedAt: -1, createdAt: -1 })
    .toArray();

export const listMeetingConnectionsForWorkspace = async (
  db: Db,
  workspaceId: string
) =>
  getMeetingConnectionsCollection(db)
    .find({ workspaceId } as any)
    .sort({ updatedAt: -1, createdAt: -1 })
    .toArray();

/**
 * Create or reactivate the single connection for (workspaceId, provider).
 * Reconnecting updates the apiKey/accountName, flips status back to active
 * and keeps the existing webhookToken so provider-side webhook URLs stay
 * valid.
 */
export const upsertMeetingConnection = async (
  db: Db,
  input: {
    workspaceId: string;
    userId: string;
    provider: MeetingProviderId;
    apiKey: string;
    accountName?: string | null;
    webhookSecret?: string | null;
  }
): Promise<MeetingConnectionDoc> => {
  await ensureMeetingConnectionIndexes(db);
  const now = new Date();
  const existing = await findMeetingConnectionForWorkspace(
    db,
    input.workspaceId,
    input.provider
  );

  if (existing) {
    const update: Partial<MeetingConnectionDoc> = {
      userId: input.userId,
      status: "active",
      apiKey: input.apiKey,
      accountName:
        input.accountName !== undefined
          ? input.accountName || null
          : existing.accountName || null,
      webhookSecret:
        input.webhookSecret !== undefined
          ? input.webhookSecret || null
          : existing.webhookSecret || null,
      webhookToken: existing.webhookToken || randomUUID(),
      revokedAt: null,
      updatedAt: now,
    };
    await getMeetingConnectionsCollection(db).updateOne(
      { _id: existing._id } as any,
      { $set: update }
    );
    return { ...existing, ...update } as MeetingConnectionDoc;
  }

  const connection: MeetingConnectionDoc = {
    _id: randomUUID(),
    workspaceId: input.workspaceId,
    userId: input.userId,
    provider: input.provider,
    status: "active",
    apiKey: input.apiKey,
    accountName: input.accountName || null,
    webhookSecret: input.webhookSecret || null,
    webhookToken: randomUUID(),
    createdAt: now,
    updatedAt: now,
    revokedAt: null,
  };
  await getMeetingConnectionsCollection(db).insertOne(connection as any);
  return connection;
};

/** Mark the workspace connection for a provider as revoked (soft delete). */
export const revokeMeetingConnection = async (
  db: Db,
  workspaceId: string,
  provider: MeetingProviderId
): Promise<MeetingConnectionDoc | null> => {
  const existing = await findMeetingConnectionForWorkspace(db, workspaceId, provider);
  if (!existing) return null;
  const now = new Date();
  await getMeetingConnectionsCollection(db).updateOne(
    { _id: existing._id } as any,
    { $set: { status: "revoked", revokedAt: now, updatedAt: now } }
  );
  return { ...existing, status: "revoked", revokedAt: now, updatedAt: now };
};

const serializeDate = (value: Date | string | null | undefined) => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
};

/** Never returns the apiKey/webhookSecret unless includeSecrets is set. */
export const serializeMeetingConnection = (
  connection: MeetingConnectionDoc | null,
  options: { includeSecrets?: boolean } = {}
) => {
  if (!connection) return null;
  return {
    id: connection._id,
    workspaceId: connection.workspaceId,
    userId: connection.userId,
    provider: connection.provider,
    status: connection.status,
    accountName: connection.accountName || null,
    hasApiKey: Boolean(connection.apiKey),
    hasWebhookSecret: Boolean(connection.webhookSecret),
    webhookToken: connection.webhookToken || null,
    ...(options.includeSecrets
      ? {
          apiKey: connection.apiKey || null,
          webhookSecret: connection.webhookSecret || null,
        }
      : {}),
    createdAt: serializeDate(connection.createdAt),
    updatedAt: serializeDate(connection.updatedAt),
    revokedAt: serializeDate(connection.revokedAt),
  };
};
