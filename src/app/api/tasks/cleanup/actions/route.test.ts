import { POST } from "@/app/api/tasks/cleanup/actions/route";
import { getDb } from "@/lib/db";
import { publishDomainEvent } from "@/lib/domain-events";
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

jest.mock("@/lib/domain-events", () => ({
  publishDomainEvent: jest.fn(),
}));

jest.mock("@/lib/observability-metrics", () => ({
  recordRouteMetric: jest.fn(),
}));

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedGetSessionUserId = getSessionUserId as jest.MockedFunction<
  typeof getSessionUserId
>;
const mockedResolveWorkspaceScopeForUser =
  resolveWorkspaceScopeForUser as jest.MockedFunction<
    typeof resolveWorkspaceScopeForUser
  >;
const mockedPublishDomainEvent = publishDomainEvent as jest.MockedFunction<
  typeof publishDomainEvent
>;

const buildRequest = (body: unknown) =>
  new Request("http://localhost/api/tasks/cleanup/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const buildTasksCollection = () => {
  const updateMany = jest.fn().mockResolvedValue({ modifiedCount: 2 });
  const toArray = jest.fn().mockResolvedValue([]);
  const find = jest.fn().mockReturnValue({ toArray });
  return { updateMany, find, toArray };
};

describe("POST /api/tasks/cleanup/actions", () => {
  let tasksCollection: ReturnType<typeof buildTasksCollection>;
  let db: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetSessionUserId.mockResolvedValue("user-1");
    mockedResolveWorkspaceScopeForUser.mockResolvedValue({
      workspaceId: "workspace-1",
      workspace: null as any,
      membership: null as any,
      workspaceMemberUserIds: ["user-1", "user-2"],
    });
    tasksCollection = buildTasksCollection();
    db = {
      collection: jest.fn((name: string) => {
        if (name === "tasks") {
          return tasksCollection;
        }
        throw new Error(`Unexpected collection in test: ${name}`);
      }),
    };
    mockedGetDb.mockResolvedValue(db);
  });

  it("returns 401 when there is no session user", async () => {
    mockedGetSessionUserId.mockResolvedValue(null as any);

    const response = await POST(
      buildRequest({ action: "dismiss", taskIds: ["task-1"] })
    );

    expect(response.status).toBe(401);
    expect(tasksCollection.updateMany).not.toHaveBeenCalled();
  });

  it("returns 400 for an unknown action", async () => {
    const response = await POST(
      buildRequest({ action: "obliterate", taskIds: ["task-1"] })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      errorCode: "invalid_payload",
    });
    expect(tasksCollection.updateMany).not.toHaveBeenCalled();
  });

  it("returns 400 when taskIds is empty", async () => {
    const response = await POST(buildRequest({ action: "expire", taskIds: [] }));

    expect(response.status).toBe(400);
    expect(tasksCollection.updateMany).not.toHaveBeenCalled();
  });

  it("restore resets cleanupStatus to active and clears expiresAt", async () => {
    const response = await POST(
      buildRequest({ action: "restore", taskIds: ["task-1", "task-2"] })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      updated: 2,
    });

    expect(tasksCollection.updateMany).toHaveBeenCalledTimes(1);
    const [filter, update] = tasksCollection.updateMany.mock.calls[0];
    expect(filter).toMatchObject({
      _id: { $in: ["task-1", "task-2"] },
      $or: [
        { workspaceId: "workspace-1" },
        {
          workspaceId: { $exists: false },
          userId: { $in: ["user-1", "user-2"] },
        },
      ],
    });
    expect(update.$set).toMatchObject({
      cleanupStatus: "active",
      expiresAt: null,
      cleanupReviewedBy: "user-1",
    });
    expect(typeof update.$set.cleanupReviewedAt).toBe("string");
  });

  it("mark_duplicate expires the task with the duplicate category", async () => {
    const response = await POST(
      buildRequest({ action: "mark_duplicate", taskIds: ["task-1"] })
    );

    expect(response.status).toBe(200);
    const [, update] = tasksCollection.updateMany.mock.calls[0];
    expect(update.$set).toMatchObject({
      cleanupStatus: "expired",
      cleanupCategory: "duplicate",
    });
    // duplicateOfTaskId is preserved (never unset by this action).
    expect(update.$set.duplicateOfTaskId).toBeUndefined();
    expect(update.$unset).toBeUndefined();
  });

  it("mark_completed sets done + dismissed and publishes a domain event per task", async () => {
    tasksCollection.toArray.mockResolvedValue([
      {
        _id: "task-1",
        sourceSessionId: "meeting-1",
        sourceSessionType: "meeting",
      },
      { _id: "task-2", sourceSessionId: null, sourceSessionType: "task" },
    ]);
    tasksCollection.updateMany.mockResolvedValue({ modifiedCount: 2 });

    const response = await POST(
      buildRequest({ action: "mark_completed", taskIds: ["task-1", "task-2"] })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      updated: 2,
    });

    const [, update] = tasksCollection.updateMany.mock.calls[0];
    expect(update.$set).toMatchObject({
      status: "done",
      cleanupStatus: "dismissed",
      cleanupReviewedBy: "user-1",
    });

    expect(mockedPublishDomainEvent).toHaveBeenCalledTimes(2);
    expect(mockedPublishDomainEvent).toHaveBeenCalledWith(db, {
      type: "task.status.changed",
      userId: "user-1",
      payload: {
        taskId: "task-1",
        status: "done",
        sourceSessionType: "meeting",
        sourceSessionId: "meeting-1",
      },
    });
    expect(mockedPublishDomainEvent).toHaveBeenCalledWith(db, {
      type: "task.status.changed",
      userId: "user-1",
      payload: {
        taskId: "task-2",
        status: "done",
      },
    });
  });

  it("dismiss only updates cleanup review fields", async () => {
    const response = await POST(
      buildRequest({ action: "dismiss", taskIds: ["task-1"] })
    );

    expect(response.status).toBe(200);
    const [, update] = tasksCollection.updateMany.mock.calls[0];
    expect(update.$set.cleanupStatus).toBe("dismissed");
    expect(update.$set.status).toBeUndefined();
    expect(mockedPublishDomainEvent).not.toHaveBeenCalled();
  });
});
