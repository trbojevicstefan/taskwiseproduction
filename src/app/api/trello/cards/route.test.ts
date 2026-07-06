import { composeCardDescription, POST } from "@/app/api/trello/cards/route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { createTrelloCard, isTrelloConfigured } from "@/lib/trelloAPI";
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
    createTrelloCard: jest.fn(),
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
const mockedCreateTrelloCard = createTrelloCard as jest.MockedFunction<
  typeof createTrelloCard
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

const buildRequest = (body: unknown) =>
  new Request("http://localhost/api/trello/cards", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const validBody = (overrides: Record<string, any> = {}) => ({
  listId: "list12345",
  cards: [
    {
      name: "Send the proposal",
      desc: "Draft and send the Q3 proposal",
      due: "2026-07-10T12:00:00.000Z",
      assigneeName: "Jane Doe",
      sourceMeetingUrl: "https://app.example.com/meetings/meeting-1",
      subtasks: ["Draft", "Review"],
    },
  ],
  ...overrides,
});

describe("composeCardDescription", () => {
  it("appends assignee and source meeting link to the description", () => {
    const desc = composeCardDescription({
      name: "Task",
      desc: "Base description",
      assigneeName: "Jane Doe",
      sourceMeetingUrl: "https://app.example.com/meetings/meeting-1",
    });

    expect(desc).toContain("Base description");
    expect(desc).toContain("Assignee: Jane Doe");
    expect(desc).toContain(
      "Source meeting: https://app.example.com/meetings/meeting-1"
    );
  });

  it("returns an empty string when there is nothing to compose", () => {
    expect(composeCardDescription({ name: "Task" })).toBe("");
  });
});

describe("POST /api/trello/cards", () => {
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
    mockedCreateTrelloCard.mockResolvedValue({
      id: "card-1",
      name: "Send the proposal",
      url: "https://trello.com/c/card-1",
    });
  });

  it("returns 401 without a session user", async () => {
    mockedGetSessionUserId.mockResolvedValue(null as any);

    const response = await POST(buildRequest(validBody()));

    expect(response.status).toBe(401);
    expect(mockedCreateTrelloCard).not.toHaveBeenCalled();
  });

  it("rejects an invalid payload with 400", async () => {
    const emptyCards = await POST(buildRequest(validBody({ cards: [] })));
    const tooManyCards = await POST(
      buildRequest(
        validBody({
          cards: Array.from({ length: 26 }, (_, index) => ({
            name: `Task ${index}`,
          })),
        })
      )
    );
    const badListId = await POST(
      buildRequest(validBody({ listId: "not a list id!" }))
    );

    expect(emptyCards.status).toBe(400);
    expect(tooManyCards.status).toBe(400);
    expect(badListId.status).toBe(400);
    expect(mockedCreateTrelloCard).not.toHaveBeenCalled();
  });

  it("returns 409 when the workspace has no Trello connection", async () => {
    mockedFindConnection.mockResolvedValue(null as any);

    const response = await POST(buildRequest(validBody()));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      errorCode: "trello_not_connected",
    });
    expect(mockedCreateTrelloCard).not.toHaveBeenCalled();
  });

  it("creates a card with due date, subtasks, and composed description", async () => {
    const response = await POST(buildRequest(validBody()));

    expect(response.status).toBe(200);
    expect(mockedCreateTrelloCard).toHaveBeenCalledTimes(1);
    expect(mockedCreateTrelloCard).toHaveBeenCalledWith(
      "secret-trello-token",
      expect.objectContaining({
        listId: "list12345",
        name: "Send the proposal",
        due: "2026-07-10T12:00:00.000Z",
        subtasks: ["Draft", "Review"],
      })
    );
    const sentDesc = mockedCreateTrelloCard.mock.calls[0][1].desc || "";
    expect(sentDesc).toContain("Draft and send the Q3 proposal");
    expect(sentDesc).toContain("Assignee: Jane Doe");
    expect(sentDesc).toContain(
      "Source meeting: https://app.example.com/meetings/meeting-1"
    );

    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      createdCount: 1,
      failures: [],
    });
    expect(body.cards).toEqual([
      {
        id: "card-1",
        name: "Send the proposal",
        url: "https://trello.com/c/card-1",
      },
    ]);
    expect(JSON.stringify(body)).not.toContain("secret-trello-token");
  });

  it("returns partial failures without failing the whole request", async () => {
    const { TrelloApiError } = jest.requireActual("@/lib/trelloAPI");
    mockedCreateTrelloCard
      .mockResolvedValueOnce({
        id: "card-1",
        name: "First",
        url: "https://trello.com/c/card-1",
      })
      .mockRejectedValueOnce(new TrelloApiError(500, "Trello exploded."));

    const response = await POST(
      buildRequest(
        validBody({ cards: [{ name: "First" }, { name: "Second" }] })
      )
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.createdCount).toBe(1);
    expect(body.failures).toEqual([
      { name: "Second", error: "Trello exploded." },
    ]);
  });

  it("returns 502 when every card fails", async () => {
    const { TrelloApiError } = jest.requireActual("@/lib/trelloAPI");
    mockedCreateTrelloCard.mockRejectedValue(
      new TrelloApiError(500, "Trello exploded.")
    );

    const response = await POST(buildRequest(validBody()));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      errorCode: "trello_api_error",
    });
  });

  it("aborts with 401 trello_auth_expired when the token dies mid-batch", async () => {
    const { TrelloAuthError } = jest.requireActual("@/lib/trelloAPI");
    mockedCreateTrelloCard.mockRejectedValue(new TrelloAuthError());

    const response = await POST(
      buildRequest(
        validBody({ cards: [{ name: "First" }, { name: "Second" }] })
      )
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      errorCode: "trello_auth_expired",
    });
  });
});
