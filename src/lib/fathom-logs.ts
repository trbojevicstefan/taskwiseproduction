import { getDb } from "@/lib/db";

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
    await db.collection(COLLECTION).insertOne(entry);
  } catch (error) {
    console.error("Failed to persist Fathom integration log:", error);
  }
};

export const getFathomIntegrationLogs = async (userId: string, limit = 200) => {
  const db = await getDb();
  return db
    .collection(COLLECTION)
    .find({ userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
};

