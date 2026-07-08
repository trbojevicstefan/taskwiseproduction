/**
 * Pure precision/recall math for the completion-detection benchmark
 * (scripts/benchmark-completion-detection.ts). Kept free of I/O and network
 * so the scoring can be unit-tested (completion-metrics.test.ts).
 */

export type CaseScore = {
  /** predicted AND expected */
  tp: number;
  /** predicted but NOT expected (false positive) */
  fp: number;
  /** expected but NOT predicted (false negative) */
  fn: number;
};

export type AggregateMetrics = CaseScore & {
  precision: number;
  recall: number;
  f1: number;
};

/**
 * Score one benchmark case: compare the set of predicted completed groupIds
 * against the expected set. Duplicate ids are collapsed (set semantics).
 */
export const scoreCase = (
  expectedIds: Iterable<string>,
  predictedIds: Iterable<string>
): CaseScore => {
  const expected = new Set(Array.from(expectedIds, String));
  const predicted = new Set(Array.from(predictedIds, String));

  let tp = 0;
  let fp = 0;
  let fn = 0;

  predicted.forEach((groupId) => {
    if (expected.has(groupId)) {
      tp += 1;
    } else {
      fp += 1;
    }
  });
  expected.forEach((groupId) => {
    if (!predicted.has(groupId)) {
      fn += 1;
    }
  });

  return { tp, fp, fn };
};

/**
 * Aggregate per-case scores into corpus-level precision/recall/f1.
 * Conventions: with zero predictions precision is 0 (not 1) so an empty run
 * can never pass the gate; with zero expected positives recall is 0.
 */
export const aggregateMetrics = (scores: CaseScore[]): AggregateMetrics => {
  const totals = scores.reduce(
    (acc, score) => ({
      tp: acc.tp + score.tp,
      fp: acc.fp + score.fp,
      fn: acc.fn + score.fn,
    }),
    { tp: 0, fp: 0, fn: 0 }
  );

  const precision =
    totals.tp + totals.fp > 0 ? totals.tp / (totals.tp + totals.fp) : 0;
  const recall =
    totals.tp + totals.fn > 0 ? totals.tp / (totals.tp + totals.fn) : 0;
  const f1 =
    precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return { ...totals, precision, recall, f1 };
};
