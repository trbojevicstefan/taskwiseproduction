import { POST } from "@/app/api/workspaces/[workspaceId]/automation/workflows/[workflowId]/test/route";
import { findAutomationWorkflowById } from "@/lib/automation-workflows";
import {
  appendWebhookDeliveryAttempt,
  createWebhookDelivery,
} from "@/lib/webhook-deliveries";
import { requireWorkspaceRouteAccess } from "@/lib/workspace-route-access";

jest.mock("@/lib/workspace-route-access", () => ({
  requireWorkspaceRouteAccess: jest.fn(),
}));

jest.mock("@/lib/automation-workflows", () => ({
  findAutomationWorkflowById: jest.fn(),
  serializeAutomationWorkflow: jest.requireActual("@/lib/automation-workflows")
    .serializeAutomationWorkflow,
}));

jest.mock("@/lib/webhook-deliveries", () => ({
  appendWebhookDeliveryAttempt: jest.fn(),
  createWebhookDelivery: jest.fn(),
  serializeWebhookDelivery: jest.requireActual("@/lib/webhook-deliveries")
    .serializeWebhookDelivery,
}));

const mockedRequireWorkspaceRouteAccess =
  requireWorkspaceRouteAccess as jest.MockedFunction<typeof requireWorkspaceRouteAccess>;
const mockedFindAutomationWorkflowById =
  findAutomationWorkflowById as jest.MockedFunction<typeof findAutomationWorkflowById>;
const mockedCreateWebhookDelivery =
  createWebhookDelivery as jest.MockedFunction<typeof createWebhookDelivery>;
const mockedAppendWebhookDeliveryAttempt =
  appendWebhookDeliveryAttempt as jest.MockedFunction<typeof appendWebhookDeliveryAttempt>;

const createWorkflow = (overrides: Record<string, any> = {}) =>
  ({
    _id: "workflow-1",
    workspaceId: "workspace-1",
    name: "Meeting Updates",
    description: "Send updates to a webhook",
    enabled: true,
    version: 2,
    trigger: "meeting.ingested",
    filters: [],
    fieldSelection: { mode: "all", fields: [] },
    transform: { runtime: "quickjs", script: null, timeoutMs: 1000 },
    destination: {
      type: "webhook",
      url: "https://example.com/hook",
      signingSecret: "secret-1",
      headers: { "x-test": "true" },
    },
    createdByUserId: "user-1",
    updatedByUserId: "user-1",
    createdAt: new Date("2026-04-16T10:00:00.000Z"),
    updatedAt: new Date("2026-04-16T10:00:00.000Z"),
    ...overrides,
  }) as any;

const createDelivery = (overrides: Record<string, any> = {}) =>
  ({
    _id: "delivery-1",
    workspaceId: "workspace-1",
    workflowId: "workflow-1",
    workflowVersion: 2,
    connectionId: null,
    eventType: "meeting.ingested",
    sourceEventId: null,
    deliveryKey: null,
    status: "queued",
    maxAttempts: 1,
    attemptCount: 0,
    request: {
      url: "https://example.com/hook",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: { hello: "world" },
      bodySha256: "hash-1",
    },
    attempts: [],
    latestResponse: null,
    lastError: null,
    nextAttemptAt: null,
    queuedAt: new Date("2026-04-16T10:05:00.000Z"),
    sentAt: null,
    failedAt: null,
    disabledAt: null,
    replayOfDeliveryId: null,
    createdAt: new Date("2026-04-16T10:05:00.000Z"),
    updatedAt: new Date("2026-04-16T10:05:00.000Z"),
    ...overrides,
  }) as any;

