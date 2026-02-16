import { analyzeMeeting } from "@/ai/flows/analyze-meeting-flow";
import { getDb } from "@/lib/db";
import { ApiRouteError } from "@/lib/api-route";
import { normalizeTask } from "@/lib/data";
import { normalizeTitleKey } from "@/lib/ai-utils";
import { normalizePersonNameKey } from "@/lib/transcript-utils";
import {
  filterTasksForSessionSync,
  mergeCompletionSuggestions,
} from "@/lib/task-completion";
import { syncBoardItemsToStatusByTaskId } from "@/lib/services/board-status-sync";
import {
  cleanupChatTasksForSessions,
  updateLinkedChatSessions,
} from "@/lib/services/session-task-sync";
import { syncTasksForSource } from "@/lib/task-sync";
import { ensureDefaultBoard } from "@/lib/boards";
import { ensureBoardItemsForTasks } from "@/lib/board-items";
import { getWorkspaceIdForUser } from "@/lib/workspace";
import type { MeetingRescanMode } from "@/lib/jobs/types";
import {
  createLogger,
  ensureCorrelationId,
  type StructuredLogger,
} from "@/lib/observability";
import type { CompletionTarget, ExtractedTaskSchema, TaskEvidence } from "@/types/chat";

type CompletionUpdate = {
  completionSuggested: boolean;
  completionConfidence?: number | null;
  completionEvidence?: TaskEvidence[] | null;
  completionTargets?: CompletionTarget[] | null;
};

const UNASSIGNED_LABELS = new Set([
  "unassigned",
  "unknown",
  "none",
  "na",
  "n a",
  "tbd",
  "un assigned",
]);

const TASK_TOKEN_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "our",
  "the",
  "their",
  "they",
  "this",
  "to",
  "we",
  "with",
  "you",
  "your",
]);

const serializeMeeting = (meeting: any) => {
  const { recordingId, recordingIdHash, ...rest } = meeting;
  return {
    ...rest,
    id: meeting._id,
    _id: undefined,
    createdAt: meeting.createdAt?.toISOString?.() || meeting.createdAt,
    lastActivityAt: meeting.lastActivityAt?.toISOString?.() || meeting.lastActivityAt,
  };
};

const resolveDetailLevel = (user: any): "light" | "medium" | "detailed" => {
  const preference = user?.taskGranularityPreference;
  if (preference === "light" || preference === "medium" || preference === "detailed") {
    return preference;
  }
  return "medium";
};

const selectTasksForLevel = (
  allTaskLevels: any,
  detailLevel: "light" | "medium" | "detailed"
) => {
  if (!allTaskLevels) return [];
  return (
    allTaskLevels[detailLevel] ||
    allTaskLevels.medium ||
    allTaskLevels.light ||
    allTaskLevels.detailed ||
    []
  );
};

const buildAssigneeKey = (task: ExtractedTaskSchema) => {
  const assigneeEmail = task.assignee?.email || null;
  if (assigneeEmail) {
    return `email:${assigneeEmail.trim().toLowerCase()}`;
  }
  const assigneeName = task.assigneeName || task.assignee?.name || null;
  const normalizedName = assigneeName ? normalizePersonNameKey(assigneeName) : "";
  if (normalizedName && !UNASSIGNED_LABELS.has(normalizedName)) {
    return `name:${normalizedName}`;
  }
  return "unassigned";
};

const buildMatchKey = (task: ExtractedTaskSchema) => {
  const titleKey = normalizeTitleKey(task.title);
  if (!titleKey) return "";
  return `${titleKey}|${buildAssigneeKey(task)}`;
};

const collectTaskKeys = (tasks: ExtractedTaskSchema[], keys: Set<string>) => {
  tasks.forEach((task: any) => {
    const key = buildMatchKey(task);
    if (key) keys.add(key);
    if (task.subtasks?.length) {
      collectTaskKeys(task.subtasks, keys);
    }
  });
};

