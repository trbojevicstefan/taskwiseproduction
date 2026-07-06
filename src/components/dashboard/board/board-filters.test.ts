import {
  applyBoardFiltersToParams,
  countActiveBoardFilters,
  hasActiveBoardFilters,
  parseBoardFilters,
  parseColumnSort,
  serializeColumnSort,
  sortColumnTasks,
  taskMatchesBoardFilters,
  DEFAULT_BOARD_FILTERS,
  type BoardFilterContext,
  type BoardFilters,
} from "@/components/dashboard/board/board-filters";
import type { Task } from "@/types/project";

const NOW = new Date("2026-07-08T12:00:00.000Z"); // Wednesday

const buildTask = (
  overrides: Partial<Task> & Record<string, unknown> = {}
): Task =>
  ({
    id: "task-1",
    title: "Send proposal",
    description: "",
    status: "todo",
    priority: "medium",
    projectId: "p1",
    userId: "u1",
    ...overrides,
  } as Task);

const buildContext = (
  overrides: Partial<BoardFilterContext> = {}
): BoardFilterContext => ({
  resolveAssigneeIds: () => new Set<string>(),
  resolveCompany: () => null,
  now: NOW,
  ...overrides,
});

const filtersWith = (overrides: Partial<BoardFilters>): BoardFilters => ({
  ...DEFAULT_BOARD_FILTERS,
  ...overrides,
});

describe("parseBoardFilters / applyBoardFiltersToParams", () => {
  it("returns defaults for empty params", () => {
    expect(parseBoardFilters(new URLSearchParams())).toEqual(
      DEFAULT_BOARD_FILTERS
    );
  });

  it("round-trips every filter through the query string", () => {
    const filters = filtersWith({
      search: "acme kickoff",
      assignees: ["person-1", "person-2"],
      unassigned: true,
      companies: ["Acme, Inc."],
      due: "overdue",
      priorities: ["high", "urgent"],
      meetings: ["meeting-1"],
      completion: "suggested",
      statuses: ["status-1"],
    });

    const params = new URLSearchParams("boardId=board-1");
    applyBoardFiltersToParams(filters, params);

    // Unrelated params survive.
    expect(params.get("boardId")).toBe("board-1");
    expect(parseBoardFilters(params)).toEqual(filters);
  });

  it("removes keys at their default value (clean URLs)", () => {
    const params = new URLSearchParams(
      "boardId=b1&q=old&assignee=p1&unassigned=1&company=Acme&due=today&priority=low&meeting=m1&completion=none&status=s1"
    );
    applyBoardFiltersToParams(DEFAULT_BOARD_FILTERS, params);
    expect(params.toString()).toBe("boardId=b1");
  });

  it("drops unknown enum values on parse", () => {
    const params = new URLSearchParams(
      "due=someday&completion=maybe&priority=critical&priority=high"
    );
    const filters = parseBoardFilters(params);
    expect(filters.due).toBe("all");
    expect(filters.completion).toBe("all");
    expect(filters.priorities).toEqual(["high"]);
  });
});

describe("hasActiveBoardFilters / countActiveBoardFilters", () => {
  it("is inactive for defaults", () => {
    expect(hasActiveBoardFilters(DEFAULT_BOARD_FILTERS)).toBe(false);
    expect(countActiveBoardFilters(DEFAULT_BOARD_FILTERS)).toBe(0);
  });

  it("counts each active filter group once", () => {
    const filters = filtersWith({
      search: "x",
      assignees: ["p1"],
      unassigned: true,
      due: "none",
    });
    expect(hasActiveBoardFilters(filters)).toBe(true);
    expect(countActiveBoardFilters(filters)).toBe(3); // search, assignee, due
  });
});

