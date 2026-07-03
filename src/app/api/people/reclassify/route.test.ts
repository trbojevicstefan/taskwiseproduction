import { POST } from "@/app/api/people/reclassify/route";
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

describe("POST /api/people/reclassify", () => {
  const peopleDocs = [
    {
      // Manually classified — the heuristic would say "client", but manual
      // classifications must never be overwritten.
      _id: "p-manual",
      email: "someone@externalco.com",
      personType: "unknown",
      personTypeSource: "manual",
    },
    {
      // Auto-classified as unknown, heuristic now says client -> update.
      _id: "p-client",
      email: "carol@clientco.com",
      personType: "unknown",
      personTypeSource: "auto",
    },
    {
      // Never classified, internal domain -> teammate -> update.
      _id: "p-team",
      email: "dave@acme.com",
    },
    {
      // Already correct -> scanned but not updated.
      _id: "p-slack",
      slackId: "U123",
      personType: "teammate",
      personTypeSource: "auto",
    },
  ];

  let peopleBulkWrite: jest.Mock;
  let peopleFind: jest.Mock;
  let usersFind: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetSessionUserId.mockResolvedValue("user-1");
    mockedResolveWorkspaceScopeForUser.mockResolvedValue({
      workspaceId: "workspace-1",
      workspace: null as any,
      membership: null as any,
      workspaceMemberUserIds: ["user-1"],
    });

    peopleFind = jest.fn().mockReturnValue({
      toArray: jest.fn().mockResolvedValue(peopleDocs),
    });
    peopleBulkWrite = jest.fn().mockResolvedValue({ modifiedCount: 2 });
    usersFind = jest.fn().mockReturnValue({
      toArray: jest
        .fn()
        .mockResolvedValue([{ _id: "user-1", email: "owner@acme.com" }]),
    });

    const db = {
      collection: jest.fn((name: string) => {
        if (name === "people") {
          return { find: peopleFind, bulkWrite: peopleBulkWrite };
        }
        if (name === "users") {
          return { find: usersFind };
        }
        throw new Error(`Unexpected collection in test: ${name}`);
      }),
    } as any;
    mockedGetDb.mockResolvedValue(db);
  });

  it("returns 401 when unauthorized", async () => {
    mockedGetSessionUserId.mockResolvedValue(null);
    const response = await POST(
      new Request("http://localhost/api/people/reclassify", { method: "POST" })
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      errorCode: "request_error",
      error: "Unauthorized",
    });
  });

  it("skips manual docs and updates auto/unclassified ones", async () => {
    const response = await POST(
      new Request("http://localhost/api/people/reclassify", { method: "POST" })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      scanned: 3,
      updated: 2,
      counts: { teammate: 2, client: 1, unknown: 1 },
    });

    expect(peopleBulkWrite).toHaveBeenCalledTimes(1);
    const operations = peopleBulkWrite.mock.calls[0][0];
    expect(operations).toHaveLength(2);

    const updatedIds = operations.map(
      (op: any) => op.updateOne.filter._id
    );
    expect(updatedIds).toEqual(
      expect.arrayContaining(["p-client", "p-team"])
    );
    expect(updatedIds).not.toContain("p-manual");
    expect(updatedIds).not.toContain("p-slack");

    const clientOp = operations.find(
      (op: any) => op.updateOne.filter._id === "p-client"
    );
    expect(clientOp.updateOne.update.$set).toEqual({
      personType: "client",
      personTypeSource: "auto",
      personTypeReason: "External email domain @clientco.com",
    });

    const teamOp = operations.find(
      (op: any) => op.updateOne.filter._id === "p-team"
    );
    expect(teamOp.updateOne.update.$set).toEqual({
      personType: "teammate",
      personTypeSource: "auto",
      personTypeReason: "Email domain @acme.com matches your team",
    });
  });

  it("does not bulkWrite when nothing changed", async () => {
    peopleFind.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([
        {
          _id: "p-slack",
          slackId: "U123",
          personType: "teammate",
          personTypeSource: "auto",
        },
      ]),
    });

    const response = await POST(
      new Request("http://localhost/api/people/reclassify", { method: "POST" })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      scanned: 1,
      updated: 0,
      counts: { teammate: 1, client: 0, unknown: 0 },
    });
    expect(peopleBulkWrite).not.toHaveBeenCalled();
  });
});
