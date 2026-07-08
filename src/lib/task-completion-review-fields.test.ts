/**
 * Priority 7 guardrail tests: the completion-review fields
 * (completionReviewStatus / completionReviewedBy / completionReviewedAt) must
 * survive all five task-field choke points — TASK_LIST_PROJECTION,
 * normalizeTask, the type definitions, ExtractedTaskSchema, and task
 * hydration — while staying OUT of buildTaskRecords (meeting re-sync must
 * never clobber review decisions).
 */

import { normalizeTask } from "@/lib/data";
import { TASK_LIST_PROJECTION } from "@/lib/task-projections";
import { hydrateTaskReferences } from "@/lib/task-hydration";
import { syncTasksForSource } from "@/lib/task-sync";
import { getDb } from "@/lib/db";

jest.mock("@/lib/db", () => ({
  getDb: jest.fn(),
}));

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;

describe("completion review field choke points", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("TASK_LIST_PROJECTION includes the completion review fields", () => {
    expect(TASK_LIST_PROJECTION).toMatchObject({
      completionReviewStatus: 1,
      completionReviewedBy: 1,
      completionReviewedAt: 1,
    });
  });

  it("normalizeTask round-trips the completion review fields", () => {
    const normalized = normalizeTask({
      id: "task-1",
      title: "Draft brief",
      completionReviewStatus: "rejected",
      completionReviewedBy: "user-1",
      completionReviewedAt: "2026-07-06T00:00:00.000Z",
    });

    expect(normalized.completionReviewStatus).toBe("rejected");
    expect(normalized.completionReviewedBy).toBe("user-1");
    expect(normalized.completionReviewedAt).toBe("2026-07-06T00:00:00.000Z");
  });

  it("normalizeTask defaults absent completion review fields to null", () => {
    const normalized = normalizeTask({ id: "task-1", title: "Draft brief" });

    expect(normalized.completionReviewStatus).toBeNull();
    expect(normalized.completionReviewedBy).toBeNull();
    expect(normalized.completionReviewedAt).toBeNull();
  });

  it("hydrateTaskReferences carries completion review fields from canonical tasks", async () => {
    mockedGetDb.mockResolvedValue({
      collection: jest.fn(() => ({
        find: jest.fn(() => ({
          project: jest.fn(() => ({
            toArray: jest.fn().mockResolvedValue([]),
          })),
          toArray: jest.fn().mockResolvedValue([
            {
              _id: "task-1",
              title: "Draft brief",
              completionReviewStatus: "auto_applied",
              completionReviewedBy: "system:completion-auto-apply",
              completionReviewedAt: "2026-07-06T00:00:00.000Z",
            },
          ]),
        })),
      })),
    } as any);

    const hydrated = await hydrateTaskReferences("user-1", [
      { taskId: "task-1", sourceTaskId: "src-1", title: "Draft brief" } as any,
    ]);

    expect(hydrated).toHaveLength(1);
    expect(hydrated[0]).toMatchObject({
      completionReviewStatus: "auto_applied",
      completionReviewedBy: "system:completion-auto-apply",
      completionReviewedAt: "2026-07-06T00:00:00.000Z",
    });
  });

  it("buildTaskRecords never writes review-owned completion fields on re-sync", async () => {
    const bulkWrite = jest.fn().mockResolvedValue({ ok: 1 });
    const db = {
      collection: jest.fn(() => ({
        find: jest.fn(() => ({
          project: jest.fn(() => ({
            toArray: jest.fn().mockResolvedValue([]),
          })),
        })),
        bulkWrite,
        deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
      })),
    } as any;

    await syncTasksForSource(
      db,
      [
        {
          id: "task-1",
          title: "Draft brief",
          priority: "medium",
          // A stale session copy carrying review-owned fields must not be
          // able to clobber the canonical review decision.
          completionReviewStatus: "rejected",
          completionReviewedBy: "user-1",
          completionReviewedAt: "2026-07-06T00:00:00.000Z",
          cleanupStatus: "dismissed",
        } as any,
      ],
      {
        userId: "user-1",
        sourceSessionId: "meeting-1",
        sourceSessionType: "meeting",
      }
    );

    expect(bulkWrite).toHaveBeenCalledTimes(1);
    const [ops] = bulkWrite.mock.calls[0];
    expect(ops).toHaveLength(1);
    const set = ops[0].updateOne.update.$set;
    expect(set.title).toBe("Draft brief");
    expect(set).not.toHaveProperty("completionReviewStatus");
    expect(set).not.toHaveProperty("completionReviewedBy");
    expect(set).not.toHaveProperty("completionReviewedAt");
    expect(set).not.toHaveProperty("completionRejectedFingerprints");
    expect(set).not.toHaveProperty("cleanupStatus");
  });
});
