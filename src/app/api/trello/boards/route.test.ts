import { GET } from "@/app/api/trello/boards/route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { fetchTrelloBoards, isTrelloConfigured } from "@/lib/trelloAPI";
import { findTrelloConnectionForWorkspace } from "@/lib/trello-connections";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";

jest.mock("@/lib/db", () => ({
  getDb: jest.fn(),
}));

jest.mock("@/lib/server-auth", () => ({
  getSessionUserId: jest.fn(),
}));

jest.mock("@/lib/workspace-scope", () => ({
  resolveWorkspaceScopeForUser: jest.fn(),
}));

jest.mock("@/lib/trelloAPI", () => {
  const actual = jest.requireActual("@/lib/trelloAPI");
  return {
    ...actual,
    isTrelloConfigured: jest.fn(() => true),
    fetchTrelloBoards: jest.fn(),
  };
});

jest.mock("@/lib/trello-connections", () => {
  const actual = jest.requireActual("@/lib/trello-connections");
  return {
    ...actual,
    findTrelloConnectionForWorkspace: jest.fn(),
  };
});

jest.mock("@/lib/observability-metrics", () => ({
  recordRouteMetric: jest.fn(),
}));

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedGetSessionUserId = getSessionUserId as jest.MockedFunction<
  typeof getSessionUserId
>;
const mockedResolveWorkspaceScopeForUser =
  resolveWorkspaceScopeForUser as jest.MockedFunction<
    typeof resolveWorkspaceScopeForUser
  >;
const mockedIsTrelloConfigured = isTrelloConfigured as jest.MockedFunction<
  typeof isTrelloConfigured
>;
const mockedFetchTrelloBoards = fetchTrelloBoards as jest.MockedFunction<
  typeof fetchTrelloBoards
>;
const mockedFindConnection =
  findTrelloConnectionForWorkspace as jest.MockedFunction<
    typeof findTrelloConnectionForWorkspace
  >;

const buildConnection = (overrides: Record<string, any> = {}) => ({
  _id: "trello-conn-1",
  workspaceId: "workspace-1",
  userId: "user-1",
  status: "active" as const,
  token: "secret-trello-token",
  memberId: "member-1",
  memberUsername: "jane",
  memberFullName: "Jane Doe",
  createdAt: new Date("2026-07-01T00:00:00Z"),
  updatedAt: new Date("2026-07-01T00:00:00Z"),
  revokedAt: null,
  ...overrides,
});

const buildRequest = () => new Request("http://localhost/api/trello/boards");

describe("GET /api/trello/boards", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetDb.mockResolvedValue({} as any);
    mockedGetSessionUserId.mockResolvedValue("user-1");
    mockedResolveWorkspaceScopeForUser.mockResolvedValue({
      workspaceId: "workspace-1",
      workspace: null as any,
      membership: null as any,
      workspaceMemberUserIds: ["user-1"],
    } as any);
    mockedIsTrelloConfigured.mockReturnValue(true);
    mockedFindConnection.mockResolvedValue(buildConnection() as any);
    mockedFetchTrelloBoards.mockResolvedValue([
      { id: "board-1", name: "Product", url: "https://trello.com/b/board-1" },
      { id: "board-2", name: "Ops", url: "https://trello.com/b/board-2" },
    ]);
  });

  it("returns 401 without a session user", async () => {
    mockedGetSessionUserId.mockResolvedValue(null as any);

    const response = await GET(buildRequest());

    expect(response.status).toBe(401);
    expect(mockedFetchTrelloBoards).not.toHaveBeenCalled();
  });

  it("returns 409 when the workspace has no Trello connection", async () => {
    mockedFindConnection.mockResolvedValue(null as any);

    const response = await GET(buildRequest());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      errorCode: "trello_not_connected",
    });
    expect(mockedFetchTrelloBoards).not.toHaveBeenCalled();
  });

  it("returns 409 when the connection is revoked", async () => {
    mockedFindConnection.mockResolvedValue(
      buildConnection({ status: "revoked", token: null }) as any
    );

    const response = await GET(buildRequest());

    expect(response.status).toBe(409);
    expect(mockedFetchTrelloBoards).not.toHaveBeenCalled();
  });

  it("returns the boards from Trello", async () => {
    const response = await GET(buildRequest());

    expect(response.status).toBe(200);
    expect(mockedFetchTrelloBoards).toHaveBeenCalledWith("secret-trello-token");
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.boards).toEqual([
      { id: "board-1", name: "Product", url: "https://trello.com/b/board-1" },
      { id: "board-2", name: "Ops", url: "https://trello.com/b/board-2" },
    ]);
    expect(JSON.stringify(body)).not.toContain("secret-trello-token");
  });

  it("maps a rejected token to 401 trello_auth_expired", async () => {
    const { TrelloAuthError } = jest.requireActual("@/lib/trelloAPI");
    mockedFetchTrelloBoards.mockRejectedValue(new TrelloAuthError());

    const response = await GET(buildRequest());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      errorCode: "trello_auth_expired",
    });
  });
});
