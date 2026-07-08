import {
  buildBulkItemsEndpoint,
  computeBulkMarkDonePlan,
  computeBulkMovePlan,
  findDoneStatus,
} from "@/components/dashboard/board/board-bulk";
import type { BoardStatus } from "@/types/board";
import type { Task } from "@/types/project";

const buildStatus = (overrides: Partial<BoardStatus> = {}): BoardStatus => ({
  id: "status-1",
  workspaceId: "w1",
  userId: "u1",
  boardId: "b1",
  label: "To do",
  color: "#2563eb",
  category: "todo",
  order: 0,
  isTerminal: false,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
  ...overrides,
});

const buildTask = (
  id: string,
  boardStatusId: string
): Task & { boardStatusId: string } =>
  ({
    id,
    title: id,
    status: "todo",
    priority: "medium",
    projectId: "p1",
    userId: "u1",
    boardStatusId,
  } as Task & { boardStatusId: string });

describe("buildBulkItemsEndpoint", () => {
  it("targets the existing items/bulk route", () => {
    expect(buildBulkItemsEndpoint("ws-1", "board-9")).toBe(
      "/api/workspaces/ws-1/boards/board-9/items/bulk"
    );
  });
});

describe("findDoneStatus", () => {
  it("returns the first done-category column by board order", () => {
    const statuses = [
      buildStatus({ id: "later-done", category: "done", order: 5 }),
      buildStatus({ id: "todo", category: "todo", order: 0 }),
      buildStatus({ id: "first-done", category: "done", order: 2 }),
    ];
    expect(findDoneStatus(statuses)?.id).toBe("first-done");
  });

  it("returns null when the board has no done column", () => {
    expect(
      findDoneStatus([
        buildStatus({ id: "todo", category: "todo" }),
        buildStatus({ id: "wip", category: "inprogress", order: 1 }),
      ])
    ).toBeNull();
  });
});

describe("computeBulkMovePlan", () => {
  it("builds the bulk endpoint payload and skips tasks already in the column", () => {
    const selected = [
      buildTask("t1", "todo"),
      buildTask("t2", "done"),
      buildTask("t3", "wip"),
    ];
    const plan = computeBulkMovePlan(selected, "done");
    expect(plan).toEqual({
      statusId: "done",
      taskIds: ["t1", "t3"],
      payload: { taskIds: ["t1", "t3"], statusId: "done" },
    });
  });

  it("returns null when nothing would change", () => {
    expect(computeBulkMovePlan([buildTask("t1", "done")], "done")).toBeNull();
    expect(computeBulkMovePlan([], "done")).toBeNull();
    expect(computeBulkMovePlan([buildTask("t1", "todo")], "")).toBeNull();
  });
});

describe("computeBulkMarkDonePlan", () => {
  const statuses = [
    buildStatus({ id: "todo", category: "todo", order: 0 }),
    buildStatus({ id: "done", category: "done", order: 2 }),
  ];

  it("plans a move into the done column", () => {
    const plan = computeBulkMarkDonePlan(
      [buildTask("t1", "todo"), buildTask("t2", "done")],
      statuses
    );
    expect(plan?.payload).toEqual({ taskIds: ["t1"], statusId: "done" });
  });

  it("returns null when there is no done column", () => {
    expect(
      computeBulkMarkDonePlan(
        [buildTask("t1", "todo")],
        [buildStatus({ id: "todo", category: "todo" })]
      )
    ).toBeNull();
  });
});
