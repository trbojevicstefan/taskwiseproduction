import {
  DELETE,
  GET,
  PATCH,
} from "@/app/api/workspaces/[workspaceId]/automation/workflows/[workflowId]/route";
import {
  deleteAutomationWorkflowById,
  findAutomationWorkflowById,
  listAutomationWorkflowsForWorkspace,
  updateAutomationWorkflowById,
} from "@/lib/automation-workflows";
import { requireWorkspaceRouteAccess } from "@/lib/workspace-route-access";

jest.mock("@/lib/workspace-route-access", () => ({
  requireWorkspaceRouteAccess: jest.fn(),
}));

jest.mock("@/lib/automation-workflows", () => ({
  deleteAutomationWorkflowById: jest.fn(),
  findAutomationWorkflowById: jest.fn(),
  listAutomationWorkflowsForWorkspace: jest.fn(),
  serializeAutomationWorkflow: jest.requireActual("@/lib/automation-workflows")
    .serializeAutomationWorkflow,
  updateAutomationWorkflowById: jest.fn(),
}));

const mockedRequireWorkspaceRouteAccess =
  requireWorkspaceRouteAccess as jest.MockedFunction<typeof requireWorkspaceRouteAccess>;
const mockedFindAutomationWorkflowById =
  findAutomationWorkflowById as jest.MockedFunction<typeof findAutomationWorkflowById>;
const mockedListAutomationWorkflowsForWorkspace =
  listAutomationWorkflowsForWorkspace as jest.MockedFunction<
    typeof listAutomationWorkflowsForWorkspace
  >;
const mockedUpdateAutomationWorkflowById =
  updateAutomationWorkflowById as jest.MockedFunction<typeof updateAutomationWorkflowById>;
const mockedDeleteAutomationWorkflowById =
  deleteAutomationWorkflowById as jest.MockedFunction<typeof deleteAutomationWorkflowById>;

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

describe("workspace automation workflow detail route", () => {
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

  it("loads a workflow with secrets for editing", async () => {
    const response = await GET(new Request("http://localhost"), {
      params: { workspaceId: "workspace-1", workflowId: "workflow-1" },
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.workflow.destination.signingSecret).toBe("secret-1");
  });

  it("updates a workflow", async () => {
    mockedListAutomationWorkflowsForWorkspace.mockResolvedValue([createWorkflow()] as any);
    mockedUpdateAutomationWorkflowById.mockResolvedValue(
      createWorkflow({ name: "Meeting Updates V2", version: 2 }) as any
    );

    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Meeting Updates V2", enabled: false }),
      }),
      {
        params: { workspaceId: "workspace-1", workflowId: "workflow-1" },
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.workflow.name).toBe("Meeting Updates V2");
    expect(mockedUpdateAutomationWorkflowById).toHaveBeenCalledWith(
      expect.anything(),
      "workflow-1",
      expect.objectContaining({
        name: "Meeting Updates V2",
        enabled: false,
        updatedByUserId: "user-1",
      })
    );
  });

  it("deletes a workflow", async () => {
    mockedDeleteAutomationWorkflowById.mockResolvedValue({ deletedCount: 1 } as any);

    const response = await DELETE(new Request("http://localhost"), {
      params: { workspaceId: "workspace-1", workflowId: "workflow-1" },
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.deleted).toBe(true);
    expect(mockedDeleteAutomationWorkflowById).toHaveBeenCalledWith(
      expect.anything(),
      "workflow-1"
    );
  });
});
