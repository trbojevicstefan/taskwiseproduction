import {
  classifyTaskHeuristic,
  normalizeTitleKey,
  type HeuristicContext,
  type HeuristicTaskInput,
} from "@/lib/task-cleanup-heuristics";

const NOW = new Date("2026-07-02T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

const baseCtx = (overrides: Partial<HeuristicContext> = {}): HeuristicContext => ({
  now: NOW,
  siblingTitleKeys: new Map(),
  clientAssigneeIds: new Set(),
  autoExpireDays: 14,
  ...overrides,
});

const baseTask = (overrides: Partial<HeuristicTaskInput> = {}): HeuristicTaskInput => ({
  id: "task-1",
  title: "Untitled",
  description: null,
  dueAt: null,
  assigneeName: null,
  status: "todo",
  ...overrides,
});

describe("normalizeTitleKey", () => {
  it("lowercases, strips punctuation and collapses whitespace", () => {
    expect(normalizeTitleKey("  Send   the Invite!! ")).toBe("send the invite");
    expect(normalizeTitleKey(null)).toBe("");
  });
});

describe("classifyTaskHeuristic — vanity/logistics spec examples", () => {
  const wholeTitleVanityCases: Array<[string, string]> = [
    ["Send meeting invitation", "scheduling_admin"],
    ["Send the invite", "scheduling_admin"],
    ["Send the presentation", "meeting_logistics"],
    ["Send the deck", "meeting_logistics"],
    ["Send the slides", "meeting_logistics"],
    ["Share the agenda", "meeting_logistics"],
    ["Book the meeting room", "meeting_logistics"],
    ["Book the room", "meeting_logistics"],
    ["Forward the calendar invite", "scheduling_admin"],
    ["Forward the invite", "scheduling_admin"],
    ["Join the call", "meeting_logistics"],
    ["Join the meeting", "meeting_logistics"],
    ["Schedule the meeting", "scheduling_admin"],
    ["Schedule the call", "scheduling_admin"],
    ["Add to calendar", "scheduling_admin"],
  ];

  it.each(wholeTitleVanityCases)(
    "flags whole-title match %j as vanity 0.9 (%s)",
    (title, category) => {
      const result = classifyTaskHeuristic(baseTask({ title }), baseCtx());
      expect(result.verdict).toBe("vanity");
      expect(result.category).toBe(category);
      expect(result.confidence).toBe(0.9);
      expect(result.suggestedExpiresAt).toBe(
        new Date(NOW.getTime() + 14 * DAY_MS).toISOString()
      );
    }
  );

  it("flags a partial pattern match at 0.7", () => {
    const result = classifyTaskHeuristic(
      baseTask({ title: "Remember to send the presentation after standup" }),
      baseCtx()
    );
    expect(result.verdict).toBe("vanity");
    expect(result.category).toBe("meeting_logistics");
    expect(result.confidence).toBe(0.7);
  });

  it("returns null suggestedExpiresAt when no autoExpireDays given", () => {
    const result = classifyTaskHeuristic(
      baseTask({ title: "Join the call" }),
      baseCtx({ autoExpireDays: undefined })
    );
    expect(result.verdict).toBe("vanity");
    expect(result.suggestedExpiresAt).toBeNull();
  });
});

describe("classifyTaskHeuristic — protected classes always keep", () => {
  it("keeps tasks with a future dueAt and an assignee", () => {
    const result = classifyTaskHeuristic(
      baseTask({
        title: "Send the invite",
        dueAt: new Date(NOW.getTime() + 3 * DAY_MS).toISOString(),
        assigneeName: "Ana",
      }),
      baseCtx()
    );
    expect(result.verdict).toBe("keep");
    expect(result.reason).toMatch(/Protected/);
  });

  it("keeps tasks assigned to a client-type person", () => {
    const result = classifyTaskHeuristic(
      baseTask({ title: "Join the call", assigneePersonId: "person-9" }),
      baseCtx({ clientAssigneeIds: new Set(["person-9"]) })
    );
    expect(result.verdict).toBe("keep");
    expect(result.reason).toMatch(/client/i);
  });

  it.each([
    "Review the legal terms",
    "Chase the invoice",
    "Prepare finance summary",
    "Security audit follow up",
    "Compliance checklist",
    "Sign the contract",
    "Process the payment",
  ])("keeps %j because of protected keywords", (title) => {
    const result = classifyTaskHeuristic(baseTask({ title }), baseCtx());
    expect(result.verdict).toBe("keep");
  });

  it("keeps tasks with a protected keyword only in the description", () => {
    const result = classifyTaskHeuristic(
      baseTask({ title: "Follow up", description: "About the invoice for Acme" }),
      baseCtx()
    );
    expect(result.verdict).toBe("keep");
  });

  it.each([
    "Build the onboarding flow",
    "Create pricing page",
    "Write the launch post",
    "Design new dashboard",
    "Implement retries",
    "Fix login bug",
    "Ship v2 exporter",
    "Deliver the migration plan",
  ])("keeps deliverable title %j", (title) => {
    const result = classifyTaskHeuristic(baseTask({ title }), baseCtx());
    expect(result.verdict).toBe("keep");
  });
});

describe("classifyTaskHeuristic — duplicates", () => {
  it("flags a task whose normalized title key maps to a different task", () => {
    const result = classifyTaskHeuristic(
      baseTask({ id: "task-2", title: "Update the Roadmap!" }),
      baseCtx({
        siblingTitleKeys: new Map([["update the roadmap", "task-1"]]),
      })
    );
    expect(result.verdict).toBe("duplicate");
    expect(result.category).toBe("duplicate");
    expect(result.confidence).toBe(0.75);
    expect(result.duplicateOfTaskId).toBe("task-1");
  });

  it("does not flag the task that owns the title key", () => {
    const result = classifyTaskHeuristic(
      baseTask({ id: "task-1", title: "Update the roadmap" }),
      baseCtx({
        siblingTitleKeys: new Map([["update the roadmap", "task-1"]]),
      })
    );
    expect(result.verdict).toBe("keep");
  });
});

describe("classifyTaskHeuristic — stale event-bound tasks", () => {
  it("flags an event-referencing task from a meeting more than 7 days old", () => {
    const result = classifyTaskHeuristic(
      baseTask({
        title: "Prepare notes for the quarterly demo",
        meetingStartTime: new Date(NOW.getTime() - 10 * DAY_MS).toISOString(),
      }),
      baseCtx()
    );
    expect(result.verdict).toBe("stale");
    expect(result.category).toBe("expired_event");
    expect(result.confidence).toBe(0.7);
    expect(result.suggestedExpiresAt).toBe(
      new Date(NOW.getTime() + 14 * DAY_MS).toISOString()
    );
  });

  it("uses stale_follow_up for follow-up phrasing", () => {
    const result = classifyTaskHeuristic(
      baseTask({
        title: "Follow up with Marko about onboarding",
        meetingStartTime: new Date(NOW.getTime() - 12 * DAY_MS).toISOString(),
      }),
      baseCtx()
    );
    expect(result.verdict).toBe("stale");
    expect(result.category).toBe("stale_follow_up");
  });

  it("does not flag when the source meeting is recent", () => {
    const result = classifyTaskHeuristic(
      baseTask({
        title: "Prepare notes for the quarterly demo",
        meetingStartTime: new Date(NOW.getTime() - 2 * DAY_MS).toISOString(),
      }),
      baseCtx()
    );
    expect(result.verdict).not.toBe("stale");
  });

  it("does not flag when the task has a future dueAt", () => {
    const result = classifyTaskHeuristic(
      baseTask({
        title: "Prepare notes for the quarterly demo",
        meetingStartTime: new Date(NOW.getTime() - 10 * DAY_MS).toISOString(),
        dueAt: new Date(NOW.getTime() + 5 * DAY_MS).toISOString(),
      }),
      baseCtx()
    );
    expect(result.verdict).not.toBe("stale");
  });
});

describe("classifyTaskHeuristic — low specificity", () => {
  it.each(["Follow up", "Review this", "Sync", "Circle back", "Check in"])(
    "flags bare %j with no description/assignee/dueAt",
    (title) => {
      const result = classifyTaskHeuristic(baseTask({ title }), baseCtx());
      expect(result.verdict).toBe("low_specificity");
      expect(result.category).toBe("low_specificity");
      expect(result.confidence).toBe(0.65);
    }
  );

  it("does not flag when a description exists", () => {
    const result = classifyTaskHeuristic(
      baseTask({ title: "Follow up", description: "Ask Iva about the beta rollout" }),
      baseCtx()
    );
    expect(result.verdict).not.toBe("low_specificity");
  });

  it("does not flag when an assignee exists", () => {
    const result = classifyTaskHeuristic(
      baseTask({ title: "Follow up", assigneeName: "Ana" }),
      baseCtx()
    );
    expect(result.verdict).not.toBe("low_specificity");
  });

  it("treats placeholder assignee names as unassigned", () => {
    const result = classifyTaskHeuristic(
      baseTask({ title: "Follow up", assigneeName: "Unassigned" }),
      baseCtx()
    );
    expect(result.verdict).toBe("low_specificity");
  });
});

describe("classifyTaskHeuristic — ambiguous path and keep default", () => {
  it("marks weak logistics signals as ambiguous (LLM candidate)", () => {
    const result = classifyTaskHeuristic(
      baseTask({ title: "Sort out the calendar mess for the offsite" }),
      baseCtx()
    );
    expect(result.verdict).toBe("ambiguous");
    expect(result.confidence).toBeLessThan(0.6);
  });

  it("keeps ordinary meaningful work", () => {
    const result = classifyTaskHeuristic(
      baseTask({
        title: "Draft migration checklist for the data warehouse",
        description: "Cover cutover and rollback",
      }),
      baseCtx()
    );
    expect(result.verdict).toBe("keep");
  });

  it("keeps empty titles instead of guessing", () => {
    const result = classifyTaskHeuristic(baseTask({ title: "   " }), baseCtx());
    expect(result.verdict).toBe("keep");
  });
});
