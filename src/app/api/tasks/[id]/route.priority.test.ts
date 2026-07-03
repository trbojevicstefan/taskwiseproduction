import { PATCH } from "@/app/api/tasks/[id]/route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";

jest.mock("@/lib/db", () => ({
  getDb: jest.fn(),
}));

jest.mock("@/lib/server-auth", () => ({
  getSessionUserId: jest.fn(),
}));

jest.mock("@/lib/transcript-utils", () => ({
  normalizePersonNameKey: jest.fn((value: string) => value.toLowerCase()),
}));

jest.mock("@/lib/task-sync", () => ({
  syncTasksForSource: jest.fn(),
}));

jest.mock("@/lib/domain-events", () => ({
  publishDomainEvent: jest.fn(),
}));

jest.mock("@/lib/services/session-task-sync", () => ({
  cleanupChatTasksForSessions: jest.fn(),
  updateChatTasks: jest.fn(),
  updateLinkedChatSessions: jest.fn(),
  updateMeetingTasks: jest.fn(),
}));

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedGetSessionUserId = getSessionUserId as jest.MockedFunction<
  typeof getSessionUserId
>;

const DAY_MS = 24 * 60 * 60 * 1000;

const buildRequest = (body: Record<string, unknown>) =>
  new Request("http://localhost/api/tasks/task-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const buildParams = (id: string) => ({ params: Promise.resolve({ id }) });

const buildDb = (existingTask: any) => {
  const updateOne = jest.fn().mockResolvedValue({ matchedCount: 1 });
  const findOne = jest.fn().mockResolvedValue(existingTask);
  const db = {
    collection: jest.fn((name: string) => {
      if (name === "tasks") {
        return { updateOne, findOne };
      }
      throw new Error(`Unexpected collection in test: ${name}`);
    }),
  } as any;
  return { db, updateOne, findOne };
};

describe("PATCH /api/tasks/[id] inline priority recompute", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetSessionUserId.mockResolvedValue("user-1");
  });

  it("adds recomputed priority fields to $set when dueAt changes", async () => {
    const existingTask = {
      _id: "task-1",
      userId: "user-1",
      title: "Prepare proposal",
      status: "todo",
      priority: "low",
      dueAt: null,
      createdAt: new Date(Date.now() - 30 * DAY_MS).toISOString(),
      lastUpdated: new Date(Date.now() - 30 * DAY_MS).toISOString(),
    };
    const { db, updateOne, findOne } = buildDb(existingTask);
    mockedGetDb.mockResolvedValue(db);

    const dueTomorrow = new Date(Date.now() + DAY_MS).toISOString();
    const response = await PATCH(
      buildRequest({ dueAt: dueTomorrow }),
      buildParams("task-1")
    );

    expect(response.status).toBe(200);
    // Pre-write merge read + post-write reload.
    expect(findOne).toHaveBeenCalledTimes(2);
    expect(updateOne).toHaveBeenCalledTimes(1);

    const [, updateArg] = updateOne.mock.calls[0];
    // Due in 1 day (+30) + recent lastUpdated (+5) = 35 -> medium.
    expect(updateArg.$set).toMatchObject({
      dueAt: dueTomorrow,
      priorityScore: 35,
      priorityLabel: "medium",
      priorityReason: expect.stringContaining("Due in 1 day"),
      priorityUpdatedAt: expect.any(String),
    });
  });

  it("does not add priority fields when only the title changes", async () => {
    const existingTask = {
      _id: "task-1",
      userId: "user-1",
      title: "Prepare proposal",
      status: "todo",
      priority: "low",
    };
    const { db, updateOne, findOne } = buildDb(existingTask);
    mockedGetDb.mockResolvedValue(db);

    const response = await PATCH(
      buildRequest({ title: "Prepare final proposal" }),
      buildParams("task-1")
    );

    expect(response.status).toBe(200);
    // No pre-write merge read — only the post-write reload.
    expect(findOne).toHaveBeenCalledTimes(1);

    const [, updateArg] = updateOne.mock.calls[0];
    expect(updateArg.$set.title).toBe("Prepare final proposal");
    expect(updateArg.$set).not.toHaveProperty("priorityScore");
    expect(updateArg.$set).not.toHaveProperty("priorityLabel");
    expect(updateArg.$set).not.toHaveProperty("priorityReason");
    expect(updateArg.$set).not.toHaveProperty("priorityUpdatedAt");
  });

  it("recomputes to zero when status is set to done", async () => {
    const existingTask = {
      _id: "task-1",
      userId: "user-1",
      title: "Prepare proposal",
      status: "todo",
      priority: "high",
      dueAt: new Date(Date.now() - DAY_MS).toISOString(),
      sourceSessionType: null,
      sourceSessionId: null,
    };
    const { db, updateOne } = buildDb(existingTask);
    mockedGetDb.mockResolvedValue(db);

    const response = await PATCH(
      buildRequest({ status: "done" }),
      buildParams("task-1")
    );

    expect(response.status).toBe(200);
    const [, updateArg] = updateOne.mock.calls[0];
    expect(updateArg.$set).toMatchObject({
      status: "done",
      priorityScore: 0,
      priorityLabel: "low",
      priorityReason: "Completed or expired",
    });
  });
});