const tokenizeTaskText = (task: ExtractedTaskSchema): Set<string> => {
  const parts = [task.title, task.description]
    .map((value: any) => (typeof value === "string" ? value : ""))
    .filter(Boolean)
    .join(" ");
  const normalized = normalizeTitleKey(parts);
  if (!normalized) return new Set();
  return new Set(
    normalized
      .split(" ")
      .map((token: any) => token.trim())
      .filter((token: any) => token && !TASK_TOKEN_STOPWORDS.has(token))
  );
};

const tokenOverlapRatio = (a: Set<string>, b: Set<string>) => {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) {
    if (b.has(token)) shared += 1;
  }
  return shared / Math.min(a.size, b.size);
};

const mergeNewTasks = (
  existing: ExtractedTaskSchema[],
  incoming: ExtractedTaskSchema[]
) => {
  const merged = [...existing];
  const keys = new Set<string>();
  collectTaskKeys(existing, keys);
  const tokenSets = existing.map((task: any) => tokenizeTaskText(task));

  let added = 0;
  incoming.forEach((task: any) => {
    const normalized = normalizeTask(task);
    const status = normalized.status || "todo";
    if (status === "done") {
      return;
    }
    const key = buildMatchKey(normalized);
    if (!key || keys.has(key)) {
      return;
    }
    const incomingTokens = tokenizeTaskText(normalized);
    const overlapsExisting = tokenSets.some(
      (tokens) => tokenOverlapRatio(tokens, incomingTokens) >= 0.65
    );
    if (overlapsExisting) {
      return;
    }
    keys.add(key);
    merged.push(normalized);
    tokenSets.push(incomingTokens);
    added += 1;
  });

  return { tasks: merged, added };
};

const buildCompletionUpdateMap = (
  suggestions: ExtractedTaskSchema[],
  autoApprove: boolean,
  minMatchRatio: number
) => {
  const updates = new Map<string, CompletionUpdate>();

  suggestions.forEach((suggestion: any) => {
    const targets = suggestion.completionTargets || [];
    if (!targets.length) return;

    const confidence =
      typeof suggestion.completionConfidence === "number" &&
      Number.isFinite(suggestion.completionConfidence)
        ? suggestion.completionConfidence
        : null;
    const shouldAutoApprove =
      confidence !== null && confidence >= minMatchRatio;
    const completionSuggested = autoApprove ? !shouldAutoApprove : true;

    targets.forEach((target: any) => {
      if (!target?.taskId) return;
      const existing = updates.get(target.taskId);
      const nextUpdate: CompletionUpdate = {
        completionSuggested,
        completionConfidence: confidence ?? null,
        completionEvidence: suggestion.completionEvidence ?? null,
        completionTargets: suggestion.completionTargets ?? null,
      };
      const existingConfidence = existing?.completionConfidence ?? 0;
      const nextConfidence = nextUpdate.completionConfidence ?? 0;
      if (!existing || nextConfidence >= existingConfidence) {
        updates.set(target.taskId, nextUpdate);
      }
    });
  });

  return updates;
};

const shouldRequireReview = (
  suggestion: ExtractedTaskSchema,
  autoApprove: boolean,
  minMatchRatio: number
) => {
  if (!autoApprove) return true;
  const confidence =
    typeof suggestion.completionConfidence === "number" &&
    Number.isFinite(suggestion.completionConfidence)
      ? suggestion.completionConfidence
      : null;
  if (confidence === null) return true;
  return confidence < minMatchRatio;
};

const applyCompletionUpdates = (
  tasks: ExtractedTaskSchema[],
  updates: Map<string, CompletionUpdate>,
  appliedIds: Set<string>
) => {
  let updated = false;

  const walk = (items: ExtractedTaskSchema[]): ExtractedTaskSchema[] =>
    items.map((task: any) => {
      let nextTask = task;
      let changed = false;

      if (task.subtasks?.length) {
        const updatedSubtasks = walk(task.subtasks);
        if (updatedSubtasks !== task.subtasks) {
          nextTask = { ...nextTask, subtasks: updatedSubtasks };
          changed = true;
        }
      }

      const update = updates.get(task.id);
      if (update) {
        const alreadyDone = (task.status || "todo") === "done";
        if (!alreadyDone || task.completionSuggested) {
          const nextStatus = update.completionSuggested
            ? task.status || "todo"
            : "done";
          nextTask = {
            ...nextTask,
            status: nextStatus,
            completionSuggested: update.completionSuggested,
            completionConfidence: update.completionConfidence ?? null,
            completionEvidence: update.completionEvidence ?? null,
            completionTargets: update.completionTargets ?? null,
          };
          appliedIds.add(task.id);
          changed = true;
          updated = true;
        }
      }

      return changed ? nextTask : task;
    });

  return { tasks: walk(tasks), updated };
};

