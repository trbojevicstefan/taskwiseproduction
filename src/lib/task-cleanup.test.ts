import { runTaskCleanupScan } from "@/lib/task-cleanup";
import { auditTasksForCleanup } from "@/ai/flows/task-cleanup-flow";
import {
  DEFAULT_TASK_CLEANUP_SETTINGS,
  type TaskCleanupSettings,
} from "@/lib/workspace-settings";

jest.mock("@/ai/flows/task-cleanup-flow", () => ({
  auditTasksForCleanup: jest.fn(async () => ({ items: [] })),
}));

const mockedAudit = auditTasksForCleanup as jest.MockedFunction<
  typeof auditTasksForCleanup
>;

const NOW_MS = Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;
const daysFromNow = (days: number) => new Date(NOW_MS + days * DAY_MS).toISOString();

type FakeDbData = {
  tasks?: any[];
  people?: any[];
  meetings?: any[];
};

const makeCursor = (docs: any[]) => {
  const cursor: any = {
    sort: jest.fn(() => cursor),
    limit: jest.fn(() => cursor),
    project: jest.fn(() => cursor),
    toArray: jest.fn(async () => docs),
  };
  return cursor;
};

const makeDb = ({ tasks = [], people = [], meetings = [] }: FakeDbData = {}) => {
  const calls = {
    taskFinds: [] as any[],
    taskUpdateMany: [] as Array<{ filter: any; update: any }>,
    taskBulkWrites: [] as any[],
    peopleFinds: [] as any[],
    meetingFinds: [] as any[],
  };
  const collections: Record<string, any> = {
    tasks: {
      find: jest.fn((filter: any) => {
        calls.taskFinds.push(filter);
        return makeCursor(tasks);
      }),
      updateMany: jest.fn(async (filter: any, update: any) => {
        calls.taskUpdateMany.push({ filter, update });
        const matching = tasks.filter(
          (task) =>
            task.cleanupStatus === "suggested_expire" &&
            typeof task.expiresAt === "string" &&
            task.expiresAt <= new Date().toISOString()
        );
        return { modifiedCount: matching.length };
      }),
      bulkWrite: jest.fn(async (operations: any[]) => {
        calls.taskBulkWrites.push(operations);
        return { modifiedCount: operations.length };
      }),
    },
    people: {
      find: jest.fn((filter: any) => {
        calls.peopleFinds.push(filter);
        return makeCursor(people);
      }),
    },
    meetings: {
      find: jest.fn((filter: any) => {
        calls.meetingFinds.push(filter);
        const ids: string[] = filter?._id?.$in?.map(String) || [];
        return makeCursor(
          meetings.filter((doc: any) => ids.includes(String(doc._id)))
        );
      }),
    },
  };
  const db = {
    collection: jest.fn((name: string) => {
      const collection = collections[name];
      if (!collection) throw new Error(`Unexpected collection: ${name}`);
      return collection;
    }),
  } as any;
  return { db, calls };
};

const scope = { userId: "user-1", workspaceId: "ws-1", memberUserIds: ["user-1"] };

const settingsWith = (
  overrides: Partial<TaskCleanupSettings> = {}
): TaskCleanupSettings => ({
  ...DEFAULT_TASK_CLEANUP_SETTINGS,
  categories: { ...DEFAULT_TASK_CLEANUP_SETTINGS.categories },
  ...overrides,
});

const collectFlagOps = (calls: ReturnType<typeof makeDb>["calls"]) =>
  calls.taskBulkWrites.flat().map((op: any) => op.updateOne);

beforeEach(() => {
  jest.clearAllMocks();
  mockedAudit.mockResolvedValue({ items: [] });
});

