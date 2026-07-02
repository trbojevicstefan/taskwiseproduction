import { addDays, subDays } from "date-fns";
import {
  computeTaskPriority,
  scoreToPriorityLabel,
  type PriorityContext,
  type PriorityTaskInput,
} from "@/lib/task-priority";

const NOW = new Date("2026-07-02T12:00:00.000Z");

const baseCtx = (overrides: Partial<PriorityContext> = {}): PriorityContext => ({
  now: NOW,
  clientAssigneeIds: new Set(),
  assigneeOpenCounts: new Map(),
  ...overrides,
});

const baseTask = (
  overrides: Partial<PriorityTaskInput> = {}
): PriorityTaskInput => ({
  title: "Prepare the report",
  description: null,
  status: "todo",
  priority: "low",
  dueAt: null,
  assignee: null,
  assigneeName: null,
  createdAt: subDays(NOW, 30).toISOString(),
  lastUpdated: subDays(NOW, 30).toISOString(),
  ...overrides,
});

describe("scoreToPriorityLabel", () => {
  const cases: Array<[number, string]> = [
    [0, "low"],
    [24, "low"],
    [25, "medium"],
    [44, "medium"],
    [45, "high"],
    [69, "high"],
    [70, "urgent"],
    [100, "urgent"],
  ];

  it.each(cases)("maps score %d to label %s", (score, label) => {
    expect(scoreToPriorityLabel(score)).toBe(label);
  });
});

describe("computeTaskPriority — due date weights in isolation", () => {
  const dueCases: Array<[string, Date, number, string, string]> = [
    ["overdue by 3 days", subDays(NOW, 3), 40, "medium", "Overdue by 3 days"],
    ["overdue by 1 day", subDays(NOW, 1), 40, "medium", "Overdue by 1 day"],
    ["due today", new Date(NOW), 35, "medium", "Due today"],
    ["due in 1 day", addDays(NOW, 1), 30, "medium", "Due in 1 day"],
    ["due in 2 days", addDays(NOW, 2), 30, "medium", "Due in 2 days"],
    ["due in 3 days", addDays(NOW, 3), 20, "low", "Due in 3 days"],
    ["due in 7 days", addDays(NOW, 7), 20, "low", "Due in 7 days"],
    ["due in 8 days", addDays(NOW, 8), 10, "low", "Due in 8 days"],
    ["due in 14 days", addDays(NOW, 14), 10, "low", "Due in 14 days"],
  ];

  it.each(dueCases)("%s scores %d/%s (%s)", (_name, dueAt, score, label, reason) => {
    const result = computeTaskPriority(baseTask({ dueAt }), baseCtx());
    expect(result).toEqual({
      priorityScore: score,
      priorityLabel: label,
      priorityReason: reason,
    });
  });

  it("gives no due weight beyond 14 days out", () => {
    const result = computeTaskPriority(
      baseTask({ dueAt: addDays(NOW, 15) }),
      baseCtx()
    );
    expect(result).toEqual({
      priorityScore: 0,
      priorityLabel: "low",
      priorityReason: "No urgency signals",
    });
  });

  it("accepts dueAt as an ISO string", () => {
    const result = computeTaskPriority(
      baseTask({ dueAt: subDays(NOW, 3).toISOString() }),
      baseCtx()
    );
    expect(result.priorityScore).toBe(40);
    expect(result.priorityReason).toBe("Overdue by 3 days");
  });

  it.each([[null], ["not-a-date"]])(
    "ignores unusable dueAt value %j",
    (dueAt) => {
      const result = computeTaskPriority(
        baseTask({ dueAt: dueAt as string | null }),
        baseCtx()
      );
      expect(result.priorityScore).toBe(0);
    }
  );
});