describe("taskMatchesBoardFilters", () => {
  it("matches everything with default filters", () => {
    expect(
      taskMatchesBoardFilters(
        buildTask(),
        "status-1",
        DEFAULT_BOARD_FILTERS,
        buildContext()
      )
    ).toBe(true);
  });

  it("searches title, description, source meeting, and assignee name", () => {
    const ctx = buildContext();
    const task = buildTask({
      title: "Write summary",
      description: "for the QBR deck",
      sourceSessionName: "Acme kickoff",
      assigneeName: "Jane Doe",
    });
    for (const query of ["summary", "qbr", "acme", "jane"]) {
      expect(
        taskMatchesBoardFilters(task, "s1", filtersWith({ search: query }), ctx)
      ).toBe(true);
    }
    expect(
      taskMatchesBoardFilters(task, "s1", filtersWith({ search: "zebra" }), ctx)
    ).toBe(false);
  });

  it("filters by column (status)", () => {
    const ctx = buildContext();
    const filters = filtersWith({ statuses: ["s1"] });
    expect(taskMatchesBoardFilters(buildTask(), "s1", filters, ctx)).toBe(true);
    expect(taskMatchesBoardFilters(buildTask(), "s2", filters, ctx)).toBe(false);
  });

  it("filters by effective priority (priorityLabel wins over priority)", () => {
    const ctx = buildContext();
    const urgentTask = buildTask({ priority: "high", priorityLabel: "urgent" });
    expect(
      taskMatchesBoardFilters(
        urgentTask,
        "s1",
        filtersWith({ priorities: ["urgent"] }),
        ctx
      )
    ).toBe(true);
    expect(
      taskMatchesBoardFilters(
        urgentTask,
        "s1",
        filtersWith({ priorities: ["high"] }),
        ctx
      )
    ).toBe(false);
  });

  it("filters by assignee with unassigned as an OR branch", () => {
    const assigned = buildTask({ id: "assigned" });
    const unassigned = buildTask({ id: "unassigned" });
    const ctx = buildContext({
      resolveAssigneeIds: (task) =>
        task.id === "assigned" ? new Set(["p1"]) : new Set(),
    });

    const byPerson = filtersWith({ assignees: ["p1"] });
    expect(taskMatchesBoardFilters(assigned, "s1", byPerson, ctx)).toBe(true);
    expect(taskMatchesBoardFilters(unassigned, "s1", byPerson, ctx)).toBe(false);

    const byUnassigned = filtersWith({ unassigned: true });
    expect(taskMatchesBoardFilters(assigned, "s1", byUnassigned, ctx)).toBe(false);
    expect(taskMatchesBoardFilters(unassigned, "s1", byUnassigned, ctx)).toBe(true);

    const both = filtersWith({ assignees: ["p1"], unassigned: true });
    expect(taskMatchesBoardFilters(assigned, "s1", both, ctx)).toBe(true);
    expect(taskMatchesBoardFilters(unassigned, "s1", both, ctx)).toBe(true);
  });

  it("filters by company case-insensitively", () => {
    const ctx = buildContext({ resolveCompany: () => "Acme Inc" });
    const filters = filtersWith({ companies: ["acme inc"] });
    expect(taskMatchesBoardFilters(buildTask(), "s1", filters, ctx)).toBe(true);

    const noCompanyCtx = buildContext({ resolveCompany: () => null });
    expect(
      taskMatchesBoardFilters(buildTask(), "s1", filters, noCompanyCtx)
    ).toBe(false);
  });

  it("filters by source meeting", () => {
    const ctx = buildContext();
    const filters = filtersWith({ meetings: ["m1"] });
    expect(
      taskMatchesBoardFilters(
        buildTask({ sourceSessionId: "m1" }),
        "s1",
        filters,
        ctx
      )
    ).toBe(true);
    expect(
      taskMatchesBoardFilters(
        buildTask({ sourceSessionId: "m2" }),
        "s1",
        filters,
        ctx
      )
    ).toBe(false);
    expect(taskMatchesBoardFilters(buildTask(), "s1", filters, ctx)).toBe(false);
  });

  it("filters by completion-suggestion status", () => {
    const ctx = buildContext();
    const suggested = buildTask({ completionSuggested: true });
    const plain = buildTask();

    const wantSuggested = filtersWith({ completion: "suggested" });
    expect(taskMatchesBoardFilters(suggested, "s1", wantSuggested, ctx)).toBe(true);
    expect(taskMatchesBoardFilters(plain, "s1", wantSuggested, ctx)).toBe(false);

    const wantNone = filtersWith({ completion: "none" });
    expect(taskMatchesBoardFilters(suggested, "s1", wantNone, ctx)).toBe(false);
    expect(taskMatchesBoardFilters(plain, "s1", wantNone, ctx)).toBe(true);
  });

  it("filters by due date: overdue, today, this_week, none", () => {
    const ctx = buildContext();
    const overdue = buildTask({ dueAt: "2026-07-01T09:00:00.000Z" });
    const today = buildTask({ dueAt: "2026-07-08T18:00:00.000Z" });
    const thisWeek = buildTask({ dueAt: "2026-07-10T09:00:00.000Z" });
    const later = buildTask({ dueAt: "2026-08-20T09:00:00.000Z" });
    const noDue = buildTask({ dueAt: null });

    expect(
      taskMatchesBoardFilters(overdue, "s1", filtersWith({ due: "overdue" }), ctx)
    ).toBe(true);
    expect(
      taskMatchesBoardFilters(today, "s1", filtersWith({ due: "overdue" }), ctx)
    ).toBe(false);
    expect(
      taskMatchesBoardFilters(today, "s1", filtersWith({ due: "today" }), ctx)
    ).toBe(true);
    expect(
      taskMatchesBoardFilters(thisWeek, "s1", filtersWith({ due: "this_week" }), ctx)
    ).toBe(true);
    expect(
      taskMatchesBoardFilters(later, "s1", filtersWith({ due: "this_week" }), ctx)
    ).toBe(false);
    expect(
      taskMatchesBoardFilters(noDue, "s1", filtersWith({ due: "none" }), ctx)
    ).toBe(true);
    expect(
      taskMatchesBoardFilters(today, "s1", filtersWith({ due: "none" }), ctx)
    ).toBe(false);
    expect(
      taskMatchesBoardFilters(noDue, "s1", filtersWith({ due: "overdue" }), ctx)
    ).toBe(false);
  });

  it("composes filters with AND", () => {
    const ctx = buildContext({
      resolveAssigneeIds: () => new Set(["p1"]),
      resolveCompany: () => "Acme",
    });
    const task = buildTask({
      title: "Send proposal",
      sourceSessionId: "m1",
      dueAt: "2026-07-01T09:00:00.000Z",
      completionSuggested: true,
    });
    const filters = filtersWith({
      search: "proposal",
      assignees: ["p1"],
      companies: ["Acme"],
      due: "overdue",
      meetings: ["m1"],
      completion: "suggested",
    });
    expect(taskMatchesBoardFilters(task, "s1", filters, ctx)).toBe(true);
    // Breaking any single condition fails the whole match.
    expect(
      taskMatchesBoardFilters(task, "s1", { ...filters, search: "zzz" }, ctx)
    ).toBe(false);
    expect(
      taskMatchesBoardFilters(task, "s1", { ...filters, meetings: ["m2"] }, ctx)
    ).toBe(false);
    expect(
      taskMatchesBoardFilters(task, "s1", { ...filters, due: "today" }, ctx)
    ).toBe(false);
  });
});

