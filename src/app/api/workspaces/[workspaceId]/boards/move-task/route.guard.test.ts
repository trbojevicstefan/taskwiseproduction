import { POST } from "@/app/api/workspaces/[workspaceId]/boards/move-task/route";
import { requireWorkspaceRouteAccess } from "@/lib/workspace-route-access";

jest.mock("@/lib/workspace-route-access", () => ({
  requireWorkspaceRouteAccess: jest.fn(),
}));

const mockedRequireWorkspaceRouteAccess =
  requireWorkspaceRouteAccess as jest.MockedFunction<typeof requireWorkspaceRouteAccess>;

describe("POST /api/workspaces/[workspaceId]/boards/move-task guard behavior", () => {
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

    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boardId: "board-1", taskId: "task-1" }),
      }),
      { params: { workspaceId: "workspace-denied" } }
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      errorCode: "workspace_forbidden",
    });
  });
});
