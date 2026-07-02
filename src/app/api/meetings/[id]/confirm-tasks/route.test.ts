import { POST } from "@/app/api/meetings/[id]/confirm-tasks/route";
import { ensureBoardItemsForTasks } from "@/lib/board-items";
import { ensureDefaultBoard } from "@/lib/boards";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import {
  cleanupChatTasksForSessions,
  updateLinkedChatSessions,
} from "@/lib/services/session-task-sync";
import { syncTasksForSource } from "@/lib/task-sync";
import { hydrateTaskReferenceLists } from "@/lib/task-hydration";
import { getWorkspaceIdForUser } from "@/lib/workspace";
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

jest.mock("@/lib/workspace", () => ({
  getWorkspaceIdForUser: jest.fn(),
}));

jest.mock("@/lib/task-sync", () => ({
  syncTasksForSource: jest.fn(),
}));

jest.mock("@/lib/task-hydration", () => ({
  hydrateTaskReferenceLists: jest.fn(),
}));

jest.mock("@/lib/boards", () => ({
  ensureDefaultBoard: jest.fn(),
}));

jest.mock("@/lib/board-items", () => ({
  ensureBoardItemsForTasks: jest.fn(),
}));

jest.mock("@/lib/services/session-task-sync", () => ({
  cleanupChatTasksForSessions: jest.fn(),
  updateLinkedChatSessions: jest.fn(),
}));

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedGetSessionUserId = getSessionUserId as jest.MockedFunction<
  typeof getSessionUserId
>;
const mockedAssertWorkspaceAccess = assertWorkspaceAccess as jest.MockedFunction<
  typeof assertWorkspaceAccess
>;
const mockedEnsureWorkspaceBootstrapForUser =
  ensureWorkspaceBootstrapForUser as jest.MockedFunction<
    typeof ensureWorkspaceBootstrapForUser
  >;
const mockedGetWorkspaceIdForUser = getWorkspaceIdForUser as jest.MockedFunction<
  typeof getWorkspaceIdForUser
>;
const mockedSyncTasksForSource = syncTasksForSource as jest.MockedFunction<
  typeof syncTasksForSource
>;
const mockedHydrateTaskReferenceLists = hydrateTaskReferenceLists as jest.MockedFunction<
  typeof hydrateTaskReferenceLists
>;
const mockedEnsureDefaultBoard = ensureDefaultBoard as jest.MockedFunction<
  typeof ensureDefaultBoard
>;
const mockedEnsureBoardItemsForTasks = ensureBoardItemsForTasks as jest.MockedFunction<
  typeof ensureBoardItemsForTasks
>;
const mockedUpdateLinkedChatSessions = updateLinkedChatSessions as jest.MockedFunction<
  typeof updateLinkedChatSessions
>;
const mockedCleanupChatTasksForSessions = cleanupChatTasksForSessions as jest.MockedFunction<
  typeof cleanupChatTasksForSessions
>;

describe("POST /api/meetings/[id]/confirm-tasks", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetSessionUserId.mockResolvedValue("user-1");
    mockedAssertWorkspaceAccess.mockResolvedValue(undefined as any);
    mockedEnsureWorkspaceBootstrapForUser.mockResolvedValue(undefined as any);
    mockedGetWorkspaceIdForUser.mockResolvedValue("workspace-1");
    mockedSyncTasksForSource.mockResolvedValue({
      taskMap: new Map([
        ["task-1", "canonical-task-1"],
        ["task-1-1", "canonical-task-1-1"],
      ]),
    } as any);
    mockedHydrateTaskReferenceLists.mockImplementation(async (_userId, taskLists) => taskLists as any);
    mockedEnsureDefaultBoard.mockResolvedValue({ _id: "board-1" } as any);
    mockedEnsureBoardItemsForTasks.mockResolvedValue({ created: 1 } as any);
    mockedUpdateLinkedChatSessions.mockResolvedValue([] as any);
    mockedCleanupChatTasksForSessions.mockResolvedValue(undefined as any);
  });

  it("confirms selected tasks, projects them to canonical references, and creates board items", async () => {
    const storedMeeting: any = {
      _id: "meeting-1",
      id: "meeting-1",
      workspaceId: "workspace-1",
      userId: "owner-1",
      title: "Launch planning",
      isHidden: false,
      createdAt: new Date("2026-07-01T10:00:00.000Z"),
      lastActivityAt: new Date("2026-07-01T10:30:00.000Z"),
      extractedTasks: [
        {
          id: "task-1",
          title: "Draft launch brief",
          priority: "high",
          reviewStatus: "pending",
          taskState: "suggested",
          status: "todo",
          subtasks: [
            {
              id: "task-1-1",
              title: "Collect metrics",
              priority: "medium",
              reviewStatus: "pending",
              taskState: "suggested",
              status: "todo",
              subtasks: null,
            },
          ],
        },
      ],
    };
    const findOne = jest.fn().mockImplementation(() => Promise.resolve(storedMeeting));
    const updateOne = jest.fn().mockImplementation((_filter, update) => {
      storedMeeting.extractedTasks = update.$set.extractedTasks;
      storedMeeting.lastActivityAt = update.$set.lastActivityAt;
      return Promise.resolve(undefined);
    });

    mockedGetDb.mockResolvedValue({
      collection: jest.fn((name: string) => {
        if (name === "meetings") {
          return { findOne, updateOne };
        }
        throw new Error(`Unexpected collection: ${name}`);
      }),
    } as any);

    const response = await POST(
      new Request("http://localhost/api/meetings/meeting-1/confirm-tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskIds: ["task-1"],
        }),
      }),
      {
        params: Promise.resolve({ id: "meeting-1" }),
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.confirmed).toBe(1);
    expect(payload.boardItemsCreated).toBe(1);
    expect(payload.boardId).toBe("board-1");
    expect(payload.meeting.extractedTasks[0]).toMatchObject({
      taskId: "canonical-task-1",
      sourceTaskId: "task-1",
      title: "Draft launch brief",
    });
    expect(payload.meeting.extractedTasks[0].subtasks[0].title).toBe("Collect metrics");
    expect(mockedEnsureBoardItemsForTasks).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "owner-1",
        workspaceId: "workspace-1",
        boardId: "board-1",
      })
    );
    expect(mockedUpdateLinkedChatSessions).toHaveBeenCalledTimes(1);
    expect(mockedCleanupChatTasksForSessions).toHaveBeenCalledTimes(1);
  });
});
