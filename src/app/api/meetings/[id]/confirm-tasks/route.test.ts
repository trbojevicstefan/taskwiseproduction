import { POST } from "@/app/api/meetings/[id]/confirm-tasks/route";
import { ensureBoardItemsForTasks } from "@/lib/board-items";
import { ensureDefaultBoard } from "@/lib/boards";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { cleanupChatTasksForSessions, updateLinkedChatSessions } from "@/lib/services/session-task-sync";
import { syncTasksForSource } from "@/lib/task-sync";
import { getWorkspaceIdForUser } from "@/lib/workspace";
import { assertWorkspaceAccess, ensureWorkspaceBootstrapForUser } from "@/lib/workspace-context";

jest.mock("@/lib/db", () => ({
  getDb: jest.fn(),
}));

jest.mock("@/lib/server-auth", () => ({
  getSessionUserId: jest.fn(),
}));

jest.mock("@/lib/board-items", () => ({
  ensureBoardItemsForTasks: jest.fn(),
}));

jest.mock("@/lib/boards", () => ({
  ensureDefaultBoard: jest.fn(),
}));

jest.mock("@/lib/services/session-task-sync", () => ({
  cleanupChatTasksForSessions: jest.fn(),
  updateLinkedChatSessions: jest.fn(),
}));

jest.mock("@/lib/task-sync", () => ({
  syncTasksForSource: jest.fn(),
}));

jest.mock("@/lib/workspace", () => ({
  getWorkspaceIdForUser: jest.fn(),
}));

jest.mock("@/lib/workspace-context", () => ({
  assertWorkspaceAccess: jest.fn(),
  ensureWorkspaceBootstrapForUser: jest.fn(),
}));

jest.mock("@/lib/task-hydration", () => ({
  hydrateTaskReferenceLists: jest.fn().mockImplementation(
    async (_userId: string, lists: any[]) => lists
  ),
}));

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedGetSessionUserId = getSessionUserId as jest.MockedFunction<
  typeof getSessionUserId
>;
const mockedEnsureBoardItemsForTasks =
  ensureBoardItemsForTasks as jest.MockedFunction<typeof ensureBoardItemsForTasks>;
const mockedEnsureDefaultBoard =
  ensureDefaultBoard as jest.MockedFunction<typeof ensureDefaultBoard>;
const mockedCleanupChatTasksForSessions =
  cleanupChatTasksForSessions as jest.MockedFunction<
    typeof cleanupChatTasksForSessions
  >;
const mockedUpdateLinkedChatSessions =
  updateLinkedChatSessions as jest.MockedFunction<typeof updateLinkedChatSessions>;
const mockedSyncTasksForSource =
  syncTasksForSource as jest.MockedFunction<typeof syncTasksForSource>;
const mockedGetWorkspaceIdForUser =
  getWorkspaceIdForUser as jest.MockedFunction<typeof getWorkspaceIdForUser>;
const mockedAssertWorkspaceAccess = assertWorkspaceAccess as jest.MockedFunction<
  typeof assertWorkspaceAccess
>;
const mockedEnsureWorkspaceBootstrapForUser =
  ensureWorkspaceBootstrapForUser as jest.MockedFunction<
    typeof ensureWorkspaceBootstrapForUser
  >;

const makeMeeting = () => ({
  _id: "meeting-1",
  userId: "owner-1",
  workspaceId: "workspace-1",
  title: "Shared Planning",
  extractedTasks: [
    {
      id: "task-1",
      title: "Approve roadmap",
      taskState: "suggested",
      reviewStatus: "suggested",
      subtasks: [
        {
          id: "task-1-1",
          title: "Draft brief",
          taskState: "suggested",
          reviewStatus: "suggested",
          subtasks: null,
        },
      ],
    },
    {
      id: "task-2",
      title: "Leave alone",
      taskState: "suggested",
      reviewStatus: "suggested",
      subtasks: null,
    },
  ],
  createdAt: new Date("2026-02-18T00:00:00.000Z"),
  lastActivityAt: new Date("2026-02-18T00:00:00.000Z"),
});