export const runMeetingRescanJob = async ({
  userId,
  meetingId,
  mode,
  correlationId,
  logger: baseLogger,
}: {
  userId: string;
  meetingId: string;
  mode: MeetingRescanMode;
  correlationId?: string;
  logger?: StructuredLogger;
}) => {
  const resolvedCorrelationId = ensureCorrelationId(correlationId);
  const logger = (baseLogger || createLogger({ scope: "jobs.meeting-rescan" })).child({
    correlationId: resolvedCorrelationId,
    userId,
    meetingId,
    mode,
  });
  const startedAtMs = Date.now();
  logger.info("jobs.meeting-rescan.started");

  const shouldScanNew = mode === "new" || mode === "both";
  const shouldScanCompleted = mode === "completed" || mode === "both";

  const db = await getDb();
  const userFilter = { $or: [{ _id: userId }, { id: userId }] };
  const user = await db.collection("users").findOne(userFilter);
  if (!user) {
    throw new ApiRouteError(404, "not_found", "User not found.");
  }

  const meetingFilter = {
    userId,
    $or: [{ _id: meetingId }, { id: meetingId }],
  };
  const meeting = await db.collection("meetings").findOne(meetingFilter);
  if (!meeting || meeting.isHidden) {
    throw new ApiRouteError(404, "not_found", "Meeting not found.");
  }

  const transcript =
    typeof meeting.originalTranscript === "string"
      ? meeting.originalTranscript.trim()
      : "";
  if (!transcript) {
    throw new ApiRouteError(400, "invalid_state", "Meeting transcript is missing.");
  }

  const detailLevel = resolveDetailLevel(user);
  const shouldAutoApprove = Boolean(user.autoApproveCompletedTasks);
  const completionMatchThreshold =
    typeof user.completionMatchThreshold === "number" &&
    Number.isFinite(user.completionMatchThreshold)
      ? Math.min(0.95, Math.max(0.4, user.completionMatchThreshold))
      : 0.6;
  const analysisResult = shouldScanNew
    ? await analyzeMeeting({ transcript, requestedDetailLevel: detailLevel })
    : null;
  // Completion detection is intentionally creation-only.
  // Meeting rescans should not re-run completion detection.
  const completionSuggestions: ExtractedTaskSchema[] = [];

  let updatedTasks: ExtractedTaskSchema[] = Array.isArray(meeting.extractedTasks)
    ? meeting.extractedTasks.map((task: any) => normalizeTask(task))
    : [];

  let newTasksAdded = 0;
  if (analysisResult && shouldScanNew) {
    const allTaskLevels = analysisResult.allTaskLevels || null;
    const selectedTasks = selectTasksForLevel(allTaskLevels, detailLevel);
    const normalizedNew = (selectedTasks || []).map((task: any) =>
      normalizeTask(task as ExtractedTaskSchema)
    );
    const merged = mergeNewTasks(updatedTasks, normalizedNew);
    updatedTasks = merged.tasks;
    newTasksAdded = merged.added;
  }

  const completionUpdates = buildCompletionUpdateMap(
    completionSuggestions,
    shouldAutoApprove,
    completionMatchThreshold
  );
  const appliedCompletionIds = new Set<string>();
  let reviewSuggestionsMerged = false;
  if (completionUpdates.size && shouldScanCompleted) {
    const completionApplied = applyCompletionUpdates(
      updatedTasks,
      completionUpdates,
      appliedCompletionIds
    );
    updatedTasks = completionApplied.tasks;
  }
  if (shouldScanCompleted && completionSuggestions.length) {
    const reviewSuggestions = completionSuggestions.filter((suggestion: any) =>
      shouldRequireReview(suggestion, shouldAutoApprove, completionMatchThreshold)
    );
    if (reviewSuggestions.length) {
      updatedTasks = mergeCompletionSuggestions(updatedTasks, reviewSuggestions);
      reviewSuggestionsMerged = true;
    }
  }

  const now = new Date();
  const update: Record<string, any> = {
    lastActivityAt: now,
  };
  const tasksChanged =
    newTasksAdded > 0 ||
    reviewSuggestionsMerged ||
    (completionUpdates.size > 0 && appliedCompletionIds.size > 0);
  if (tasksChanged) {
    update.extractedTasks = updatedTasks;
  }

  if (tasksChanged) {
    await db.collection("meetings").updateOne(meetingFilter, { $set: update });
  } else {
    await db.collection("meetings").updateOne(meetingFilter, {
      $set: { lastActivityAt: now },
    });
  }

  const updatedMeeting = await db.collection("meetings").findOne(meetingFilter);
  const workspaceId =
    updatedMeeting?.workspaceId || (await getWorkspaceIdForUser(db, userId));

  if (tasksChanged && updatedMeeting) {
    const sessionId = String(updatedMeeting._id ?? meetingId);
    const syncTasks = filterTasksForSessionSync(updatedTasks, "meeting", sessionId);
    await syncTasksForSource(db, syncTasks, {
      userId,
      workspaceId,
      sourceSessionId: sessionId,
      sourceSessionType: "meeting",
      sourceSessionName: updatedMeeting.title || "Meeting",
      origin: "meeting",
      taskState: "active",
    });
    const linkedSessions = await updateLinkedChatSessions(
      db,
      userId,
      updatedMeeting,
      updatedTasks
    );
    await cleanupChatTasksForSessions(db, userId, linkedSessions);
    if (workspaceId) {
      const defaultBoard = await ensureDefaultBoard(db, userId, workspaceId);
      await ensureBoardItemsForTasks(db, {
        userId,
        workspaceId,
        boardId: String(defaultBoard._id),
        tasks: syncTasks,
      });
    }
  }

  if (completionUpdates.size) {
    const sessionTargets = new Map<
      string,
      { type: "meeting" | "chat"; id: string; taskIds: Set<string> }
    >();

    completionSuggestions.forEach((suggestion: any) => {
      const targets = suggestion.completionTargets || [];
      targets.forEach((target: any) => {
        if (!target?.sourceSessionId || !target?.taskId) return;
        if (target.sourceType !== "meeting" && target.sourceType !== "chat") return;
        const key = `${target.sourceType}:${target.sourceSessionId}`;
        if (!sessionTargets.has(key)) {
          sessionTargets.set(key, {
            type: target.sourceType,
            id: target.sourceSessionId,
            taskIds: new Set<string>(),
          });
        }
        sessionTargets.get(key)?.taskIds.add(target.taskId);
      });
    });

    for (const session of sessionTargets.values()) {
      if (session.type === "meeting" && session.id === String(meeting._id ?? meetingId)) {
        continue;
      }

      if (session.type === "chat") {
        const chatFilter = {
          userId,
          $or: [{ _id: session.id }, { id: session.id }],
        };
        const chatSession = await db.collection("chatSessions").findOne(chatFilter);
        if (chatSession?.sourceMeetingId) {
          const linkedMeetingId = String(chatSession.sourceMeetingId);
          const meetingFilter = {
            userId,
            $or: [
              { _id: linkedMeetingId },
              { id: linkedMeetingId },
            ],
          };
          const linkedMeeting = await db
            .collection("meetings")
            .findOne(meetingFilter);
          if (!linkedMeeting) continue;
          const linkedWorkspaceId = linkedMeeting.workspaceId || workspaceId;
          let linkedTasks = Array.isArray(linkedMeeting.extractedTasks)
            ? linkedMeeting.extractedTasks.map((task: any) => normalizeTask(task))
            : [];
          const updatesForSession = new Map(
            Array.from(session.taskIds).map((taskId: any) => [
              taskId,
              completionUpdates.get(taskId),
            ])
          );
          const filteredUpdates = new Map(
            Array.from(updatesForSession.entries()).filter(
              ([, update]) => update
            ) as Array<[string, CompletionUpdate]>
          );
          if (!filteredUpdates.size) continue;
          const completionApplied = applyCompletionUpdates(
            linkedTasks,
            filteredUpdates,
            appliedCompletionIds
          );
          if (completionApplied.updated) {
            linkedTasks = completionApplied.tasks;
            await db.collection("meetings").updateOne(meetingFilter, {
              $set: { extractedTasks: linkedTasks, lastActivityAt: now },
            });
            const syncTasks = filterTasksForSessionSync(
              linkedTasks,
              "meeting",
              linkedMeetingId
            );
            await syncTasksForSource(db, syncTasks, {
              userId,
              workspaceId: linkedWorkspaceId,
              sourceSessionId: String(linkedMeeting._id ?? linkedMeetingId),
              sourceSessionType: "meeting",
              sourceSessionName: linkedMeeting.title || "Meeting",
              origin: "meeting",
              taskState: "active",
            });
            const linkedSessions = await updateLinkedChatSessions(
              db,
              userId,
              linkedMeeting,
              linkedTasks
            );
            await cleanupChatTasksForSessions(db, userId, linkedSessions);
            if (linkedWorkspaceId) {
              const defaultBoard = await ensureDefaultBoard(
                db,
                userId,
                linkedWorkspaceId
              );
              await ensureBoardItemsForTasks(db, {
                userId,
                workspaceId: linkedWorkspaceId,
                boardId: String(defaultBoard._id),
                tasks: syncTasks,
              });
            }
          }
          continue;
        }
      }

      if (session.type === "meeting") {
        const meetingFilter = {
          userId,
          $or: [{ _id: session.id }, { id: session.id }],
        };
        const otherMeeting = await db.collection("meetings").findOne(meetingFilter);
        if (!otherMeeting) continue;
        const otherWorkspaceId = otherMeeting.workspaceId || workspaceId;
        const updatesForSession = new Map(
          Array.from(session.taskIds).map((taskId: any) => [
            taskId,
            completionUpdates.get(taskId),
          ])
        );
        const filteredUpdates = new Map(
          Array.from(updatesForSession.entries()).filter(
            ([, update]) => update
          ) as Array<[string, CompletionUpdate]>
        );
        if (!filteredUpdates.size) continue;
        let otherTasks = Array.isArray(otherMeeting.extractedTasks)
          ? otherMeeting.extractedTasks.map((task: any) => normalizeTask(task))
          : [];
        const completionApplied = applyCompletionUpdates(
          otherTasks,
          filteredUpdates,
          appliedCompletionIds
        );
        if (completionApplied.updated) {
          otherTasks = completionApplied.tasks;
          await db.collection("meetings").updateOne(meetingFilter, {
            $set: { extractedTasks: otherTasks, lastActivityAt: now },
          });
          const syncTasks = filterTasksForSessionSync(
            otherTasks,
            "meeting",
            session.id
          );
          await syncTasksForSource(db, syncTasks, {
            userId,
            workspaceId: otherWorkspaceId,
            sourceSessionId: String(otherMeeting._id ?? session.id),
            sourceSessionType: "meeting",
            sourceSessionName: otherMeeting.title || "Meeting",
            origin: "meeting",
            taskState: "active",
          });
          const linkedSessions = await updateLinkedChatSessions(
            db,
            userId,
            otherMeeting,
            otherTasks
          );
          await cleanupChatTasksForSessions(db, userId, linkedSessions);
          if (otherWorkspaceId) {
            const defaultBoard = await ensureDefaultBoard(
              db,
              userId,
              otherWorkspaceId
            );
            await ensureBoardItemsForTasks(db, {
              userId,
              workspaceId: otherWorkspaceId,
              boardId: String(defaultBoard._id),
              tasks: syncTasks,
            });
          }
        }
        continue;
      }

      if (session.type === "chat") {
        const chatFilter = {
          userId,
          $or: [{ _id: session.id }, { id: session.id }],
        };
        const chatSession = await db.collection("chatSessions").findOne(chatFilter);
        if (!chatSession) continue;
        const updatesForSession = new Map(
          Array.from(session.taskIds).map((taskId: any) => [
            taskId,
            completionUpdates.get(taskId),
          ])
        );
        const filteredUpdates = new Map(
          Array.from(updatesForSession.entries()).filter(
            ([, update]) => update
          ) as Array<[string, CompletionUpdate]>
        );
        if (!filteredUpdates.size) continue;
        let chatTasks = Array.isArray(chatSession.suggestedTasks)
          ? chatSession.suggestedTasks.map((task: any) => normalizeTask(task))
          : [];
        const completionApplied = applyCompletionUpdates(
          chatTasks,
          filteredUpdates,
          appliedCompletionIds
        );
        if (completionApplied.updated) {
          chatTasks = completionApplied.tasks;
          await db.collection("chatSessions").updateOne(chatFilter, {
            $set: { suggestedTasks: chatTasks, lastActivityAt: now },
          });
        }
      }
    }
  }

  if (completionUpdates.size) {
    const taskIds = Array.from(completionUpdates.keys()).filter(Boolean);
    const existingTasks = await db
      .collection("tasks")
      .find({
        userId,
        $or: [
          { _id: { $in: taskIds } },
          { id: { $in: taskIds } },
          { sourceTaskId: { $in: taskIds } },
        ],
      })
      .project({ _id: 1, id: 1, status: 1, completionSuggested: 1 })
      .toArray();

    const skipIds = new Set<string>();
    existingTasks.forEach((task: any) => {
      const alreadyDone = task?.status === "done" && !task?.completionSuggested;
      if (!alreadyDone) return;
      if (task?._id) skipIds.add(String(task._id));
      if (task?.id) skipIds.add(String(task.id));
    });

    const boardUpdateIds = new Set<string>();
    const updateOperations = taskIds.map((taskId: any) => {
      const updateFields = completionUpdates.get(taskId);
      if (!updateFields) return null;
      if (skipIds.has(taskId)) return null;
      appliedCompletionIds.add(taskId);
      if (!updateFields.completionSuggested) {
        boardUpdateIds.add(taskId);
      }
      const setFields: Record<string, any> = {
        completionSuggested: updateFields.completionSuggested,
        completionConfidence: updateFields.completionConfidence ?? null,
        completionEvidence: updateFields.completionEvidence ?? null,
        completionTargets: updateFields.completionTargets ?? null,
        lastUpdated: now,
      };
      if (!updateFields.completionSuggested) {
        setFields.status = "done";
      }
      return {
        updateOne: {
          filter: {
            userId,
            $or: [
              { _id: taskId },
              { id: taskId },
              { sourceTaskId: taskId },
            ],
          },
          update: { $set: setFields },
        },
      };
    });
    const filteredOps = updateOperations.filter(Boolean);
    if (filteredOps.length) {
      await db.collection("tasks").bulkWrite(filteredOps as any[], {
        ordered: false,
      });
    }
    await Promise.all(
      Array.from(boardUpdateIds).map((taskId: any) =>
        syncBoardItemsToStatusByTaskId(db, userId, taskId, "done")
      )
    );
  }

  const result = {
    meeting: updatedMeeting ? serializeMeeting(updatedMeeting) : null,
    stats: {
      mode,
      newTasksAdded,
      completionUpdates: appliedCompletionIds.size || completionUpdates.size,
      autoApproved: shouldAutoApprove,
    },
    debug: null,
  };

  logger.info("jobs.meeting-rescan.succeeded", {
    durationMs: Date.now() - startedAtMs,
    newTasksAdded,
    completionUpdates: appliedCompletionIds.size || completionUpdates.size,
    tasksChanged,
  });

  return result;
};


