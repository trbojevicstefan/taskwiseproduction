import { aggregateMetrics, scoreCase } from "./completion-metrics";

describe("completion benchmark metrics", () => {
  it("scores a case with true positives, false positives and false negatives", () => {
    expect(scoreCase(["a", "b", "c"], ["a", "b", "d"])).toEqual({
      tp: 2,
      fp: 1,
      fn: 1,
    });
  });

  it("scores an all-negative case with no predictions as zeroes", () => {
    expect(scoreCase([], [])).toEqual({ tp: 0, fp: 0, fn: 0 });
  });

  it("counts every prediction as a false positive when nothing was expected", () => {
    expect(scoreCase([], ["a", "b"])).toEqual({ tp: 0, fp: 2, fn: 0 });
  });

  it("collapses duplicate predicted ids (set semantics)", () => {
    expect(scoreCase(["a"], ["a", "a", "a"])).toEqual({ tp: 1, fp: 0, fn: 0 });
  });

  it("aggregates precision, recall and f1 across cases", () => {
    const metrics = aggregateMetrics([
      { tp: 2, fp: 1, fn: 1 },
      { tp: 2, fp: 0, fn: 1 },
    ]);
    expect(metrics.tp).toBe(4);
    expect(metrics.fp).toBe(1);
    expect(metrics.fn).toBe(2);
    expect(metrics.precision).toBeCloseTo(4 / 5, 10);
    expect(metrics.recall).toBeCloseTo(4 / 6, 10);
    const p = 4 / 5;
    const r = 4 / 6;
    expect(metrics.f1).toBeCloseTo((2 * p * r) / (p + r), 10);
  });

  it("reports 0 precision/recall/f1 (not 1) when there are no predictions or positives", () => {
    const metrics = aggregateMetrics([{ tp: 0, fp: 0, fn: 0 }]);
    expect(metrics.precision).toBe(0);
    expect(metrics.recall).toBe(0);
    expect(metrics.f1).toBe(0);
  });
});
