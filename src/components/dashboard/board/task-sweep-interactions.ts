export type SweepGestureAction = "keep" | "discard" | "snooze" | "complete";

export const resolveSweepActionFromDrag = (
  offset: { x: number; y: number },
  threshold = 80
): SweepGestureAction | null => {
  const horizontal = Math.abs(offset.x);
  const vertical = Math.abs(offset.y);

  if (Math.max(horizontal, vertical) < threshold) return null;
  if (horizontal >= vertical) return offset.x > 0 ? "keep" : "discard";
  return offset.y < 0 ? "snooze" : "complete";
};

export const resolveSweepActionFromKey = (key: string): SweepGestureAction | null => {
  const normalized = key.toLowerCase();
  if (key === "ArrowRight" || normalized === "k") return "keep";
  if (key === "ArrowLeft" || normalized === "d") return "discard";
  if (key === "ArrowUp" || normalized === "s") return "snooze";
  if (key === "ArrowDown" || normalized === "c") return "complete";
  return null;
};

export const filterSweepCandidatesByStrictness = <T extends { sweepScore: number }>(
  candidates: T[],
  strictness: number
): T[] => {
  const normalized = Math.max(0, Math.min(100, strictness));
  const minimumScore = (normalized / 100) * 10;
  return candidates.filter((candidate) => candidate.sweepScore >= minimumScore);
};
