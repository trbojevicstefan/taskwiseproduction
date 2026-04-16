import { executeMcpWriteTool, listMcpWriteTools } from "@/lib/mcp-write-tools";
import { publishDomainEvent } from "@/lib/domain-events";
import { McpToolCallError } from "@/lib/mcp-read-tools";

jest.mock("@/lib/domain-events", () => ({
  publishDomainEvent: jest.fn(),
}));

const mockedPublishDomainEvent =
  publishDomainEvent as jest.MockedFunction<typeof publishDomainEvent>;

describe("mcp-write-tools", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPublishDomainEvent.mockResolvedValue({ matchedTasks: 1 } as any);
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
});