describe("computeTaskPriority — non-due weights in isolation", () => {
  it("scores explicit high priority +20", () => {
    const result = computeTaskPriority(
      baseTask({ priority: "high" }),
      baseCtx()
    );
    expect(result).toEqual({
      priorityScore: 20,
      priorityLabel: "low",
      priorityReason: "Marked high priority",
    });
  });

  it("scores explicit medium priority +10", () => {
    const result = computeTaskPriority(
      baseTask({ priority: "medium" }),
      baseCtx()
    );
    expect(result).toEqual({
      priorityScore: 10,
      priorityLabel: "low",
      priorityReason: "Marked medium priority",
    });
  });

  it("gives no weight for explicit low priority", () => {
    const result = computeTaskPriority(baseTask({ priority: "low" }), baseCtx());
    expect(result.priorityScore).toBe(0);
  });

  it("scores client impact +15 when assignee uid is a client", () => {
    const result = computeTaskPriority(
      baseTask({ assignee: { uid: "client-1", email: null } }),
      baseCtx({ clientAssigneeIds: new Set(["client-1"]) })
    );
    expect(result).toEqual({
      priorityScore: 15,
      priorityLabel: "low",
      priorityReason: "Client-facing",
    });
  });

  it("scores client impact +15 when assignee email is a client", () => {
    const result = computeTaskPriority(
      baseTask({ assignee: { uid: null, email: "jane@client.com" } }),
      baseCtx({ clientAssigneeIds: new Set(["jane@client.com"]) })
    );
    expect(result.priorityScore).toBe(15);
    expect(result.priorityReason).toBe("Client-facing");
  });

  it("gives no client weight when the assignee is not a client", () => {
    const result = computeTaskPriority(
      baseTask({ assignee: { uid: "teammate-1", email: "t@team.com" } }),
      baseCtx({ clientAssigneeIds: new Set(["client-1"]) })
    );
    expect(result.priorityScore).toBe(0);
  });

  const blockerTitles: Array<[string]> = [
    ["This task is blocked by legal review"],
    ["Blocking the release train"],
    ["Waiting on vendor response"],
    ["Unblock the deploy pipeline"],
    ["Depends on schema migration"],
  ];

  it.each(blockerTitles)("scores blocker signal +10 for title %j", (title) => {
    const result = computeTaskPriority(baseTask({ title }), baseCtx());
    expect(result).toEqual({
      priorityScore: 10,
      priorityLabel: "low",
      priorityReason: "Blocker/dependency signal",
    });
  });

  it("detects blocker signals in the description too", () => {
    const result = computeTaskPriority(
      baseTask({ description: "Team is waiting on this before QA" }),
      baseCtx()
    );
    expect(result.priorityScore).toBe(10);
    expect(result.priorityReason).toBe("Blocker/dependency signal");
  });

  it("does not double-count blocker signals in title and description", () => {
    const result = computeTaskPriority(
      baseTask({ title: "Blocked deploy", description: "waiting on infra" }),
      baseCtx()
    );
    expect(result.priorityScore).toBe(10);
  });

  it("scores recency +5 when createdAt is within 7 days", () => {
    const result = computeTaskPriority(
      baseTask({ createdAt: subDays(NOW, 6).toISOString() }),
      baseCtx()
    );
    expect(result).toEqual({
      priorityScore: 5,
      priorityLabel: "low",
      priorityReason: "Recently active",
    });
  });

  it("scores recency +5 when lastUpdated is within 7 days", () => {
    const result = computeTaskPriority(
      baseTask({ lastUpdated: subDays(NOW, 2) }),
      baseCtx()
    );
    expect(result.priorityScore).toBe(5);
    expect(result.priorityReason).toBe("Recently active");
  });

  it("does not double-count recency for createdAt and lastUpdated", () => {
    const result = computeTaskPriority(
      baseTask({ createdAt: subDays(NOW, 1), lastUpdated: subDays(NOW, 1) }),
      baseCtx()
    );
    expect(result.priorityScore).toBe(5);
  });

  it("gives no recency weight after 8 days of inactivity", () => {
    const result = computeTaskPriority(
      baseTask({
        createdAt: subDays(NOW, 8).toISOString(),
        lastUpdated: subDays(NOW, 8).toISOString(),
      }),
      baseCtx()
    );
    expect(result.priorityScore).toBe(0);
  });

  const workloadCases: Array<[string, PriorityTaskInput["assignee"], string | null, string]> = [
    ["uid", { uid: "u-1", email: null }, null, "u-1"],
    ["email", { uid: null, email: "busy@team.com" }, null, "busy@team.com"],
    ["assigneeName", null, "Busy Person", "Busy Person"],
  ];

  it.each(workloadCases)(
    "applies workload relief -5 when open count > 10 keyed by %s",
    (_keyKind, assignee, assigneeName, countKey) => {
      const result = computeTaskPriority(
        baseTask({ priority: "high", assignee, assigneeName }),
        baseCtx({ assigneeOpenCounts: new Map([[countKey, 11]]) })
      );
      expect(result.priorityScore).toBe(15);
      expect(result.priorityReason).toBe(
        "Marked high priority; Assignee has a heavy workload"
      );
    }
  );

  it("gives no workload relief at exactly 10 open tasks", () => {
    const result = computeTaskPriority(
      baseTask({ priority: "high", assignee: { uid: "u-1" } }),
      baseCtx({ assigneeOpenCounts: new Map([["u-1", 10]]) })
    );
    expect(result.priorityScore).toBe(20);
  });
});

