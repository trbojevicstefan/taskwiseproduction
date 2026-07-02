import { GET } from "@/app/api/workspaces/[workspaceId]/boards/[boardId]/items/route";
import { requireWorkspaceRouteAccess } from "@/lib/workspace-route-access";

jest.mock("@/lib/workspace-route-access", () => ({
  requireWorkspaceRouteAccess: jest.fn(),
}));

const mockedRequireWorkspaceRouteAccess =
  requireWorkspaceRouteAccess as jest.MockedFunction<
    typeof requireWorkspaceRouteAccess
  >;

const getTaskLookupMatch = (pipeline: any[]) => {
  const lookupStage = pipeline.find((stage) => stage.$lookup);
  return lookupStage.$lookup.pipeline[0].$match;
};

describe("GET /api/workspaces/[workspaceId]/boards/[boardId]/items expired exclusion", () => {
  let capturedPipeline: any[];

  beforeEach(() => {
    jest.clearAllMocks();
    capturedPipeline = [];
    const aggregate = jest.fn().mockImplementation((pipeline: any[]) => {
      capturedPipeline = pipeline;
      return { toArray: jest.fn().mockResolvedValue([]) };
    });
    const db = {
      collection: jest.fn((name: string) => {
        if (name === "boardItems") {
          return { aggregate };
        }
        throw new Error(`Unexpected collection in test: ${name}`);
      }),
    };
    mockedRequireWorkspaceRouteAccess.mockResolvedValue({
      ok: true,
      db,
      userId: "user-1",
    } as any);
  });

  it("excludes tasks with cleanupStatus expired by default", async () => {
    const response = await GET(
      new Request("http://localhost/api/workspaces/w1/boards/b1/items"),
      { params: { workspaceId: "w1", boardId: "b1" } }
    );

    expect(response.status).toBe(200);
    const match = getTaskLookupMatch(capturedPipeline);
    expect(match.cleanupStatus).toEqual({ $ne: "expired" });
    // Existing taskState filter must stay intact.
    expect(match.taskState).toEqual({ $ne: "archived" });
    expect(match.workspaceId).toBe("w1");
  });

  it("includes expired tasks when includeExpired=1", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/workspaces/w1/boards/b1/items?includeExpired=1"
      ),
      { params: { workspaceId: "w1", boardId: "b1" } }
    );

    expect(response.status).toBe(200);
    const match = getTaskLookupMatch(capturedPipeline);
    expect(match.cleanupStatus).toBeUndefined();
    expect(match.taskState).toEqual({ $ne: "archived" });
  });

  it("still returns the access guard response when access fails", async () => {
    mockedRequireWorkspaceRouteAccess.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ ok: false }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }) as any,
    } as any);

    const response = await GET(
      new Request("http://localhost/api/workspaces/w1/boards/b1/items"),
      { params: { workspaceId: "w1", boardId: "b1" } }
    );

    expect(response.status).toBe(403);
  });
});
