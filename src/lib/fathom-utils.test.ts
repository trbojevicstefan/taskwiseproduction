import {
  FATHOM_WEBHOOK_EVENT,
  FATHOM_WEBHOOK_TRIGGERED_FOR,
  extractFathomProviderSourceId,
  formatFathomTranscript,
  formatTimestamp,
  getFathomRedirectUri,
  getFathomRecordingHashScope,
  getFathomWebhookUrl,
  getFathomWebhookUrlPrefix,
  hashFathomRecordingId,
} from "@/lib/fathom-utils";

describe("fathom-utils", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("exports the expected webhook constants", () => {
    expect(FATHOM_WEBHOOK_EVENT).toBe("new-meeting-content-ready");
    expect(FATHOM_WEBHOOK_TRIGGERED_FOR).toEqual([
      "my_recordings",
      "shared_with_me_external_recordings",
      "my_shared_with_team_recordings",
      "shared_team_recordings",
    ]);
  });

  it("derives redirect and webhook urls from environment settings", () => {
    process.env.NEXTAUTH_URL = "https://app.example.com/";
    process.env.FATHOM_PUBLIC_BASE_URL = "https://public.example.com/";

    expect(getFathomRedirectUri()).toBe(
      "https://public.example.com/api/fathom/oauth/callback"
    );
    expect(getFathomWebhookUrl("token-123")).toBe(
      "https://public.example.com/api/fathom/webhook?token=token-123"
    );
    expect(getFathomWebhookUrlPrefix()).toBe(
      "https://public.example.com/api/fathom/webhook?token="
    );
  });

  it("scopes and hashes recording ids deterministically", () => {
    const scope = getFathomRecordingHashScope({
      userId: "user-1",
      connectionId: "connection-1",
    });

    expect(scope).toBe("connection:connection-1");
    expect(hashFathomRecordingId(scope, "recording-1")).toHaveLength(64);
    expect(hashFathomRecordingId(scope, "recording-1")).toBe(
      hashFathomRecordingId(scope, "recording-1")
    );
  });

  it("extracts provider source ids from several payload shapes", () => {
    expect(extractFathomProviderSourceId({ provider_source_id: 42 })).toBe("42");
    expect(extractFathomProviderSourceId({ source: { id: "source-1" } })).toBe(
      "source-1"
    );
    expect(
      extractFathomProviderSourceId({
        recording: { source_ids: ["source-2"] },
      })
    ).toBe("source-2");
  });

  it("formats transcript payloads into readable text", () => {
    expect(
      formatFathomTranscript([
        { timestamp: 12, speaker: { display_name: "Maya" }, text: "Hello" },
        { timestamp: "00:20", name: "Jon", content: "World" },
      ])
    ).toBe("0:12 - Maya: Hello\n00:20 - Jon: World");
  });

  it("formats timestamps as mm:ss", () => {
    expect(formatTimestamp(12)).toBe("0:12");
    expect(formatTimestamp("00:20")).toBe("00:20");
    expect(formatTimestamp(null)).toBe("");
  });
});
