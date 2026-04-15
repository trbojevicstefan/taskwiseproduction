import {
  consumeFathomConnectionOAuthState,
  createFathomConnection,
  createFathomConnectionOAuthState,
  ensureFathomConnectionIndexes,
  serializeFathomConnection,
} from "@/lib/fathom-connections";

describe("fathom-connections", () => {
  it("creates expected indexes for connections and oauth states", async () => {
    const connectionCreateIndex = jest.fn().mockResolvedValue(undefined);
    const oauthCreateIndex = jest.fn().mockResolvedValue(undefined);
    const db = {
      collection: jest.fn((name: string) => {
        if (name === "fathomConnections") {
          return { createIndex: connectionCreateIndex };
        }
        if (name === "fathomConnectionOauthStates") {
          return { createIndex: oauthCreateIndex };
        }
        throw new Error(`Unexpected collection: ${name}`);
      }),
    } as any;

    await ensureFathomConnectionIndexes(db);

    expect(connectionCreateIndex).toHaveBeenCalledTimes(6);
    expect(oauthCreateIndex).toHaveBeenCalledTimes(2);
  });

  it("redacts secrets by default and consumes oauth state records", async () => {
    const insertOne = jest.fn().mockResolvedValue(undefined);
    const deleteOne = jest.fn().mockResolvedValue(undefined);
    const findOne = jest
      .fn()
      .mockResolvedValueOnce({
        _id: "state-1",
        workspaceId: "workspace-1",
        userId: "user-1",
        connectionId: null,
        label: "Primary",
        createdAt: new Date("2026-04-15T10:00:00.000Z"),
        expiresAt: new Date("2026-04-15T10:30:00.000Z"),
      })
      .mockResolvedValueOnce(null);
    const db = {
      collection: jest.fn((name: string) => {
        if (name === "fathomConnections") {
          return { insertOne };
        }
        if (name === "fathomConnectionOauthStates") {
          return { insertOne, findOne, deleteOne };
        }
        throw new Error(`Unexpected collection: ${name}`);
      }),
    } as any;

    const connection = await createFathomConnection(db, {
      workspaceId: "workspace-1",
      label: "Primary",
      createdByUserId: "user-1",
      oauth: {
        accessToken: "access-secret",
        refreshToken: "refresh-secret",
      },
      webhook: {
        token: "webhook-token",
        secret: "webhook-secret",
        status: "active",
      },
    });
    const serialized = serializeFathomConnection(connection);

    expect(serialized?.oauth).not.toHaveProperty("accessToken");
    expect(serialized?.webhook).not.toHaveProperty("secret");

    await createFathomConnectionOAuthState(db, {
      workspaceId: "workspace-1",
      userId: "user-1",
      label: "Primary",
      id: "state-1",
    });
    const consumed = await consumeFathomConnectionOAuthState(db, "state-1");
    const missing = await consumeFathomConnectionOAuthState(db, "state-1");

    expect(consumed?._id).toBe("state-1");
    expect(deleteOne).toHaveBeenCalledWith({ _id: "state-1" });
    expect(missing).toBeNull();
  });
});
