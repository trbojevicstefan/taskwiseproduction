import type { Db, ObjectId } from "mongodb";
import type { FathomConnectionDoc } from "../src/lib/fathom-connections";

export const ensureWebhookBurstLookupIndex = async (db: Db) =>
  db.collection("fathomConnections").createIndex(
    { "webhook.token": 1 },
    {
      unique: true,
      partialFilterExpression: { "webhook.token": { $type: "string" } },
    }
  );

export const buildWebhookBurstFixture = (input: {
  userId: ObjectId;
  workspaceId: string;
  connectionId: string;
  webhookToken: string;
  now?: Date;
}) => {
  const now = input.now ?? new Date();
  const userId = input.userId.toString();
  const user = {
    _id: input.userId,
    email: `burst+${input.connectionId}@example.com`,
    name: "Webhook Burst Probe",
    passwordHash: "not-used",
    avatarUrl: null,
    sourceSessionIds: [],
    createdAt: now,
    lastUpdated: now,
    lastSeenAt: now,
    onboardingCompleted: true,
    workspace: { id: input.workspaceId, name: "Burst Workspace" },
    firefliesWebhookToken: null,
    fathomWebhookToken: input.webhookToken,
    fathomConnected: true,
  };
  const connection: FathomConnectionDoc = {
    _id: input.connectionId,
    workspaceId: input.workspaceId,
    provider: "fathom",
    label: "Webhook Burst Probe",
    status: "active",
    createdByUserId: userId,
    updatedByUserId: userId,
    legacyUserId: userId,
    oauth: {
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
      scope: null,
      stateId: null,
      connectedAt: now,
      lastRefreshedAt: null,
      lastError: null,
    },
    webhook: {
      token: input.webhookToken,
      secret: null,
      status: "active",
      webhookId: null,
      webhookUrl: null,
      webhookEvent: "new-meeting-content-ready",
      managedWebhooks: [],
      lastSyncedAt: now,
      lastError: null,
    },
    source: {
      providerUserId: null,
      providerAccountId: null,
      providerSourceIds: [],
    },
    sync: {
      lastAttemptedAt: null,
      lastSucceededAt: null,
      lastError: null,
    },
    migration: null,
    createdAt: now,
    updatedAt: now,
    revokedAt: null,
  };
  return { user, connection };
};
