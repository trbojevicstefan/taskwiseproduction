import {
  applyFathomConnectionRefresh,
  applyFathomInstallationRefresh,
  buildFathomRefreshRequestParams,
} from "@/lib/fathom-oauth-helpers";

describe("fathom-oauth-helpers", () => {
  it("builds refresh token request params", () => {
    const params = buildFathomRefreshRequestParams("refresh", "client", "secret");
    expect(params.get("grant_type")).toBe("refresh_token");
    expect(params.get("refresh_token")).toBe("refresh");
    expect(params.get("client_id")).toBe("client");
    expect(params.get("client_secret")).toBe("secret");
  });

  it("applies refresh payloads to installation state", () => {
    const updated = applyFathomInstallationRefresh(
      {
        userId: "user_1",
        accessToken: "old-access",
        refreshToken: "old-refresh",
        expiresAt: 1000,
        scope: "old-scope",
      },
      {
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_in: 60,
        scope: "new-scope",
      }
    );

    expect(updated).toMatchObject({
      userId: "user_1",
      accessToken: "new-access",
      refreshToken: "new-refresh",
      scope: "new-scope",
    });
    expect(updated.expiresAt).toBeGreaterThan(Date.now());
  });

  it("applies refresh payloads to connection oauth state", () => {
    const updated = applyFathomConnectionRefresh(
      {
        _id: "conn_1",
        workspaceId: "workspace_1",
        provider: "fathom",
        label: "Fathom",
        status: "active",
        createdByUserId: "user_1",
        updatedByUserId: "user_1",
        oauth: {
          accessToken: "old-access",
          refreshToken: "old-refresh",
          expiresAt: 1000,
          scope: "old-scope",
        },
        webhook: { status: "not_configured" },
        source: {},
        sync: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any,
      {
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_in: 60,
        scope: "new-scope",
      }
    );

    expect(updated.oauth).toMatchObject({
      accessToken: "new-access",
      refreshToken: "new-refresh",
      scope: "new-scope",
      lastError: null,
    });
    expect(updated.oauth.expiresAt).toBeGreaterThan(Date.now());
  });
});
