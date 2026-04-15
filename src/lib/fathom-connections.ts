import { randomUUID } from "crypto";
import type { Db } from "mongodb";
import { serializeError } from "@/lib/observability";
import { findWorkspaceById } from "@/lib/workspaces";

export type FathomConnectionStatus = "pending" | "active" | "error" | "revoked";
export type FathomConnectionWebhookStatus =
  | "not_configured"
  | "active"
  | "error"
  | "revoked";

export interface FathomManagedWebhookDoc {
  id?: string | null;
  url?: string | null;
  createdAt?: Date | string | null;
  includeTranscript?: boolean | null;
  includeSummary?: boolean | null;
  includeActionItems?: boolean | null;
  includeCrmMatches?: boolean | null;
  triggeredFor?: string[] | null;
}

export interface FathomConnectionDoc {
  _id: string;
  workspaceId: string;
  provider: "fathom";
  label: string;
  status: FathomConnectionStatus;
  createdByUserId: string;
  updatedByUserId: string;
  legacyUserId?: string | null;
  oauth: {
    accessToken?: string | null;
    refreshToken?: string | null;
    expiresAt?: number | null;
    scope?: string | null;
    stateId?: string | null;
    connectedAt?: Date | null;
    lastRefreshedAt?: Date | null;
    lastError?: ReturnType<typeof serializeError> | null;
  };
  webhook: {
    token?: string | null;
    secret?: string | null;
    status: FathomConnectionWebhookStatus;
    webhookId?: string | null;
    webhookUrl?: string | null;
    webhookEvent?: string | null;
    managedWebhooks?: FathomManagedWebhookDoc[] | null;
    lastSyncedAt?: Date | null;
    lastError?: ReturnType<typeof serializeError> | null;
  };
  source: {
    providerUserId?: string | null;
    providerAccountId?: string | null;
    providerSourceIds?: string[] | null;
  };
  sync: {
    lastAttemptedAt?: Date | null;
    lastSucceededAt?: Date | null;
    lastError?: ReturnType<typeof serializeError> | null;
  };
  migration?: {
    migratedFromInstallationId?: string | null;
    dualReadUserId?: string | null;
  } | null;
  createdAt: Date;
  updatedAt: Date;
  revokedAt?: Date | null;
}

export interface FathomConnectionOAuthStateDoc {
  _id: string;
  workspaceId: string;
  userId: string;
  connectionId?: string | null;
  label?: string | null;
  createdAt: Date;
  expiresAt: Date;
}

const FATHOM_CONNECTIONS_COLLECTION = "fathomConnections";
const FATHOM_CONNECTION_OAUTH_STATES_COLLECTION = "fathomConnectionOauthStates";
const OAUTH_STATE_TTL_MINUTES = Math.max(
  5,
  Number(process.env.FATHOM_OAUTH_STATE_TTL_MINUTES || 30)
);

const serializeDate = (value: Date | string | null | undefined) => {
  if (!value) return null;
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
};

const serializeManagedWebhook = (webhook: FathomManagedWebhookDoc) => ({
  id: webhook.id || null,
  url: webhook.url || null,
  createdAt: serializeDate(webhook.createdAt),
  includeTranscript:
    typeof webhook.includeTranscript === "boolean" ? webhook.includeTranscript : null,
  includeSummary:
    typeof webhook.includeSummary === "boolean" ? webhook.includeSummary : null,
  includeActionItems:
    typeof webhook.includeActionItems === "boolean" ? webhook.includeActionItems : null,
  includeCrmMatches:
    typeof webhook.includeCrmMatches === "boolean" ? webhook.includeCrmMatches : null,
  triggeredFor: Array.isArray(webhook.triggeredFor) ? webhook.triggeredFor : null,
});

