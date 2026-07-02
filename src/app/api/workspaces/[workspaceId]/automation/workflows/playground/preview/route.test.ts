import { POST } from "@/app/api/workspaces/[workspaceId]/automation/workflows/playground/preview/route";
import {
  buildCanonicalWorkflowPayloadForAutomation,
  evaluateAutomationWorkflowFilters,
  runAutomationWorkflowTransform,
  selectAutomationWorkflowPayload,
} from "@/lib/meeting-workflow-automation";
import { getWorkflowGuardrailConfig } from "@/lib/workflow-guardrails";
import { requireWorkspaceRouteAccess } from "@/lib/workspace-route-access";

jest.mock("@/lib/workspace-route-access", () => ({
  requireWorkspaceRouteAccess: jest.fn(),
}));

jest.mock("@/lib/workflow-guardrails", () => ({
  getWorkflowGuardrailConfig: jest.fn(),
}));

jest.mock("@/lib/meeting-workflow-automation", () => ({
  buildCanonicalWorkflowPayloadForAutomation: jest.fn(),
  evaluateAutomationWorkflowFilters: jest.fn(),
  selectAutomationWorkflowPayload: jest.fn(),
  runAutomationWorkflowTransform: jest.fn(),
}));

const mockedRequireWorkspaceRouteAccess =
  requireWorkspaceRouteAccess as jest.MockedFunction<typeof requireWorkspaceRouteAccess>;
const mockedGetWorkflowGuardrailConfig =
  getWorkflowGuardrailConfig as jest.MockedFunction<typeof getWorkflowGuardrailConfig>;
const mockedBuildCanonicalWorkflowPayloadForAutomation =
  buildCanonicalWorkflowPayloadForAutomation as jest.MockedFunction<
    typeof buildCanonicalWorkflowPayloadForAutomation
  >;
const mockedEvaluateAutomationWorkflowFilters =
  evaluateAutomationWorkflowFilters as jest.MockedFunction<
    typeof evaluateAutomationWorkflowFilters
  >;
const mockedSelectAutomationWorkflowPayload =
  selectAutomationWorkflowPayload as jest.MockedFunction<typeof selectAutomationWorkflowPayload>;
const mockedRunAutomationWorkflowTransform =
  runAutomationWorkflowTransform as jest.MockedFunction<typeof runAutomationWorkflowTransform>;

const createMeeting = (overrides: Record<string, any> = {}) =>
  ({
    _id: "meeting-1",
    id: "meeting-1",
    workspaceId: "workspace-1",
    title: "Product Kickoff",
    summary: "Discussed goals and launch milestones.",
    originalTranscript: "kickoff transcript",
    attendees: [],
    extractedTasks: [],
    tags: [],
    meetingMetadata: null,
    recordingUrl: null,
    shareUrl: null,
    startTime: new Date("2026-04-16T09:00:00.000Z"),
    endTime: new Date("2026-04-16T09:30:00.000Z"),
    duration: 1800,
    connectionId: null,
    providerSourceId: null,
    createdAt: new Date("2026-04-16T09:00:00.000Z"),
    lastActivityAt: new Date("2026-04-16T09:31:00.000Z"),
    isHidden: false,
    ...overrides,
  }) as any;

const createDbMock = (meetings: any[]) => {
  const toArray = jest.fn().mockResolvedValue(meetings);
  const limit = jest.fn().mockReturnValue({ toArray });
  const sort = jest.fn().mockReturnValue({ limit });
  const find = jest.fn().mockReturnValue({ sort });
  const findOne = jest.fn().mockResolvedValue(null);
  return {
    collection: jest.fn().mockReturnValue({
      find,
      findOne,
    }),
  };
};