describe("POST /api/meetings/[id]/confirm-tasks", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetSessionUserId.mockResolvedValue("user-1");
    mockedEnsureWorkspaceBootstrapForUser.mockResolvedValue(null as any);
    mockedAssertWorkspaceAccess.mockResolvedValue({
      workspace: { _id: "workspace-1", name: "Workspace 1" },
      membership: { role: "member", status: "active" },
    } as any);
    mockedGetWorkspaceIdForUser.mockResolvedValue("workspace-1");
    mockedEnsureDefaultBoard.mockResolvedValue({ _id: "board-1" } as any);
    mockedEnsureBoardItemsForTasks.mockResolvedValue({ created: 1 } as any);
    mockedCleanupChatTasksForSessions.mockResolvedValue(undefined as any);
    mockedUpdateLinkedChatSessions.mockResolvedValue([] as any);
    mockedSyncTasksForSource.mockResolvedValue({
      taskMap: new Map([
        ["task-1", "canonical-task-1"],
        ["task-1-1", "canonical-task-1-1"],
        ["task-2", "canonical-task-2"],
      ]),
    } as any);
  });

  it("returns 401 when the user is not authenticated", async () => {
    mockedGetSessionUserId.mockResolvedValueOnce(null);

    const response = await POST(
      new Request("http://localhost/api/meetings/meeting-1/confirm-tasks", {
        method: "POST",
        body: JSON.stringify({ taskIds: ["task-1"] }),
      }),
      { params: Promise.resolve({ id: "meeting-1" }) }
    );

    expect(response.status).toBe(401);
    expect(mockedGetDb).not.toHaveBeenCalled();
  });

  it("returns 400 when no task IDs are provided", async () => {
    const response = await POST(
      new Request("http://localhost/api/meetings/meeting-1/confirm-tasks", {
        method: "POST",
        body: JSON.stringify({ taskIds: [] }),
      }),
      { params: Promise.resolve({ id: "meeting-1" }) }
    );

    expect(response.status).toBe(400);
    expect(mockedGetDb).not.toHaveBeenCalled();
  });

  it("returns 403 when workspace access is denied", async () => {
    mockedAssertWorkspaceAccess.mockRejectedValueOnce(new Error("Forbidden"));

    const db = {
      collection: jest.fn(() => ({
        findOne: jest.fn().mockResolvedValue(makeMeeting()),
      })),
    } as any;
    mockedGetDb.mockResolvedValue(db);

    const response = await POST(
      new Request("http://localhost/api/meetings/meeting-1/confirm-tasks", {
        method: "POST",
        body: JSON.stringify({ taskIds: ["task-1"] }),
      }),
      { params: Promise.resolve({ id: "meeting-1" }) }
    );

    expect(response.status).toBe(403);
    expect(mockedEnsureDefaultBoard).not.toHaveBeenCalled();
  });

  it("returns 404 when the meeting is missing", async () => {
    const db = {
      collection: jest.fn(() => ({
        findOne: jest.fn().mockResolvedValue(null),
      })),
    } as any;
    mockedGetDb.mockResolvedValue(db);

    const response = await POST(
      new Request("http://localhost/api/meetings/meeting-1/confirm-tasks", {
        method: "POST",
        body: JSON.stringify({ taskIds: ["task-1"] }),
      }),
      { params: Promise.resolve({ id: "meeting-1" }) }
    );

    expect(response.status).toBe(404);
  });

  it("confirms selected tasks, creates board items, and updates the meeting", async () => {
    const meeting = makeMeeting();
    const updatedMeeting = {
      ...meeting,
      extractedTasks: [
        {
          taskId: "canonical-task-1",
          sourceTaskId: "task-1",
          title: "Approve roadmap",
          subtasks: [
            {
              taskId: "canonical-task-1-1",
              sourceTaskId: "task-1-1",
              title: "Draft brief",
              subtasks: null,
            },
          ],
        },
        {
          taskId: "canonical-task-2",
          sourceTaskId: "task-2",
          title: "Leave alone",
          subtasks: null,
        },
      ],
      lastActivityAt: new Date("2026-02-18T01:00:00.000Z"),
    };
    const findOne = jest
      .fn()
      .mockResolvedValueOnce(meeting)
      .mockResolvedValueOnce(updatedMeeting);
    const updateOne = jest.fn().mockResolvedValue({ acknowledged: true });
    const db = {
      collection: jest.fn((name: string) => {
        if (name === "meetings") {
          return { findOne, updateOne };
        }
        throw new Error(`Unexpected collection ${name}`);
      }),
    } as any;
    mockedGetDb.mockResolvedValue(db);

    const response = await POST(
      new Request("http://localhost/api/meetings/meeting-1/confirm-tasks", {
        method: "POST",
        body: JSON.stringify({
          taskIds: ["task-1"],
        }),
      }),
      { params: Promise.resolve({ id: "meeting-1" }) }
    );

    expect(response.status).toBe(200);
    expect(mockedSyncTasksForSource).toHaveBeenCalledWith(
      db,
      expect.arrayContaining([
        expect.objectContaining({
          id: "task-1",
          taskState: "active",
          reviewStatus: "confirmed",
          subtasks: [
            expect.objectContaining({
              id: "task-1-1",
              taskState: "suggested",
              reviewStatus: "suggested",
            }),
          ],
        }),
      ]),
      expect.objectContaining({
        userId: "owner-1",
        workspaceId: "workspace-1",
        sourceSessionId: "meeting-1",
        sourceSessionType: "meeting",
        sourceSessionName: "Shared Planning",
        origin: "meeting",
        taskState: "suggested",
      })
    );
    expect(mockedEnsureDefaultBoard).toHaveBeenCalledWith(
      db,
      "owner-1",
      "workspace-1"
    );
    expect(mockedEnsureBoardItemsForTasks).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        userId: "owner-1",
        workspaceId: "workspace-1",
        boardId: "board-1",
        tasks: [
          expect.objectContaining({
            id: "task-1",
            title: "Approve roadmap",
            subtasks: null,
          }),
        ],
      })
    );
    expect(updateOne).toHaveBeenCalledWith(
      { _id: "meeting-1" },
      expect.objectContaining({
        $set: expect.objectContaining({
          lastActivityAt: expect.any(Date),
          extractedTasks: [
            {
              taskId: "canonical-task-1",
              sourceTaskId: "task-1",
              title: "Approve roadmap",
              subtasks: [
                {
                  taskId: "canonical-task-1-1",
                  sourceTaskId: "task-1-1",
                  title: "Draft brief",
                  subtasks: null,
                },
              ],
            },
            {
              taskId: "canonical-task-2",
              sourceTaskId: "task-2",
              title: "Leave alone",
              subtasks: null,
            },
          ],
        }),
      })
    );
    await expect(response.json()).resolves.toMatchObject({
      confirmed: 1,
      boardItemsCreated: 1,
      boardId: "board-1",
      meeting: expect.objectContaining({
        id: "meeting-1",
        workspaceId: "workspace-1",
      }),
    });
  });
});
