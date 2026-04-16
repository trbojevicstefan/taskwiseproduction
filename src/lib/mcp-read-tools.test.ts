import {
  executeMcpReadTool,
  listMcpReadTools,
  McpToolCallError,
} from "@/lib/mcp-read-tools";
import { listActiveWorkspaceMembershipsForWorkspace } from "@/lib/workspace-memberships";

jest.mock("@/lib/workspace-memberships", () => ({
  listActiveWorkspaceMembershipsForWorkspace: jest.fn(),
}));

const mockedListActiveWorkspaceMembershipsForWorkspace =
  listActiveWorkspaceMembershipsForWorkspace as jest.MockedFunction<
    typeof listActiveWorkspaceMembershipsForWorkspace
  >;

const createCursor = (rows: any[]) => {
  let workingRows = [...rows];
  const cursor: any = {};
  cursor.project = jest.fn(() => cursor);
  cursor.sort = jest.fn(() => cursor);
  cursor.limit = jest.fn((limit: number) => {
    workingRows = workingRows.slice(0, limit);
    return cursor;
  });
  cursor.toArray = jest.fn(async () => workingRows);
  return cursor;
};

describe("mcp-read-tools", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedListActiveWorkspaceMembershipsForWorkspace.mockResolvedValue([
      { userId: "user-1", status: "active" },
    ] as any);
  });

  it("exposes meeting/action-item/people tools", () => {
    const tools = listMcpReadTools();
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "meetings.latest",
        "meetings.list",
        "meetings.get",
        "action_items.list",
        "people.list",
        "people.get",
      ])
    );
  });

  it("returns latest meeting with serialized identifiers and dates", async () => {
    const meetingsCursor = createCursor([
      {
        _id: "meeting-1",
        workspaceId: "workspace-1",
        title: "Roadmap Sync",
        summary: "Discussed roadmap",
        recordingId: "secret",
        createdAt: new Date("2026-04-16T10:00:00.000Z"),
        lastActivityAt: new Date("2026-04-16T10:30:00.000Z"),
      },
    ]);

    const db = {
      collection: jest.fn((name: string) => {
        if (name === "meetings") {
          return {
            find: jest.fn(() => meetingsCursor),
          };
        }
        throw new Error(`Unexpected collection: ${name}`);
      }),
    } as any;

    const result = await executeMcpReadTool(
      db,
      "workspace-1",
      "meetings.latest",
      {}
    );

    expect(result.toolName).toBe("meetings.latest");
    expect(result.data.meeting).toMatchObject({
      id: "meeting-1",
      title: "Roadmap Sync",
      createdAt: "2026-04-16T10:00:00.000Z",
      lastActivityAt: "2026-04-16T10:30:00.000Z",
    });
    expect(result.data.meeting).not.toHaveProperty("recordingId");
  });

  it("returns person details with assigned action items", async () => {
    const tasksCursor = createCursor([
      {
        _id: "task-1",
        workspaceId: "workspace-1",
        title: "Send follow-up",
        status: "todo",
        assignee: { uid: "person-1", name: "Alex Parker" },
        createdAt: new Date("2026-04-16T09:00:00.000Z"),
        lastUpdated: new Date("2026-04-16T09:15:00.000Z"),
      },
    ]);

    const db = {
      collection: jest.fn((name: string) => {
        if (name === "people") {
          return {
            findOne: jest.fn(async () => ({
              _id: "person-1",
              workspaceId: "workspace-1",
              name: "Alex Parker",
              email: "alex@example.com",
              createdAt: new Date("2026-04-15T10:00:00.000Z"),
              lastSeenAt: new Date("2026-04-16T08:00:00.000Z"),
            })),
          };
        }
        if (name === "tasks") {
          return {
            find: jest.fn(() => tasksCursor),
          };
        }
        throw new Error(`Unexpected collection: ${name}`);
      }),
    } as any;

    const result = await executeMcpReadTool(db, "workspace-1", "people.get", {
      personId: "person-1",
      includeActionItems: true,
      actionItemsLimit: 10,
    });

    expect(result.toolName).toBe("people.get");
    expect(result.data.person).toMatchObject({
      id: "person-1",
      name: "Alex Parker",
    });
    expect(result.data.actionItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "task-1",
          title: "Send follow-up",
        }),
      ])
    );
  });

  it("throws a typed error for unknown tools", async () => {
    const db = { collection: jest.fn() } as any;
    await expect(
      executeMcpReadTool(db, "workspace-1", "people.delete", {})
    ).rejects.toBeInstanceOf(McpToolCallError);
  });
});
