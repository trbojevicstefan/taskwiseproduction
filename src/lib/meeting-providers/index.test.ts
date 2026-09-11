import {
  getMeetingProviderAdapter,
  isMeetingProviderId,
  listMeetingProviders,
} from "@/lib/meeting-providers";

describe("meeting provider registry", () => {
  it("resolves every supported meeting provider", () => {
    for (const provider of [
      "fathom",
      "fireflies",
      "grain",
      "tldv",
      "otter",
      "meetgeek",
      "read",
    ] as const) {
      expect(getMeetingProviderAdapter(provider)?.provider).toBe(provider);
    }
  });

  it("normalizes casing and whitespace in provider ids", () => {
    expect(getMeetingProviderAdapter(" Fireflies ")?.provider).toBe("fireflies");
    expect(getMeetingProviderAdapter(" READ ")?.provider).toBe("read");
  });

  it("returns null for unknown providers", () => {
    expect(getMeetingProviderAdapter("zoom")).toBeNull();
    expect(getMeetingProviderAdapter("")).toBeNull();
    expect(getMeetingProviderAdapter(null)).toBeNull();
    expect(getMeetingProviderAdapter(undefined)).toBeNull();
  });

  it("lists all registered providers exactly once", () => {
    const providers = listMeetingProviders().map((adapter) => adapter.provider);
    expect(providers).toEqual(
      expect.arrayContaining([
        "fathom",
        "fireflies",
        "grain",
        "tldv",
        "otter",
        "meetgeek",
        "read",
      ])
    );
    expect(new Set(providers).size).toBe(7);
    expect(providers).toHaveLength(7);
  });

  it("keeps Fathom on its legacy rail and exposes capability metadata for generic providers", () => {
    expect(getMeetingProviderAdapter("fathom")?.legacyWebhook).toBe(true);
    expect(getMeetingProviderAdapter("fireflies")?.capabilities).toMatchObject({
      connectionMode: "api-key",
      manualSync: true,
    });
    expect(getMeetingProviderAdapter("read")?.capabilities).toMatchObject({
      connectionMode: "webhook-only",
      manualSync: false,
      supportsWebhookSecret: true,
    });
  });

  it("validates every supported provider id", () => {
    for (const provider of [
      "fathom",
      "fireflies",
      "grain",
      "tldv",
      "otter",
      "meetgeek",
      "read",
    ]) {
      expect(isMeetingProviderId(provider)).toBe(true);
    }
    expect(isMeetingProviderId("zoom")).toBe(false);
  });
});
