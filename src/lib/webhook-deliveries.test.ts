import {
  appendWebhookDeliveryAttempt,
  createWebhookDelivery,
  ensureWebhookDeliveryIndexes,
  serializeWebhookDelivery,
} from "@/lib/webhook-deliveries";

describe("webhook-deliveries", () => {
  it("creates indexes and serializes nested attempt dates", async () => {
    const createIndex = jest.fn().mockResolvedValue(undefined);
    const insertOne = jest.fn().mockResolvedValue(undefined);
    const updateOne = jest.fn().mockResolvedValue(undefined);
    const findOne = jest
      .fn()
      .mockResolvedValueOnce({
        _id: "delivery-1",
        workspaceId: "workspace-1",
        workflowId: "workflow-1",
        workflowVersion: 1,
        status: "queued",
        maxAttempts: 5,
        attemptCount: 0,
        request: { url: "https://example.com", method: "POST", headers: {}, body: null },
        attempts: [],
        queuedAt: new Date("2026-04-15T10:00:00.000Z"),
        createdAt: new Date("2026-04-15T10:00:00.000Z"),
        updatedAt: new Date("2026-04-15T10:00:00.000Z"),
      })
      .mockResolvedValueOnce({
        _id: "delivery-1",
        workspaceId: "workspace-1",
        workflowId: "workflow-1",
        workflowVersion: 1,
        status: "sent",
        maxAttempts: 5,
        attemptCount: 1,
        request: { url: "https://example.com", method: "POST", headers: {}, body: null },
        attempts: [
          {
            attemptNumber: 1,
            status: "sent",
            startedAt: new Date("2026-04-15T10:01:00.000Z"),
            finishedAt: new Date("2026-04-15T10:01:05.000Z"),
            response: {
              statusCode: 200,
              receivedAt: new Date("2026-04-15T10:01:05.000Z"),
            },
          },
        ],
        latestResponse: {
          statusCode: 200,
          receivedAt: new Date("2026-04-15T10:01:05.000Z"),
        },
        queuedAt: new Date("2026-04-15T10:00:00.000Z"),
        sentAt: new Date("2026-04-15T10:01:05.000Z"),
        createdAt: new Date("2026-04-15T10:00:00.000Z"),
        updatedAt: new Date("2026-04-15T10:01:05.000Z"),
      });
    const db = {
      collection: jest.fn(() => ({
        createIndex,
        insertOne,
        updateOne,
        findOne,
      })),
    } as any;

    await ensureWebhookDeliveryIndexes(db);
    await createWebhookDelivery(db, {
      workspaceId: "workspace-1",
      workflowId: "workflow-1",
      workflowVersion: 1,
      eventType: "meeting.ingested",
      request: {
        url: "https://example.com",
        method: "POST",
      },
      id: "delivery-1",
    });
    const updated = await appendWebhookDeliveryAttempt(db, "delivery-1", {
      status: "sent",
      startedAt: new Date("2026-04-15T10:01:00.000Z"),
      finishedAt: new Date("2026-04-15T10:01:05.000Z"),
      response: {
        statusCode: 200,
        receivedAt: new Date("2026-04-15T10:01:05.000Z"),
      },
    });

    expect(createIndex).toHaveBeenCalledTimes(6);
    expect(insertOne).toHaveBeenCalledTimes(1);
    expect(updateOne).toHaveBeenCalledTimes(1);
    expect(serializeWebhookDelivery(updated)?.attempts[0]?.finishedAt).toBe(
      "2026-04-15T10:01:05.000Z"
    );
  });
});