export const ensureFathomConnectionIndexes = async (db: Db) => {
  const connections = db.collection<FathomConnectionDoc>(FATHOM_CONNECTIONS_COLLECTION);
  const oauthStates = db.collection<FathomConnectionOAuthStateDoc>(
    FATHOM_CONNECTION_OAUTH_STATES_COLLECTION
  );

  await Promise.all([
    connections.createIndex({ workspaceId: 1, updatedAt: -1 }),
    connections.createIndex(
      { workspaceId: 1, label: 1 },
      { unique: true, name: "fathom_connections_workspace_label_unique" }
    ),
    connections.createIndex(
      { "webhook.token": 1 },
      {
        unique: true,
        sparse: true,
        partialFilterExpression: { "webhook.token": { $type: "string" } },
      }
    ),
    connections.createIndex(
      { "webhook.webhookId": 1 },
      {
        sparse: true,
        partialFilterExpression: { "webhook.webhookId": { $type: "string" } },
      }
    ),
    connections.createIndex(
      { "source.providerUserId": 1, workspaceId: 1 },
      {
        sparse: true,
        partialFilterExpression: { "source.providerUserId": { $type: "string" } },
      }
    ),
    connections.createIndex({ legacyUserId: 1, workspaceId: 1 }, { sparse: true }),
    oauthStates.createIndex({ workspaceId: 1, userId: 1, createdAt: -1 }),
    oauthStates.createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0, name: "fathom_connection_oauth_states_ttl" }
    ),
  ]);
};

export const createFathomConnection = async (
  db: Db,
  input: {
    workspaceId: string;
    label: string;
    createdByUserId: string;
    updatedByUserId?: string;
    status?: FathomConnectionStatus;
    legacyUserId?: string | null;
    oauth?: Partial<FathomConnectionDoc["oauth"]>;
    webhook?: Partial<FathomConnectionDoc["webhook"]>;
    source?: Partial<FathomConnectionDoc["source"]>;
    sync?: Partial<FathomConnectionDoc["sync"]>;
    migration?: FathomConnectionDoc["migration"];
    revokedAt?: Date | null;
    id?: string;
  }
) => {
  const now = new Date();
  const connection: FathomConnectionDoc = {
    _id: input.id || randomUUID(),
    workspaceId: input.workspaceId,
    provider: "fathom",
    label: input.label.trim(),
    status: input.status || "pending",
    createdByUserId: input.createdByUserId,
    updatedByUserId: input.updatedByUserId || input.createdByUserId,
    legacyUserId: input.legacyUserId || null,
    oauth: {
      accessToken: input.oauth?.accessToken || null,
      refreshToken: input.oauth?.refreshToken || null,
      expiresAt:
        typeof input.oauth?.expiresAt === "number" ? input.oauth.expiresAt : null,
      scope: input.oauth?.scope || null,
      stateId: input.oauth?.stateId || null,
      connectedAt: input.oauth?.connectedAt || null,
      lastRefreshedAt: input.oauth?.lastRefreshedAt || null,
      lastError: input.oauth?.lastError || null,
    },
    webhook: {
      token: input.webhook?.token || null,
      secret: input.webhook?.secret || null,
      status: input.webhook?.status || "not_configured",
      webhookId: input.webhook?.webhookId || null,
      webhookUrl: input.webhook?.webhookUrl || null,
      webhookEvent: input.webhook?.webhookEvent || null,
      managedWebhooks: input.webhook?.managedWebhooks || [],
      lastSyncedAt: input.webhook?.lastSyncedAt || null,
      lastError: input.webhook?.lastError || null,
    },
    source: {
      providerUserId: input.source?.providerUserId || null,
      providerAccountId: input.source?.providerAccountId || null,
      providerSourceIds: input.source?.providerSourceIds || [],
    },
    sync: {
      lastAttemptedAt: input.sync?.lastAttemptedAt || null,
      lastSucceededAt: input.sync?.lastSucceededAt || null,
      lastError: input.sync?.lastError || null,
    },
    migration: input.migration || null,
    createdAt: now,
    updatedAt: now,
    revokedAt: input.revokedAt || null,
  };

  await db.collection<FathomConnectionDoc>(FATHOM_CONNECTIONS_COLLECTION).insertOne(connection);
  return connection;
};

