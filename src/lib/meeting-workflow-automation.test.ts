import { listEnabledAutomationWorkflowsForTrigger } from "@/lib/automation-workflows";
import { enqueueJob } from "@/lib/jobs/store";
import { queueMeetingWorkflowAutomation } from "@/lib/meeting-workflow-automation";
import {
  appendWebhookDeliveryAttempt,
  createWebhookDelivery,
} from "@/lib/webhook-deliveries";
import { maybeAutoDisableWorkflowForRepeatedFailures } from "@/lib/workflow-guardrails";
import { runWorkflowTransform } from "@/lib/workflow-transform";

jest.mock("@/lib/automation-workflows", () => ({
  listEnabledAutomationWorkflowsForTrigger: jest.fn(),
}));

jest.mock("@/lib/jobs/store", () => ({
  enqueueJob: jest.fn(),
}));

jest.mock("@/lib/webhook-deliveries", () => ({
  appendWebhookDeliveryAttempt: jest.fn(),
  createWebhookDelivery: jest.fn(),
}));

jest.mock("@/lib/workflow-transform", () => ({
  WorkflowTransformError: class WorkflowTransformError extends Error {
    code: string;
    details?: Record<string, unknown>;

    constructor(
      code: string,
      message: string,
      details?: Record<string, unknown>
    ) {
      super(message);
      this.name = "WorkflowTransformError";
      this.code = code;
      this.details = details;
    }
  },
  runWorkflowTransform: jest.fn(),
}));

jest.mock("@/lib/workflow-guardrails", () => ({
  WORKFLOW_GUARDRAIL_SYSTEM_USER_ID: "system:workflow-guardrail",
  getWorkflowGuardrailConfig: jest.fn(() => ({
    deliveryBodyLimitBytes: 512 * 1024,
    transformMemoryLimitBytes: 8 * 1024 * 1024,
    transformStackLimitBytes: 512 * 1024,
    transformInputLimitBytes: 256 * 1024,
    transformOutputLimitBytes: 256 * 1024,
    autoDisableFailureThreshold: 5,
    autoDisableWindowMs: 60 * 60 * 1000,
  })),
  maybeAutoDisableWorkflowForRepeatedFailures: jest.fn(),
}));

const mockedListEnabledAutomationWorkflowsForTrigger =
  listEnabledAutomationWorkflowsForTrigger as jest.MockedFunction<
    typeof listEnabledAutomationWorkflowsForTrigger
  >;
const mockedCreateWebhookDelivery =
  createWebhookDelivery as jest.MockedFunction<typeof createWebhookDelivery>;
const mockedAppendWebhookDeliveryAttempt =
  appendWebhookDeliveryAttempt as jest.MockedFunction<
    typeof appendWebhookDeliveryAttempt
  >;
const mockedEnqueueJob = enqueueJob as jest.MockedFunction<typeof enqueueJob>;
const mockedRunWorkflowTransform =
  runWorkflowTransform as jest.MockedFunction<typeof runWorkflowTransform>;
const mockedMaybeAutoDisableWorkflowForRepeatedFailures =
  maybeAutoDisableWorkflowForRepeatedFailures as jest.MockedFunction<
    typeof maybeAutoDisableWorkflowForRepeatedFailures
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
    mockedCreateWebhookDelivery.mockImplementation(
      (async (_db: any, input: any) =>
        ({
          _id: input.id || "delivery-1",
          request: input.request,
          status: "queued",
        }) as any) as any
    );
    mockedAppendWebhookDeliveryAttempt.mockResolvedValue({
      _id: "delivery-1",
      status: "failed",
    } as any);
    mockedEnqueueJob.mockResolvedValue({ _id: "job-1" } as any);
    mockedRunWorkflowTransform.mockResolvedValue({
      payload: { transformed: true },
      inputBytes: 16,
      outputBytes: 32,
    });
    mockedMaybeAutoDisableWorkflowForRepeatedFailures.mockResolvedValue({
      checked: true,
      threshold: 5,
      failedCount: 1,
      disabled: false,
      windowStartAt: null,
    });
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

  it("records a failed delivery attempt when workflow transform throws", async () => {
    const db = createDb({
      _id: "meeting-1",
      workspaceId: "workspace-1",
      connectionId: "connection-1",
      title: "Weekly Sync",
      summary: "Summary",
      attendees: [{ name: "Jane Doe" }],
      extractedTasks: [{ id: "task-1", title: "Follow up" }],
    });
    mockedListEnabledAutomationWorkflowsForTrigger.mockResolvedValue([
      createWorkflow({
        _id: "workflow-transform-fail",
        filters: [
          {
            field: "meeting.title",
            operator: "contains",
            value: "weekly",
          },
        ],
        transform: {
          runtime: "quickjs",
          script: "return (payload) => ({ ...payload, changed: true });",
          timeoutMs: 500,
        },
      }),
    ] as any);
    mockedRunWorkflowTransform.mockRejectedValue(new Error("transform failed"));

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
      workspaceId: "workspace-1",
      checkedWorkflows: 1,
      matchedWorkflows: 1,
      queuedDeliveries: 0,
    });
    expect(mockedAppendWebhookDeliveryAttempt).toHaveBeenCalledWith(
      db,
      expect.any(String),
      expect.objectContaining({
        status: "failed",
      })
    );
    expect(mockedEnqueueJob).not.toHaveBeenCalled();
    expect(mockedMaybeAutoDisableWorkflowForRepeatedFailures).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        workflowId: "workflow-transform-fail",
        workspaceId: "workspace-1",
      })
    );
  });

  it("supports richer workflow filters for transcript, tags, attendees, and tasks", async () => {
    const db = createDb({
      _id: "meeting-1",
      workspaceId: "workspace-1",
      connectionId: "connection-1",
      title: "Launch Planning",
      originalTranscript: "Weekly roadmap review with customer rollout discussion.",
      summary: "Summary",
      tags: ["product", "customer"],
      attendees: [
        { name: "Jane Doe", email: "jane@example.com" },
        { name: "Mark Smith", email: "mark@example.com" },
      ],
      extractedTasks: [
        { id: "task-1", title: "Prepare launch update", status: "open" },
        { id: "task-2", title: "Draft customer follow-up", status: "in_progress" },
      ],
    });
    mockedListEnabledAutomationWorkflowsForTrigger.mockResolvedValue([
      createWorkflow({
        _id: "workflow-rich-match",
        filters: [
          { field: "meeting.transcript", operator: "contains_all", value: ["weekly", "rollout"] },
          { field: "meeting.tags", operator: "contains_any", value: ["customer", "finance"] },
          {
            field: "meeting.attendeeEmails",
            operator: "contains_any",
            value: ["jane@example.com"],
          },
          { field: "meeting.taskStatuses", operator: "contains_any", value: ["open"] },
          { field: "meeting.taskCount", operator: "greater_than_or_equal", value: 2 },
        ],
      }),
      createWorkflow({
        _id: "workflow-rich-no-match",
        filters: [{ field: "meeting.taskCount", operator: "less_than", value: 2 }],
      }),
    ] as any);

    const result = await queueMeetingWorkflowAutomation({
      db,
      userId: "user-1",
      eventType: "meeting.ingested",
      payload: {
        meetingId: "meeting-1",
      },
      correlationId: "corr-rich",
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
        workflowId: "workflow-rich-match",
      })
    );
  });
});
