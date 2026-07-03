import {
  buildConnectionWebhookUpsert,
  buildLegacyWebhookUpsert,
} from "@/lib/fathom-webhook-sync-helpers";

describe("fathom-webhook-sync-helpers", () => {
  it("builds a legacy webhook upsert result", () => {
    expect(
      buildLegacyWebhookUpsert(
        {
          id: "wh_1",
          url: "https://example.com",
          createdAt: "2026-07-02T00:00:00Z",
          include_transcript: true,
          triggered_for: ["my_recordings"],
        },
        {
          webhooks: [{ id: "old", url: "https://old.example.com" }],
        },
        "https://fallback.example.com"
      )
    ).toEqual({
      webhookId: "wh_1",
      createdUrl: "https://example.com",
      createdAt: "2026-07-02T00:00:00Z",
      merged: [
        {
          id: "wh_1",
          url: "https://example.com",
          createdAt: "2026-07-02T00:00:00Z",
          include_transcript: true,
          include_summary: null,
          include_action_items: null,
          include_crm_matches: null,
          triggered_for: ["my_recordings"],
        },
        { id: "old", url: "https://old.example.com" },
      ],
    });
  });

  it("builds a connection webhook upsert result", () => {
    expect(
      buildConnectionWebhookUpsert(
        {
          webhook_id: "wh_1",
          webhook_url: "https://example.com",
          secret: "secret",
        },
        {
          webhook: { secret: "fallback-secret", webhookEvent: "event" },
          webhooks: [{ id: "old", url: "https://old.example.com" }],
        },
        "https://fallback.example.com"
      )
    ).toEqual({
      webhookId: "wh_1",
      createdUrl: "https://example.com",
      merged: [
        {
          id: "wh_1",
          url: "https://example.com",
          createdAt: null,
          includeTranscript: null,
          includeSummary: null,
          includeActionItems: null,
          includeCrmMatches: null,
          triggeredFor: null,
        },
        { id: "old", url: "https://old.example.com" },
      ],
      secret: "secret",
      event: "event",
    });
  });
});
