import { PATCH } from "@/app/api/tasks/[id]/route";
import { getDb } from "@/lib/db";
import { kickJobWorker } from "@/lib/jobs/worker";
import { getSessionUserId } from "@/lib/server-auth";
import {
  cancelRemindersForTask,
  enqueueReminderSweepJob,
} from "@/lib/task-reminders";

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

jest.mock("@/lib/task-reminders", () => ({
  cancelRemindersForTask: jest.fn().mockResolvedValue({ canceled: 1 }),
  enqueueReminderSweepJob: jest
    .fn()
    .mockResolvedValue({ enqueued: true, jobId: "job-1" }),
}));

jest.mock("@/lib/jobs/worker", () => ({
  kickJobWorker: jest.fn().mockResolvedValue(undefined),
}));

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedGetSessionUserId = getSessionUserId as jest.MockedFunction<
  typeof getSessionUserId
>;
const mockedCancelRemindersForTask =
  cancelRemindersForTask as jest.MockedFunction<typeof cancelRemindersForTask>;
const mockedEnqueueReminderSweepJob =
  enqueueReminderSweepJob as jest.MockedFunction<typeof enqueueReminderSweepJob>;
const mockedKickJobWorker = kickJobWorker as jest.MockedFunction<
  typeof kickJobWorker
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

describe("PATCH /api/tasks/[id] Slack reminder reschedule on dueAt change", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetSessionUserId.mockResolvedValue("user-1");
  });

  it("cancels scheduled reminders and enqueues a sweep when dueAt changes", async () => {
    const existingTask = {
      _id: "task-1",
      userId: "user-1",
      workspaceId: "workspace-1",
      title: "Prepare proposal",
      status: "todo",
      dueAt: "2026-07-10T00:00:00.000Z",
    };
    const { db } = buildDb(existingTask);
    mockedGetDb.mockResolvedValue(db);

    const nextDueAt = new Date(Date.now() + 5 * DAY_MS).toISOString();
    const response = await PATCH(
      buildRequest({ dueAt: nextDueAt }),
      buildParams("task-1")
    );

    expect(response.status).toBe(200);
    expect(mockedCancelRemindersForTask).toHaveBeenCalledTimes(1);
    expect(mockedCancelRemindersForTask).toHaveBeenCalledWith(
      db,
      ["task-1"],
      "due_date_changed"
    );
    expect(mockedEnqueueReminderSweepJob).toHaveBeenCalledTimes(1);
    expect(mockedEnqueueReminderSweepJob).toHaveBeenCalledWith(db, {
      workspaceId: "workspace-1",
      userId: "user-1",
    });
    expect(mockedKickJobWorker).toHaveBeenCalledTimes(1);
  });

  it("uses a null workspaceId for personal tasks", async () => {
    const existingTask = {
      _id: "task-1",
      userId: "user-1",
      title: "Personal errand",
      status: "todo",
      dueAt: null,
    };
    const { db } = buildDb(existingTask);
    mockedGetDb.mockResolvedValue(db);

    const response = await PATCH(
      buildRequest({ dueAt: new Date(Date.now() + DAY_MS).toISOString() }),
      buildParams("task-1")
    );

    expect(response.status).toBe(200);
    expect(mockedEnqueueReminderSweepJob).toHaveBeenCalledWith(db, {
      workspaceId: null,
      userId: "user-1",
    });
  });

  it("does not touch reminders when dueAt is sent but unchanged (Date vs ISO)", async () => {
    const dueAt = "2026-07-10T00:00:00.000Z";
    const existingTask = {
      _id: "task-1",
      userId: "user-1",
      title: "Prepare proposal",
      status: "todo",
      // Stored as a Date; PATCH body carries the equivalent ISO string.
      dueAt: new Date(dueAt),
    };
    const { db } = buildDb(existingTask);
    mockedGetDb.mockResolvedValue(db);

    const response = await PATCH(buildRequest({ dueAt }), buildParams("task-1"));

    expect(response.status).toBe(200);
    expect(mockedCancelRemindersForTask).not.toHaveBeenCalled();
    expect(mockedEnqueueReminderSweepJob).not.toHaveBeenCalled();
    expect(mockedKickJobWorker).not.toHaveBeenCalled();
  });

  it("does not touch reminders when the PATCH does not include dueAt", async () => {
    const existingTask = {
      _id: "task-1",
      userId: "user-1",
      title: "Prepare proposal",
      status: "todo",
      dueAt: "2026-07-10T00:00:00.000Z",
    };
    const { db } = buildDb(existingTask);
    mockedGetDb.mockResolvedValue(db);

    const response = await PATCH(
      buildRequest({ title: "Prepare final proposal" }),
      buildParams("task-1")
    );

    expect(response.status).toBe(200);
    expect(mockedCancelRemindersForTask).not.toHaveBeenCalled();
    expect(mockedEnqueueReminderSweepJob).not.toHaveBeenCalled();
  });
});