describe("computeTaskPriority — combinations and label boundaries", () => {
  it("overdue + high + client crosses into urgent (75)", () => {
    const result = computeTaskPriority(
      baseTask({
        dueAt: subDays(NOW, 3),
        priority: "high",
        assignee: { uid: "client-1" },
      }),
      baseCtx({ clientAssigneeIds: new Set(["client-1"]) })
    );
    expect(result).toEqual({
      priorityScore: 75,
      priorityLabel: "urgent",
      priorityReason: "Overdue by 3 days; Marked high priority; Client-facing",
    });
  });

  it("due today + medium lands exactly on the high boundary (45)", () => {
    const result = computeTaskPriority(
      baseTask({ dueAt: new Date(NOW), priority: "medium" }),
      baseCtx()
    );
    expect(result.priorityScore).toBe(45);
    expect(result.priorityLabel).toBe("high");
  });

  it("due within 7 days + medium lands exactly on the medium boundary (30)", () => {
    const result = computeTaskPriority(
      baseTask({ dueAt: addDays(NOW, 5), priority: "medium" }),
      baseCtx()
    );
    expect(result.priorityScore).toBe(30);
    expect(result.priorityLabel).toBe("medium");
  });

  it("workload relief can drop a task across a label boundary (45 -> 40)", () => {
    const result = computeTaskPriority(
      baseTask({
        dueAt: new Date(NOW),
        priority: "medium",
        assignee: { uid: "u-1" },
      }),
      baseCtx({ assigneeOpenCounts: new Map([["u-1", 25]]) })
    );
    expect(result.priorityScore).toBe(40);
    expect(result.priorityLabel).toBe("medium");
  });

  it("all positive signals sum to 90 (urgent) and stay within bounds", () => {
    const result = computeTaskPriority(
      baseTask({
        title: "Unblock client deploy",
        dueAt: subDays(NOW, 2),
        priority: "high",
        assignee: { uid: "client-1" },
        lastUpdated: subDays(NOW, 1),
      }),
      baseCtx({ clientAssigneeIds: new Set(["client-1"]) })
    );
    expect(result.priorityScore).toBe(90);
    expect(result.priorityLabel).toBe("urgent");
  });

  it("clamps a negative-only total to 0", () => {
    const result = computeTaskPriority(
      baseTask({ assignee: { uid: "u-1" } }),
      baseCtx({ assigneeOpenCounts: new Map([["u-1", 99]]) })
    );
    expect(result.priorityScore).toBe(0);
    expect(result.priorityLabel).toBe("low");
    expect(result.priorityReason).toBe("Assignee has a heavy workload");
  });
});

describe("computeTaskPriority — reason composition", () => {
  it("keeps only the top 3 factors in descending contribution order", () => {
    const result = computeTaskPriority(
      baseTask({
        title: "Unblock client deploy",
        dueAt: subDays(NOW, 2),
        priority: "high",
        assignee: { uid: "client-1" },
        lastUpdated: subDays(NOW, 1),
      }),
      baseCtx({ clientAssigneeIds: new Set(["client-1"]) })
    );
    // 40 overdue > 20 high > 15 client; blocker (10) and recency (5) drop off.
    expect(result.priorityReason).toBe(
      "Overdue by 2 days; Marked high priority; Client-facing"
    );
  });

  it("breaks weight ties by weight-table order (due date before blocker)", () => {
    const result = computeTaskPriority(
      baseTask({ title: "Blocked follow-up", dueAt: addDays(NOW, 10) }),
      baseCtx()
    );
    // Due within 14 days (+10) and blocker (+10) tie; due date is listed first.
    expect(result.priorityScore).toBe(20);
    expect(result.priorityReason).toBe(
      "Due in 10 days; Blocker/dependency signal"
    );
  });

  it("lists the negative workload factor last when it makes the top 3", () => {
    const result = computeTaskPriority(
      baseTask({ priority: "medium", assignee: { uid: "u-1" } }),
      baseCtx({ assigneeOpenCounts: new Map([["u-1", 12]]) })
    );
    expect(result.priorityReason).toBe(
      "Marked medium priority; Assignee has a heavy workload"
    );
  });

  it("falls back to 'No urgency signals' when nothing contributes", () => {
    const result = computeTaskPriority(baseTask(), baseCtx());
    expect(result).toEqual({
      priorityScore: 0,
      priorityLabel: "low",
      priorityReason: "No urgency signals",
    });
  });
});

describe("computeTaskPriority — done/expired zeroing", () => {
  it.each([
    ["status done", { status: "done" }],
    ["cleanupStatus expired", { cleanupStatus: "expired" }],
  ])("zeroes %s even with strong signals", (_name, overrides) => {
    const result = computeTaskPriority(
      baseTask({
        ...overrides,
        title: "Unblock client deploy",
        dueAt: subDays(NOW, 10),
        priority: "high",
        assignee: { uid: "client-1" },
        lastUpdated: subDays(NOW, 1),
      }),
      baseCtx({ clientAssigneeIds: new Set(["client-1"]) })
    );
    expect(result).toEqual({
      priorityScore: 0,
      priorityLabel: "low",
      priorityReason: "Completed or expired",
    });
  });

  it("does not zero other cleanup statuses", () => {
    const result = computeTaskPriority(
      baseTask({ cleanupStatus: "suggested_expire", priority: "high" }),
      baseCtx()
    );
    expect(result.priorityScore).toBe(20);
  });

  it("handles a minimal task object without optional fields", () => {
    const result = computeTaskPriority({}, { now: NOW });
    expect(result).toEqual({
      priorityScore: 0,
      priorityLabel: "low",
      priorityReason: "No urgency signals",
    });
  });
});
