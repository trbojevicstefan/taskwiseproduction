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

  it("renders API-key setup for Fireflies", () => {
    const markup = renderToStaticMarkup(
      <MeetingProviderIntegrationCard provider="fireflies" canManage initialConnection={null} />
    );
    expect(markup).toContain("API key");
    expect(markup).toContain("Webhook secret");
    expect(markup).toContain("x-hub-signature");
    expect(markup).toContain("Connect");
    expect(markup).not.toContain("Sync now");
  });

  it("keeps Grain setup and copy intact", () => {
    const markup = renderToStaticMarkup(
      <MeetingProviderIntegrationCard provider="grain" canManage initialConnection={null} />
    );
    expect(markup).toContain("Grain");
    expect(markup).toContain("grain-hook-secret");
    expect(markup).toContain("personal access token");
  });

  it("renders a connected API provider with sync and workspace webhook routing", () => {
    const markup = renderToStaticMarkup(
      <MeetingProviderIntegrationCard provider="fireflies" canManage initialConnection={activeConnection()} />
    );
    expect(markup).toContain("Connected as Jane Doe");
    expect(markup).toContain("/api/webhooks/fireflies?token=tok-123");
    expect(markup).toContain("Copy webhook URL");
    expect(markup).toContain("Sync now");
    expect(markup).toContain("Disconnect");
    expect(markup).toContain("unique URL token routes the event to this workspace");
    expect(markup).not.toContain("API key");
  });

  it("notes signature verification when a supported webhook secret is saved", () => {
    const markup = renderToStaticMarkup(
      <MeetingProviderIntegrationCard
        provider="grain"
        canManage
        initialConnection={activeConnection({ provider: "grain", hasWebhookSecret: true })}
      />
    );
    expect(markup).toContain("/api/webhooks/grain?token=tok-123");
    expect(markup).toContain("Incoming webhooks are signature-verified");
  });

  it("renders Read AI as webhook-first without an API key or manual sync control", () => {
    const markup = renderToStaticMarkup(
      <MeetingProviderIntegrationCard provider="read" canManage initialConnection={null} />
    );
    expect(markup).toContain("Read AI");
    expect(markup).toContain("Webhook-first");
    expect(markup).toContain("Webhook signing key");
    expect(markup).toContain("X-Read-Signature");
    expect(markup).not.toContain("Read AI API key");
    expect(markup).not.toContain("Sync now");
  });

  it("renders provider-specific constraints for tl;dv, Otter and MeetGeek", () => {
    const tldv = renderToStaticMarkup(
      <MeetingProviderIntegrationCard provider="tldv" canManage initialConnection={null} />
    );
    const otter = renderToStaticMarkup(
      <MeetingProviderIntegrationCard provider="otter" canManage initialConnection={null} />
    );
    const meetgeek = renderToStaticMarkup(
      <MeetingProviderIntegrationCard provider="meetgeek" canManage initialConnection={null} />
    );
    expect(tldv).toContain("tl;dv API key");
    expect(otter).toContain("Enterprise workspace");
    expect(meetgeek).toContain("region-specific");
  });

  it("treats a revoked connection as not connected", () => {
    const markup = renderToStaticMarkup(
      <MeetingProviderIntegrationCard provider="fireflies" canManage initialConnection={activeConnection({ status: "revoked" })} />
    );
    expect(markup).toContain("Not connected");
    expect(markup).toContain("Connect");
    expect(markup).not.toContain("Sync now");
  });

  it("shows the manage note and disables controls for non-managers", () => {
    const markup = renderToStaticMarkup(
      <MeetingProviderIntegrationCard provider="fireflies" canManage={false} initialConnection={null} />
    );
    expect(markup).toContain("Only workspace owners and admins can manage this integration.");
    expect(markup).toContain("disabled");
  });

  describe("buildProviderConnectPayload", () => {
    it("trims an API key and omits an empty webhook secret", () => {
      expect(buildProviderConnectPayload({ apiKeyInput: "  ff-api-key  ", webhookSecretInput: "   " })).toEqual({ apiKey: "ff-api-key" });
    });

    it("supports webhook-only payloads without inventing an API key", () => {
      expect(buildProviderConnectPayload({ apiKeyInput: "", webhookSecretInput: "  read-signing-key  " })).toEqual({ webhookSecret: "read-signing-key" });
    });
  });

  describe("buildProviderWebhookUrl", () => {
    it("appends the webhook token as a query parameter", () => {
      expect(buildProviderWebhookUrl("https://app.example.com", "fireflies", "tok 1")).toBe("https://app.example.com/api/webhooks/fireflies?token=tok%201");
    });

    it("supports new providers", () => {
      expect(buildProviderWebhookUrl("https://app.example.com", "read", "r-1")).toBe("https://app.example.com/api/webhooks/read?token=r-1");
    });
  });
});