export const findFathomConnectionById = async (db: Db, connectionId: string) =>
  db.collection<FathomConnectionDoc>(FATHOM_CONNECTIONS_COLLECTION).findOne({
    _id: connectionId,
  });

export const findFathomConnectionByWebhookToken = async (db: Db, token: string) =>
  db.collection<FathomConnectionDoc>(FATHOM_CONNECTIONS_COLLECTION).findOne({
    "webhook.token": token,
  });

export const findFathomConnectionByLegacyUserId = async (db: Db, userId: string) =>
  db.collection<FathomConnectionDoc>(FATHOM_CONNECTIONS_COLLECTION).findOne({
    legacyUserId: userId,
  });

export const listFathomConnectionsForWorkspace = async (
  db: Db,
  workspaceId: string
) =>
  db
    .collection<FathomConnectionDoc>(FATHOM_CONNECTIONS_COLLECTION)
    .find({ workspaceId })
    .sort({ updatedAt: -1, createdAt: -1 })
    .toArray();

export const listActiveFathomConnectionsForWorkspace = async (
  db: Db,
  workspaceId: string
) =>
  db
    .collection<FathomConnectionDoc>(FATHOM_CONNECTIONS_COLLECTION)
    .find({ workspaceId, status: "active" })
    .sort({ updatedAt: -1, createdAt: -1 })
    .toArray();

export const countFathomConnectionsForWorkspace = async (
  db: Db,
  workspaceId: string,
  options: { status?: FathomConnectionStatus } = {}
) =>
  db.collection<FathomConnectionDoc>(FATHOM_CONNECTIONS_COLLECTION).countDocuments({
    workspaceId,
    ...(options.status ? { status: options.status } : {}),
  });

export const findPreferredFathomConnectionForWorkspace = async (
  db: Db,
  workspaceId: string,
  userId?: string | null
) => {
  const connections = await listFathomConnectionsForWorkspace(db, workspaceId);
  if (!connections.length) {
    return null;
  }

  const activeConnections = connections.filter((connection) => connection.status === "active");
  const workspace = await findWorkspaceById(db as any, workspaceId);
  const preferredConnectionId =
    workspace?.settings?.integrations?.preferredFathomConnectionId || null;
  if (preferredConnectionId) {
    const preferredActiveConnection = activeConnections.find(
      (connection) => connection._id === preferredConnectionId
    );
    if (preferredActiveConnection) {
      return preferredActiveConnection;
    }

    const preferredConnection = connections.find(
      (connection) => connection._id === preferredConnectionId
    );
    if (preferredConnection) {
      return preferredConnection;
    }
  }

  const activeOwnedByUser =
    userId && activeConnections.find((connection) => connection.createdByUserId === userId);
  if (activeOwnedByUser) {
    return activeOwnedByUser;
  }

  if (activeConnections.length) {
    return activeConnections[0];
  }

  const ownedByUser = userId
    ? connections.find((connection) => connection.createdByUserId === userId)
    : null;
  return ownedByUser || connections[0];
};

export const updateFathomConnectionById = async (
  db: Db,
  connectionId: string,
  update: Partial<
    Omit<FathomConnectionDoc, "_id" | "workspaceId" | "provider" | "createdAt">
  >
) => {
  await db.collection<FathomConnectionDoc>(FATHOM_CONNECTIONS_COLLECTION).updateOne(
    { _id: connectionId },
    {
      $set: {
        ...update,
        updatedAt: new Date(),
      },
    }
  );

  return findFathomConnectionById(db, connectionId);
};

export const revokeFathomConnectionById = async (
  db: Db,
  connectionId: string,
  updatedByUserId: string
) =>
  updateFathomConnectionById(db, connectionId, {
    status: "revoked",
    revokedAt: new Date(),
    updatedByUserId,
  });

