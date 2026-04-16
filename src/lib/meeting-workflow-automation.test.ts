import { listEnabledAutomationWorkflowsForTrigger } from "@/lib/automation-workflows";
import { enqueueJob } from "@/lib/jobs/store";
import { queueMeetingWorkflowAutomation } from "@/lib/meeting-workflow-automation";
import { createWebhookDelivery } from "@/lib/webhook-deliveries";

jest.mock("@/lib/automation-workflows", () => ({
  listEnabledAutomationWorkflowsForTrigger: jest.fn(),
}));

jest.mock("@/lib/jobs/store", () => ({
  enqueueJob: jest.fn(),
}));

jest.mock("@/lib/webhook-deliveries", () => ({
  createWebhookDelivery: jest.fn(),
}));

const mockedListEnabledAutomationWorkflowsForTrigger =
  listEnabledAutomationWorkflowsForTrigger as jest.MockedFunction<
    typeof listEnabledAutomationWorkflowsForTrigger
  >;
const mockedCreateWebhookDelivery =
  createWebhookDelivery as jest.MockedFunction<typeof createWebhookDelivery>;
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
      headers: { "x-custom": "true" },
    },
    createdByUserId: "user-1",
    updatedByUserId: "user-1",
    createdAt: new Date("2026-04-16T10:00:00.000Z"),
    updatedAt: new Date("2026-04-16T10:00:00.000Z"),
    ...overrides,
  }) as any;

const createDb = (meetingDoc: Record<string, any> | null) =>
  ({
    collection: jest.fn((name: string) => {
      if (name !== "meetings") {
        throw new Error(`Unexpected collection ${name}`);
      }
      return {
        findOne: jest.fn().mockResolvedValue(meetingDoc),
      };
    }),
  }) as any;

describe("queueMeetingWorkflowAutomation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedCreateWebhookDelivery.mockResolvedValue({ _id: "delivery-1" } as any);
    mockedEnqueueJob.mockResolvedValue({ _id: "job-1" } as any);
  });

  it("matches workflows and enqueues delivery jobs", async () => {
    const db = createDb({
      _id: "meeting-1",
      workspaceId: "workspace-1",
      connectionId: "connection-1",
      providerSourceId: "fathom-user-1",
      title: "Weekly Sync",
      summary: "Summary",
      attendees: [{ name: "Jane Doe" }],
      extractedTasks: [{ id: "task-1", title: "Follow up" }],
      createdAt: new Date("2026-04-16T10:00:00.000Z"),
      lastActivityAt: new Date("2026-04-16T10:05:00.000Z"),
    });
    mockedListEnabledAutomationWorkflowsForTrigger.mockResolvedValue([
      createWorkflow({
        _id: "workflow-match",
        filters: [
          {
            field: "meeting.title",
            operator: "contains",
            value: "weekly",
          },
        ],
      }),
      createWorkflow({
        _id: "workflow-no-match",
        filters: [
          {
            field: "meeting.title",
            operator: "contains",
            value: "daily",
          },
        ],
      }),
    ] as any);

    const result = await queueMeetingWorkflowAutomation({
      db,
      userId: "user-1",
      eventType: "meeting.ingested",
      payload: {
        meetingId: "meeting-1",
      },
      correlationId: "corr-1",
      kickWorker: false,
    });

    expect(result).toEqual({
      workspaceId: "workspace-1",
      checkedWorkflows: 2,
      matchedWorkflows: 1,
      queuedDeliveries: 1,
    });
    expect(mockedCreateWebhookDelivery).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        workspaceId: "workspace-1",
        workflowId: "workflow-match",
        eventType: "meeting.ingested",
        connectionId: "connection-1",
        request: expect.objectContaining({
          url: "https://example.com/hook",
          headers: expect.objectContaining({
            "content-type": "application/json",
            "x-taskwise-event": "meeting.ingested",
            "x-taskwise-workflow-id": "workflow-match",
          }),
        }),
      })
    );
    expect(mockedEnqueueJob).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        type: "workflow-webhook-delivery-send",
        userId: "user-1",
        correlationId: "corr-1",
      })
    );
  });

  it("returns without queueing when workspace cannot be resolved", async () => {
    const db = createDb(null);
    mockedListEnabledAutomationWorkflowsForTrigger.mockResolvedValue([] as any);

    const result = await queueMeetingWorkflowAutomation({
      db,
      userId: "user-1",
      eventType: "meeting.ingested",
      payload: {
        meetingId: "meeting-1",
      },
      kickWorker: false,
    });

    expect(result).toEqual({
      workspaceId: null,
      checkedWorkflows: 0,
      matchedWorkflows: 0,
      queuedDeliveries: 0,
    });
    expect(mockedCreateWebhookDelivery).not.toHaveBeenCalled();
    expect(mockedEnqueueJob).not.toHaveBeenCalled();
  });
});

