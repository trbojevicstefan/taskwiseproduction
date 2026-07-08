import {
  getMeetingProviderAdapter,
  isMeetingProviderId,
  listMeetingProviders,
} from "@/lib/meeting-providers";

describe("meeting provider registry", () => {
  it("resolves adapters by provider id", () => {
    expect(getMeetingProviderAdapter("fathom")?.provider).toBe("fathom");
    expect(getMeetingProviderAdapter("fireflies")?.provider).toBe("fireflies");
    expect(getMeetingProviderAdapter("grain")?.provider).toBe("grain");
  });

  it("normalizes casing and whitespace in provider ids", () => {
    expect(getMeetingProviderAdapter(" Fireflies ")?.provider).toBe("fireflies");
  });

  it("returns null for unknown providers", () => {
    expect(getMeetingProviderAdapter("otter")).toBeNull();
    expect(getMeetingProviderAdapter("")).toBeNull();
    expect(getMeetingProviderAdapter(null)).toBeNull();
    expect(getMeetingProviderAdapter(undefined)).toBeNull();
  });

  it("lists all registered providers", () => {
    const providers = listMeetingProviders().map((adapter) => adapter.provider);
    expect(providers).toEqual(
      expect.arrayContaining(["fathom", "fireflies", "grain"])
    );
    expect(providers).toHaveLength(3);
  });

  it("marks only fathom as a legacy-webhook provider", () => {
    expect(getMeetingProviderAdapter("fathom")?.legacyWebhook).toBe(true);
    expect(getMeetingProviderAdapter("fireflies")?.legacyWebhook).toBeUndefined();
    expect(getMeetingProviderAdapter("grain")?.legacyWebhook).toBeUndefined();
  });

  it("validates provider ids", () => {
    expect(isMeetingProviderId("fireflies")).toBe(true);
    expect(isMeetingProviderId("grain")).toBe(true);
    expect(isMeetingProviderId("otter")).toBe(false);
  });

  // The per-provider "stub methods throw ProviderNotImplementedError" block
  // was removed when the real fireflies/grain adapters landed; adapter
  // behavior is covered by fireflies.test.ts / grain.test.ts.
});
