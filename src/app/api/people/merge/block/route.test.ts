import { POST } from "@/app/api/people/merge/block/route";
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

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedGetSessionUserId = getSessionUserId as jest.MockedFunction<
  typeof getSessionUserId
>;
const mockedResolveWorkspaceScopeForUser =
  resolveWorkspaceScopeForUser as jest.MockedFunction<
    typeof resolveWorkspaceScopeForUser
  >;

const buildRequest = (body: any) =>
  new Request("http://localhost/api/people/merge/block", {
    method: "POST",
    body: JSON.stringify(body),
  });

const buildDb = (people: any[]) => {
  const findOne = jest.fn(async (query: any) => {
    const orClauses = query?.$and?.[1]?.$or || [];
    const wantedId =
      orClauses[0]?._id ?? orClauses[1]?.id ?? orClauses[2]?.slackId ?? null;
    return (
      people.find(
        (person) => person._id === wantedId || person.slackId === wantedId
      ) || null
    );
  });
  const updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
  const db = {
    collection: jest.fn((name: string) => {
      if (name === "people") return { findOne, updateOne };
      throw new Error(`Unexpected collection in test: ${name}`);
    }),
  } as any;
  return { db, findOne, updateOne };
};

describe("POST /api/people/merge/block", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetSessionUserId.mockResolvedValue("user-1");
    mockedResolveWorkspaceScopeForUser.mockResolvedValue({
      workspaceId: "workspace-1",
      workspace: null as any,
      membership: null as any,
      workspaceMemberUserIds: ["user-1"],
    });
  });

  it("returns 401 when unauthorized", async () => {
    mockedGetSessionUserId.mockResolvedValue(null);
    const response = await POST(buildRequest({ personId: "a" }));
    expect(response.status).toBe(401);
  });

  it("rejects a payload without a block subject", async () => {
    const response = await POST(buildRequest({ personId: "a" }));
    expect(response.status).toBe(400);
  });

  it("blocks a pair of saved people on both docs", async () => {
    const { db, updateOne } = buildDb([
      { _id: "a", name: "Sam Smith" },
      { _id: "b", name: "Sam S" },
    ]);
    mockedGetDb.mockResolvedValue(db);

    const response = await POST(
      buildRequest({ personId: "a", otherPersonId: "b" })
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      blocked: "pair",
    });
    expect(updateOne).toHaveBeenCalledWith(
      { _id: "a" },
      { $addToSet: { blockedMergePersonIds: "b" } }
    );
    expect(updateOne).toHaveBeenCalledWith(
      { _id: "b" },
      { $addToSet: { blockedMergePersonIds: "a" } }
    );
  });

  it("blocks a discovered candidate by normalized keys", async () => {
    const { db, updateOne } = buildDb([{ _id: "a", name: "Sam Smith" }]);
    mockedGetDb.mockResolvedValue(db);

    const response = await POST(
      buildRequest({
        personId: "a",
        blockedName: "  Sam  S. ",
        blockedEmail: "Sam@Old.com",
      })
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      blocked: "keys",
      keys: ["sam s", "sam@old.com"],
    });
    expect(updateOne).toHaveBeenCalledWith(
      { _id: "a" },
      { $addToSet: { blockedMergeKeys: { $each: ["sam s", "sam@old.com"] } } }
    );
  });

  it("returns 404 when the person is outside the workspace scope", async () => {
    const { db } = buildDb([]);
    mockedGetDb.mockResolvedValue(db);
    const response = await POST(
      buildRequest({ personId: "ghost", blockedName: "X" })
    );
    expect(response.status).toBe(404);
  });
});
