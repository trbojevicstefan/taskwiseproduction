import { normalizeTitleKey } from "@/lib/ai-utils";
import {
  buildAssigneeKey,
  buildCompletionEvidenceFingerprint,
  isExplicitCompletionEvidence,
} from "@/lib/task-completion-helpers";
import type { ExtractedTaskSchema } from "@/types/chat";

/**
 * Priority 7 completion auto-apply policy.
 *
 * Tiers (see classifyCompletionSuggestion):
 *  - auto_apply : confidence >= COMPLETION_AUTO_APPLY_MIN_CONFIDENCE AND the
 *    evidence snippet is an EXPLICIT completion statement
 *    (isExplicitCompletionEvidence). Only this tier may flip a task to done
 *    without a human; the task is stamped completionReviewStatus
 *    "auto_applied" with the evidence retained.
 *  - suggest    : confidence >= COMPLETION_SUGGEST_MIN_CONFIDENCE. Never
 *    applied directly — these ride the existing cleanup review flow
 *    (cleanupStatus "completed_suggested", written by
 *    buildCompletionSuggestions in task-completion-detection.ts) and wait for
 *    a reviewer on /review/cleanup.
 *  - ignore     : everything below the suggest floor.
 *
 * Rejection memory: every write is guarded with
 * `completionRejectedFingerprints: { $ne: <evidence fingerprint> }` so a
 * suggestion a reviewer already rejected (cleanup "dismiss" action) can never
 * be re-applied or re-suggested for the same evidence.
 */

// 0.85 matches the benchmark gate (COMPLETION_BENCH_MIN_PRECISION defaults to
// 0.85 in scripts/benchmark-completion-detection.ts): we only auto-apply in
// the confidence regime where measured precision is enforced. Clamped so an
// env override can tighten but never drop below the suggest tier.
export const COMPLETION_AUTO_APPLY_MIN_CONFIDENCE = Math.min(
  0.99,
  Math.max(
    0.7,
    Number(process.env.TASK_COMPLETION_AUTO_APPLY_MIN_CONFIDENCE || 0.85)
  )
);

// 0.6 matches the default user completionMatchThreshold
// (resolveCompletionMatchThreshold) — the floor the pipeline already uses to
// call something a "suggestion" at all. Below this the signal is noise.
export const COMPLETION_SUGGEST_MIN_CONFIDENCE = Math.min(
  COMPLETION_AUTO_APPLY_MIN_CONFIDENCE,
  Math.max(0.4, Number(process.env.TASK_COMPLETION_SUGGEST_MIN_CONFIDENCE || 0.6))
);

export type CompletionSuggestionTier = "auto_apply" | "suggest" | "ignore";

export const classifyCompletionSuggestion = (suggestion: {
  completionConfidence?: number | null;
  completionEvidence?: Array<{ snippet?: string | null }> | null;
}): CompletionSuggestionTier => {
  const confidence =
    typeof suggestion.completionConfidence === "number" &&
    Number.isFinite(suggestion.completionConfidence)
      ? suggestion.completionConfidence
      : 0;
  if (confidence < COMPLETION_SUGGEST_MIN_CONFIDENCE) return "ignore";
  const snippet = suggestion.completionEvidence?.[0]?.snippet ?? null;
  if (
    confidence >= COMPLETION_AUTO_APPLY_MIN_CONFIDENCE &&
    isExplicitCompletionEvidence(snippet)
  ) {
    return "auto_apply";
  }
  return "suggest";
};

/** Reviewer sentinel recorded when the system auto-applies a completion. */
export const COMPLETION_AUTO_APPLY_REVIEWER = "system:completion-auto-apply";

export const mergeCompletionSuggestions = (
  tasks: ExtractedTaskSchema[],
  suggestions: ExtractedTaskSchema[]
): ExtractedTaskSchema[] => {
  if (!suggestions.length) return tasks;

  const matchKey = (task: ExtractedTaskSchema) => {
    const assigneeName = task.assignee?.name || task.assigneeName || "";
    const assigneeEmail = task.assignee?.email || "";
    const assigneeKey = buildAssigneeKey(assigneeName, assigneeEmail, true);
    return `${normalizeTitleKey(task.title)}|${assigneeKey}`;
  };

  const suggestionByKey = new Map<string, ExtractedTaskSchema>();
  suggestions.forEach((suggestion: any) => {
    const key = matchKey(suggestion);
    if (!key) return;
    suggestionByKey.set(key, suggestion);
  });

  const applySuggestions = (items: ExtractedTaskSchema[]): ExtractedTaskSchema[] =>
    items.map((task: any) => {
      const key = matchKey(task);
      const suggestion = suggestionByKey.get(key);
      if (suggestion) {
        suggestionByKey.delete(key);
        return {
          ...task,
          status: task.status || "todo",
          completionSuggested: true,
          completionConfidence: suggestion.completionConfidence ?? null,
          completionEvidence: suggestion.completionEvidence ?? null,
          completionTargets: suggestion.completionTargets ?? null,
        };
      }
      if (task.subtasks?.length) {
        return { ...task, subtasks: applySuggestions(task.subtasks) };
      }
      return task;
    });

  const updated = applySuggestions(tasks);
  const remaining = Array.from(suggestionByKey.values()).map((suggestion: any) => ({
    ...suggestion,
    status: suggestion.status && suggestion.status !== "done" ? suggestion.status : "todo",
    completionSuggested: true,
  }));
  return remaining.length ? [...updated, ...remaining] : updated;
};

