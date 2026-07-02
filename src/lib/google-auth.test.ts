import {
  getGoogleAccessTokenForUser,
  revokeGoogleTokensForUser,
} from "@/lib/google-auth";
import { findUserById, updateUserById } from "@/lib/db/users";
import { logGoogleIntegration } from "@/lib/google-logs";
import { recordExternalApiFailure } from "@/lib/observability-metrics";

jest.mock("@/lib/db/users", () => ({
  findUserById: jest.fn(),
  updateUserById: jest.fn(),
}));

jest.mock("@/lib/google-logs", () => ({
  logGoogleIntegration: jest.fn(),
}));

jest.mock("@/lib/observability-metrics", () => ({
  recordExternalApiFailure: jest.fn(),
}));

const mockedFindUserById = findUserById as jest.MockedFunction<typeof findUserById>;
const mockedUpdateUserById = updateUserById as jest.MockedFunction<typeof updateUserById>;
const mockedLogGoogleIntegration = logGoogleIntegration as jest.MockedFunction<
  typeof logGoogleIntegration
>;
const mockedRecordExternalApiFailure =
  recordExternalApiFailure as jest.MockedFunction<typeof recordExternalApiFailure>;

describe("google-auth helper", () => {
  const originalClientId = process.env.GOOGLE_INTEGRATION_CLIENT_ID;
  const originalClientSecret = process.env.GOOGLE_INTEGRATION_CLIENT_SECRET;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn() as any;
    process.env.GOOGLE_INTEGRATION_CLIENT_ID = "test-google-client-id";
    process.env.GOOGLE_INTEGRATION_CLIENT_SECRET = "test-google-client-secret";
  });

  afterAll(() => {
    process.env.GOOGLE_INTEGRATION_CLIENT_ID = originalClientId;
    process.env.GOOGLE_INTEGRATION_CLIENT_SECRET = originalClientSecret;
  });

  it("treats invalid_token revoke responses as already-revoked success and clears local credentials", async () => {
    mockedFindUserById.mockResolvedValue({
      _id: { toString: () => "user-1" } as any,
      email: "user@example.com",
      name: "User One",
      avatarUrl: null,
      sourceSessionIds: [],
      createdAt: new Date(),
      lastUpdated: new Date(),
      lastSeenAt: new Date(),
      onboardingCompleted: true,
      workspace: { id: "workspace-1", name: "Main Workspace" },
      activeWorkspaceId: "workspace-1",
      firefliesWebhookToken: null,
      googleConnected: true,
      googleAccessToken: "access-token",
      googleRefreshToken: "refresh-token",
      googleTokenExpiry: Date.now() + 1000,
      googleScopes: "openid",
    } as any);
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response("invalid_token", { status: 400 })
    );

    const result = await revokeGoogleTokensForUser("user-1", {
      workspaceId: "workspace-1",
      actorUserId: "admin-1",
    });

    expect(result).toMatchObject({
      revokedUserId: "user-1",
      remotelyRevoked: true,
    });
    expect(result.warning).toBeUndefined();
    expect(mockedUpdateUserById).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        googleAccessToken: null,
        googleRefreshToken: null,
        googleTokenExpiry: null,
        googleScopes: null,
        googleConnected: false,
      })
    );
    expect(mockedRecordExternalApiFailure).not.toHaveBeenCalled();
    expect(mockedLogGoogleIntegration).toHaveBeenCalled();
  });

  it("returns warning when remote revoke fails but still clears local credentials", async () => {
    mockedFindUserById.mockResolvedValue({
      _id: { toString: () => "user-1" } as any,
      email: "user@example.com",
      name: "User One",
      avatarUrl: null,
      sourceSessionIds: [],
      createdAt: new Date(),
      lastUpdated: new Date(),
      lastSeenAt: new Date(),
      onboardingCompleted: true,
      workspace: { id: "workspace-1", name: "Main Workspace" },
      activeWorkspaceId: "workspace-1",
      firefliesWebhookToken: null,
      googleConnected: true,
      googleAccessToken: "access-token",
      googleRefreshToken: "refresh-token",
      googleTokenExpiry: Date.now() + 1000,
      googleScopes: "openid",
    } as any);
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response("remote revoke failed", { status: 500 })
    );

    const result = await revokeGoogleTokensForUser("user-1", {
      workspaceId: "workspace-1",
      actorUserId: "admin-1",
    });

    expect(result.revokedUserId).toBe("user-1");
    expect(result.remotelyRevoked).toBe(false);
    expect(result.warning).toContain("remote revoke failed");
    expect(mockedRecordExternalApiFailure).toHaveBeenCalled();
    expect(mockedUpdateUserById).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        googleConnected: false,
      })
    );
  });

  it("refreshes token successfully and returns new token", async () => {
    mockedFindUserById.mockResolvedValue({
      _id: { toString: () => "user-1" } as any,
      email: "user@example.com",
      name: "User One",
      avatarUrl: null,
      sourceSessionIds: [],
      createdAt: new Date(),
      lastUpdated: new Date(),
      lastSeenAt: new Date(),
      onboardingCompleted: true,
      workspace: { id: "workspace-1", name: "Main Workspace" },
      activeWorkspaceId: "workspace-1",
      firefliesWebhookToken: null,
      googleConnected: true,
      googleAccessToken: "old-access-token",
      googleRefreshToken: "refresh-token",
      googleTokenExpiry: Date.now() - 1000,
      googleScopes: "openid",
    } as any);
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "new-access-token",
          expires_in: 3600,
          scope: "openid profile",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      )
    );

    const token = await getGoogleAccessTokenForUser("user-1", {
      workspaceId: "workspace-1",
      actorUserId: "user-1",
    });

    expect(token).toBe("new-access-token");
    expect(mockedUpdateUserById).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        googleAccessToken: "new-access-token",
        googleConnected: true,
      })
    );
  });
});
