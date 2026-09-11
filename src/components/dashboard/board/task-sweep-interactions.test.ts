import {
  filterSweepCandidatesByStrictness,
  resolveSweepActionFromDrag,
  resolveSweepActionFromKey,
} from "@/components/dashboard/board/task-sweep-interactions";

describe("task sweep interactions", () => {
  it("maps horizontal and vertical drags to actions", () => {
    expect(resolveSweepActionFromDrag({ x: 120, y: 5 })).toBe("keep");
    expect(resolveSweepActionFromDrag({ x: -120, y: 5 })).toBe("discard");
    expect(resolveSweepActionFromDrag({ x: 5, y: -120 })).toBe("snooze");
    expect(resolveSweepActionFromDrag({ x: 5, y: 120 })).toBe("complete");
    expect(resolveSweepActionFromDrag({ x: 20, y: 20 })).toBeNull();
  });

  it("maps keyboard shortcuts without hijacking unrelated keys", () => {
    expect(resolveSweepActionFromKey("ArrowRight")).toBe("keep");
    expect(resolveSweepActionFromKey("d")).toBe("discard");
    expect(resolveSweepActionFromKey("s")).toBe("snooze");
    expect(resolveSweepActionFromKey("c")).toBe("complete");
    expect(resolveSweepActionFromKey("Enter")).toBeNull();
  });

  it("uses strictness to keep only higher stale-score candidates", () => {
    const candidates = [
      { id: "a", sweepScore: 2 },
      { id: "b", sweepScore: 5 },
      { id: "c", sweepScore: 8 },
    ];

    expect(filterSweepCandidatesByStrictness(candidates, 0).map((item) => item.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(filterSweepCandidatesByStrictness(candidates, 50).map((item) => item.id)).toEqual([
      "b",
      "c",
    ]);
    expect(filterSweepCandidatesByStrictness(candidates, 80).map((item) => item.id)).toEqual([
      "c",
    ]);
  });
});