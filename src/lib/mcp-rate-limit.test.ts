import type { Db } from "mongodb";
import { enforceMcpApiKeyRateLimit } from "@/lib/mcp-rate-limit";

class InMemoryCollection {
  private docs = new Map<string, Record<string, unknown>>();

  async createIndex() {
    return "ok";
  }

  async findOneAndUpdate(
    filter: Record<string, any>,
    update: Record<string, any>,
    options: Record<string, any>
  ) {
    const docId = String(filter._id);
    const existingDoc = this.docs.get(docId);
    if (!existingDoc && !options?.upsert) {
      return null;
    }

    const nextDoc: Record<string, unknown> = {
      _id: docId,
      ...(existingDoc || {}),
    };

    if (!existingDoc) {
      if (!options?.upsert) {
        return null;
      }
      Object.assign(nextDoc, (update.$setOnInsert || {}) as Record<string, unknown>);
    }

    if (update.$inc) {
      Object.entries(update.$inc).forEach(([key, value]) => {
        const current = Number(nextDoc[key] || 0);
        nextDoc[key] = current + Number(value || 0);
      });
    }

    if (update.$set) {
      Object.assign(nextDoc, (update.$set || {}) as Record<string, unknown>);
    }

    this.docs.set(docId, nextDoc);
    return { ...nextDoc };
  }
}

const createMockDb = () => {
  const collection = new InMemoryCollection();
  const db = {
    collection: jest.fn(() => collection),
  } as unknown as Db;
  return { db, collection };
};

describe("mcp-rate-limit", () => {
  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-04-16T12:00:00.000Z"));
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it("allows request traffic under the per-minute limit", async () => {
    const { db } = createMockDb();
    const result = await enforceMcpApiKeyRateLimit(db, {
      workspaceId: "workspace-1",
      apiKeyId: "key-1",
      isWriteRequest: false,
    });

    expect(result.allowed).toBe(true);
    expect(result.request.limit).toBeGreaterThan(1);
    expect(result.request.count).toBe(1);
    expect(result.request.remaining).toBe(result.request.limit - 1);
    expect(result.blocked).toBeNull();
  });

  it("blocks when request limit is exceeded within the same minute window", async () => {
    const { db } = createMockDb();
    let latestResult: Awaited<ReturnType<typeof enforceMcpApiKeyRateLimit>> | null = null;

    for (let index = 0; index < 121; index += 1) {
      latestResult = await enforceMcpApiKeyRateLimit(db, {
        workspaceId: "workspace-1",
        apiKeyId: "key-1",
        isWriteRequest: false,
      });
    }

    expect(latestResult).not.toBeNull();
    expect(latestResult?.allowed).toBe(false);
    expect(latestResult?.blocked?.category).toBe("requests");
    expect(latestResult?.request.count).toBeGreaterThan(latestResult?.request.limit || 0);
  });

  it("blocks writes on the dedicated write limit before request limit is reached", async () => {
    const { db } = createMockDb();
    let latestResult: Awaited<ReturnType<typeof enforceMcpApiKeyRateLimit>> | null = null;

    for (let index = 0; index < 31; index += 1) {
      latestResult = await enforceMcpApiKeyRateLimit(db, {
        workspaceId: "workspace-1",
        apiKeyId: "key-1",
        isWriteRequest: true,
      });
    }

    expect(latestResult).not.toBeNull();
    expect(latestResult?.allowed).toBe(false);
    expect(latestResult?.blocked?.category).toBe("writes");
    expect(latestResult?.write?.count).toBeGreaterThan(latestResult?.write?.limit || 0);
  });
});
