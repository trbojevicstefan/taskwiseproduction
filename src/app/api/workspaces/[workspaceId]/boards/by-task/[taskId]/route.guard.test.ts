import { GET } from "@/app/api/workspaces/[workspaceId]/boards/by-task/[taskId]/route";
import { requireWorkspaceRouteAccess } from "@/lib/workspace-route-access";

jest.mock("@/lib/workspace-route-access", () => ({
  requireWorkspaceRouteAccess: jest.fn(),
}));

const mockedRequireWorkspaceRouteAccess =
  requireWorkspaceRouteAccess as jest.MockedFunction<typeof requireWorkspaceRouteAccess>;

describe("GET /api/workspaces/[workspaceId]/boards/by-task/[taskId] guard behavior", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns forbidden when workspace access is denied", async () => {
    mockedRequireWorkspaceRouteAccess.mockResolvedValue({
      ok: false,
      response: new Response(
        JSON.stringify({
          ok: false,
          error: "Forbidden",
          errorCode: "workspace_forbidden",
        }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }
      ) as any,
    });

    const response = await GET(new Request("http://localhost"), {
      params: { workspaceId: "workspace-denied", taskId: "task-1" },
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      errorCode: "workspace_forbidden",
    });
  });
});
