import { GET, POST } from "@/app/api/companies/route";
import {
  createOrReuseCompany,
  listCompaniesForWorkspace,
  syncCompaniesFromClientPeople,
} from "@/lib/companies";
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

jest.mock("@/lib/companies", () => {
  const actual = jest.requireActual("@/lib/companies");
  return {
    ...actual,
    createOrReuseCompany: jest.fn(),
    listCompaniesForWorkspace: jest.fn(),
    syncCompaniesFromClientPeople: jest.fn(),
  };
});

jest.mock("@/lib/observability-metrics", () => ({
  recordRouteMetric: jest.fn(),
}));

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedGetSessionUserId = getSessionUserId as jest.MockedFunction<
  typeof getSessionUserId
>;
const mockedResolveScope = resolveWorkspaceScopeForUser as jest.MockedFunction<
  typeof resolveWorkspaceScopeForUser
>;
const mockedSync = syncCompaniesFromClientPeople as jest.MockedFunction<
  typeof syncCompaniesFromClientPeople
>;
const mockedList = listCompaniesForWorkspace as jest.MockedFunction<
  typeof listCompaniesForWorkspace
>;
const mockedCreate = createOrReuseCompany as jest.MockedFunction<
  typeof createOrReuseCompany
>;

const clientPeople = [
  { _id: "p1", name: "Jane", email: "jane@acme.com", company: null },
];

const peopleFind = jest.fn();
const fakeDb = {
  collection: jest.fn((name: string) => {
    if (name === "people") return { find: peopleFind };
    throw new Error(`Unexpected collection in test: ${name}`);
  }),
} as any;

const companyDoc = {
  _id: "c1",
  workspaceId: "workspace-1",
  userId: "user-1",
  name: "acme.com",
  nameKey: "acme.com",
  domain: "acme.com",
  aliases: [],
  peopleIds: ["p1"],
  createdAt: new Date("2026-07-01T00:00:00.000Z"),
  updatedAt: new Date("2026-07-01T00:00:00.000Z"),
};

const buildPostRequest = (body: unknown) =>
  new Request("http://localhost/api/companies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("/api/companies", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetSessionUserId.mockResolvedValue("user-1");
    mockedResolveScope.mockResolvedValue({
      workspaceId: "workspace-1",
      workspace: null as any,
      membership: null as any,
      workspaceMemberUserIds: ["user-1"],
    });
    mockedGetDb.mockResolvedValue(fakeDb);
    peopleFind.mockReturnValue({
      project: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue(clientPeople),
      }),
    });
    mockedSync.mockResolvedValue([]);
    mockedList.mockResolvedValue([companyDoc] as any);
  });

  describe("GET", () => {
    it("returns 401 when unauthorized", async () => {
      mockedGetSessionUserId.mockResolvedValue(null);
      const response = await GET(new Request("http://localhost/api/companies"));
      expect(response.status).toBe(401);
      expect(mockedSync).not.toHaveBeenCalled();
    });

    it("syncs client people into companies and returns the serialized list", async () => {
      const response = await GET(new Request("http://localhost/api/companies"));
      expect(response.status).toBe(200);

      // The clients query is workspace-scoped and only targets active clients.
      const peopleQuery = peopleFind.mock.calls[0][0];
      expect(JSON.stringify(peopleQuery)).toContain("workspace-1");
      expect(JSON.stringify(peopleQuery)).toContain('"personType":"client"');

      expect(mockedSync).toHaveBeenCalledWith(fakeDb, {
        workspaceId: "workspace-1",
        userId: "user-1",
        people: clientPeople,
      });

      const payload = await response.json();
      expect(payload).toEqual([
        expect.objectContaining({
          id: "c1",
          name: "acme.com",
          domain: "acme.com",
          peopleIds: ["p1"],
          createdAt: "2026-07-01T00:00:00.000Z",
        }),
      ]);
    });

    it("returns an empty list without syncing when no workspace resolves", async () => {
      mockedResolveScope.mockResolvedValue({
        workspaceId: null,
        workspace: null as any,
        membership: null as any,
        workspaceMemberUserIds: ["user-1"],
      } as any);
      const response = await GET(new Request("http://localhost/api/companies"));
      expect(response.status).toBe(200);
      expect(mockedSync).not.toHaveBeenCalled();
      await expect(response.json()).resolves.toEqual([]);
    });
  });

  describe("POST", () => {
    it("returns 401 when unauthorized", async () => {
      mockedGetSessionUserId.mockResolvedValue(null);
      const response = await POST(buildPostRequest({ name: "Acme" }));
      expect(response.status).toBe(401);
      expect(mockedCreate).not.toHaveBeenCalled();
    });

    it("rejects invalid payloads with 400", async () => {
      const response = await POST(buildPostRequest({ name: "", extra: true }));
      expect(response.status).toBe(400);
      expect(mockedCreate).not.toHaveBeenCalled();
    });

    it("creates a company (201) with the workspace scope", async () => {
      mockedCreate.mockResolvedValue({
        company: companyDoc as any,
        created: true,
      });
      const response = await POST(
        buildPostRequest({ name: "Acme", domain: "acme.com", aliases: ["ACME"] })
      );
      expect(response.status).toBe(201);
      expect(mockedCreate).toHaveBeenCalledWith(fakeDb, {
        workspaceId: "workspace-1",
        userId: "user-1",
        name: "Acme",
        domain: "acme.com",
        aliases: ["ACME"],
        peopleIds: undefined,
      });
      const payload = await response.json();
      expect(payload.id).toBe("c1");
    });

    it("returns 200 when the company deduped to an existing record", async () => {
      mockedCreate.mockResolvedValue({
        company: companyDoc as any,
        created: false,
      });
      const response = await POST(buildPostRequest({ name: "acme.com" }));
      expect(response.status).toBe(200);
    });
  });
});
