import { createHmac, randomBytes, randomUUID } from "crypto";
import type { Db } from "mongodb";

export type McpApiKeyStatus = "active" | "revoked";

export interface McpApiKeyDoc {
  _id: string;
  workspaceId: string;
  name: string;
  description?: string | null;
  keyPrefix: string;
  keyHash: string;
  scopes: string[];
  status: McpApiKeyStatus;
  expiresAt?: Date | null;
  lastUsedAt?: Date | null;
  createdByUserId: string;
  revokedByUserId?: string | null;
  revokedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const MCP_API_KEYS_COLLECTION = "mcpApiKeys";
const MCP_KEY_PREFIX = "twmcp";

const serializeDate = (value: Date | string | null | undefined) => {
  if (!value) return null;
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
};

const getMcpApiKeyPepper = () =>
  process.env.NEXTAUTH_SECRET || "taskwise-mcp-api-key-pepper";

export const hashMcpApiKey = (apiKey: string) =>
  createHmac("sha256", getMcpApiKeyPepper()).update(apiKey).digest("hex");

export const generateMcpApiKey = () =>
  `${MCP_KEY_PREFIX}_${randomBytes(24).toString("base64url")}`;

export const ensureMcpApiKeyIndexes = async (db: Db) => {
  const collection = db.collection<McpApiKeyDoc>(MCP_API_KEYS_COLLECTION);
  await Promise.all([
    collection.createIndex({ workspaceId: 1, status: 1, createdAt: -1 }),
    collection.createIndex({ keyHash: 1 }, { unique: true }),
    collection.createIndex({ workspaceId: 1, name: 1 }, { unique: true }),
    collection.createIndex({ expiresAt: 1 }, { sparse: true }),
  ]);
};

export const createMcpApiKey = async (
  db: Db,
  input: {
    workspaceId: string;
    name: string;
    description?: string | null;
    scopes?: string[];
    createdByUserId: string;
    expiresAt?: Date | null;
    apiKey?: string;
    id?: string;
  }
) => {
  const now = new Date();
  const apiKey = input.apiKey || generateMcpApiKey();
  const doc: McpApiKeyDoc = {
    _id: input.id || randomUUID(),
    workspaceId: input.workspaceId,
    name: input.name.trim(),
    description: input.description || null,
    keyPrefix: apiKey.slice(0, 12),
    keyHash: hashMcpApiKey(apiKey),
    scopes: input.scopes || [],
    status: "active",
    expiresAt: input.expiresAt || null,
    lastUsedAt: null,
    createdByUserId: input.createdByUserId,
    revokedByUserId: null,
    revokedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  await db.collection<McpApiKeyDoc>(MCP_API_KEYS_COLLECTION).insertOne(doc);
  return { apiKey, record: doc };
};

export const findMcpApiKeyById = async (db: Db, keyId: string) =>
  db.collection<McpApiKeyDoc>(MCP_API_KEYS_COLLECTION).findOne({
    _id: keyId,
  });

export const findActiveMcpApiKeyByToken = async (db: Db, apiKey: string) => {
  const now = new Date();
  return db.collection<McpApiKeyDoc>(MCP_API_KEYS_COLLECTION).findOne({
    keyHash: hashMcpApiKey(apiKey),
    status: "active",
    $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }, { expiresAt: { $exists: false } }],
  });
};

export const listMcpApiKeysForWorkspace = async (db: Db, workspaceId: string) =>
  db
    .collection<McpApiKeyDoc>(MCP_API_KEYS_COLLECTION)
    .find({ workspaceId })
    .sort({ createdAt: -1 })
    .toArray();

export const touchMcpApiKeyUsage = async (db: Db, keyId: string) => {
  const now = new Date();
  await db.collection<McpApiKeyDoc>(MCP_API_KEYS_COLLECTION).updateOne(
    { _id: keyId },
    {
      $set: {
        lastUsedAt: now,
        updatedAt: now,
      },
    }
  );

  return findMcpApiKeyById(db, keyId);
};

export const revokeMcpApiKeyById = async (
  db: Db,
  keyId: string,
  revokedByUserId: string
) => {
  const now = new Date();
  await db.collection<McpApiKeyDoc>(MCP_API_KEYS_COLLECTION).updateOne(
    { _id: keyId },
    {
      $set: {
        status: "revoked",
        revokedByUserId,
        revokedAt: now,
        updatedAt: now,
      },
    }
  );

  return findMcpApiKeyById(db, keyId);
};

export const serializeMcpApiKey = (key: McpApiKeyDoc | null) => {
  if (!key) return null;

  return {
    id: key._id,
    workspaceId: key.workspaceId,
    name: key.name,
    description: key.description || null,
    keyPrefix: key.keyPrefix,
    scopes: key.scopes,
    status: key.status,
    expiresAt: serializeDate(key.expiresAt),
    lastUsedAt: serializeDate(key.lastUsedAt),
    createdByUserId: key.createdByUserId,
    revokedByUserId: key.revokedByUserId || null,
    revokedAt: serializeDate(key.revokedAt),
    createdAt: key.createdAt.toISOString(),
    updatedAt: key.updatedAt.toISOString(),
  };
};
