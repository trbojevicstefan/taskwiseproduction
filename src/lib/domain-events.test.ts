import { dispatchQueuedDomainEventById, publishDomainEvent } from "@/lib/domain-events";
import { ensureBoardItemsForTasks } from "@/lib/board-items";
import { ensureDefaultBoard } from "@/lib/boards";
import { isAsyncDomainEventProcessingEnabled } from "@/lib/core-first-flags";
import { enqueueJob } from "@/lib/jobs/store";
import { createLogger } from "@/lib/observability";
import { upsertPeopleFromAttendees } from "@/lib/people-sync";
import { syncBoardItemsToStatusByTaskRecord } from "@/lib/services/board-status-sync";
import { syncTasksForSource } from "@/lib/task-sync";
import { getWorkspaceIdForUser } from "@/lib/workspace";

jest.mock("@/lib/services/board-status-sync", () => ({
  syncBoardItemsToStatusByTaskRecord: jest.fn(),
}));

jest.mock("@/lib/people-sync", () => ({
  upsertPeopleFromAttendees: jest.fn(),
}));

jest.mock("@/lib/task-sync", () => ({
  syncTasksForSource: jest.fn(),
}));

jest.mock("@/lib/boards", () => ({
  ensureDefaultBoard: jest.fn(),
}));

jest.mock("@/lib/board-items", () => ({
  ensureBoardItemsForTasks: jest.fn(),
}));

jest.mock("@/lib/workspace", () => ({
  getWorkspaceIdForUser: jest.fn(),
}));

jest.mock("@/lib/core-first-flags", () => ({
  isAsyncDomainEventProcessingEnabled: jest.fn(),
}));

jest.mock("@/lib/jobs/store", () => ({
  enqueueJob: jest.fn(),
}));

jest.mock("@/lib/observability", () => ({
  createLogger: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(),
  })),
  serializeError: jest.fn((error: unknown) => ({
    message: error instanceof Error ? error.message : String(error),
  })),
}));

const mockedSyncBoardItemsToStatusByTaskRecord =
  syncBoardItemsToStatusByTaskRecord as jest.MockedFunction<
    typeof syncBoardItemsToStatusByTaskRecord
  >;
const mockedUpsertPeopleFromAttendees =
  upsertPeopleFromAttendees as jest.MockedFunction<typeof upsertPeopleFromAttendees>;
const mockedSyncTasksForSource = syncTasksForSource as jest.MockedFunction<
  typeof syncTasksForSource
>;
const mockedEnsureDefaultBoard = ensureDefaultBoard as jest.MockedFunction<
  typeof ensureDefaultBoard
>;
const mockedEnsureBoardItemsForTasks = ensureBoardItemsForTasks as jest.MockedFunction<
  typeof ensureBoardItemsForTasks
>;
const mockedGetWorkspaceIdForUser = getWorkspaceIdForUser as jest.MockedFunction<
  typeof getWorkspaceIdForUser
>;
const mockedIsAsyncDomainEventProcessingEnabled =
  isAsyncDomainEventProcessingEnabled as jest.MockedFunction<
    typeof isAsyncDomainEventProcessingEnabled
  >;
const mockedEnqueueJob = enqueueJob as jest.MockedFunction<typeof enqueueJob>;
const mockedCreateLogger = createLogger as jest.MockedFunction<typeof createLogger>;

