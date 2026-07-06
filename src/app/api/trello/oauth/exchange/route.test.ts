import { POST } from "@/app/api/trello/oauth/exchange/route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { fetchTrelloMember, isTrelloConfigured } from "@/lib/trelloAPI";
import { upsertTrelloConnection } from "@/lib/trello-connections";
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
    buildTrelloAuthorizeUrl: jest.fn(() => "https://trello.com/1/authorize?key=k"),
    fetchTrelloMember: jest.fn(),
  };
});

jest.mock("@/lib/trello-connections", () => {
  const actual = jest.requireActual("@/lib/trello-connections");
  return {
    ...actual,
    findTrelloConnectionForWorkspace: jest.fn(),
    upsertTrelloConnection: jest.fn(),
    revokeTrelloConnection: jest.fn(),
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
const mockedFetchTrelloMember = fetchTrelloMember as jest.MockedFunction<
  typeof fetchTrelloMember
>;
const mockedUpsertConnection = upsertTrelloConnection as jest.MockedFunction<
  typeof upsertTrelloConnection
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

const buildRequest = (body: unknown = { token: "secret-trello-token" }) =>
  new Request("http://localhost/api/trello/oauth/exchange", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /api/trello/oauth/exchange", () => {
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
    mockedFetchTrelloMember.mockResolvedValue({
      id: "member-1",
      username: "jane",
      fullName: "Jane Doe",
    });
    mockedUpsertConnection.mockResolvedValue(buildConnection() as any);
  });

  it("returns 401 without a session user", async () => {
    mockedGetSessionUserId.mockResolvedValue(null as any);

    const response = await POST(buildRequest());

    expect(response.status).toBe(401);
    expect(mockedUpsertConnection).not.toHaveBeenCalled();
  });

  it("returns 503 when TRELLO_API_KEY is not configured", async () => {
    mockedIsTrelloConfigured.mockReturnValue(false);

    const response = await POST(buildRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      errorCode: "trello_not_configured",
    });
    expect(mockedFetchTrelloMember).not.toHaveBeenCalled();
    expect(mockedUpsertConnection).not.toHaveBeenCalled();
  });

  it("rejects an invalid payload with 400", async () => {
    const response = await POST(buildRequest({ token: "abc" }));

    expect(response.status).toBe(400);
    expect(mockedFetchTrelloMember).not.toHaveBeenCalled();
  });

  it("rejects a token Trello does not recognize with 400", async () => {
    const { TrelloAuthError } = jest.requireActual("@/lib/trelloAPI");
    mockedFetchTrelloMember.mockRejectedValue(new TrelloAuthError());

    const response = await POST(buildRequest());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      errorCode: "invalid_token",
    });
    expect(mockedUpsertConnection).not.toHaveBeenCalled();
  });

  it("validates the token and stores the connection without leaking it", async () => {
    const response = await POST(buildRequest());

    expect(response.status).toBe(200);
    expect(mockedFetchTrelloMember).toHaveBeenCalledWith("secret-trello-token");
    expect(mockedUpsertConnection).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        workspaceId: "workspace-1",
        userId: "user-1",
        token: "secret-trello-token",
        memberId: "member-1",
        memberUsername: "jane",
        memberFullName: "Jane Doe",
      })
    );
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.connection.hasToken).toBe(true);
    expect(body.connection.token).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("secret-trello-token");
  });
});
