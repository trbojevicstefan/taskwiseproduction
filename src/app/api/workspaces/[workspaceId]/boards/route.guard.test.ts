import { GET } from "@/app/api/workspaces/[workspaceId]/boards/route";
import { requireWorkspaceRouteAccess } from "@/lib/workspace-route-access";

jest.mock("@/lib/workspace-route-access", () => ({
  requireWorkspaceRouteAccess: jest.fn(),
}));

const mockedRequireWorkspaceRouteAccess =
  requireWorkspaceRouteAccess as jest.MockedFunction<typeof requireWorkspaceRouteAccess>;

describe("GET /api/workspaces/[workspaceId]/boards guard behavior", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns forbidden when workspace access check fails", async () => {
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
      params: { workspaceId: "workspace-denied" },
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      errorCode: "workspace_forbidden",
    });
  });
});
