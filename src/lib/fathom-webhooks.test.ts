import {
  deleteFathomWebhook,
  pruneFathomManagedWebhooks,
} from "@/lib/fathom-webhooks";

jest.mock("@/lib/observability-metrics", () => ({
  recordExternalApiFailure: jest.fn(),
}));

describe("fathom-webhooks", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it("deletes a webhook using the provided delete url", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 204,
      statusText: "No Content",
      text: async () => "",
    });
    global.fetch = fetchMock as any;

    await deleteFathomWebhook("access-token", {
      id: "webhook-1",
      actions: { deleteUrl: "/external/v1/webhooks/webhook-1" },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.fathom.ai/external/v1/webhooks/webhook-1",
      expect.objectContaining({
        method: "DELETE",
        headers: { Authorization: "Bearer access-token" },
      })
    );
  });

  it("prunes stale managed webhooks and keeps the primary entry", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 204,
      statusText: "No Content",
      text: async () => "",
    });
    global.fetch = fetchMock as any;

    const result = await pruneFathomManagedWebhooks("access-token", {
      webhookId: "primary-webhook",
      webhookUrl: "https://public.example/webhook?token=abc",
      managedWebhooks: [
        { id: "primary-webhook", url: "https://public.example/webhook?token=abc" },
        { id: "stale-webhook", url: "https://public.example/webhook?token=old" },
      ],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.managedWebhooks).toEqual([
      { id: "primary-webhook", url: "https://public.example/webhook?token=abc" },
    ]);
    expect(result.deletedCount).toBe(1);
    expect(result.cleanupErrors).toEqual([]);
  });
});
