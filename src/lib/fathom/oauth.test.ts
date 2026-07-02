import {
  consumeFathomOAuthState,
  createFathomOAuthState,
  deleteFathomInstallation,
  getFathomInstallation,
  getValidFathomAccessToken,
  getValidFathomAccessTokenForConnection,
  saveFathomInstallation,
} from "@/lib/fathom/oauth";
import { findFathomConnectionById, updateFathomConnectionById } from "@/lib/fathom-connections";
import { getDb } from "@/lib/db";
import { recordExternalApiFailure } from "@/lib/observability-metrics";

jest.mock("@/lib/db", () => ({
  getDb: jest.fn(),
}));

jest.mock("@/lib/fathom-connections", () => ({
  findFathomConnectionById: jest.fn(),
  updateFathomConnectionById: jest.fn(),
}));

jest.mock("@/lib/observability-metrics", () => ({
  recordExternalApiFailure: jest.fn(),
}));

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedFindFathomConnectionById = findFathomConnectionById as jest.MockedFunction<
  typeof findFathomConnectionById
>;
const mockedUpdateFathomConnectionById = updateFathomConnectionById as jest.MockedFunction<
  typeof updateFathomConnectionById
>;
const mockedRecordExternalApiFailure = recordExternalApiFailure as jest.MockedFunction<
  typeof recordExternalApiFailure
>;

describe("fathom/oauth", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.FATHOM_CLIENT_ID = "client-id";
    process.env.FATHOM_CLIENT_SECRET = "client-secret";
    process.env.NEXTAUTH_SECRET = "hash-secret";
  });

  it("creates and consumes oauth state records", async () => {
    const insertOne = jest.fn().mockResolvedValue(undefined);
    const deleteOne = jest.fn().mockResolvedValue(undefined);
    const findOne = jest
      .fn()
      .mockResolvedValueOnce({
        _id: "state-1",
        userId: "user-1",
      })
      .mockResolvedValueOnce(null);
    mockedGetDb.mockResolvedValue({
      collection: jest.fn((name: string) => {
        if (name === "fathomOauthStates") {
          return { insertOne, findOne, deleteOne };
        }
        throw new Error(`Unexpected collection: ${name}`);
      }),
    } as any);

    const state = await createFathomOAuthState("user-1");
    const consumed = await consumeFathomOAuthState("state-1");
    const missing = await consumeFathomOAuthState("state-1");

    expect(state).toBeTruthy();
    expect(insertOne).toHaveBeenCalledTimes(1);
    expect(consumed).toBe("user-1");
    expect(deleteOne).toHaveBeenCalledWith({ _id: "state-1" });
    expect(missing).toBeNull();
  });

  it("reads and writes installation records", async () => {
    const insertOne = jest.fn();
    const updateOne = jest.fn().mockResolvedValue(undefined);
    const deleteOne = jest.fn().mockResolvedValue(undefined);
    const findOne = jest.fn().mockResolvedValue({
      _id: "user-1",
      userId: "user-1",
      accessToken: "access-token",
      createdAt: new Date("2026-07-01T10:00:00.000Z"),
      updatedAt: new Date("2026-07-01T10:00:00.000Z"),
    });
    mockedGetDb.mockResolvedValue({
      collection: jest.fn((name: string) => {
        if (name === "fathomInstallations") {
          return { insertOne, updateOne, deleteOne, findOne };
        }
        if (name === "fathomOauthStates") {
          return { insertOne, updateOne, deleteOne, findOne };
        }
        throw new Error(`Unexpected collection: ${name}`);
      }),
    } as any);

    const installation = await getFathomInstallation("user-1");
    await saveFathomInstallation({
      _id: "user-1",
      userId: "user-1",
      accessToken: "access-token",
      createdAt: new Date("2026-07-01T10:00:00.000Z"),
      updatedAt: new Date("2026-07-01T10:00:00.000Z"),
    } as any);
    await deleteFathomInstallation("user-1");

    expect(installation?.accessToken).toBe("access-token");
    expect(updateOne).toHaveBeenCalledTimes(1);
    expect(deleteOne).toHaveBeenCalledTimes(1);
  });

  it("refreshes expired access tokens for installations and connections", async () => {
    const installFindOne = jest.fn().mockResolvedValue({
      _id: "user-1",
      userId: "user-1",
      accessToken: "old-access",
      refreshToken: "refresh-token",
      expiresAt: Date.now() - 10_000,
      createdAt: new Date("2026-07-01T10:00:00.000Z"),
      updatedAt: new Date("2026-07-01T10:00:00.000Z"),
    });
    const connectionRecord = {
      _id: "connection-1",
      workspaceId: "workspace-1",
      provider: "fathom",
      label: "Primary",
      status: "active",
      createdByUserId: "user-1",
      updatedByUserId: "user-1",
      legacyUserId: "user-1",
      oauth: {
        accessToken: "old-connection-access",
        refreshToken: "refresh-token",
        expiresAt: Date.now() - 10_000,
        scope: "public_api",
        stateId: null,
        connectedAt: new Date("2026-07-01T10:00:00.000Z"),
        lastRefreshedAt: null,
        lastError: null,
      },
      webhook: {
        token: null,
        secret: null,
        status: "not_configured",
        webhookId: null,
        webhookUrl: null,
        webhookEvent: null,
        managedWebhooks: [],
        lastSyncedAt: null,
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
      createdAt: new Date("2026-07-01T10:00:00.000Z"),
      updatedAt: new Date("2026-07-01T10:00:00.000Z"),
      revokedAt: null,
    };
    const connectionFindOne = jest.fn().mockResolvedValue(connectionRecord);
    mockedGetDb.mockResolvedValue({
      collection: jest.fn((name: string) => {
        if (name === "fathomInstallations") {
          return { findOne: installFindOne, updateOne: jest.fn().mockResolvedValue(undefined) };
        }
        if (name === "fathomConnections") {
          return { findOne: connectionFindOne, updateOne: jest.fn().mockResolvedValue(undefined) };
        }
        throw new Error(`Unexpected collection: ${name}`);
      }),
    } as any);
    mockedFindFathomConnectionById.mockResolvedValue(connectionRecord as any);
    mockedUpdateFathomConnectionById.mockResolvedValue(connectionRecord as any);
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_in: 3600,
        scope: "public_api",
      }),
      ok: true,
      status: 200,
      text: async () => "",
    }) as any;

    const installToken = await getValidFathomAccessToken("user-1");
    const connectionToken = await getValidFathomAccessTokenForConnection("connection-1");

    expect(installToken).toBe("new-access");
    expect(connectionToken).toBe("new-access");
    expect(mockedRecordExternalApiFailure).not.toHaveBeenCalled();
  });
});