describe("workflow playground preview route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetWorkflowGuardrailConfig.mockReturnValue({
      transformOutputLimitBytes: 256 * 1024,
    } as any);
    mockedBuildCanonicalWorkflowPayloadForAutomation.mockImplementation(
      ((input: any) => ({
        event: {
          type: input?.eventType,
          emittedAt: new Date("2026-04-16T10:00:00.000Z").toISOString(),
        },
        meeting: {
          id: input?.meetingDoc?._id,
          title: input?.meetingDoc?.title,
          transcript: null,
          summary: null,
          attendees: [],
          attendeeCount: 0,
          attendeeNames: [],
          attendeeEmails: [],
          extractedTasks: [],
          taskCount: 0,
          taskTitles: [],
          taskStatuses: [],
          taskAssignees: [],
          tags: [],
          metadata: null,
          recordingUrl: null,
          shareUrl: null,
          startTime: null,
          endTime: null,
          duration: null,
          connectionId: null,
          providerSourceId: null,
          createdAt: null,
          lastActivityAt: null,
        },
        workspace: {
          id: input?.workspaceId,
        },
      })) as any
    );
    mockedSelectAutomationWorkflowPayload.mockImplementation((payload: any) => payload);
    mockedRunAutomationWorkflowTransform.mockResolvedValue({
      transformed: true,
    } as any);
  });

  it("returns matched meetings and transform output preview", async () => {
    const db = createDbMock([
      createMeeting({ _id: "meeting-1", title: "Product Kickoff" }),
      createMeeting({ _id: "meeting-2", title: "Weekly Standup" }),
    ]);

    mockedRequireWorkspaceRouteAccess.mockResolvedValue({
      ok: true,
      db: db as any,
      userId: "user-1",
      membership: { role: "owner", status: "active" },
      workspace: { _id: "workspace-1", name: "Main Workspace" },
    } as any);
    mockedEvaluateAutomationWorkflowFilters.mockImplementation((payload: any) =>
      String(payload?.meeting?.title || "").toLowerCase().includes("kickoff")
    );

    const response = await POST(
      new Request(
        "http://localhost/api/workspaces/workspace-1/automation/workflows/playground/preview",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            workflow: {
              trigger: "meeting.ingested",
              filters: [],
              fieldSelection: { mode: "all", fields: [] },
              transform: {
                runtime: "quickjs",
                script: "return input;",
                timeoutMs: 1000,
              },
            },
          }),
        }
      ),
      {
        params: { workspaceId: "workspace-1" },
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.consideredMeetingCount).toBe(2);
    expect(payload.matchedMeetingCount).toBe(1);
    expect(payload.meetings[0]).toMatchObject({
      id: "meeting-1",
      matched: true,
    });
    expect(payload.meetings[1]).toMatchObject({
      id: "meeting-2",
      matched: false,
    });
    expect(payload.selectedMeeting).toMatchObject({
      id: "meeting-1",
    });
    expect(payload.transformOutput).toMatchObject({
      transformed: true,
    });
    expect(mockedRunAutomationWorkflowTransform).toHaveBeenCalledTimes(1);
  });

  it("includes transform error details when transform fails", async () => {
    const db = createDbMock([createMeeting()]);

    mockedRequireWorkspaceRouteAccess.mockResolvedValue({
      ok: true,
      db: db as any,
      userId: "user-1",
      membership: { role: "owner", status: "active" },
      workspace: { _id: "workspace-1", name: "Main Workspace" },
    } as any);
    mockedEvaluateAutomationWorkflowFilters.mockReturnValue(true);
    mockedRunAutomationWorkflowTransform.mockRejectedValue(new Error("transform failed"));

    const response = await POST(
      new Request(
        "http://localhost/api/workspaces/workspace-1/automation/workflows/playground/preview",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            workflow: {
              trigger: "meeting.ingested",
              filters: [],
              fieldSelection: { mode: "all", fields: [] },
              transform: {
                runtime: "quickjs",
                script: "throw new Error('bad');",
                timeoutMs: 1000,
              },
            },
          }),
        }
      ),
      {
        params: { workspaceId: "workspace-1" },
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.transformOutput).toBe(null);
    expect(payload.transformOutputError).toMatchObject({
      message: "transform failed",
    });
  });
});