const createFakeDb = ({
  tasksFindResult = [],
  taskUpdateModifiedCount = 1,
}: {
  tasksFindResult?: any[];
  taskUpdateModifiedCount?: number;
} = {}) => {
  const domainEventsInsertOne = jest.fn().mockResolvedValue({ acknowledged: true });
  const domainEventsUpdateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
  const domainEventsCreateIndex = jest.fn().mockResolvedValue("ok");
  let persistedDomainEvent: any = null;
  const domainEventsFindOne = jest.fn().mockImplementation((filter: any) => {
    if (!persistedDomainEvent) return Promise.resolve(null);
    if (filter?._id && filter._id !== persistedDomainEvent._id) return Promise.resolve(null);
    if (
      filter?.userId &&
      String(filter.userId) !== String(persistedDomainEvent.userId)
    ) {
      return Promise.resolve(null);
    }
    return Promise.resolve(persistedDomainEvent);
  });
  const domainEventsFindOneAndUpdate = jest
    .fn()
    .mockImplementation((filter: any, update: any) => {
      if (!persistedDomainEvent) return Promise.resolve(null);
      if (filter?._id && filter._id !== persistedDomainEvent._id) {
        return Promise.resolve(null);
      }
      if (
        filter?.userId &&
        String(filter.userId) !== String(persistedDomainEvent.userId)
      ) {
        return Promise.resolve(null);
      }
      const allowedStatuses: string[] = filter?.status?.$in || [];
      if (allowedStatuses.length && !allowedStatuses.includes(persistedDomainEvent.status)) {
        return Promise.resolve(null);
      }
      persistedDomainEvent = {
        ...persistedDomainEvent,
        ...(update?.$set || {}),
      };
      return Promise.resolve(persistedDomainEvent);
    });
  domainEventsInsertOne.mockImplementation(async (document: any) => {
    persistedDomainEvent = { ...document };
    return { acknowledged: true };
  });
  domainEventsUpdateOne.mockImplementation(async (_filter: any, update: any) => {
    if (persistedDomainEvent) {
      persistedDomainEvent = {
        ...persistedDomainEvent,
        ...(update?.$set || {}),
      };
    }
    return { modifiedCount: 1 };
  });
  const tasksFindToArray = jest.fn().mockResolvedValue(tasksFindResult);
  const tasksFind = jest.fn().mockReturnValue({ toArray: tasksFindToArray });
  const tasksUpdateOne = jest
    .fn()
    .mockResolvedValue({ modifiedCount: taskUpdateModifiedCount });

  const collections: Record<string, any> = {
    domainEvents: {
      createIndex: domainEventsCreateIndex,
      insertOne: domainEventsInsertOne,
      findOne: domainEventsFindOne,
      findOneAndUpdate: domainEventsFindOneAndUpdate,
      updateOne: domainEventsUpdateOne,
    },
    tasks: {
      find: tasksFind,
      updateOne: tasksUpdateOne,
    },
  };

  const db = {
    collection: jest.fn((name: string) => {
      const collection = collections[name];
      if (!collection) {
        throw new Error(`Unexpected collection requested in test: ${name}`);
      }
      return collection;
    }),
  };

  return {
    db,
    domainEventsInsertOne,
    domainEventsCreateIndex,
    domainEventsFindOne,
    domainEventsFindOneAndUpdate,
    domainEventsUpdateOne,
    tasksFind,
    tasksUpdateOne,
  };
};

