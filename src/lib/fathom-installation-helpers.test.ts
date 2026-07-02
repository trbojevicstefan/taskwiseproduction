import {
  buildLegacyFathomInstallation,
} from "@/lib/fathom-installation-helpers";

describe("fathom-installation-helpers", () => {
  it("builds a legacy installation from connection state and overrides", () => {
    const connection: any = {
      legacyUserId: "user_1",
      oauth: {
        accessToken: "conn-access",
        refreshToken: "conn-refresh",
        expiresAt: 123,
        scope: "basic",
      },
      source: { providerUserId: "fathom-user" },
      webhook: {
        webhookId: "wh_1",
        webhookUrl: "https://example.com",
        webhookEvent: "webhook.created",
        secret: "secret",
        managedWebhooks: [
          {
            id: "web_1",
            url: "https://example.com",
            includeTranscript: true,
          },
        ],
      },
    };

    expect(
      buildLegacyFathomInstallation(connection, {
        _id: "user_1",
        userId: "user_1",
        accessToken: "existing-access",
        refreshToken: "existing-refresh",
        expiresAt: 456,
        scope: "existing",
        fathomUserId: "existing-user",
        webhookId: "existing-webhook",
        webhookUrl: "https://existing.example.com",
        webhookEvent: "webhook.updated",
        webhookSecret: "existing-secret",
        webhooks: [],
        createdAt: new Date("2026-07-01T00:00:00Z"),
      })
    ).toMatchObject({
      _id: "user_1",
      userId: "user_1",
      accessToken: "conn-access",
      refreshToken: "conn-refresh",
      expiresAt: 123,
      scope: "basic",
      fathomUserId: "fathom-user",
      webhookId: "wh_1",
      webhookUrl: "https://example.com",
      webhookEvent: "webhook.created",
      webhookSecret: "secret",
      webhooks: [
        {
          id: "web_1",
          url: "https://example.com",
          include_transcript: true,
        },
      ],
    });
  });

  it("returns the existing installation when no access token is available", () => {
    const connection: any = {
      legacyUserId: "user_1",
      oauth: {},
      source: {},
      webhook: {},
    };
    const existing = {
      _id: "user_1",
      userId: "user_1",
      accessToken: "existing-access",
    };
    expect(buildLegacyFathomInstallation(connection, existing)).toMatchObject({
      _id: "user_1",
      userId: "user_1",
      accessToken: "existing-access",
    });
  });
});
