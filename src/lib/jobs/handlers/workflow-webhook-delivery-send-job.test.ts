import { getDb } from "@/lib/db";
import { runWorkflowWebhookDeliverySendJob } from "@/lib/jobs/handlers/workflow-webhook-delivery-send-job";
import { enqueueJob } from "@/lib/jobs/store";
import {
  appendWebhookDeliveryAttempt,
  findWebhookDeliveryById,
} from "@/lib/webhook-deliveries";

jest.mock("@/lib/db", () => ({
  getDb: jest.fn(),
}));

jest.mock("@/lib/jobs/store", () => ({
  enqueueJob: jest.fn(),
}));

jest.mock("@/lib/webhook-deliveries", () => ({
  appendWebhookDeliveryAttempt: jest.fn(),
  findWebhookDeliveryById: jest.fn(),
}));

jest.mock("@/lib/observability", () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn().mockReturnValue({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  })),
  ensureCorrelationId: jest.fn((value?: string) => value || "corr-test"),
  serializeError: jest.fn((error: unknown) => ({
    message: error instanceof Error ? error.message : String(error),
  })),
}));

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedEnqueueJob = enqueueJob as jest.MockedFunction<typeof enqueueJob>;
const mockedFindWebhookDeliveryById =
  findWebhookDeliveryById as jest.MockedFunction<typeof findWebhookDeliveryById>;
const mockedAppendWebhookDeliveryAttempt =
  appendWebhookDeliveryAttempt as jest.MockedFunction<typeof appendWebhookDeliveryAttempt>;

const createDelivery = (overrides: Record<string, any> = {}) =>
  ({
    _id: "delivery-1",
    workspaceId: "workspace-1",
    workflowId: "workflow-1",
    workflowVersion: 1,
    eventType: "meeting.ingested",
    status: "queued",
    maxAttempts: 3,
    attemptCount: 0,
    request: {
      url: "https://example.com/hook",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: { hello: "world" },
      bodySha256: "hash-1",
    },
    attempts: [],
    createdAt: new Date("2026-04-16T10:00:00.000Z"),
    updatedAt: new Date("2026-04-16T10:00:00.000Z"),
    ...overrides,
  }) as any;

describe("runWorkflowWebhookDeliverySendJob", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetDb.mockResolvedValue({} as any);
    mockedEnqueueJob.mockResolvedValue({ _id: "job-1" } as any);
    global.fetch = jest.fn() as any;
  });

  it("marks delivery sent when destination responds with success", async () => {
    mockedFindWebhookDeliveryById.mockResolvedValue(createDelivery());
    mockedAppendWebhookDeliveryAttempt.mockResolvedValue(
      createDelivery({
        status: "sent",
        attemptCount: 1,
      }) as any
    );
    (global.fetch as jest.Mock).mockResolvedValue(new Response("ok", { status: 200 }));

    const result = await runWorkflowWebhookDeliverySendJob({
      userId: "user-1",
      deliveryId: "delivery-1",
      correlationId: "corr-1",
    });

    expect(result).toMatchObject({
      deliveryId: "delivery-1",
      status: "sent",
      attemptNumber: 1,
      responseStatusCode: 200,
    });
    expect(mockedAppendWebhookDeliveryAttempt).toHaveBeenCalledWith(
      expect.anything(),
      "delivery-1",
      expect.objectContaining({
        status: "sent",
      })
    );
    expect(mockedEnqueueJob).not.toHaveBeenCalled();
  });

  it("schedules a retry when destination responds with non-2xx", async () => {
    mockedFindWebhookDeliveryById.mockResolvedValue(createDelivery());
    mockedAppendWebhookDeliveryAttempt.mockResolvedValue(
      createDelivery({
        status: "queued",
        attemptCount: 1,
      }) as any
    );
    (global.fetch as jest.Mock).mockResolvedValue(new Response("fail", { status: 500 }));

    const result = await runWorkflowWebhookDeliverySendJob({
      userId: "user-1",
      deliveryId: "delivery-1",
      correlationId: "corr-2",
    });

    expect(result).toMatchObject({
      deliveryId: "delivery-1",
      retryScheduled: true,
      responseStatusCode: 500,
    });
    expect(mockedAppendWebhookDeliveryAttempt).toHaveBeenCalledWith(
      expect.anything(),
      "delivery-1",
      expect.objectContaining({
        status: "failed",
        nextAttemptAt: expect.any(Date),
      })
    );
    expect(mockedEnqueueJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: "workflow-webhook-delivery-send",
        payload: { deliveryId: "delivery-1" },
        runAt: expect.any(Date),
      })
    );
  });

  it("records a terminal failure when retries are exhausted", async () => {
    mockedFindWebhookDeliveryById.mockResolvedValue(
      createDelivery({
        attemptCount: 2,
        maxAttempts: 3,
      })
    );
    mockedAppendWebhookDeliveryAttempt.mockResolvedValue(
      createDelivery({
        status: "failed",
        attemptCount: 3,
      }) as any
    );
    (global.fetch as jest.Mock).mockRejectedValue(new Error("network down"));

    const result = await runWorkflowWebhookDeliverySendJob({
      userId: "user-1",
      deliveryId: "delivery-1",
      correlationId: "corr-3",
    });

    expect(result).toMatchObject({
      deliveryId: "delivery-1",
      retryScheduled: false,
      status: "failed",
    });
    expect(mockedAppendWebhookDeliveryAttempt).toHaveBeenCalledWith(
      expect.anything(),
      "delivery-1",
      expect.objectContaining({
        status: "failed",
        nextAttemptAt: null,
      })
    );
    expect(mockedEnqueueJob).not.toHaveBeenCalled();
  });
});