describe("runTaskCleanupScan", () => {
  it("returns zeros and touches nothing when cleanup is disabled", async () => {
    const { db, calls } = makeDb({ tasks: [{ _id: "t1", title: "Join the call" }] });
    const result = await runTaskCleanupScan(
      db,
      scope,
      settingsWith({ enabled: false })
    );
    expect(result).toEqual({ scanned: 0, flagged: 0, expired: 0, byCategory: {} });
    expect(calls.taskFinds).toHaveLength(0);
    expect(calls.taskUpdateMany).toHaveLength(0);
    expect(mockedAudit).not.toHaveBeenCalled();
  });

  it("auto-transitions overdue suggested_expire tasks to expired", async () => {
    const { db, calls } = makeDb({
      tasks: [
        {
          _id: "t1",
          title: "Old suggestion",
          cleanupStatus: "suggested_expire",
          expiresAt: daysFromNow(-1),
        },
      ],
    });
    const result = await runTaskCleanupScan(db, scope, settingsWith());
    expect(result.expired).toBe(1);
    expect(calls.taskUpdateMany).toHaveLength(1);
    const { filter, update } = calls.taskUpdateMany[0];
    expect(filter.cleanupStatus).toBe("suggested_expire");
    expect(filter.expiresAt.$ne).toBeNull();
    expect(typeof filter.expiresAt.$lte).toBe("string");
    expect(update.$set.cleanupStatus).toBe("expired");
  });

  it("flags whole-title vanity tasks via heuristics and scopes writes to unreviewed docs", async () => {
    const { db, calls } = makeDb({
      tasks: [
        { _id: "t1", title: "Join the call", status: "todo" },
        { _id: "t2", title: "Draft migration checklist", status: "todo" },
      ],
    });
    const result = await runTaskCleanupScan(db, scope, settingsWith());
    expect(result.scanned).toBe(2);
    expect(result.flagged).toBe(1);
    expect(result.byCategory).toEqual({ meeting_logistics: 1 });

    const ops = collectFlagOps(calls);
    expect(ops).toHaveLength(1);
    expect(ops[0].filter._id).toBe("t1");
    // Guard: scan may only write where cleanupStatus is absent or 'active'.
    expect(ops[0].filter.$or).toEqual([
      { cleanupStatus: { $exists: false } },
      { cleanupStatus: null },
      { cleanupStatus: "active" },
    ]);
    expect(ops[0].update.$set.cleanupStatus).toBe("suggested_expire");
    expect(ops[0].update.$set.cleanupCategory).toBe("meeting_logistics");
    expect(typeof ops[0].update.$set.expiresAt).toBe("string");
  });

  it("never scans or overwrites dismissed/expired/reviewed docs", async () => {
    const { db, calls } = makeDb({
      tasks: [
        { _id: "t1", title: "Join the call", cleanupStatus: "dismissed" },
        { _id: "t2", title: "Send the invite", cleanupStatus: "expired" },
        { _id: "t3", title: "Add to calendar", cleanupStatus: "active" },
      ],
    });
    const result = await runTaskCleanupScan(db, scope, settingsWith());
    // Only the 'active' doc is eligible.
    expect(result.scanned).toBe(1);
    const ops = collectFlagOps(calls);
    expect(ops.map((op: any) => op.filter._id)).toEqual(["t3"]);
  });

  it("skips protected tasks (client assignee, future due + assignee, keywords)", async () => {
    const { db, calls } = makeDb({
      tasks: [
        {
          _id: "t1",
          title: "Join the call",
          assignee: { uid: "person-client" },
        },
        {
          _id: "t2",
          title: "Send the invite",
          dueAt: daysFromNow(3),
          assigneeName: "Ana",
        },
        { _id: "t3", title: "Send the invoice" },
      ],
      people: [{ _id: "person-client" }],
    });
    const result = await runTaskCleanupScan(db, scope, settingsWith());
    expect(result.flagged).toBe(0);
    expect(collectFlagOps(calls)).toHaveLength(0);
  });

  describe("strictness gates", () => {
    const gateTasks = () => [
      // vanity 0.9 (whole-title) — allowed everywhere
      { _id: "vanity-high", title: "Join the call", createdAt: daysFromNow(-1) },
      // vanity 0.7 (partial) — aggressive only
      {
        _id: "vanity-weak",
        title: "Remember to send the slides afterwards",
        createdAt: daysFromNow(-2),
      },
      // duplicate 0.75 — balanced+; older twin owns the title key
      {
        _id: "dup-original",
        title: "Update the roadmap",
        createdAt: daysFromNow(-10),
      },
      { _id: "dup-copy", title: "Update the roadmap", createdAt: daysFromNow(-3) },
      // low specificity 0.65 — aggressive only
      { _id: "vague", title: "Follow up", createdAt: daysFromNow(-4) },
    ];

    it("light: only high-confidence vanity", async () => {
      const { db, calls } = makeDb({ tasks: gateTasks() });
      const result = await runTaskCleanupScan(
        db,
        scope,
        settingsWith({ strictness: "light" })
      );
      const ops = collectFlagOps(calls);
      expect(ops.map((op: any) => op.filter._id)).toEqual(["vanity-high"]);
      expect(result.byCategory).toEqual({ meeting_logistics: 1 });
    });

    it("balanced: adds duplicates (heuristic fallback when LLM returns nothing)", async () => {
      const { db, calls } = makeDb({ tasks: gateTasks() });
      const result = await runTaskCleanupScan(
        db,
        scope,
        settingsWith({ strictness: "balanced" })
      );
      const flaggedIds = collectFlagOps(calls).map((op: any) => op.filter._id);
      expect(flaggedIds.sort()).toEqual(["dup-copy", "vanity-high"]);
      expect(result.byCategory).toEqual({ meeting_logistics: 1, duplicate: 1 });
      const dupOp = collectFlagOps(calls).find(
        (op: any) => op.filter._id === "dup-copy"
      );
      expect(dupOp.update.$set.cleanupStatus).toBe("duplicate_suggested");
      expect(dupOp.update.$set.duplicateOfTaskId).toBe("dup-original");
    });

    it("aggressive: adds low specificity and weaker vanity flags", async () => {
      const { db, calls } = makeDb({ tasks: gateTasks() });
      const result = await runTaskCleanupScan(
        db,
        scope,
        settingsWith({ strictness: "aggressive" })
      );
      const flaggedIds = collectFlagOps(calls)
        .map((op: any) => op.filter._id)
        .sort();
      expect(flaggedIds).toEqual([
        "dup-copy",
        "vague",
        "vanity-high",
        "vanity-weak",
      ]);
      expect(result.byCategory).toEqual({
        meeting_logistics: 2,
        duplicate: 1,
        low_specificity: 1,
      });
    });
  });

  it("respects per-category toggles", async () => {
    const { db, calls } = makeDb({
      tasks: [{ _id: "t1", title: "Join the call" }],
    });
    const settings = settingsWith();
    settings.categories.meeting_logistics = false;
    const result = await runTaskCleanupScan(db, scope, settings);
    expect(result.flagged).toBe(0);
    expect(collectFlagOps(calls)).toHaveLength(0);
  });

  describe("LLM auditor integration", () => {
    it("sends stale candidates to the LLM with meeting context and accepts evidence-backed completed suggestions", async () => {
      const meetingId = "meeting-1";
      const { db, calls } = makeDb({
        tasks: [
          {
            _id: "t1",
            title: "Prepare notes for the quarterly demo",
            sourceSessionType: "meeting",
            sourceSessionId: meetingId,
          },
        ],
        meetings: [
          {
            _id: meetingId,
            title: "Quarterly demo",
            startTime: daysFromNow(-10),
            originalTranscript:
              "00:10 - Ana: The quarterly demo notes are already done and shared.",
          },
        ],
      });
      mockedAudit.mockResolvedValue({
        items: [
          {
            taskId: "t1",
            classification: "completed_suggested",
            confidence: 0.9,
            reason: "Transcript confirms the notes were shared.",
            evidence: [
              {
                sourceType: "transcript",
                sourceId: meetingId,
                snippet: "The quarterly demo notes are already done and shared.",
              },
            ],
            suggestedAction: "suggest_completed",
            expiresAt: null,
            duplicateOfTaskId: null,
          },
        ],
      });

      const result = await runTaskCleanupScan(db, scope, settingsWith());
      expect(mockedAudit).toHaveBeenCalledTimes(1);
      const auditInput = mockedAudit.mock.calls[0][0];
      expect(auditInput.tasks).toHaveLength(1);
      expect(auditInput.tasks[0]).toMatchObject({
        taskId: "t1",
        meetingTitle: "Quarterly demo",
      });
      expect(auditInput.tasks[0].transcriptSnippet).toContain(
        "quarterly demo notes"
      );

      const ops = collectFlagOps(calls);
      expect(ops).toHaveLength(1);
      expect(ops[0].update.$set.cleanupStatus).toBe("completed_suggested");
      expect(ops[0].update.$set.cleanupCategory).toBe("already_completed");
      expect(ops[0].update.$set.cleanupEvidence).toHaveLength(1);
      expect(result.byCategory).toEqual({ already_completed: 1 });
    });

    it("drops completed suggestions that carry no evidence", async () => {
      const { db, calls } = makeDb({
        tasks: [
          {
            _id: "t1",
            title: "Prepare notes for the quarterly demo",
            sourceSessionType: "meeting",
            sourceSessionId: "meeting-1",
          },
        ],
        meetings: [
          {
            _id: "meeting-1",
            title: "Quarterly demo",
            startTime: daysFromNow(-10),
            originalTranscript: "00:10 - Ana: nothing relevant.",
          },
        ],
      });
      mockedAudit.mockResolvedValue({
        items: [
          {
            taskId: "t1",
            classification: "completed_suggested",
            confidence: 0.9,
            reason: "Probably done.",
            evidence: [],
            suggestedAction: "suggest_completed",
            expiresAt: null,
            duplicateOfTaskId: null,
          },
        ],
      });
      const result = await runTaskCleanupScan(db, scope, settingsWith());
      expect(result.flagged).toBe(0);
      expect(collectFlagOps(calls)).toHaveLength(0);
    });

    it("an LLM keep verdict cancels a heuristic stale flag", async () => {
      const { db, calls } = makeDb({
        tasks: [
          {
            _id: "t1",
            title: "Prepare notes for the quarterly demo",
            sourceSessionType: "meeting",
            sourceSessionId: "meeting-1",
          },
        ],
        meetings: [
          {
            _id: "meeting-1",
            title: "Quarterly demo",
            startTime: daysFromNow(-10),
            originalTranscript: "00:10 - Ana: demo moved to next month.",
          },
        ],
      });
      mockedAudit.mockResolvedValue({
        items: [
          {
            taskId: "t1",
            classification: "keep",
            confidence: 0.8,
            reason: "The demo was rescheduled; notes still needed.",
            evidence: [],
            suggestedAction: "keep",
            expiresAt: null,
            duplicateOfTaskId: null,
          },
        ],
      });
      const result = await runTaskCleanupScan(db, scope, settingsWith());
      expect(result.flagged).toBe(0);
      expect(collectFlagOps(calls)).toHaveLength(0);
    });

    it("falls back to the heuristic verdict when the LLM returns no item", async () => {
      const { db, calls } = makeDb({
        tasks: [
          {
            _id: "t1",
            title: "Prepare notes for the quarterly demo",
            sourceSessionType: "meeting",
            sourceSessionId: "meeting-1",
          },
        ],
        meetings: [
          {
            _id: "meeting-1",
            title: "Quarterly demo",
            startTime: daysFromNow(-10),
            originalTranscript: "irrelevant",
          },
        ],
      });
      mockedAudit.mockResolvedValue({ items: [] });
      const result = await runTaskCleanupScan(db, scope, settingsWith());
      const ops = collectFlagOps(calls);
      expect(ops).toHaveLength(1);
      expect(ops[0].update.$set.cleanupStatus).toBe("suggested_expire");
      expect(ops[0].update.$set.cleanupCategory).toBe("expired_event");
      expect(result.byCategory).toEqual({ expired_event: 1 });
    });

    it("caps the LLM batch at 30 tasks", async () => {
      const tasks = Array.from({ length: 40 }, (_, index) => ({
        _id: `dup-${index}`,
        title: "Update the roadmap",
        createdAt: daysFromNow(-index - 1),
      }));
      const { db } = makeDb({ tasks });
      await runTaskCleanupScan(db, scope, settingsWith());
      expect(mockedAudit).toHaveBeenCalledTimes(1);
      expect(mockedAudit.mock.calls[0][0].tasks.length).toBeLessThanOrEqual(30);
    });

    it("does not call the LLM when there are no candidates", async () => {
      const { db } = makeDb({
        tasks: [{ _id: "t1", title: "Join the call" }],
      });
      await runTaskCleanupScan(db, scope, settingsWith());
      expect(mockedAudit).not.toHaveBeenCalled();
    });
  });

  it("uses the workspace fallback $or scope filter", async () => {
    const { db, calls } = makeDb({ tasks: [] });
    await runTaskCleanupScan(db, scope, settingsWith());
    expect(calls.taskFinds[0].$or).toEqual([
      { workspaceId: "ws-1" },
      { workspaceId: { $exists: false }, userId: { $in: ["user-1"] } },
    ]);
    expect(calls.taskFinds[0].status).toEqual({ $ne: "done" });
    expect(calls.taskFinds[0].taskState).toEqual({ $ne: "archived" });
  });
});