/**
 * Auto-apply completion suggestions to their target tasks.
 *
 * Callers pre-filter with the user's autoApproveCompletedTasks setting and
 * completionMatchThreshold; this function additionally enforces the Priority 7
 * policy: ONLY the auto_apply tier (explicit evidence + high confidence, see
 * classifyCompletionSuggestion) flips tasks to done. suggest/ignore tiers are
 * skipped here — suggest-tier items already ride the cleanup review flow as
 * cleanupStatus "completed_suggested".
 *
 * Applied tasks get completionReviewStatus "auto_applied" + reviewer/timestamp
 * with the evidence retained, and cleanupStatus "dismissed" so an accompanying
 * "completed_suggested" review entry leaves the /review/cleanup queue (same
 * semantics as the manual mark_completed action). Writes are guarded by the
 * rejected-evidence fingerprint so previously rejected evidence never
 * auto-applies.
 */
export const applyCompletionTargets = async (
  db: any,
  userId: string,
  suggestions: ExtractedTaskSchema[]
) => {
  for (const suggestion of suggestions) {
    if (!suggestion.completionTargets?.length) continue;
    if (classifyCompletionSuggestion(suggestion) !== "auto_apply") continue;

    const evidence = suggestion.completionEvidence || undefined;
    const fingerprint = buildCompletionEvidenceFingerprint(
      suggestion.completionEvidence?.[0]?.snippet
    );
    const nowIso = new Date().toISOString();
    const reviewSet = {
      completionReviewStatus: "auto_applied",
      completionReviewedBy: COMPLETION_AUTO_APPLY_REVIEWER,
      completionReviewedAt: nowIso,
      cleanupStatus: "dismissed",
    };
    const rejectionGuard = fingerprint
      ? { completionRejectedFingerprints: { $ne: fingerprint } }
      : {};
    const targets = suggestion.completionTargets;

    const directTaskTargets = targets.filter((t) => t.sourceType === "task");
    if (directTaskTargets.length) {
      const taskIds = directTaskTargets.map((t) => t.taskId);
      await db.collection("tasks").updateMany(
        {
          userId,
          $or: [{ _id: { $in: taskIds } }, { id: { $in: taskIds } }],
          ...rejectionGuard,
        },
        {
          $set: {
            status: "done",
            completionEvidence: evidence,
            ...reviewSet,
            lastUpdated: new Date(),
          },
        }
      );
    }

    const sessionTargets = targets.filter((t) => t.sourceType !== "task");
    for (const target of sessionTargets) {
      await db.collection("tasks").updateMany(
        {
          userId,
          sourceSessionType: target.sourceType,
          ...rejectionGuard,
          $and: [
            {
              $or: [{ sourceSessionId: target.sourceSessionId }],
            },
            {
              $or: [{ _id: target.taskId }, { sourceTaskId: target.taskId }, { id: target.taskId }],
            },
          ],
        },
        {
          $set: {
            status: "done",
            completionEvidence: evidence,
            completionSuggested: false,
            ...reviewSet,
            lastUpdated: new Date(),
          },
        }
      );
    }
  }
};

export const filterTasksForSessionSync = (
  tasks: ExtractedTaskSchema[],
  sessionType: "meeting" | "chat",
  sessionId: string
) => {
  if (!tasks.length) return tasks;
  const sessionKey = String(sessionId);
  const shouldInclude = (task: ExtractedTaskSchema) => {
    if (!task.completionSuggested) return true;
    const targets = task.completionTargets || [];
    if (!targets.length) return true;
    return targets.some(
      (target: any) =>
        target.sourceType === sessionType &&
        String(target.sourceSessionId) === sessionKey
    );
  };

  const walk = (items: ExtractedTaskSchema[]): ExtractedTaskSchema[] =>
    items.reduce<ExtractedTaskSchema[]>((acc, task) => {
      if (!shouldInclude(task)) return acc;
      if (task.subtasks?.length) {
        acc.push({ ...task, subtasks: walk(task.subtasks) });
      } else {
        acc.push(task);
      }
      return acc;
    }, []);

  return walk(tasks);
};
