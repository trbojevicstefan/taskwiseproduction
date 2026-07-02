import { randomUUID } from "crypto";
import type { Db } from "mongodb";
import { getDb } from "@/lib/db";

export type GoogleIntegrationLogLevel = "info" | "warn" | "error";

export interface GoogleIntegrationLogDoc {
  _id: string;
  workspaceId: string;
  userId: string | null;
  actorUserId: string | null;
  level: GoogleIntegrationLogLevel;
  event: string;
  message: string;
  metadata?: Record<string, unknown> | null;
  createdAt: Date;
  expiresAt: Date;
}

const COLLECTION = "googleIntegrationLogs";
const LOG_RETENTION_DAYS = Math.max(
  1,
  Number(process.env.GOOGLE_INTEGRATION_LOG_RETENTION_DAYS || 30)
);

let indexesEnsured = false;
let indexesEnsuring: Promise<void> | null = null;

const resolveExpiry = (createdAt: Date) =>
  new Date(createdAt.getTime() + LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);

export const ensureGoogleIntegrationLogIndexes = async (db: Db) => {
  if (indexesEnsured) return;
  if (indexesEnsuring) {
    await indexesEnsuring;
    return;
  }

  indexesEnsuring = (async () => {
    const collection = db.collection<GoogleIntegrationLogDoc>(COLLECTION);
    await Promise.all([
      collection.createIndex({ workspaceId: 1, createdAt: -1 }),
      collection.createIndex({ workspaceId: 1, event: 1, createdAt: -1 }),
      collection.createIndex({ userId: 1, createdAt: -1 }),
      collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    ]);
    indexesEnsured = true;
  })().finally(() => {
    indexesEnsuring = null;
  });

  await indexesEnsuring;
};

export const logGoogleIntegration = async (input: {
  workspaceId: string | null | undefined;
  userId?: string | null;
  actorUserId?: string | null;
  level: GoogleIntegrationLogLevel;
  event: string;
  message: string;
  metadata?: Record<string, unknown> | null;
}) => {
  const workspaceId = typeof input.workspaceId === "string" ? input.workspaceId.trim() : "";
  if (!workspaceId) {
    return;
  }

  try {
    const db = (await getDb()) as Db;
    await ensureGoogleIntegrationLogIndexes(db);
    const createdAt = new Date();
    const doc: GoogleIntegrationLogDoc = {
      _id: randomUUID(),
      workspaceId,
      userId: input.userId || null,
      actorUserId: input.actorUserId || null,
      level: input.level,
      event: input.event,
      message: input.message,
      metadata: input.metadata || null,
      createdAt,
      expiresAt: resolveExpiry(createdAt),
    };
    await db.collection<GoogleIntegrationLogDoc>(COLLECTION).insertOne(doc);
  } catch (error) {
    console.error("Failed to persist Google integration log:", error);
  }
};

export const listGoogleIntegrationLogsForWorkspace = async (
  db: Db,
  workspaceId: string,
  limit = 100
) => {
  await ensureGoogleIntegrationLogIndexes(db);
  const safeLimit = Math.max(1, Math.min(200, Math.trunc(limit) || 100));
  return db
    .collection<GoogleIntegrationLogDoc>(COLLECTION)
    .find({ workspaceId })
    .sort({ createdAt: -1 })
    .limit(safeLimit)
    .toArray();
};

export const serializeGoogleIntegrationLog = (
  log: GoogleIntegrationLogDoc | null | undefined
) => {
  if (!log) return null;
  return {
    id: log._id,
    workspaceId: log.workspaceId,
    userId: log.userId || null,
    actorUserId: log.actorUserId || null,
    level: log.level,
    event: log.event,
    message: log.message,
    metadata: log.metadata || null,
    createdAt: log.createdAt?.toISOString?.() || null,
  };
};
