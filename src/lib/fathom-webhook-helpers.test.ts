import {
  buildWebhookBody,
  getWebhookId,
  getWebhookUrl,
  mergeManagedWebhookEntries,
  toConnectionManagedWebhook,
  toLegacyWebhookEntry,
} from "@/lib/fathom-webhook-helpers";

describe("fathom-webhook-helpers", () => {
  it("normalizes legacy webhook entries", () => {
    expect(
      toLegacyWebhookEntry({
        id: "abc",
        url: "https://example.com",
        createdAt: "2026-07-02T00:00:00Z",
        includeTranscript: true,
        includeSummary: false,
        includeActionItems: true,
        includeCrmMatches: false,
        triggeredFor: ["my_recordings"],
      })
    ).toEqual({
      id: "abc",
      url: "https://example.com",
      createdAt: "2026-07-02T00:00:00Z",
      include_transcript: true,
      include_summary: false,
      include_action_items: true,
      include_crm_matches: false,
      triggered_for: ["my_recordings"],
    });
  });

  it("normalizes connection webhook entries", () => {
    expect(
      toConnectionManagedWebhook(
        {
          webhook_id: "wh_1",
          webhook_url: "https://example.com",
          created_at: "2026-07-02T00:00:00Z",
          include_transcript: true,
          include_summary: false,
          include_action_items: true,
          include_crm_matches: false,
          triggered_for: ["shared_team_recordings"],
        },
        "https://fallback.example.com"
      )
    ).toEqual({
      id: "wh_1",
      url: "https://example.com",
      createdAt: "2026-07-02T00:00:00Z",
      includeTranscript: true,
      includeSummary: false,
      includeActionItems: true,
      includeCrmMatches: false,
      triggeredFor: ["shared_team_recordings"],
    });
  });

  it("merges managed webhook entries without duplicates", () => {
    expect(
      mergeManagedWebhookEntries(
        { id: "abc", url: "https://new.example.com" },
        [
          { id: "abc", url: "https://old.example.com" },
          { id: "xyz", url: "https://keep.example.com" },
        ]
      )
    ).toEqual([
      { id: "abc", url: "https://new.example.com" },
      { id: "xyz", url: "https://keep.example.com" },
    ]);
  });

  it("builds webhook bodies and reads ids/urls", () => {
    expect(buildWebhookBody("https://example.com", ["my_recordings"])).toEqual({
      destination_url: "https://example.com",
      include_transcript: true,
      include_summary: true,
      include_action_items: true,
      include_crm_matches: false,
      triggered_for: ["my_recordings"],
    });
    expect(getWebhookUrl({ destination_url: "https://example.com" })).toBe(
      "https://example.com"
    );
    expect(getWebhookId({ webhook_id: "wh_1" })).toBe("wh_1");
  });
});
