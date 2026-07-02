import {
  buildRetryHeaders,
  recordWorkflowFailureDelivery,
  toSerializableError,
} from "@/lib/meeting-workflow-automation-delivery";
import { createWebhookDelivery, appendWebhookDeliveryAttempt } from "@/lib/webhook-deliveries";
import { maybeAutoDisableWorkflowForRepeatedFailures } from "@/lib/workflow-guardrails";
import { WorkflowTransformError } from "@/lib/workflow-transform";

jest.mock("@/lib/webhook-deliveries", () => ({
  createWebhookDelivery: jest.fn(),
  appendWebhookDeliveryAttempt: jest.fn(),
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

const mockedCreateWebhookDelivery =
  createWebhookDelivery as jest.MockedFunction<typeof createWebhookDelivery>;
const mockedAppendWebhookDeliveryAttempt =
  appendWebhookDeliveryAttempt as jest.MockedFunction<
    typeof appendWebhookDeliveryAttempt
  >;
const mockedMaybeAutoDisableWorkflowForRepeatedFailures =
  maybeAutoDisableWorkflowForRepeatedFailures as jest.MockedFunction<
    typeof maybeAutoDisableWorkflowForRepeatedFailures
  >;

describe("meeting-workflow-automation-delivery", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("builds signed retry headers", () => {
    expect(
      buildRetryHeaders(
        {
          _id: "workflow-1",
          version: 2,
          trigger: "meeting.ingested",
          destination: { signingSecret: "secret-1" },
        } as any,
        "{\"ok\":true}",
        new Date("2026-07-02T10:30:00.000Z")
      )
    ).toMatchObject({
      "content-type": "application/json",
      "x-taskwise-event": "meeting.ingested",
      "x-taskwise-workflow-id": "workflow-1",
      "x-taskwise-workflow-version": "2",
      "x-taskwise-signature-timestamp": "1782988200",
      "x-taskwise-signature-v1": expect.any(String),
    });
  });

  it("serializes workflow transform errors with code and details", () => {
    const error = new WorkflowTransformError("timeout", "Timed out", { timeoutMs: 1000 });
    expect(toSerializableError(error)).toEqual(
      expect.objectContaining({
        name: "WorkflowTransformError",
        message: "Timed out",
        code: "timeout",
        details: { timeoutMs: 1000 },
      })
    );
  });

  it("records a failed delivery attempt and asks guardrails to auto-disable workflows", async () => {
    mockedCreateWebhookDelivery.mockResolvedValue({
      request: { url: "https://example.com/hook" },
    } as any);
    mockedAppendWebhookDeliveryAttempt.mockResolvedValue({
      _id: "delivery-1",
      status: "failed",
    } as any);
    mockedMaybeAutoDisableWorkflowForRepeatedFailures.mockResolvedValue({
      checked: true,
      threshold: 5,
      failedCount: 1,
      disabled: false,
      windowStartAt: null,
    });

    await recordWorkflowFailureDelivery({
      db: { collection: jest.fn() },
      workspaceId: "workspace-1",
      meetingId: "meeting-1",
      eventType: "meeting.ingested",
      workflow: {
        _id: "workflow-1",
        version: 2,
        destination: { url: "https://example.com/hook" },
      } as any,
      canonicalPayload: {
        event: { type: "meeting.ingested", emittedAt: "2026-07-02T10:30:00.000Z" },
        workspace: { id: "workspace-1" },
        meeting: { connectionId: "connection-1" },
      } as any,
      error: new Error("boom"),
      reason: "workflow_transform_runtime_error",
    });

    expect(mockedCreateWebhookDelivery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        workspaceId: "workspace-1",
        workflowId: "workflow-1",
        eventType: "meeting.ingested",
      })
    );
    expect(mockedAppendWebhookDeliveryAttempt).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.objectContaining({
        status: "failed",
      })
    );
    expect(mockedMaybeAutoDisableWorkflowForRepeatedFailures).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        workflowId: "workflow-1",
        workspaceId: "workspace-1",
        reason: "workflow_transform_runtime_error",
      })
    );
  });
});
