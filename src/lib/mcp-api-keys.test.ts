import {
  createMcpApiKey,
  ensureMcpApiKeyIndexes,
  hashMcpApiKey,
  serializeMcpApiKey,
} from "@/lib/mcp-api-keys";

describe("mcp-api-keys", () => {
  it("creates indexes, hashes stable values, and never serializes hashes", async () => {
    const createIndex = jest.fn().mockResolvedValue(undefined);
    const insertOne = jest.fn().mockResolvedValue(undefined);
    const db = {
      collection: jest.fn(() => ({
        createIndex,
        insertOne,
      })),
    } as any;

    await ensureMcpApiKeyIndexes(db);
    const { apiKey, record } = await createMcpApiKey(db, {
      workspaceId: "workspace-1",
      name: "CLI Key",
      scopes: ["meetings:read"],
      createdByUserId: "user-1",
      apiKey: "twmcp_static_test_key",
    });

    expect(createIndex).toHaveBeenCalledTimes(4);
    expect(apiKey).toBe("twmcp_static_test_key");
    expect(record.keyHash).toBe(hashMcpApiKey(apiKey));
    expect(serializeMcpApiKey(record)).not.toHaveProperty("keyHash");
  });
});
