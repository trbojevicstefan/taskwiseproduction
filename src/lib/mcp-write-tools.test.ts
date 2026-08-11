import { executeMcpWriteTool, listMcpWriteTools } from "@/lib/mcp-write-tools";
import { publishDomainEvent } from "@/lib/domain-events";
import { McpToolCallError } from "@/lib/mcp-read-tools";
import { listActiveWorkspaceMembershipsForWorkspace } from "@/lib/workspace-memberships";

jest.mock("@/lib/domain-events", () => ({
  publishDomainEvent: jest.fn(),
}));

jest.mock("@/lib/workspace-memberships", () => ({
  listActiveWorkspaceMembershipsForWorkspace: jest.fn(),
}));

const mockedPublishDomainEvent =
  publishDomainEvent as jest.MockedFunction<typeof publishDomainEvent>;
const mockedMemberships =
  listActiveWorkspaceMembershipsForWorkspace as jest.MockedFunction<
    typeof listActiveWorkspaceMembershipsForWorkspace
  >;

describe("mcp-write-tools", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPublishDomainEvent.mockResolvedValue({ matchedTasks: 1 } as any);
    mockedMemberships.mockResolvedValue([
      { userId: "member-1", status: "active" },
    ] as any);
  });

  it("exposes safe action-item write tools", () => {
    const names = listMcpWriteTools().map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "action_items.update_status",
        "action_items.update_assignee",
        "action_items.update_due_date",
        "action_items.update_notes",
        "action_items.update_title",
      ])
    );
  });

  it("updates status and publishes domain event", async () => {
    const updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    const findOne = jest
      .fn()
      .mockResolvedValueOnce({
        _id: "task-1",
        workspaceId: "workspace-1",
        userId: "user-1",
        status: "todo",
      })
      .mockResolvedValueOnce({
        _id: "task-1",
        workspaceId: "workspace-1",
        userId: "user-1",
        status: "done",
      });

    const db = {
      collection: jest.fn(() => ({
        findOne,
        updateOne,
      })),
    } as any;

    const result = await executeMcpWriteTool(db, "workspace-1", "action_items.update_status", {
      taskId: "task-1",
      status: "done",
    });

    expect(result.summary).toContain("done");
    expect(result.data.task).toMatchObject({
      id: "task-1",
      status: "done",
    });
    expect(mockedPublishDomainEvent).toHaveBeenCalled();
  });

  it("updates assignee fields and normalizes assigneeName", async () => {
    const updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    const findOne = jest
      .fn()
      .mockResolvedValueOnce({
        _id: "task-2",
        workspaceId: "workspace-1",
        userId: "user-1",
      })
      .mockResolvedValueOnce({
        _id: "task-2",
        workspaceId: "workspace-1",
        userId: "user-1",
        assignee: { uid: "person-1", name: "Alex Parker" },
        assigneeName: "Alex Parker",
      });

    const db = {
      collection: jest.fn(() => ({
        findOne,
        updateOne,
      })),
    } as any;

    const result = await executeMcpWriteTool(db, "workspace-1", "action_items.update_assignee", {
      taskId: "task-2",
      assignee: {
        uid: "person-1",
        name: "Alex Parker",
        email: "alex@example.com",
      },
    });

    expect(result.data.task).toMatchObject({
      id: "task-2",
      assigneeName: "Alex Parker",
    });
    expect(updateOne).toHaveBeenCalled();
  });

  it("rejects invalid due date", async () => {
    const findOne = jest.fn().mockResolvedValue({
      _id: "task-3",
      workspaceId: "workspace-1",
      userId: "user-1",
    });
    const db = {
      collection: jest.fn(() => ({
        findOne,
        updateOne: jest.fn(),
      })),
    } as any;

    await expect(
      executeMcpWriteTool(db, "workspace-1", "action_items.update_due_date", {
        taskId: "task-3",
        dueAt: "not-a-date",
      })
    ).rejects.toBeInstanceOf(McpToolCallError);
  });

  it.each([
    {
      label: "status",
      toolName: "action_items.update_status",
      args: { taskId: "legacy-task", status: "done" },
      updated: { status: "done" },
    },
    {
      label: "title",
      toolName: "action_items.update_title",
      args: { taskId: "legacy-task", title: "Renamed legacy task" },
      updated: { title: "Renamed legacy task" },
    },
    {
      label: "due date",
      toolName: "action_items.update_due_date",
      args: { taskId: "legacy-task", dueAt: "2026-08-20T00:00:00.000Z" },
      updated: { dueAt: "2026-08-20T00:00:00.000Z" },
    },
  ])(
    "updates a workspace-less member-owned task through the typed $label boundary",
    async ({ toolName, args, updated }) => {
      const before = {
        _id: "legacy-task",
        userId: "member-1",
        title: "Legacy task",
        status: "todo",
      };
      const updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
      const findOne = jest.fn(async (filter: any) => {
        if (filter?._id === "legacy-task") return { ...before, ...updated };
        if (Array.isArray(filter?.$and)) return before;
        return null;
      });
      const db = {
        collection: jest.fn(() => ({ findOne, updateOne })),
      } as any;

      const result = await executeMcpWriteTool(
        db,
        "workspace-1",
        toolName,
        args
      );

      expect(mockedMemberships).toHaveBeenCalledWith(db, "workspace-1");
      expect(findOne).toHaveBeenNthCalledWith(1, {
        $and: [
          {
            $or: [
              { workspaceId: "workspace-1" },
              {
                workspaceId: { $exists: false },
                userId: { $in: ["member-1"] },
              },
            ],
          },
          { taskState: { $ne: "archived" } },
          {
            $or: [
              { _id: "legacy-task" },
              { id: "legacy-task" },
              { sourceTaskId: "legacy-task" },
            ],
          },
        ],
      });
      expect(updateOne).toHaveBeenCalledTimes(1);
      expect(result.data.task).toEqual(expect.objectContaining(updated));
    }
  );

  it("rejects a workspace-less nonmember task with zero writes", async () => {
    const updateOne = jest.fn();
    const findOne = jest.fn(async () => null);
    const db = {
      collection: jest.fn(() => ({ findOne, updateOne })),
    } as any;

    await expect(
      executeMcpWriteTool(
        db,
        "workspace-1",
        "action_items.update_title",
        { taskId: "nonmember-task", title: "Forbidden rename" }
      )
    ).rejects.toMatchObject({ code: "invalid_arguments" });

    expect(mockedMemberships).toHaveBeenCalledWith(db, "workspace-1");
    expect(findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        $and: expect.arrayContaining([
          expect.objectContaining({
            $or: expect.arrayContaining([
              expect.objectContaining({
                userId: { $in: ["member-1"] },
              }),
            ]),
          }),
        ]),
      })
    );
    expect(updateOne).not.toHaveBeenCalled();
  });
});