describe("publishDomainEvent", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedIsAsyncDomainEventProcessingEnabled.mockReturnValue(false);
    mockedEnqueueJob.mockResolvedValue({ _id: "job-1" } as any);
    mockedGetWorkspaceIdForUser.mockResolvedValue("workspace-1");
    mockedUpsertPeopleFromAttendees.mockResolvedValue({ created: 1, updated: 0 });
    mockedSyncTasksForSource.mockResolvedValue({ upserted: 1, deleted: 0 } as any);
    mockedEnsureDefaultBoard.mockResolvedValue({ _id: "board-1" } as any);
    mockedEnsureBoardItemsForTasks.mockResolvedValue({ created: 1 } as any);
  });

  it("keeps task and board state aligned when task status changes", async () => {
    const { db, tasksFind, domainEventsInsertOne, domainEventsUpdateOne } = createFakeDb({
      tasksFindResult: [{ _id: "task-1" }, { _id: "task-2", sourceTaskId: "legacy-2" }],
    });

    const result = await publishDomainEvent(db as any, {
      type: "task.status.changed",
      userId: "user-1",
      payload: {
        taskId: "task-root",
        status: "done",
      },
    });

    expect(result).toEqual({ matchedTasks: 2 });
    expect(tasksFind).toHaveBeenCalledWith({
      userId: "user-1",
      $or: [{ _id: "task-root" }, { sourceTaskId: "task-root" }],
    });
    expect(mockedSyncBoardItemsToStatusByTaskRecord).toHaveBeenCalledTimes(2);
    expect(domainEventsInsertOne).toHaveBeenCalledTimes(1);
    expect(domainEventsUpdateOne).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        $set: expect.objectContaining({ status: "handled" }),
      })
    );
  });

  it("filters meeting tasks by completion-target session before syncing tasks and board items", async () => {
    const { db } = createFakeDb();

    const result = await publishDomainEvent(db as any, {
      type: "meeting.ingested",
      userId: "user-1",
      payload: {
        meetingId: "meeting-1",
        title: "Weekly Sync",
        attendees: [{ name: "Jane Doe" }],
        extractedTasks: [
          {
            id: "keep-task",
            title: "Send recap",
            priority: "medium",
          },
          {
            id: "drop-task",
            title: "Out of scope completion",
            priority: "medium",
            completionSuggested: true,
            completionTargets: [
              {
                taskId: "legacy-task",
                sourceType: "meeting",
                sourceSessionId: "different-meeting",
              },
            ],
          },
        ],
      },
    });

    const syncedTasks = mockedSyncTasksForSource.mock.calls[0]?.[1] || [];
    expect(syncedTasks).toHaveLength(1);
    expect(syncedTasks[0]).toMatchObject({ id: "keep-task", title: "Send recap" });

    expect(mockedEnsureBoardItemsForTasks).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        boardId: "board-1",
        tasks: syncedTasks,
      })
    );

    expect(result).toEqual({
      people: { created: 1, updated: 0 },
      tasks: { upserted: 1, deleted: 0 },
      boardItemsCreated: 1,
    });
  });

  it("propagates board item updates back into canonical task fields", async () => {
    const { db, tasksUpdateOne } = createFakeDb({ taskUpdateModifiedCount: 1 });

    const result = await publishDomainEvent(db as any, {
      type: "board.item.updated",
      userId: "user-1",
      payload: {
        taskId: "task-9",
        statusCategory: "done",
        taskUpdates: {
          title: "  Ship release  ",
          assigneeName: "Jane Doe",
        },
      },
    });

    expect(tasksUpdateOne).toHaveBeenCalledWith(
      { userId: "user-1", $or: [{ _id: "task-9" }, { id: "task-9" }] },
      {
        $set: expect.objectContaining({
          title: "Ship release",
          assigneeName: "Jane Doe",
          assigneeNameKey: "jane doe",
          status: "done",
          lastUpdated: expect.any(Date),
        }),
      }
    );
    expect(result).toEqual({ updated: true, taskId: "task-9" });
    expect(mockedCreateLogger).toHaveBeenCalled();
  });

  it("queues domain-event dispatch when async processing flag is enabled", async () => {
    mockedIsAsyncDomainEventProcessingEnabled.mockReturnValue(true);
    const { db, domainEventsInsertOne } = createFakeDb({
      tasksFindResult: [{ _id: "task-1" }],
    });

    const result = await publishDomainEvent(db as any, {
      type: "task.status.changed",
      userId: "user-1",
      payload: {
        taskId: "task-root",
        status: "done",
      },
    });

    const insertedEvent = domainEventsInsertOne.mock.calls[0]?.[0];
    expect(insertedEvent).toBeTruthy();
    expect(insertedEvent.status).toBe("queued");
    expect(mockedEnqueueJob).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        type: "domain-event-dispatch",
        userId: "user-1",
        payload: {
          eventId: insertedEvent._id,
        },
      })
    );
    expect(mockedSyncBoardItemsToStatusByTaskRecord).not.toHaveBeenCalled();
    expect(result).toEqual({ matchedTasks: 0 });
  });

  it("does not re-apply side effects when replaying an already-handled event id", async () => {
    const { db, domainEventsInsertOne } = createFakeDb({
      tasksFindResult: [{ _id: "task-1" }],
    });

    const firstResult = await publishDomainEvent(db as any, {
      type: "task.status.changed",
      userId: "user-1",
      payload: {
        taskId: "task-root",
        status: "done",
      },
    });

    expect(firstResult).toEqual({ matchedTasks: 1 });
    expect(mockedSyncBoardItemsToStatusByTaskRecord).toHaveBeenCalledTimes(1);

    const eventId = domainEventsInsertOne.mock.calls[0]?.[0]?._id;
    const replay = await dispatchQueuedDomainEventById(db as any, eventId, "user-1");

    expect(replay).toEqual({
      status: "already_handled",
      eventType: "task.status.changed",
      result: { matchedTasks: 1 },
    });
    expect(mockedSyncBoardItemsToStatusByTaskRecord).toHaveBeenCalledTimes(1);
  });
});
