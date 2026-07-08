import { ObjectId } from "mongodb";
import { enqueueJob } from "@/lib/jobs/store";
import { getValidSlackToken } from "@/lib/slack";
import {
  buildTaskReminderDedupKey,
  cancelRemindersForTask,
  enqueueReminderSweepJob,
  runReminderSweep,
  sendTaskReminder,
  shiftOutOfQuietHours,
} from "@/lib/task-reminders";
import { listActiveWorkspaceMembershipsForWorkspace } from "@/lib/workspace-memberships";
import { findWorkspaceById } from "@/lib/workspaces";

jest.mock("@/lib/jobs/store", () => ({
  enqueueJob: jest.fn(),
}));

jest.mock("@/lib/slack", () => ({
  getValidSlackToken: jest.fn(),
}));

jest.mock("@/lib/workspaces", () => ({
  findWorkspaceById: jest.fn(),
}));

jest.mock("@/lib/workspace-memberships", () => ({
  listActiveWorkspaceMembershipsForWorkspace: jest.fn(),
}));

const mockedEnqueueJob = enqueueJob as jest.MockedFunction<typeof enqueueJob>;
const mockedGetValidSlackToken = getValidSlackToken as jest.MockedFunction<
  typeof getValidSlackToken
>;
const mockedFindWorkspaceById = findWorkspaceById as jest.MockedFunction<
  typeof findWorkspaceById
>;
const mockedListMemberships =
  listActiveWorkspaceMembershipsForWorkspace as jest.MockedFunction<
    typeof listActiveWorkspaceMembershipsForWorkspace
  >;

const USER_ID = "64b7f3a2c9e77a0012345678";
const WORKSPACE_ID = "ws-1";

// --- tiny in-memory mongo-ish harness (mock-everything convention) ---

type Doc = Record<string, any>;

const eq = (left: any, right: any) => {
  if (left instanceof ObjectId || right instanceof ObjectId) {
    return String(left) === String(right);
  }
  if (left instanceof Date || right instanceof Date) {
    return new Date(left as any).getTime() === new Date(right as any).getTime();
  }
  return (left ?? null) === (right ?? null);
};

const isOperatorObject = (condition: any) =>
  Boolean(
    condition &&
      typeof condition === "object" &&
      !Array.isArray(condition) &&
      !(condition instanceof Date) &&
      !(condition instanceof ObjectId) &&
      Object.keys(condition).length > 0 &&
      Object.keys(condition).every((key) => key.startsWith("$"))
  );

const readPath = (doc: Doc, key: string) =>
  key.split(".").reduce<any>((acc, part) => (acc == null ? undefined : acc[part]), doc);

const matchesFilter = (doc: Doc, filter: Doc): boolean =>
  Object.entries(filter || {}).every(([key, condition]) => {
    if (key === "$or") {
      return (condition as Doc[]).some((sub) => matchesFilter(doc, sub));
    }
    const value = readPath(doc, key);
    if (isOperatorObject(condition)) {
      return Object.entries(condition as Doc).every(([op, operand]) => {
        switch (op) {
          case "$in":
            return (operand as any[]).some((candidate) => eq(value, candidate));
          case "$nin":
            return !(operand as any[]).some((candidate) => eq(value, candidate));
          case "$exists":
            return operand ? value !== undefined : value === undefined;
          case "$ne":
            return !eq(value, operand);
          case "$type":
            return operand === "string" ? typeof value === "string" : true;
          default:
            throw new Error(`Unsupported operator in test matcher: ${op}`);
        }
      });
    }
    return eq(value, condition);
  });

const applyUpdate = (doc: Doc, update: Doc) => {
  Object.entries(update.$set || {}).forEach(([key, value]) => {
    doc[key] = value;
  });
  Object.entries(update.$inc || {}).forEach(([key, value]) => {
    doc[key] = (doc[key] || 0) + (value as number);
  });
};

