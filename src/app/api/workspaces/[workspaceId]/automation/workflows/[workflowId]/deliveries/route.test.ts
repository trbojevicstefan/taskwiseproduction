import { GET } from "@/app/api/workspaces/[workspaceId]/automation/workflows/[workflowId]/deliveries/route";
import { findAutomationWorkflowById } from "@/lib/automation-workflows";
import { listWebhookDeliveriesForWorkspace } from "@/lib/webhook-deliveries";
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
  listWebhookDeliveriesForWorkspace: jest.fn(),
  serializeWebhookDelivery: jest.requireActual("@/lib/webhook-deliveries")
    .serializeWebhookDelivery,
}));

const mockedRequireWorkspaceRouteAccess =
  requireWorkspaceRouteAccess as jest.MockedFunction<typeof requireWorkspaceRouteAccess>;
const mockedFindAutomationWorkflowById =
  findAutomationWorkflowById as jest.MockedFunction<typeof findAutomationWorkflowById>;
const mockedListWebhookDeliveriesForWorkspace =
  listWebhookDeliveriesForWorkspace as jest.MockedFunction<
    typeof listWebhookDeliveriesForWorkspace
  >;

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
    status: "failed",
    maxAttempts: 3,
    attemptCount: 1,
    request: {
      url: "https://example.com/hook",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: { meetingId: "meeting-1" },
      bodySha256: "hash-1",
    },
    attempts: [],
    latestResponse: {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: "{\"error\":\"failed\"}",
      durationMs: 250,
      receivedAt: new Date("2026-04-16T10:05:02.000Z"),
    },
    lastError: {
      name: "Error",
      message: "Webhook responded with status 500.",
    },
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

describe("workflow deliveries route", () => {
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
  });

  it("lists deliveries for a workflow with filters", async () => {
    mockedListWebhookDeliveriesForWorkspace.mockResolvedValue([createDelivery()] as any);

    const response = await GET(
      new Request(
        "http://localhost/api/workspaces/workspace-1/automation/workflows/workflow-1/deliveries?status=failed&limit=10"
      ),
      {
        params: { workspaceId: "workspace-1", workflowId: "workflow-1" },
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.totalCount).toBe(1);
    expect(payload.workflow).toMatchObject({
      id: "workflow-1",
      name: "Meeting Updates",
    });
    expect(payload.workflow.destination).not.toHaveProperty("signingSecret");
    expect(payload.deliveries[0]).toMatchObject({
      id: "delivery-1",
      status: "failed",
    });
    expect(mockedListWebhookDeliveriesForWorkspace).toHaveBeenCalledWith(
      expect.anything(),
      "workspace-1",
      {
        workflowId: "workflow-1",
        status: "failed",
        limit: 10,
      }
    );
  });
});
