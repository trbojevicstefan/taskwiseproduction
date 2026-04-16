import type { Db } from "mongodb";

type McpRateLimitCategory = "requests" | "writes";

type McpRateLimitDoc = {
  _id: string;
  workspaceId: string;
  apiKeyId: string;
  category: McpRateLimitCategory;
  windowStart: Date;
  count: number;
  expiresAt: Date;
};

export type McpRateLimitWindowResult = {
  category: McpRateLimitCategory;
  allowed: boolean;
  limit: number;
  count: number;
  remaining: number;
  resetAt: Date;
  retryAfterSeconds: number;
};

export type McpRateLimitResult = {
  allowed: boolean;
  request: McpRateLimitWindowResult;
  write: McpRateLimitWindowResult | null;
  blocked: McpRateLimitWindowResult | null;
};

const MCP_RATE_LIMITS_COLLECTION = "mcpRateLimits";
const ONE_MINUTE_MS = 60_000;
const DEFAULT_REQUESTS_PER_MINUTE = 120;
const DEFAULT_WRITES_PER_MINUTE = 30;

const parsePositiveInteger = (rawValue: string | undefined, fallbackValue: number) => {
  const parsed = Number.parseInt(String(rawValue || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallbackValue;
  }
  return parsed;
};

const REQUESTS_PER_MINUTE_LIMIT = parsePositiveInteger(
  process.env.MCP_RATE_LIMIT_REQUESTS_PER_MINUTE,
  DEFAULT_REQUESTS_PER_MINUTE
);
const WRITES_PER_MINUTE_LIMIT = parsePositiveInteger(
  process.env.MCP_RATE_LIMIT_WRITES_PER_MINUTE,
  DEFAULT_WRITES_PER_MINUTE
);

let indexesEnsured = false;
let ensureIndexesPromise: Promise<void> | null = null;

const ensureMcpRateLimitIndexes = async (db: Db) => {
  if (indexesEnsured) {
    return;
  }
  if (ensureIndexesPromise) {
    await ensureIndexesPromise;
    return;
  }

  ensureIndexesPromise = (async () => {
    const collection = db.collection<McpRateLimitDoc>(MCP_RATE_LIMITS_COLLECTION);
    await Promise.all([
      collection.createIndex({ workspaceId: 1, apiKeyId: 1, category: 1, windowStart: 1 }),
      collection.createIndex(
        { expiresAt: 1 },
        { expireAfterSeconds: 0, name: "mcp_rate_limits_expires_at_ttl" }
      ),
    ]);
    indexesEnsured = true;
  })().finally(() => {
    ensureIndexesPromise = null;
  });

  await ensureIndexesPromise;
};

const toWindowStart = (nowMs: number) => nowMs - (nowMs % ONE_MINUTE_MS);

const consumeWindowLimit = async (
  db: Db,
  input: {
    workspaceId: string;
    apiKeyId: string;
    category: McpRateLimitCategory;
    limit: number;
    now: Date;
  }
): Promise<McpRateLimitWindowResult> => {
  await ensureMcpRateLimitIndexes(db);

  const nowMs = input.now.getTime();
  const windowStartMs = toWindowStart(nowMs);
  const resetAt = new Date(windowStartMs + ONE_MINUTE_MS);
  const expiresAt = new Date(resetAt.getTime() + ONE_MINUTE_MS);
  const docId = `${input.workspaceId}:${input.apiKeyId}:${input.category}:${windowStartMs}`;

  const updated = await db.collection<McpRateLimitDoc>(MCP_RATE_LIMITS_COLLECTION).findOneAndUpdate(
    {
      _id: docId,
    },
    {
      $setOnInsert: {
        workspaceId: input.workspaceId,
        apiKeyId: input.apiKeyId,
        category: input.category,
        windowStart: new Date(windowStartMs),
        expiresAt,
      },
      $inc: {
        count: 1,
      },
      $set: {
        expiresAt,
      },
    },
    {
      upsert: true,
      returnDocument: "after",
    }
  );

  const count = Math.max(0, Number(updated?.count || 0));
  const allowed = count <= input.limit;
  const remaining = Math.max(0, input.limit - count);
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAt.getTime() - nowMs) / 1000));

  return {
    category: input.category,
    allowed,
    limit: input.limit,
    count,
    remaining,
    resetAt,
    retryAfterSeconds,
  };
};

export const enforceMcpApiKeyRateLimit = async (
  db: Db,
  input: {
    workspaceId: string;
    apiKeyId: string;
    isWriteRequest: boolean;
  }
): Promise<McpRateLimitResult> => {
  const now = new Date();

  const request = await consumeWindowLimit(db, {
    workspaceId: input.workspaceId,
    apiKeyId: input.apiKeyId,
    category: "requests",
    limit: REQUESTS_PER_MINUTE_LIMIT,
    now,
  });

  if (!request.allowed) {
    return {
      allowed: false,
      request,
      write: null,
      blocked: request,
    };
  }

  if (!input.isWriteRequest) {
    return {
      allowed: true,
      request,
      write: null,
      blocked: null,
    };
  }

  const write = await consumeWindowLimit(db, {
    workspaceId: input.workspaceId,
    apiKeyId: input.apiKeyId,
    category: "writes",
    limit: WRITES_PER_MINUTE_LIMIT,
    now,
  });

  if (!write.allowed) {
    return {
      allowed: false,
      request,
      write,
      blocked: write,
    };
  }

  return {
    allowed: true,
    request,
    write,
    blocked: null,
  };
};