const createCollection = (initialDocs: Doc[] = [], options: { uniqueDedup?: boolean } = {}) => {
  const docs: Doc[] = initialDocs.map((doc) => ({ ...doc }));
  return {
    docs,
    createIndex: jest.fn().mockResolvedValue("ok"),
    find: (filter: Doc = {}, _findOptions?: Doc) => ({
      toArray: async () => docs.filter((doc) => matchesFilter(doc, filter)).map((doc) => ({ ...doc })),
    }),
    findOne: async (filter: Doc = {}, _findOptions?: Doc) => {
      const found = docs.find((doc) => matchesFilter(doc, filter));
      return found ? { ...found } : null;
    },
    insertOne: async (doc: Doc) => {
      if (options.uniqueDedup && typeof doc.dedupKey === "string") {
        const clash = docs.find(
          (existing) =>
            (existing.workspaceId ?? null) === (doc.workspaceId ?? null) &&
            existing.dedupKey === doc.dedupKey
        );
        if (clash) {
          const error: any = new Error("E11000 duplicate key error");
          error.code = 11000;
          throw error;
        }
      }
      docs.push({ ...doc });
      return { acknowledged: true, insertedId: doc._id };
    },
    updateOne: async (filter: Doc, update: Doc, updateOptions?: Doc) => {
      const found = docs.find((doc) => matchesFilter(doc, filter));
      if (found) {
        applyUpdate(found, update);
        return { matchedCount: 1, modifiedCount: 1 };
      }
      if (updateOptions?.upsert) {
        const upserted: Doc = {};
        Object.entries(filter).forEach(([key, value]) => {
          if (!key.startsWith("$") && !isOperatorObject(value)) upserted[key] = value;
        });
        applyUpdate(upserted, update);
        docs.push(upserted);
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
      }
      return { matchedCount: 0, modifiedCount: 0 };
    },
    updateMany: async (filter: Doc, update: Doc) => {
      let modifiedCount = 0;
      docs.forEach((doc) => {
        if (matchesFilter(doc, filter)) {
          applyUpdate(doc, update);
          modifiedCount += 1;
        }
      });
      return { matchedCount: modifiedCount, modifiedCount };
    },
  };
};

type FakeCollections = ReturnType<typeof createCollection>;

