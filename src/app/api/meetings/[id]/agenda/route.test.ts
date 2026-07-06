import { PATCH } from "@/app/api/meetings/[id]/agenda/route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import {
  assertWorkspaceAccess,
  ensureWorkspaceBootstrapForUser,
} from "@/lib/workspace-context";

jest.mock("@/lib/db", () => ({
  getDb: jest.fn(),
}));

jest.mock("@/lib/server-auth", () => ({
  getSessionUserId: jest.fn(),
}));

jest.mock("@/lib/workspace-context", () => ({
  assertWorkspaceAccess: jest.fn(),
  ensureWorkspaceBootstrapForUser: jest.fn(),
}));

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedGetSessionUserId = getSessionUserId as jest.MockedFunction<
  typeof getSessionUserId
>;
const mockedAssertWorkspaceAccess =
  assertWorkspaceAccess as jest.MockedFunction<typeof assertWorkspaceAccess>;
const mockedEnsureBootstrap =
  ensureWorkspaceBootstrapForUser as jest.MockedFunction<
    typeof ensureWorkspaceBootstrapForUser
  >;

const buildDb = (meeting: any) => {
  const findOne = jest.fn().mockResolvedValue(meeting);
  const updateOne = jest.fn().mockResolvedValue({ matchedCount: 1 });
  const db = {
    collection: jest.fn((name: string) => {
      if (name === "meetings") return { findOne, updateOne };
      throw new Error(`Unexpected collection in test: ${name}`);
    }),
  } as any;
  return { db, findOne, updateOne };
};

const patchRequest = (body: unknown) =>
  new Request("http://localhost/api/meetings/m-1/agenda", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

const params = Promise.resolve({ id: "m-1" });

const VALID_BODY = {
  agenda: [
    { id: "s-2", title: "Wrap up", notes: "", order: 5 },
    { id: "s-1", title: "Intro", notes: "Say hi", order: 0 },
  ],
};

describe("PATCH /api/meetings/[id]/agenda", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetSessionUserId.mockResolvedValue("user-1");
  });

  it("returns 401 when there is no session user", async () => {
    mockedGetSessionUserId.mockResolvedValue(null as any);

    const response = await PATCH(patchRequest(VALID_BODY), { params });

    expect(response.status).toBe(401);
    expect(mockedGetDb).not.toHaveBeenCalled();
  });

  it("rejects invalid payloads with 400 before touching the database", async () => {
    for (const body of [
      {},
      { agenda: "nope" },
      { agenda: [{ id: "s-1", title: "", order: 0 }] }, // empty title
      { agenda: [{ id: "s-1", title: "Hi", order: -1 }] }, // negative order
      { agenda: [{ id: "s-1", title: "Hi", order: 0 }], extra: true }, // strict
      {
        agenda: [
          { id: "s-1", title: "x".repeat(301), order: 0 }, // title too long
        ],
      },
      {
        agenda: Array.from({ length: 51 }, (_, index) => ({
          id: `s-${index}`,
          title: "Topic",
          order: index,
        })), // too many sections
      },
    ]) {
      const response = await PATCH(patchRequest(body), { params });
      expect(response.status).toBe(400);
    }
    expect(mockedGetDb).not.toHaveBeenCalled();
  });

  it("persists a normalized agenda (sorted, re-numbered) and returns it", async () => {
    const meeting = { _id: "m-1", workspaceId: "workspace-1", userId: "user-2" };
    const { db, findOne, updateOne } = buildDb(meeting);
    mockedGetDb.mockResolvedValue(db);
    mockedAssertWorkspaceAccess.mockResolvedValue(undefined as any);

    const response = await PATCH(patchRequest(VALID_BODY), { params });

    expect(response.status).toBe(200);
    const payload = await response.json();
    // Round-trip: sorted by order, order re-numbered to array index.
    expect(payload.agenda).toEqual([
      { id: "s-1", title: "Intro", notes: "Say hi", order: 0 },
      { id: "s-2", title: "Wrap up", notes: "", order: 1 },
    ]);

    expect(findOne).toHaveBeenCalledWith({
      $or: [{ _id: "m-1" }, { id: "m-1" }],
    });
    expect(mockedEnsureBootstrap).toHaveBeenCalledWith(db, "user-1");
    expect(mockedAssertWorkspaceAccess).toHaveBeenCalledWith(
      db,
      "user-1",
      "workspace-1",
      "member"
    );
    expect(updateOne).toHaveBeenCalledWith(
      { _id: "m-1" },
      {
        $set: {
          agenda: payload.agenda,
          agendaUpdatedAt: expect.any(Date),
          lastActivityAt: expect.any(Date),
        },
      }
    );
  });

  it("accepts an empty agenda (clearing it)", async () => {
    const meeting = { _id: "m-1", userId: "user-1" };
    const { db, updateOne } = buildDb(meeting);
    mockedGetDb.mockResolvedValue(db);

    const response = await PATCH(patchRequest({ agenda: [] }), { params });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ agenda: [] });
    expect(updateOne).toHaveBeenCalledWith(
      { _id: "m-1" },
      expect.objectContaining({ $set: expect.objectContaining({ agenda: [] }) })
    );
  });

  it("returns 404 for a missing or hidden meeting", async () => {
    const missing = buildDb(null);
    mockedGetDb.mockResolvedValue(missing.db);
    let response = await PATCH(patchRequest(VALID_BODY), { params });
    expect(response.status).toBe(404);
    expect(missing.updateOne).not.toHaveBeenCalled();

    const hidden = buildDb({ _id: "m-1", userId: "user-1", isHidden: true });
    mockedGetDb.mockResolvedValue(hidden.db);
    response = await PATCH(patchRequest(VALID_BODY), { params });
    expect(response.status).toBe(404);
    expect(hidden.updateOne).not.toHaveBeenCalled();
  });

  it("returns 403 when workspace access is denied", async () => {
    const meeting = { _id: "m-1", workspaceId: "workspace-1", userId: "user-2" };
    const { db, updateOne } = buildDb(meeting);
    mockedGetDb.mockResolvedValue(db);
    mockedAssertWorkspaceAccess.mockRejectedValue(new Error("forbidden"));

    const response = await PATCH(patchRequest(VALID_BODY), { params });

    expect(response.status).toBe(403);
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("returns 404 for a legacy workspace-less meeting owned by someone else", async () => {
    const meeting = { _id: "m-1", userId: "someone-else" };
    const { db, updateOne } = buildDb(meeting);
    mockedGetDb.mockResolvedValue(db);

    const response = await PATCH(patchRequest(VALID_BODY), { params });

    expect(response.status).toBe(404);
    expect(updateOne).not.toHaveBeenCalled();
    expect(mockedAssertWorkspaceAccess).not.toHaveBeenCalled();
  });
});