export const createFathomConnectionOAuthState = async (
  db: Db,
  input: {
    workspaceId: string;
    userId: string;
    connectionId?: string | null;
    label?: string | null;
    ttlMinutes?: number;
    id?: string;
  }
) => {
  const now = new Date();
  const ttlMinutes = Math.max(5, input.ttlMinutes || OAUTH_STATE_TTL_MINUTES);
  const state: FathomConnectionOAuthStateDoc = {
    _id: input.id || randomUUID(),
    workspaceId: input.workspaceId,
    userId: input.userId,
    connectionId: input.connectionId || null,
    label: input.label || null,
    createdAt: now,
    expiresAt: new Date(now.getTime() + ttlMinutes * 60 * 1000),
  };

  await db
    .collection<FathomConnectionOAuthStateDoc>(FATHOM_CONNECTION_OAUTH_STATES_COLLECTION)
    .insertOne(state);

  return state;
};

export const consumeFathomConnectionOAuthState = async (
  db: Db,
  stateId: string
) => {
  const state = await db
    .collection<FathomConnectionOAuthStateDoc>(FATHOM_CONNECTION_OAUTH_STATES_COLLECTION)
    .findOne({ _id: stateId });

  if (!state) {
    return null;
  }

  await db
    .collection<FathomConnectionOAuthStateDoc>(FATHOM_CONNECTION_OAUTH_STATES_COLLECTION)
    .deleteOne({ _id: stateId });

  return state;
};

export const serializeFathomConnection = (
  connection: FathomConnectionDoc | null,
  options: { includeSecrets?: boolean } = {}
) => {
  if (!connection) return null;

  return {
    id: connection._id,
    workspaceId: connection.workspaceId,
    provider: connection.provider,
    label: connection.label,
    status: connection.status,
    createdByUserId: connection.createdByUserId,
    updatedByUserId: connection.updatedByUserId,
    legacyUserId: connection.legacyUserId || null,
    oauth: {
      ...(options.includeSecrets
        ? {
            accessToken: connection.oauth.accessToken || null,
            refreshToken: connection.oauth.refreshToken || null,
          }
        : {}),
      expiresAt:
        typeof connection.oauth.expiresAt === "number"
          ? connection.oauth.expiresAt
          : null,
      scope: connection.oauth.scope || null,
      stateId: connection.oauth.stateId || null,
      connectedAt: serializeDate(connection.oauth.connectedAt),
      lastRefreshedAt: serializeDate(connection.oauth.lastRefreshedAt),
      lastError: connection.oauth.lastError || null,
    },
    webhook: {
      ...(options.includeSecrets
        ? {
            token: connection.webhook.token || null,
            secret: connection.webhook.secret || null,
          }
        : {}),
      status: connection.webhook.status,
      webhookId: connection.webhook.webhookId || null,
      webhookUrl: connection.webhook.webhookUrl || null,
      webhookEvent: connection.webhook.webhookEvent || null,
      managedWebhooks: Array.isArray(connection.webhook.managedWebhooks)
        ? connection.webhook.managedWebhooks.map(serializeManagedWebhook)
        : [],
      lastSyncedAt: serializeDate(connection.webhook.lastSyncedAt),
      lastError: connection.webhook.lastError || null,
    },
    source: {
      providerUserId: connection.source.providerUserId || null,
      providerAccountId: connection.source.providerAccountId || null,
      providerSourceIds: Array.isArray(connection.source.providerSourceIds)
        ? connection.source.providerSourceIds
        : [],
    },
    sync: {
      lastAttemptedAt: serializeDate(connection.sync.lastAttemptedAt),
      lastSucceededAt: serializeDate(connection.sync.lastSucceededAt),
      lastError: connection.sync.lastError || null,
    },
    migration: connection.migration || null,
    createdAt: connection.createdAt.toISOString(),
    updatedAt: connection.updatedAt.toISOString(),
    revokedAt: serializeDate(connection.revokedAt),
  };
};

export const serializeFathomConnectionOAuthState = (
  state: FathomConnectionOAuthStateDoc | null
) => {
  if (!state) return null;
  return {
    id: state._id,
    workspaceId: state.workspaceId,
    userId: state.userId,
    connectionId: state.connectionId || null,
    label: state.label || null,
    createdAt: state.createdAt.toISOString(),
    expiresAt: state.expiresAt.toISOString(),
  };
};
