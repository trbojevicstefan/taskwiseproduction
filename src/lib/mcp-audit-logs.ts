import { randomUUID } from "crypto";
import type { Db } from "mongodb";

export type McpAuditLogStatus = "success" | "error";
export type McpAuditActorType = "api_key" | "user";

export interface McpAuditLogDoc {
  _id: string;
  workspaceId: string;
  actorType: McpAuditActorType;
  actorUserId?: string | null;
  apiKeyId?: string | null;
  apiKeyName?: string | null;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  status: McpAuditLogStatus;
  message: string;
  metadata?: Record<string, unknown> | null;
  createdAt: Date;
  expiresAt: Date;
}

const MCP_AUDIT_LOGS_COLLECTION = "mcpAuditLogs";
const MCP_AUDIT_LOG_RETENTION_DAYS = Math.max(
  7,
  Number(process.env.MCP_AUDIT_LOG_RETENTION_DAYS || 90)
);

const buildExpiresAt = (createdAt: Date) =>
  new Date(createdAt.getTime() + MCP_AUDIT_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);

let indexesEnsured = false;
let indexesEnsuringPromise: Promise<void> | null = null;

const serializeDate = (value: Date | string | null | undefined) => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
};

export const ensureMcpAuditLogIndexes = async (db: Db) => {
  if (indexesEnsured) return;
  if (indexesEnsuringPromise) {
    await indexesEnsuringPromise;
    return;
  }

  indexesEnsuringPromise = (async () => {
    const collection = db.collection<McpAuditLogDoc>(MCP_AUDIT_LOGS_COLLECTION);
    await Promise.all([
      collection.createIndex({ workspaceId: 1, createdAt: -1 }),
      collection.createIndex({ apiKeyId: 1, createdAt: -1 }, { sparse: true }),
      collection.createIndex(
        { expiresAt: 1 },
        { expireAfterSeconds: 0, name: "mcp_audit_logs_expires_at_ttl" }
      ),
    ]);
    indexesEnsured = true;
  })().finally(() => {
    indexesEnsuringPromise = null;
  });

  await indexesEnsuringPromise;
};

export const logMcpAuditEvent = async (
  db: Db,
  input: {
    workspaceId: string;
    actorType: McpAuditActorType;
    actorUserId?: string | null;
    apiKeyId?: string | null;
    apiKeyName?: string | null;
    action: string;
    resourceType?: string | null;
    resourceId?: string | null;
    status: McpAuditLogStatus;
    message: string;
    metadata?: Record<string, unknown> | null;
  }
) => {
  await ensureMcpAuditLogIndexes(db);
  const createdAt = new Date();
  const doc: McpAuditLogDoc = {
    _id: randomUUID(),
    workspaceId: input.workspaceId,
    actorType: input.actorType,
    actorUserId: input.actorUserId || null,
    apiKeyId: input.apiKeyId || null,
    apiKeyName: input.apiKeyName || null,
    action: input.action,
    resourceType: input.resourceType || null,
    resourceId: input.resourceId || null,
    status: input.status,
    message: input.message,
    metadata: input.metadata || null,
    createdAt,
    expiresAt: buildExpiresAt(createdAt),
  };

  await db.collection<McpAuditLogDoc>(MCP_AUDIT_LOGS_COLLECTION).insertOne(doc);
  return doc;
};

export const listMcpAuditLogsForWorkspace = async (
  db: Db,
  workspaceId: string,
  limit = 50
) => {
  await ensureMcpAuditLogIndexes(db);
  const clampedLimit = Math.max(1, Math.min(200, Math.floor(limit || 50)));
  return db
    .collection<McpAuditLogDoc>(MCP_AUDIT_LOGS_COLLECTION)
    .find({ workspaceId })
    .sort({ createdAt: -1 })
    .limit(clampedLimit)
    .toArray();
};

export const serializeMcpAuditLog = (log: McpAuditLogDoc | null) => {
  if (!log) return null;
  return {
    id: log._id,
    workspaceId: log.workspaceId,
    actorType: log.actorType,
    actorUserId: log.actorUserId || null,
    apiKeyId: log.apiKeyId || null,
    apiKeyName: log.apiKeyName || null,
    action: log.action,
    resourceType: log.resourceType || null,
    resourceId: log.resourceId || null,
    status: log.status,
    message: log.message,
    metadata: log.metadata || null,
    createdAt: serializeDate(log.createdAt),
  };
};
