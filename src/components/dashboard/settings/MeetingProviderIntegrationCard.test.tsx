import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import MeetingProviderIntegrationCard, {
  buildProviderConnectPayload,
  buildProviderWebhookUrl,
  type SerializedMeetingProviderConnection,
} from "@/components/dashboard/settings/MeetingProviderIntegrationCard";

jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

const activeConnection = (
  overrides: Partial<SerializedMeetingProviderConnection> = {}
): SerializedMeetingProviderConnection => ({
  id: "conn-1",
  provider: "fireflies",
  status: "active",
  accountName: "Jane Doe",
  hasApiKey: true,
  hasWebhookSecret: false,
  webhookToken: "tok-123",
  ...overrides,
});

describe("MeetingProviderIntegrationCard", () => {
  it("renders the loading state while the connection status is fetched", () => {
    const markup = renderToStaticMarkup(
      <MeetingProviderIntegrationCard provider="fireflies" canManage />
    );

    expect(markup).toContain("Fireflies.ai");
    expect(markup).toContain("Checking...");
    expect(markup).toContain("Not connected");
  });

  it("renders the connect form when there is no connection", () => {
    const markup = renderToStaticMarkup(
      <MeetingProviderIntegrationCard
        provider="fireflies"
        canManage
        initialConnection={null}
      />
    );

    expect(markup).toContain("Fireflies.ai");
    expect(markup).toContain("Not connected");
    expect(markup).toContain("API key");
    expect(markup).toContain('type="password"');
    expect(markup).toContain("Webhook secret");
    expect(markup).toContain("x-hub-signature");
    expect(markup).toContain("Connect");
    expect(markup).not.toContain("Disconnect");
    expect(markup).not.toContain("Sync now");
  });

  it("renders grain-specific copy for the grain provider", () => {
    const markup = renderToStaticMarkup(
      <MeetingProviderIntegrationCard
        provider="grain"
        canManage
        initialConnection={null}
      />
    );

    expect(markup).toContain("Grain");
    expect(markup).toContain("grain-hook-secret");
    expect(markup).toContain("personal access token");
  });

  it("renders the connected state with account name, webhook URL, sync, and disconnect", () => {
    const markup = renderToStaticMarkup(
      <MeetingProviderIntegrationCard
        provider="fireflies"
        canManage
        initialConnection={activeConnection()}
      />
    );

    expect(markup).toContain("Connected");
    expect(markup).toContain("Connected as Jane Doe");
    expect(markup).toContain("Webhook URL");
    expect(markup).toContain("/api/webhooks/fireflies?token=tok-123");
    expect(markup).toContain("Copy webhook URL");
    expect(markup).toContain("Sync now");
    expect(markup).toContain("Disconnect");
    expect(markup).toContain(
      "accepted without signature verification"
    );
    // The API key is never rendered anywhere in the connected state.
    expect(markup).not.toContain("API key");
  });

  it("notes signature verification when a webhook secret is saved", () => {
    const markup = renderToStaticMarkup(
      <MeetingProviderIntegrationCard
        provider="grain"
        canManage
        initialConnection={activeConnection({
          provider: "grain",
          hasWebhookSecret: true,
        })}
      />
    );

    expect(markup).toContain("/api/webhooks/grain?token=tok-123");
    expect(markup).toContain(
      "verified with your saved webhook secret"
    );
  });

  it("treats a revoked connection as not connected", () => {
    const markup = renderToStaticMarkup(
      <MeetingProviderIntegrationCard
        provider="fireflies"
        canManage
        initialConnection={activeConnection({ status: "revoked" })}
      />
    );

    expect(markup).toContain("Not connected");
    expect(markup).toContain("Connect");
    expect(markup).not.toContain("Sync now");
  });

  it("shows the manage note and disables controls for non-managers", () => {
    const markup = renderToStaticMarkup(
      <MeetingProviderIntegrationCard
        provider="fireflies"
        canManage={false}
        initialConnection={null}
      />
    );

    expect(markup).toContain(
      "Only workspace owners and admins can manage this integration."
    );
    expect(markup).toContain("disabled");
  });

  describe("buildProviderConnectPayload (POST body shape)", () => {
    it("trims the api key and omits an empty webhook secret", () => {
      expect(
        buildProviderConnectPayload({
          apiKeyInput: "  ff-api-key  ",
          webhookSecretInput: "   ",
        })
      ).toEqual({ apiKey: "ff-api-key" });
    });

    it("includes a trimmed webhook secret when provided", () => {
      expect(
        buildProviderConnectPayload({
          apiKeyInput: "grain-pat",
          webhookSecretInput: "  hook-secret  ",
        })
      ).toEqual({ apiKey: "grain-pat", webhookSecret: "hook-secret" });
    });
  });

  describe("buildProviderWebhookUrl", () => {
    it("appends the webhook token as a query parameter", () => {
      expect(
        buildProviderWebhookUrl("https://app.example.com", "fireflies", "tok 1")
      ).toBe("https://app.example.com/api/webhooks/fireflies?token=tok%201");
    });

    it("omits the token query when there is no token", () => {
      expect(buildProviderWebhookUrl("https://app.example.com", "grain", null)).toBe(
        "https://app.example.com/api/webhooks/grain"
      );
    });
  });
});
