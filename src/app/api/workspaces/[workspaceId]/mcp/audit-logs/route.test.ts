import { GET } from "@/app/api/workspaces/[workspaceId]/mcp/audit-logs/route";
import { listMcpAuditLogsForWorkspace } from "@/lib/mcp-audit-logs";
import { requireWorkspaceRouteAccess } from "@/lib/workspace-route-access";

jest.mock("@/lib/workspace-route-access", () => ({
  requireWorkspaceRouteAccess: jest.fn(),
}));

jest.mock("@/lib/mcp-audit-logs", () => ({
  listMcpAuditLogsForWorkspace: jest.fn(),
  serializeMcpAuditLog: jest.requireActual("@/lib/mcp-audit-logs").serializeMcpAuditLog,
}));

const mockedRequireWorkspaceRouteAccess =
  requireWorkspaceRouteAccess as jest.MockedFunction<typeof requireWorkspaceRouteAccess>;
const mockedListMcpAuditLogsForWorkspace =
  listMcpAuditLogsForWorkspace as jest.MockedFunction<typeof listMcpAuditLogsForWorkspace>;

describe("workspace mcp audit logs route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRequireWorkspaceRouteAccess.mockResolvedValue({
      ok: true,
      db: {} as any,
      userId: "user-1",
      workspace: { _id: "workspace-1", name: "Main Workspace" },
      membership: { role: "owner", status: "active" },
    } as any);
    mockedListMcpAuditLogsForWorkspace.mockResolvedValue([
      {
        _id: "audit-1",
        workspaceId: "workspace-1",
        actorType: "api_key",
        actorUserId: null,
        apiKeyId: "key-1",
        apiKeyName: "Write Key",
        action: "mcp.tool.call",
        resourceType: "task",
        resourceId: "task-1",
        status: "success",
        message: "Executed action_items.update_status",
        metadata: { toolName: "action_items.update_status" },
        createdAt: new Date("2026-04-16T12:00:00.000Z"),
        expiresAt: new Date("2026-07-16T12:00:00.000Z"),
      } as any,
    ]);
  });

  it("lists workspace MCP audit logs", async () => {
    const response = await GET(
      new Request("http://localhost/api/workspaces/workspace-1/mcp/audit-logs?limit=20"),
      {
        params: { workspaceId: "workspace-1" },
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.totalCount).toBe(1);
    expect(payload.logs[0]).toMatchObject({
      id: "audit-1",
      action: "mcp.tool.call",
      status: "success",
    });
  });
});
