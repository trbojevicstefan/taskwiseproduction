import { GET, POST } from "@/app/api/workspaces/[workspaceId]/google/logs/route";
import { listGoogleIntegrationLogsForWorkspace, logGoogleIntegration } from "@/lib/google-logs";
import { requireWorkspaceRouteAccess } from "@/lib/workspace-route-access";

jest.mock("@/lib/workspace-route-access", () => ({
  requireWorkspaceRouteAccess: jest.fn(),
}));

jest.mock("@/lib/google-logs", () => ({
  listGoogleIntegrationLogsForWorkspace: jest.fn(),
  logGoogleIntegration: jest.fn(),
  serializeGoogleIntegrationLog: jest.requireActual("@/lib/google-logs").serializeGoogleIntegrationLog,
}));

const mockedRequireWorkspaceRouteAccess =
  requireWorkspaceRouteAccess as jest.MockedFunction<typeof requireWorkspaceRouteAccess>;
const mockedListGoogleIntegrationLogsForWorkspace =
  listGoogleIntegrationLogsForWorkspace as jest.MockedFunction<
    typeof listGoogleIntegrationLogsForWorkspace
  >;
const mockedLogGoogleIntegration =
  logGoogleIntegration as jest.MockedFunction<typeof logGoogleIntegration>;

describe("workspace google logs route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRequireWorkspaceRouteAccess.mockResolvedValue({
      ok: true,
      db: {} as any,
      userId: "user-1",
      workspace: { _id: "workspace-1", name: "Main Workspace" },
      membership: { role: "owner", status: "active" },
    } as any);
    mockedListGoogleIntegrationLogsForWorkspace.mockResolvedValue([
      {
        _id: "google-log-1",
        workspaceId: "workspace-1",
        userId: "user-2",
        actorUserId: "user-1",
        level: "warn",
        event: "oauth.token.revoke.completed_with_warning",
        message: "Local credentials cleared, remote revoke returned warning.",
        metadata: { remotelyRevoked: false },
        createdAt: new Date("2026-04-16T14:20:00.000Z"),
        expiresAt: new Date("2026-05-16T14:20:00.000Z"),
      } as any,
    ]);
  });

  it("lists workspace google logs", async () => {
    const response = await GET(
      new Request("http://localhost/api/workspaces/workspace-1/google/logs?limit=20"),
      {
        params: { workspaceId: "workspace-1" },
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.totalCount).toBe(1);
    expect(payload.logs[0]).toMatchObject({
      id: "google-log-1",
      level: "warn",
      event: "oauth.token.revoke.completed_with_warning",
    });
    expect(mockedListGoogleIntegrationLogsForWorkspace).toHaveBeenCalledWith(
      expect.anything(),
      "workspace-1",
      20
    );
  });

  it("records a workspace google log entry", async () => {
    mockedLogGoogleIntegration.mockResolvedValue(undefined as never);

    const response = await POST(
      new Request("http://localhost/api/workspaces/workspace-1/google/logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          level: "error",
          event: "oauth.connect.failed",
          message: "Google OAuth callback failed.",
          metadata: { errorCode: "OAuthCallback" },
        }),
      }),
      {
        params: { workspaceId: "workspace-1" },
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.logged).toBe(true);
    expect(mockedLogGoogleIntegration).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace-1",
        userId: "user-1",
        event: "oauth.connect.failed",
      })
    );
  });
});
