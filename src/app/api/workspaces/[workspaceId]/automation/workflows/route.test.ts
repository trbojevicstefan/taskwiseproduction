import {
  GET,
  POST,
} from "@/app/api/workspaces/[workspaceId]/automation/workflows/route";
import {
  createAutomationWorkflow,
  listAutomationWorkflowsForWorkspace,
} from "@/lib/automation-workflows";
import { requireWorkspaceRouteAccess } from "@/lib/workspace-route-access";

jest.mock("@/lib/workspace-route-access", () => ({
  requireWorkspaceRouteAccess: jest.fn(),
}));

jest.mock("@/lib/automation-workflows", () => ({
  createAutomationWorkflow: jest.fn(),
  listAutomationWorkflowsForWorkspace: jest.fn(),
  serializeAutomationWorkflow: jest.requireActual("@/lib/automation-workflows")
    .serializeAutomationWorkflow,
}));

const mockedRequireWorkspaceRouteAccess =
  requireWorkspaceRouteAccess as jest.MockedFunction<typeof requireWorkspaceRouteAccess>;
const mockedListAutomationWorkflowsForWorkspace =
  listAutomationWorkflowsForWorkspace as jest.MockedFunction<
    typeof listAutomationWorkflowsForWorkspace
  >;
const mockedCreateAutomationWorkflow =
  createAutomationWorkflow as jest.MockedFunction<typeof createAutomationWorkflow>;

const createWorkflow = (overrides: Record<string, any> = {}) =>
  ({
    _id: "workflow-1",
    workspaceId: "workspace-1",
    name: "Meeting Updates",
    description: "Send updates to a webhook",
    enabled: true,
    version: 1,
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

describe("workspace automation workflows route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRequireWorkspaceRouteAccess.mockResolvedValue({
      ok: true,
      db: {} as any,
      userId: "user-1",
      workspace: { _id: "workspace-1", name: "Main Workspace" },
      membership: { role: "owner", status: "active" },
    } as any);
  });

  it("lists workflows for a workspace", async () => {
    mockedListAutomationWorkflowsForWorkspace.mockResolvedValue([createWorkflow()] as any);

    const response = await GET(new Request("http://localhost"), {
      params: { workspaceId: "workspace-1" },
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.totalCount).toBe(1);
    expect(payload.workflows[0]).toMatchObject({
      id: "workflow-1",
      name: "Meeting Updates",
      canManage: true,
    });
    expect(payload.workflows[0].destination).not.toHaveProperty("signingSecret");
  });

  it("creates a workflow for owners/admins", async () => {
    mockedListAutomationWorkflowsForWorkspace.mockResolvedValue([] as any);
    mockedCreateAutomationWorkflow.mockResolvedValue(createWorkflow() as any);

    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Meeting Updates",
          trigger: "meeting.ingested",
          destination: {
            type: "webhook",
            url: "https://example.com/hook",
            signingSecret: "secret-1",
            headers: { "x-test": "true" },
          },
        }),
      }),
      {
        params: { workspaceId: "workspace-1" },
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.ok).toBe(true);
    expect(mockedCreateAutomationWorkflow).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        workspaceId: "workspace-1",
        createdByUserId: "user-1",
        destination: expect.objectContaining({
          url: "https://example.com/hook",
          signingSecret: "secret-1",
        }),
      })
    );
    expect(payload.workflow.destination.signingSecret).toBe("secret-1");
  });
});