const createFakeDb = (seed: {
  tasks?: Doc[];
  reminders?: Doc[];
  users?: Doc[];
  people?: Doc[];
  jobs?: Doc[];
  reminderState?: Doc[];
} = {}) => {
  const collections: Record<string, FakeCollections> = {
    tasks: createCollection(seed.tasks || []),
    taskReminders: createCollection(seed.reminders || [], { uniqueDedup: true }),
    users: createCollection(seed.users || []),
    people: createCollection(seed.people || []),
    jobs: createCollection(seed.jobs || []),
    slackReminderState: createCollection(seed.reminderState || []),
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
  return { db: db as any, collections };
};

const workspaceWithSettings = (slackReminders: Doc, timezone: string | null = "UTC") =>
  ({
    _id: WORKSPACE_ID,
    name: "Workspace",
    settings: { timezone, slackReminders },
  }) as any;

const baseSettings = {
  enabled: true,
  remindDaysBefore: [1],
  remindOnDue: true,
  remindOverdue: true,
  maxRemindersPerTask: 10,
  deliver: "dm",
  defaultChannelId: null,
  quietHoursStart: 22,
  quietHoursEnd: 7,
  digest: "off",
};

const openTask = (overrides: Doc = {}): Doc => ({
  _id: "task-1",
  workspaceId: WORKSPACE_ID,
  userId: USER_ID,
  title: "Ship the report",
  status: "todo",
  taskState: "active",
  dueAt: "2026-07-10T17:00:00.000Z",
  ...overrides,
});

const slackOk = (payload: Doc = { ok: true }) => ({
  json: async () => payload,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockedEnqueueJob.mockResolvedValue({ _id: "job-1" } as any);
  mockedGetValidSlackToken.mockResolvedValue("xoxb-token");
  mockedListMemberships.mockResolvedValue([
    { _id: "m-1", workspaceId: WORKSPACE_ID, userId: USER_ID, role: "owner", status: "active" },
  ] as any);
  global.fetch = jest.fn().mockResolvedValue(slackOk() as any) as any;
});

describe("runReminderSweep enrollment", () => {
  it("enrolls before_due/on_due/overdue instances at 09:00 workspace-local and enqueues send jobs", async () => {
    mockedFindWorkspaceById.mockResolvedValue(
      workspaceWithSettings({ ...baseSettings, remindDaysBefore: [1, 3] })
    );
    const { db, collections } = createFakeDb({ tasks: [openTask()] });

    const result = await runReminderSweep(db, {
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      now: new Date("2026-07-01T12:00:00.000Z"),
    });

    expect(result).toMatchObject({ enrolled: 4, canceledStale: 0, skipped: 0, enabled: true });
    const runAts = collections.taskReminders.docs
      .map((doc) => (doc.runAt as Date).toISOString())
      .sort();
    expect(runAts).toEqual([
      "2026-07-07T09:00:00.000Z", // 3 days before
      "2026-07-09T09:00:00.000Z", // 1 day before
      "2026-07-10T09:00:00.000Z", // on due day
      "2026-07-11T09:00:00.000Z", // day after due (overdue)
    ]);
    expect(new Set(collections.taskReminders.docs.map((doc) => doc.kind))).toEqual(
      new Set(["before_due", "on_due", "overdue"])
    );
    expect(collections.taskReminders.docs.every((doc) => doc.status === "scheduled")).toBe(true);
    expect(
      new Set(collections.taskReminders.docs.map((doc) => doc.dedupKey)).size
    ).toBe(4);

    expect(mockedEnqueueJob).toHaveBeenCalledTimes(4);
    const enqueuedRunAts = mockedEnqueueJob.mock.calls
      .map(([, input]) => (input.runAt as Date).toISOString())
      .sort();
    expect(enqueuedRunAts).toEqual(runAts);
    mockedEnqueueJob.mock.calls.forEach(([, input]) => {
      expect(input.type).toBe("slack-reminder-send");
      expect(input.maxAttempts).toBe(1);
      expect((input.payload as any).reminderId).toBeTruthy();
    });

    // dedup unique index + supporting indexes were ensured
    expect(collections.taskReminders.createIndex).toHaveBeenCalledWith(
      { workspaceId: 1, dedupKey: 1 },
      expect.objectContaining({
        unique: true,
        partialFilterExpression: { dedupKey: { $type: "string" } },
      })
    );
  });

  it("computes 09:00 in the workspace timezone (falls back to UTC when unset)", async () => {
    mockedFindWorkspaceById.mockResolvedValue(
      workspaceWithSettings(
        { ...baseSettings, remindDaysBefore: [], remindOverdue: false },
        "America/New_York"
      )
    );
    const { db, collections } = createFakeDb({ tasks: [openTask()] });

    await runReminderSweep(db, {
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      now: new Date("2026-07-01T12:00:00.000Z"),
    });

    // 09:00 America/New_York (EDT, UTC-4) === 13:00 UTC
    expect(collections.taskReminders.docs).toHaveLength(1);
    expect((collections.taskReminders.docs[0].runAt as Date).toISOString()).toBe(
      "2026-07-10T13:00:00.000Z"
    );
  });

  it("shifts instances that land inside quiet hours to the quiet-hours end", async () => {
    mockedFindWorkspaceById.mockResolvedValue(
      workspaceWithSettings({
        ...baseSettings,
        remindDaysBefore: [],
        remindOverdue: false,
        quietHoursStart: 8,
        quietHoursEnd: 10,
      })
    );
    const { db, collections } = createFakeDb({ tasks: [openTask()] });

    await runReminderSweep(db, {
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      now: new Date("2026-07-01T12:00:00.000Z"),
    });

    expect((collections.taskReminders.docs[0].runAt as Date).toISOString()).toBe(
      "2026-07-10T10:00:00.000Z"
    );
  });

  it("skips instances whose runAt is more than 1h in the past", async () => {
    mockedFindWorkspaceById.mockResolvedValue(workspaceWithSettings(baseSettings));
    const { db, collections } = createFakeDb({
      tasks: [openTask({ dueAt: "2026-07-10T02:00:00.000Z" })],
    });

    const result = await runReminderSweep(db, {
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      now: new Date("2026-07-10T13:00:00.000Z"),
    });

    // before_due (Jul 9 09:00) and on_due (Jul 10 09:00) are >1h past; overdue (Jul 11) survives
    expect(result).toMatchObject({ enrolled: 1, skipped: 2 });
    expect(collections.taskReminders.docs).toHaveLength(1);
    expect(collections.taskReminders.docs[0].kind).toBe("overdue");
  });

  it("enforces maxRemindersPerTask counting scheduled+sent reminders", async () => {
    mockedFindWorkspaceById.mockResolvedValue(
      workspaceWithSettings({ ...baseSettings, maxRemindersPerTask: 3 })
    );
    const { db, collections } = createFakeDb({
      tasks: [openTask()],
      reminders: [
        {
          _id: "r-old-1",
          workspaceId: WORKSPACE_ID,
          userId: USER_ID,
          taskId: "task-1",
          kind: "custom",
          dedupKey: "task-1:custom:old-1",
          status: "sent",
        },
        {
          _id: "r-old-2",
          workspaceId: WORKSPACE_ID,
          userId: USER_ID,
          taskId: "task-1",
          kind: "custom",
          dedupKey: "task-1:custom:old-2",
          status: "sent",
        },
      ],
    });

    const result = await runReminderSweep(db, {
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      now: new Date("2026-07-01T12:00:00.000Z"),
    });

    // 3 desired instances, cap 3, 2 already sent -> only 1 new
    expect(result).toMatchObject({ enrolled: 1, skipped: 2 });
    expect(
      collections.taskReminders.docs.filter((doc) => doc.status === "scheduled")
    ).toHaveLength(1);
  });

  it("does not re-insert deduplicated instances on a second sweep", async () => {
    mockedFindWorkspaceById.mockResolvedValue(workspaceWithSettings(baseSettings));
    const { db, collections } = createFakeDb({ tasks: [openTask()] });
    const now = new Date("2026-07-01T12:00:00.000Z");

    const first = await runReminderSweep(db, {
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      now,
    });
    const second = await runReminderSweep(db, {
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      now,
    });

    expect(first).toMatchObject({ enrolled: 3, skipped: 0 });
    expect(second).toMatchObject({ enrolled: 0, skipped: 3 });
    expect(collections.taskReminders.docs).toHaveLength(3);
    expect(mockedEnqueueJob).toHaveBeenCalledTimes(3);
  });

  it("returns zeros without touching reminders when disabled", async () => {
    mockedFindWorkspaceById.mockResolvedValue(workspaceWithSettings({ enabled: false }));
    const { db, collections } = createFakeDb({ tasks: [openTask()] });

    const result = await runReminderSweep(db, {
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
    });

    expect(result).toEqual({
      enrolled: 0,
      canceledStale: 0,
      skipped: 0,
      enabled: false,
      digestSent: false,
    });
    expect(collections.taskReminders.docs).toHaveLength(0);
    expect(mockedEnqueueJob).not.toHaveBeenCalled();
  });

  it("cancels scheduled reminders whose task closed or whose dueAt drifted", async () => {
    mockedFindWorkspaceById.mockResolvedValue(
      workspaceWithSettings({ ...baseSettings, remindDaysBefore: [], remindOnDue: false, remindOverdue: false })
    );
    const { db, collections } = createFakeDb({
      tasks: [
        openTask({ dueAt: "2026-07-15T12:00:00.000Z" }),
        openTask({ _id: "task-done", status: "done", dueAt: "2026-07-12T12:00:00.000Z" }),
      ],
      reminders: [
        {
          _id: "r-drift",
          workspaceId: WORKSPACE_ID,
          userId: USER_ID,
          taskId: "task-1",
          kind: "on_due",
          dedupKey: "task-1:on_due:2026-07-09T00:00:00.000Z",
          status: "scheduled",
          taskDueAt: "2026-07-09T00:00:00.000Z", // no longer matches the task
          runAt: new Date("2026-07-09T09:00:00.000Z"),
        },
        {
          _id: "r-done",
          workspaceId: WORKSPACE_ID,
          userId: USER_ID,
          taskId: "task-done",
          kind: "on_due",
          dedupKey: "task-done:on_due:2026-07-12T12:00:00.000Z",
          status: "scheduled",
          taskDueAt: "2026-07-12T12:00:00.000Z",
          runAt: new Date("2026-07-12T09:00:00.000Z"),
        },
      ],
    });

    const result = await runReminderSweep(db, {
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      now: new Date("2026-07-01T12:00:00.000Z"),
    });

    expect(result.canceledStale).toBe(2);
    const byId = new Map(collections.taskReminders.docs.map((doc) => [doc._id, doc]));
    expect(byId.get("r-drift")?.status).toBe("canceled");
    expect(byId.get("r-done")?.status).toBe("canceled");
  });
});

describe("runReminderSweep daily digest", () => {
  const digestSettings = {
    ...baseSettings,
    remindDaysBefore: [],
    remindOnDue: false,
    remindOverdue: false,
    deliver: "channel",
    defaultChannelId: "C-DIGEST",
    digest: "daily",
  };

  it("sends the digest at most once per workspace-local day", async () => {
    mockedFindWorkspaceById.mockResolvedValue(workspaceWithSettings(digestSettings));
    const { db, collections } = createFakeDb({
      tasks: [openTask({ dueAt: "2026-07-08T10:00:00.000Z" })], // overdue vs now
      users: [{ _id: USER_ID, slackTeamId: "T1", email: "owner@example.com" }],
    });
    const now = new Date("2026-07-10T12:00:00.000Z");

    const first = await runReminderSweep(db, {
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      now,
    });
    const second = await runReminderSweep(db, {
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      now: new Date("2026-07-10T18:00:00.000Z"),
    });

    expect(first.digestSent).toBe(true);
    expect(second.digestSent).toBe(false);

    const postMessageCalls = (global.fetch as jest.Mock).mock.calls.filter(([url]) =>
      String(url).includes("chat.postMessage")
    );
    expect(postMessageCalls).toHaveLength(1);
    const body = JSON.parse(postMessageCalls[0][1].body);
    expect(body.channel).toBe("C-DIGEST");
    expect(body.text).toContain("1 overdue");

    expect(collections.slackReminderState.docs).toHaveLength(1);
    expect(collections.slackReminderState.docs[0]._id).toBe(`workspace:${WORKSPACE_ID}`);
  });

  it("sends again on the next local day", async () => {
    mockedFindWorkspaceById.mockResolvedValue(workspaceWithSettings(digestSettings));
    const { db } = createFakeDb({
      tasks: [openTask({ dueAt: "2026-07-08T10:00:00.000Z" })],
      users: [{ _id: USER_ID, slackTeamId: "T1", email: "owner@example.com" }],
      reminderState: [
        {
          _id: `workspace:${WORKSPACE_ID}`,
          lastDigestSentAt: new Date("2026-07-09T12:00:00.000Z"),
        },
      ],
    });

    const result = await runReminderSweep(db, {
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      now: new Date("2026-07-10T12:00:00.000Z"),
    });

    expect(result.digestSent).toBe(true);
  });
});

describe("sendTaskReminder", () => {
  const scheduledReminder = (overrides: Doc = {}): Doc => ({
    _id: "rem-1",
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    taskId: "task-1",
    kind: "on_due",
    dedupKey: "task-1:on_due:2026-07-10T17:00:00.000Z",
    status: "scheduled",
    runAt: new Date("2026-07-10T09:00:00.000Z"),
    taskTitle: "Ship the report",
    taskDueAt: "2026-07-10T17:00:00.000Z",
    target: { type: "dm", slackUserId: null, channelId: null, assigneeName: "Jane" },
    attempts: 0,
    ...overrides,
  });

  it("sends a DM to the assignee and marks the reminder sent", async () => {
    mockedFindWorkspaceById.mockResolvedValue(workspaceWithSettings(baseSettings));
    (global.fetch as jest.Mock).mockImplementation(async (url: string) => {
      if (String(url).includes("conversations.open")) {
        return slackOk({ ok: true, channel: { id: "D-100" } });
      }
      return slackOk({ ok: true });
    });
    const { db, collections } = createFakeDb({
      tasks: [openTask({ assignee: { name: "Jane", slackId: "U-JANE" } })],
      reminders: [scheduledReminder()],
      users: [{ _id: USER_ID, slackTeamId: "T1", email: "owner@example.com" }],
    });

    const outcome = await sendTaskReminder(db, "rem-1");

    expect(outcome).toBe("sent");
    const doc = collections.taskReminders.docs[0];
    expect(doc.status).toBe("sent");
    expect(doc.attempts).toBe(1);
    expect(doc.sentAt).toBeInstanceOf(Date);
    expect(doc.target).toMatchObject({ type: "dm", slackUserId: "U-JANE", channelId: "D-100" });

    const postCall = (global.fetch as jest.Mock).mock.calls.find(([url]) =>
      String(url).includes("chat.postMessage")
    );
    const body = JSON.parse(postCall[1].body);
    expect(body.channel).toBe("D-100");
    expect(body.text).toContain("Ship the report");
    expect(postCall[1].headers.Authorization).toBe("Bearer xoxb-token");
  });

  it("no-ops with 'skipped' when the reminder is not scheduled", async () => {
    const { db, collections } = createFakeDb({
      reminders: [scheduledReminder({ status: "canceled" })],
    });

    const outcome = await sendTaskReminder(db, "rem-1");

    expect(outcome).toBe("skipped");
    expect(collections.taskReminders.docs[0].status).toBe("canceled");
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockedGetValidSlackToken).not.toHaveBeenCalled();
  });

  it("cancels and skips when the task dueAt drifted from the snapshot", async () => {
    mockedFindWorkspaceById.mockResolvedValue(workspaceWithSettings(baseSettings));
    const { db, collections } = createFakeDb({
      tasks: [openTask({ dueAt: "2026-07-20T17:00:00.000Z" })],
      reminders: [scheduledReminder()],
    });

    const outcome = await sendTaskReminder(db, "rem-1");

    expect(outcome).toBe("skipped");
    expect(collections.taskReminders.docs[0].status).toBe("canceled");
    expect(collections.taskReminders.docs[0].cancelReason).toBe("task_changed");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("cancels and skips when the task is no longer open", async () => {
    mockedFindWorkspaceById.mockResolvedValue(workspaceWithSettings(baseSettings));
    const { db, collections } = createFakeDb({
      tasks: [openTask({ status: "done" })],
      reminders: [scheduledReminder()],
    });

    const outcome = await sendTaskReminder(db, "rem-1");

    expect(outcome).toBe("skipped");
    expect(collections.taskReminders.docs[0].status).toBe("canceled");
  });

  it("fails with no_slack_target when no DM mapping and no default channel exist", async () => {
    mockedFindWorkspaceById.mockResolvedValue(workspaceWithSettings(baseSettings));
    const { db, collections } = createFakeDb({
      tasks: [openTask({ assignee: { name: "Nobody" } })],
      reminders: [scheduledReminder()],
    });

    const outcome = await sendTaskReminder(db, "rem-1");

    expect(outcome).toBe("failed");
    const doc = collections.taskReminders.docs[0];
    expect(doc.status).toBe("failed");
    expect(doc.lastError).toBe("no_slack_target");
    expect(doc.attempts).toBe(1);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("fails with no_slack_connection when nobody in scope has Slack connected", async () => {
    mockedFindWorkspaceById.mockResolvedValue(
      workspaceWithSettings({ ...baseSettings, deliver: "channel", defaultChannelId: "C-1" })
    );
    const { db, collections } = createFakeDb({
      tasks: [openTask()],
      reminders: [scheduledReminder()],
      users: [{ _id: USER_ID, slackTeamId: null, email: "owner@example.com" }],
    });

    const outcome = await sendTaskReminder(db, "rem-1");

    expect(outcome).toBe("failed");
    expect(collections.taskReminders.docs[0].lastError).toBe("no_slack_connection");
  });

  it("audits a vanished installation as failed instead of throwing", async () => {
    mockedFindWorkspaceById.mockResolvedValue(
      workspaceWithSettings({ ...baseSettings, deliver: "channel", defaultChannelId: "C-1" })
    );
    mockedGetValidSlackToken.mockRejectedValue(
      new Error("Slack installation not found for this team.")
    );
    const { db, collections } = createFakeDb({
      tasks: [openTask()],
      reminders: [scheduledReminder()],
      users: [{ _id: USER_ID, slackTeamId: "T1", email: "owner@example.com" }],
    });

    const outcome = await sendTaskReminder(db, "rem-1");

    expect(outcome).toBe("failed");
    expect(collections.taskReminders.docs[0].status).toBe("failed");
    expect(collections.taskReminders.docs[0].lastError).toContain("installation not found");
  });

  it("falls back to the default channel when the DM cannot be opened", async () => {
    mockedFindWorkspaceById.mockResolvedValue(
      workspaceWithSettings({ ...baseSettings, defaultChannelId: "C-FALLBACK" })
    );
    (global.fetch as jest.Mock).mockImplementation(async (url: string) => {
      if (String(url).includes("conversations.open")) {
        return slackOk({ ok: false, error: "user_not_found" });
      }
      return slackOk({ ok: true });
    });
    const { db, collections } = createFakeDb({
      tasks: [openTask({ assignee: { name: "Jane", slackId: "U-JANE" } })],
      reminders: [scheduledReminder()],
      users: [{ _id: USER_ID, slackTeamId: "T1", email: "owner@example.com" }],
    });

    const outcome = await sendTaskReminder(db, "rem-1");

    expect(outcome).toBe("sent");
    expect(collections.taskReminders.docs[0].target).toMatchObject({
      type: "channel",
      channelId: "C-FALLBACK",
    });
  });
});

describe("cancelRemindersForTask", () => {
  it("cancels only scheduled reminders for the given task ids in one updateMany", async () => {
    const { db, collections } = createFakeDb({
      reminders: [
        { _id: "r-1", taskId: "task-1", status: "scheduled", dedupKey: "k1" },
        { _id: "r-2", taskId: "task-1", status: "sent", dedupKey: "k2" },
        { _id: "r-3", taskId: "task-2", status: "scheduled", dedupKey: "k3" },
        { _id: "r-4", taskId: "task-3", status: "scheduled", dedupKey: "k4" },
      ],
    });

    const result = await cancelRemindersForTask(db, ["task-1", "task-2"], "task_completed");

    expect(result).toEqual({ canceled: 2 });
    const byId = new Map(collections.taskReminders.docs.map((doc) => [doc._id, doc]));
    expect(byId.get("r-1")?.status).toBe("canceled");
    expect(byId.get("r-1")?.cancelReason).toBe("task_completed");
    expect(byId.get("r-2")?.status).toBe("sent");
    expect(byId.get("r-3")?.status).toBe("canceled");
    expect(byId.get("r-4")?.status).toBe("scheduled");
  });

  it("returns zero for empty input without querying", async () => {
    const { db } = createFakeDb();
    await expect(cancelRemindersForTask(db, [], "noop")).resolves.toEqual({ canceled: 0 });
  });
});

describe("enqueueReminderSweepJob", () => {
  it("skips enqueueing when a sweep is already pending for the workspace", async () => {
    const { db } = createFakeDb({
      jobs: [
        {
          _id: "job-existing",
          type: "slack-reminder-sweep",
          status: "queued",
          payload: { workspaceId: WORKSPACE_ID },
        },
      ],
    });

    const result = await enqueueReminderSweepJob(db, {
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
    });

    expect(result).toEqual({ enqueued: false, jobId: "job-existing" });
    expect(mockedEnqueueJob).not.toHaveBeenCalled();
  });

  it("enqueues a sweep when none is pending", async () => {
    mockedEnqueueJob.mockResolvedValue({ _id: "job-new" } as any);
    const { db } = createFakeDb();
    const runAt = new Date("2026-07-01T18:00:00.000Z");

    const result = await enqueueReminderSweepJob(db, {
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      runAt,
    });

    expect(result).toEqual({ enqueued: true, jobId: "job-new" });
    expect(mockedEnqueueJob).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        type: "slack-reminder-sweep",
        userId: USER_ID,
        payload: { workspaceId: WORKSPACE_ID },
        runAt,
      })
    );
  });
});

describe("helpers", () => {
  it("shiftOutOfQuietHours handles wrapped windows and disabled windows", () => {
    // wrapped 22 -> 7: 23:00 shifts to next-day 07:00, 03:00 shifts to same-day 07:00
    expect(
      shiftOutOfQuietHours(new Date("2026-07-10T23:00:00.000Z"), "UTC", 22, 7).toISOString()
    ).toBe("2026-07-11T07:00:00.000Z");
    expect(
      shiftOutOfQuietHours(new Date("2026-07-10T03:00:00.000Z"), "UTC", 22, 7).toISOString()
    ).toBe("2026-07-10T07:00:00.000Z");
    // equal start/end disables quiet hours
    expect(
      shiftOutOfQuietHours(new Date("2026-07-10T23:00:00.000Z"), "UTC", 9, 9).toISOString()
    ).toBe("2026-07-10T23:00:00.000Z");
    // outside the window is untouched
    expect(
      shiftOutOfQuietHours(new Date("2026-07-10T12:00:00.000Z"), "UTC", 22, 7).toISOString()
    ).toBe("2026-07-10T12:00:00.000Z");
  });

  it("buildTaskReminderDedupKey composes taskId:kind:stamp", () => {
    expect(
      buildTaskReminderDedupKey("task-1", "on_due", "2026-07-10T17:00:00.000Z")
    ).toBe("task-1:on_due:2026-07-10T17:00:00.000Z");
  });
});