describe("workflow test delivery route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRequireWorkspaceRouteAccess.mockResolvedValue({
      ok: true,
      db: {} as any,
      userId: "user-1",
      workspace: { _id: "workspace-1", name: "Main Workspace" },
      membership: { role: "owner", status: "active" },
    } as any);
    mockedFindAutomationWorkflowById.mockResolvedValue(createWorkflow());
    global.fetch = jest.fn() as any;
  });

  it("sends a workflow test delivery and records a successful response", async () => {
    mockedCreateWebhookDelivery.mockResolvedValue(createDelivery());
    mockedAppendWebhookDeliveryAttempt.mockResolvedValue(
      createDelivery({
        status: "sent",
        attemptCount: 1,
        attempts: [
          {
            attemptNumber: 1,
            status: "sent",
            startedAt: new Date("2026-04-16T10:05:01.000Z"),
            finishedAt: new Date("2026-04-16T10:05:02.000Z"),
            request: {
              url: "https://example.com/hook",
              method: "POST",
              headers: { "content-type": "application/json" },
              body: { hello: "world" },
              bodySha256: "hash-1",
            },
            response: {
              statusCode: 202,
              headers: { "x-target": "ok" },
              body: "accepted",
              durationMs: 1000,
              receivedAt: new Date("2026-04-16T10:05:02.000Z"),
            },
          },
        ],
        latestResponse: {
          statusCode: 202,
          headers: { "x-target": "ok" },
          body: "accepted",
          durationMs: 1000,
          receivedAt: new Date("2026-04-16T10:05:02.000Z"),
        },
        sentAt: new Date("2026-04-16T10:05:02.000Z"),
        updatedAt: new Date("2026-04-16T10:05:02.000Z"),
      }) as any
    );
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response("accepted", {
        status: 202,
        headers: { "x-target": "ok" },
      })
    );

    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventType: "meeting.ingested",
          payload: { hello: "world" },
        }),
      }),
      {
        params: { workspaceId: "workspace-1", workflowId: "workflow-1" },
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.responseOk).toBe(true);
    expect(payload.responseStatusCode).toBe(202);
    expect(mockedCreateWebhookDelivery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        workspaceId: "workspace-1",
        workflowId: "workflow-1",
        workflowVersion: 2,
        eventType: "meeting.ingested",
        request: expect.objectContaining({
          url: "https://example.com/hook",
          body: { hello: "world" },
          headers: expect.objectContaining({
            "content-type": "application/json",
            "x-taskwise-test": "true",
            "x-taskwise-workflow-id": "workflow-1",
          }),
        }),
      })
    );
    expect(mockedAppendWebhookDeliveryAttempt).toHaveBeenCalledWith(
      expect.anything(),
      "delivery-1",
      expect.objectContaining({
        status: "sent",
      })
    );
  });

  it("returns a failed test result when the destination fetch rejects", async () => {
    mockedCreateWebhookDelivery.mockResolvedValue(createDelivery());
    mockedAppendWebhookDeliveryAttempt.mockResolvedValue(
      createDelivery({
        status: "failed",
        attemptCount: 1,
        attempts: [
          {
            attemptNumber: 1,
            status: "failed",
            startedAt: new Date("2026-04-16T10:05:01.000Z"),
            finishedAt: new Date("2026-04-16T10:05:02.000Z"),
            error: {
              name: "Error",
              message: "network down",
            },
          },
        ],
        lastError: {
          name: "Error",
          message: "network down",
        },
        failedAt: new Date("2026-04-16T10:05:02.000Z"),
        updatedAt: new Date("2026-04-16T10:05:02.000Z"),
      }) as any
    );
    (global.fetch as jest.Mock).mockRejectedValue(new Error("network down"));

    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
      {
        params: { workspaceId: "workspace-1", workflowId: "workflow-1" },
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.responseOk).toBe(false);
    expect(payload.responseStatusCode).toBeNull();
    expect(mockedAppendWebhookDeliveryAttempt).toHaveBeenCalledWith(
      expect.anything(),
      "delivery-1",
      expect.objectContaining({
        status: "failed",
        error: expect.objectContaining({
          message: "network down",
        }),
      })
    );
  });
});
