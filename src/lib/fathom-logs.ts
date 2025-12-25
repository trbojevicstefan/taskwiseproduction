import { getDb } from "@/lib/db";
import { buildIdQuery } from "@/lib/mongo-id";

export type FathomLogLevel = "info" | "warn" | "error";

export interface FathomIntegrationLog {
  id?: string;
  userId: string;
  level: FathomLogLevel;
  event: string;
  message: string;
  metadata?: Record<string, unknown> | null;
  createdAt: Date;
}

const COLLECTION = "fathomIntegrationLogs";

export const logFathomIntegration = async (
  userId: string,
  level: FathomLogLevel,
  event: string,
  message: string,
  metadata?: Record<string, unknown> | null
) => {
  try {
    const db = await getDb();
    const entry: FathomIntegrationLog = {
      userId,
      level,
      event,
      message,
      metadata: metadata || null,
      createdAt: new Date(),
    };
    await db.collection<FathomIntegrationLog>(COLLECTION).insertOne(entry);
  } catch (error) {
    console.error("Failed to persist Fathom integration log:", error);
  }
};

export const getFathomIntegrationLogs = async (userId: string, limit = 200) => {
  const db = await getDb();
  const userIdQuery = buildIdQuery(userId);
  return db
    .collection<FathomIntegrationLog>(COLLECTION)
    .find({ userId: userIdQuery })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
};
