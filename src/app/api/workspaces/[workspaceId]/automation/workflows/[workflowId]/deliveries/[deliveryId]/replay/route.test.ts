import { POST } from "@/app/api/workspaces/[workspaceId]/automation/workflows/[workflowId]/deliveries/[deliveryId]/replay/route";
import { findAutomationWorkflowById } from "@/lib/automation-workflows";
import { enqueueJob } from "@/lib/jobs/store";
import {
  createWebhookDeliveryReplay,
  findWebhookDeliveryById,
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

jest.mock("@/lib/jobs/store", () => ({
  enqueueJob: jest.fn(),
}));

jest.mock("@/lib/webhook-deliveries", () => ({
  createWebhookDeliveryReplay: jest.fn(),
  findWebhookDeliveryById: jest.fn(),
  serializeWebhookDelivery: jest.requireActual("@/lib/webhook-deliveries")
    .serializeWebhookDelivery,
}));

const mockedRequireWorkspaceRouteAccess =
  requireWorkspaceRouteAccess as jest.MockedFunction<typeof requireWorkspaceRouteAccess>;
const mockedFindAutomationWorkflowById =
  findAutomationWorkflowById as jest.MockedFunction<typeof findAutomationWorkflowById>;
const mockedFindWebhookDeliveryById =
  findWebhookDeliveryById as jest.MockedFunction<typeof findWebhookDeliveryById>;
const mockedCreateWebhookDeliveryReplay =
  createWebhookDeliveryReplay as jest.MockedFunction<typeof createWebhookDeliveryReplay>;
const mockedEnqueueJob = enqueueJob as jest.MockedFunction<typeof enqueueJob>;

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
    sourceEventId: "meeting.ingested:meeting-1",
    deliveryKey: null,
    status: "failed",
    maxAttempts: 5,
    attemptCount: 5,
    request: {
      url: "https://example.com/hook",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: { meetingId: "meeting-1" },
      bodySha256: "hash-1",
    },
    attempts: [],
    latestResponse: null,
    lastError: { message: "Webhook responded with status 500." },
    nextAttemptAt: null,
    queuedAt: new Date("2026-04-16T10:05:00.000Z"),
    sentAt: null,
    failedAt: new Date("2026-04-16T10:05:02.000Z"),
    disabledAt: null,
    replayOfDeliveryId: null,
    createdAt: new Date("2026-04-16T10:05:00.000Z"),
    updatedAt: new Date("2026-04-16T10:05:02.000Z"),
    ...overrides,
  }) as any;

describe("workflow delivery replay route", () => {
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
    mockedFindWebhookDeliveryById.mockResolvedValue(createDelivery());
    mockedCreateWebhookDeliveryReplay.mockResolvedValue(
      createDelivery({
        _id: "delivery-replay-1",
        status: "queued",
        attemptCount: 0,
        failedAt: null,
        replayOfDeliveryId: "delivery-1",
      })
    );
    mockedEnqueueJob.mockResolvedValue({ _id: "job-1" } as any);
  });

  it("replays a failed delivery and enqueues send job", async () => {
    const response = await POST(new Request("http://localhost", { method: "POST" }), {
      params: {
        workspaceId: "workspace-1",
        workflowId: "workflow-1",
        deliveryId: "delivery-1",
      },
    });
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.ok).toBe(true);
    expect(payload.replayDelivery).toMatchObject({
      id: "delivery-replay-1",
      replayOfDeliveryId: "delivery-1",
      status: "queued",
    });
    expect(mockedCreateWebhookDeliveryReplay).toHaveBeenCalledWith(
      expect.anything(),
      "delivery-1"
    );
    expect(mockedEnqueueJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: "workflow-webhook-delivery-send",
        userId: "user-1",
        payload: { deliveryId: "delivery-replay-1" },
      })
    );
  });

  it("rejects replay when delivery is not failed/disabled", async () => {
    mockedFindWebhookDeliveryById.mockResolvedValue(createDelivery({ status: "sent" }));

    const response = await POST(new Request("http://localhost", { method: "POST" }), {
      params: {
        workspaceId: "workspace-1",
        workflowId: "workflow-1",
        deliveryId: "delivery-1",
      },
    });
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.errorCode).toBe("invalid_state");
    expect(mockedCreateWebhookDeliveryReplay).not.toHaveBeenCalled();
    expect(mockedEnqueueJob).not.toHaveBeenCalled();
  });

  it("blocks replay when user cannot manage the workflow", async () => {
    mockedRequireWorkspaceRouteAccess.mockResolvedValue({
      ok: true,
      db: {} as any,
      userId: "user-1",
      workspace: { _id: "workspace-1", name: "Main Workspace" },
      membership: { role: "member", status: "active" },
    } as any);
    mockedFindAutomationWorkflowById.mockResolvedValue(
      createWorkflow({ createdByUserId: "user-2" })
    );

    const response = await POST(new Request("http://localhost", { method: "POST" }), {
      params: {
        workspaceId: "workspace-1",
        workflowId: "workflow-1",
        deliveryId: "delivery-1",
      },
    });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.errorCode).toBe("forbidden");
    expect(mockedCreateWebhookDeliveryReplay).not.toHaveBeenCalled();
    expect(mockedEnqueueJob).not.toHaveBeenCalled();
  });
});
