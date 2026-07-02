import { PATCH } from "@/app/api/people/[id]/route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
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

const existingPerson = {
  _id: "person-1",
  userId: "user-1",
  name: "Alice",
  email: "alice@acme.com",
  aliases: [],
  sourceSessionIds: [],
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  lastSeenAt: new Date("2026-06-30T00:00:00.000Z"),
};

const patchRequest = (body: unknown) =>
  new Request("http://localhost/api/people/person-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const routeParams = { params: Promise.resolve({ id: "person-1" }) };

describe("PATCH /api/people/[id]", () => {
  let peopleFindOne: jest.Mock;
  let peopleUpdateOne: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetSessionUserId.mockResolvedValue("user-1");
    mockedResolveWorkspaceScopeForUser.mockResolvedValue({
      workspaceId: "workspace-1",
      workspace: null as any,
      membership: null as any,
      workspaceMemberUserIds: ["user-1"],
    });

    peopleFindOne = jest.fn().mockResolvedValue(existingPerson);
    peopleUpdateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    const db = {
      collection: jest.fn((name: string) => {
        if (name === "people") {
          return { findOne: peopleFindOne, updateOne: peopleUpdateOne };
        }
        if (name === "tasks") {
          return {
            find: jest.fn().mockReturnValue({
              toArray: jest.fn().mockResolvedValue([]),
            }),
          };
        }
        throw new Error(`Unexpected collection in test: ${name}`);
      }),
    } as any;
    mockedGetDb.mockResolvedValue(db);
  });

  it("returns 401 when unauthorized", async () => {
    mockedGetSessionUserId.mockResolvedValue(null);
    const response = await PATCH(patchRequest({ name: "Bob" }), routeParams);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      errorCode: "request_error",
      error: "Unauthorized",
    });
  });

  it("rejects unknown fields with 400 request_error", async () => {
    const response = await PATCH(
      patchRequest({ name: "Bob", hackedField: true }),
      routeParams
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      errorCode: "request_error",
    });
    expect(peopleUpdateOne).not.toHaveBeenCalled();
  });

  it("accepts personType and stamps manual provenance", async () => {
    peopleFindOne
      .mockResolvedValueOnce(existingPerson)
      .mockResolvedValueOnce({
        ...existingPerson,
        personType: "client",
        personTypeSource: "manual",
        personTypeReason: "Set manually",
      });

    const response = await PATCH(
      patchRequest({ personType: "client" }),
      routeParams
    );

    expect(response.status).toBe(200);
    expect(peopleUpdateOne).toHaveBeenCalledWith(
      { _id: "person-1" },
      {
        $set: expect.objectContaining({
          personType: "client",
          personTypeSource: "manual",
          personTypeReason: "Set manually",
        }),
      }
    );
    await expect(response.json()).resolves.toMatchObject({
      id: "person-1",
      personType: "client",
      personTypeSource: "manual",
      personTypeReason: "Set manually",
    });
  });

  it("rejects an invalid personType value", async () => {
    const response = await PATCH(
      patchRequest({ personType: "vendor" }),
      routeParams
    );
    expect(response.status).toBe(400);
    expect(peopleUpdateOne).not.toHaveBeenCalled();
  });

  it("accepts a full round-tripped person object but persists only editable fields", async () => {
    const response = await PATCH(
      patchRequest({
        id: "person-1",
        userId: "user-1",
        workspaceId: "workspace-1",
        createdAt: "2026-01-01T00:00:00.000Z",
        lastSeenAt: "2026-06-30T00:00:00.000Z",
        taskCount: 3,
        taskCounts: { total: 3, open: 3, todo: 3, inprogress: 0, done: 0, recurring: 0 },
        personTypeSource: "auto",
        personTypeReason: "External email domain @acme.com",
        name: "Alice Updated",
        email: "alice@acme.com",
        title: "PM",
        avatarUrl: null,
        slackId: null,
        firefliesId: null,
        phantomBusterId: null,
        aliases: ["Ali"],
        isBlocked: false,
        sourceSessionIds: ["meeting-1"],
        company: "Acme",
        nextFollowUpAt: "2026-07-10T00:00:00.000Z",
      }),
      routeParams
    );

    expect(response.status).toBe(200);
    const [, updateArg] = peopleUpdateOne.mock.calls[0];
    expect(updateArg.$set).toMatchObject({
      name: "Alice Updated",
      company: "Acme",
      nextFollowUpAt: "2026-07-10T00:00:00.000Z",
    });
    // Read-only fields must never be persisted from the body.
    expect(updateArg.$set).not.toHaveProperty("id");
    expect(updateArg.$set).not.toHaveProperty("userId");
    expect(updateArg.$set).not.toHaveProperty("workspaceId");
    expect(updateArg.$set).not.toHaveProperty("taskCount");
    expect(updateArg.$set).not.toHaveProperty("taskCounts");
    expect(updateArg.$set).not.toHaveProperty("createdAt");
    // No personType in body -> provenance untouched.
    expect(updateArg.$set).not.toHaveProperty("personTypeSource");
    expect(updateArg.$set).not.toHaveProperty("personTypeReason");
  });
});