describe("sortColumnTasks", () => {
  type ColumnTask = Task & { boardRank?: number };
  const tasks: ColumnTask[] = [
    buildTask({
      id: "a",
      title: "A",
      boardRank: 3000,
      priorityScore: 20,
      dueAt: "2026-07-20T00:00:00.000Z",
      createdAt: "2026-07-01T00:00:00.000Z",
    }),
    buildTask({
      id: "b",
      title: "B",
      boardRank: 1000,
      priorityScore: 90,
      dueAt: null,
      createdAt: "2026-07-03T00:00:00.000Z",
    }),
    buildTask({
      id: "c",
      title: "C",
      boardRank: 2000,
      priorityScore: 55,
      dueAt: "2026-07-05T00:00:00.000Z",
      createdAt: "2026-07-02T00:00:00.000Z",
    }),
  ];

  it("manual sorts by board rank", () => {
    expect(sortColumnTasks(tasks, "manual").map((t) => t.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("priority sorts by priorityScore descending", () => {
    expect(sortColumnTasks(tasks, "priority").map((t) => t.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("priority falls back to the effective label when scores are missing", () => {
    const unscored: ColumnTask[] = [
      buildTask({ id: "low", priority: "low", boardRank: 1 }),
      buildTask({ id: "urgent", priority: "high", priorityLabel: "urgent", boardRank: 2 }),
      buildTask({ id: "med", priority: "medium", boardRank: 3 }),
    ];
    expect(sortColumnTasks(unscored, "priority").map((t) => t.id)).toEqual([
      "urgent",
      "med",
      "low",
    ]);
  });

  it("due sorts soonest first with missing dates last", () => {
    expect(sortColumnTasks(tasks, "due").map((t) => t.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("recency sorts newest created first", () => {
    expect(sortColumnTasks(tasks, "recency").map((t) => t.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("does not mutate the input array", () => {
    const input = [...tasks];
    sortColumnTasks(input, "due");
    expect(input.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });
});

describe("column sort URL round-trip", () => {
  it("serializes and parses per-column sort modes", () => {
    const map = { "status-1": "priority", "status-2": "due" } as const;
    const serialized = serializeColumnSort(map);
    expect(parseColumnSort(serialized)).toEqual(map);
  });

  it("omits manual entries and ignores malformed input", () => {
    expect(serializeColumnSort({ "s1": "manual" })).toBe("");
    expect(parseColumnSort(null)).toEqual({});
    expect(parseColumnSort("garbage")).toEqual({});
    expect(parseColumnSort("s1:bogus,s2:recency")).toEqual({ s2: "recency" });
  });
});
