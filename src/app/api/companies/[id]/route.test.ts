import { GET, PATCH } from "@/app/api/companies/[id]/route";
import { findCompanyById, updateCompany } from "@/lib/companies";
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
    findCompanyById: jest.fn(),
    updateCompany: jest.fn(),
  };
});

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedGetSessionUserId = getSessionUserId as jest.MockedFunction<
  typeof getSessionUserId
>;
const mockedResolveScope = resolveWorkspaceScopeForUser as jest.MockedFunction<
  typeof resolveWorkspaceScopeForUser
>;
const mockedFindCompanyById = findCompanyById as jest.MockedFunction<
  typeof findCompanyById
>;
const mockedUpdateCompany = updateCompany as jest.MockedFunction<
  typeof updateCompany
>;

const DAY_MS = 24 * 60 * 60 * 1000;

const companyDoc = {
  _id: "c1",
  workspaceId: "workspace-1",
  userId: "user-1",
  name: "Acme",
  nameKey: "acme",
  domain: "acme.com",
  aliases: [],
  peopleIds: ["p1"],
  createdAt: new Date("2026-07-01T00:00:00.000Z"),
  updatedAt: new Date("2026-07-01T00:00:00.000Z"),
};

const personDoc = {
  _id: "p1",
  name: "Jane Client",
  email: "jane@acme.com",
  aliases: [],
  personType: "client",
  sourceSessionIds: ["m1"],
  nextFollowUpAt: "2026-08-01T00:00:00.000Z",
  lastSeenAt: new Date("2026-06-30T00:00:00.000Z"),
};

const meetingDoc = {
  _id: "m1",
  title: "Acme sync",
  startTime: new Date("2026-06-29T10:00:00.000Z"),
  attendees: [{ name: "Jane Client", email: "jane@acme.com" }],
};

const buildDb = ({
  people = [personDoc],
  meetings = [meetingDoc],
  tasks = [] as any[],
} = {}) => {
  const chainedFind = (docs: any[], withProject: boolean) =>
    jest.fn().mockImplementation(() => {
      const cursor: any = {
        sort: jest.fn(() => cursor),
        limit: jest.fn(() => cursor),
        project: jest.fn(() => cursor),
        toArray: jest.fn().mockResolvedValue(docs),
      };
      if (!withProject) delete cursor.project;
      return cursor;
    });
  return {
    collection: jest.fn((name: string) => {
      if (name === "people") return { find: chainedFind(people, false) };
      if (name === "meetings") return { find: chainedFind(meetings, true) };
      if (name === "tasks") return { find: chainedFind(tasks, true) };
      throw new Error(`Unexpected collection in test: ${name}`);
    }),
  } as any;
};

const params = Promise.resolve({ id: "c1" });

describe("/api/companies/[id]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetSessionUserId.mockResolvedValue("user-1");
    mockedResolveScope.mockResolvedValue({
      workspaceId: "workspace-1",
      workspace: null as any,
      membership: null as any,
      workspaceMemberUserIds: ["user-1"],
    });
    mockedFindCompanyById.mockResolvedValue(companyDoc as any);
    mockedGetDb.mockResolvedValue(buildDb());
  });

  describe("GET", () => {
    it("returns 401 when unauthorized", async () => {
      mockedGetSessionUserId.mockResolvedValue(null);
      const response = await GET(
        new Request("http://localhost/api/companies/c1"),
        { params }
      );
      expect(response.status).toBe(401);
    });

    it("returns 404 when the company is not in the workspace", async () => {
      mockedFindCompanyById.mockResolvedValue(null);
      const response = await GET(
        new Request("http://localhost/api/companies/c1"),
        { params }
      );
      expect(response.status).toBe(404);
      expect(mockedFindCompanyById).toHaveBeenCalledWith(
        expect.anything(),
        "workspace-1",
        "c1"
      );
    });

    it("aggregates people, meetings, open tasks, and stats", async () => {
      const overdue = new Date(Date.now() - DAY_MS);
      mockedGetDb.mockResolvedValue(
        buildDb({
          tasks: [
            {
              _id: "t1",
              title: "Send proposal",
              status: "todo",
              dueAt: overdue,
              assigneeName: "Jane Client",
            },
            { _id: "t2", title: "Kickoff deck", status: "done" },
          ],
        })
      );

      const response = await GET(
        new Request("http://localhost/api/companies/c1"),
        { params }
      );
      expect(response.status).toBe(200);
      const payload = await response.json();

      expect(payload.company.id).toBe("c1");
      expect(payload.people).toEqual([
        expect.objectContaining({ id: "p1", name: "Jane Client" }),
      ]);
      expect(payload.meetings).toEqual([
        expect.objectContaining({
          id: "m1",
          title: "Acme sync",
          attendeeCount: 1,
        }),
      ]);
      expect(payload.openTasks).toEqual([
        expect.objectContaining({ id: "t1", overdue: true }),
      ]);
      expect(payload.stats).toEqual(
        expect.objectContaining({
          peopleCount: 1,
          openTaskCount: 1,
          overdueTaskCount: 1,
          completedTaskCount: 1,
          lastContactedAt: "2026-06-29T10:00:00.000Z",
          nextFollowUpAt: "2026-08-01T00:00:00.000Z",
        })
      );
    });
  });

  describe("PATCH", () => {
    const buildPatch = (body: unknown) =>
      new Request("http://localhost/api/companies/c1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

    it("returns 401 when unauthorized", async () => {
      mockedGetSessionUserId.mockResolvedValue(null);
      const response = await PATCH(buildPatch({ name: "Acme" }), { params });
      expect(response.status).toBe(401);
    });

    it("rejects unknown fields with 400", async () => {
      const response = await PATCH(buildPatch({ hacker: true }), { params });
      expect(response.status).toBe(400);
      expect(mockedUpdateCompany).not.toHaveBeenCalled();
    });

    it("updates the company within the workspace", async () => {
      mockedUpdateCompany.mockResolvedValue({
        ...companyDoc,
        name: "Acme Corp",
        nameKey: "acme corp",
      } as any);
      const response = await PATCH(buildPatch({ name: "Acme Corp" }), { params });
      expect(response.status).toBe(200);
      expect(mockedUpdateCompany).toHaveBeenCalledWith(
        expect.anything(),
        "workspace-1",
        "c1",
        { name: "Acme Corp" }
      );
      const payload = await response.json();
      expect(payload.name).toBe("Acme Corp");
    });

    it("returns 404 when the company does not exist", async () => {
      mockedUpdateCompany.mockResolvedValue(null);
      const response = await PATCH(buildPatch({ name: "Acme Corp" }), { params });
      expect(response.status).toBe(404);
    });
  });
});
