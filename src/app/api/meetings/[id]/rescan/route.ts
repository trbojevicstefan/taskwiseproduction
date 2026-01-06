import { NextResponse } from "next/server";
import { analyzeMeeting } from "@/ai/flows/analyze-meeting-flow";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { buildIdQuery } from "@/lib/mongo-id";
import { normalizeTask } from "@/lib/data";
import { normalizeTitleKey } from "@/lib/ai-utils";
import { normalizePersonNameKey } from "@/lib/transcript-utils";
import { buildCompletionSuggestions } from "@/lib/task-completion";
import { syncTasksForSource } from "@/lib/task-sync";
import { ensureDefaultBoard } from "@/lib/boards";
import { ensureBoardItemsForTasks } from "@/lib/board-items";
import { getWorkspaceIdForUser } from "@/lib/workspace";
import type { CompletionTarget, ExtractedTaskSchema, TaskEvidence } from "@/types/chat";

type RescanMode = "completed" | "new" | "both";

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
  tasks.forEach((task) => {
    const key = buildMatchKey(task);
    if (key) keys.add(key);
    if (task.subtasks?.length) {
      collectTaskKeys(task.subtasks, keys);
    }
  });
};

const mergeNewTasks = (
  existing: ExtractedTaskSchema[],
  incoming: ExtractedTaskSchema[]
) => {
  const merged = [...existing];
  const keys = new Set<string>();
  collectTaskKeys(existing, keys);

  let added = 0;
  incoming.forEach((task) => {
    const normalized = normalizeTask(task);
    const status = normalized.status || "todo";
    if (status === "done") {
      return;
    }
    const key = buildMatchKey(normalized);
    if (!key || keys.has(key)) {
      return;
    }
    keys.add(key);
    merged.push(normalized);
    added += 1;
  });

  return { tasks: merged, added };
};

const buildCompletionUpdateMap = (
  suggestions: ExtractedTaskSchema[],
  autoApprove: boolean
) => {
  const updates = new Map<string, CompletionUpdate>();

  suggestions.forEach((suggestion) => {
    const targets = suggestion.completionTargets || [];
    if (!targets.length) return;

    targets.forEach((target) => {
      if (!target?.taskId) return;
      const existing = updates.get(target.taskId);
      const nextUpdate: CompletionUpdate = {
        completionSuggested: !autoApprove,
        completionConfidence: suggestion.completionConfidence ?? null,
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

const applyCompletionUpdates = (
  tasks: ExtractedTaskSchema[],
  updates: Map<string, CompletionUpdate>,
  appliedIds: Set<string>
) => {
  let updated = false;

  const walk = (items: ExtractedTaskSchema[]): ExtractedTaskSchema[] =>
    items.map((task) => {
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
          nextTask = {
            ...nextTask,
            status: "done",
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

const updateLinkedChatSessions = async (
  db: any,
  userId: string,
  meeting: any,
  tasks: ExtractedTaskSchema[]
) => {
  const meetingIds = new Set<string>();
  if (meeting?._id) meetingIds.add(String(meeting._id));
  if (meeting?.id) meetingIds.add(String(meeting.id));
  const chatFilters: any[] = [];
  if (meeting?.chatSessionId) {
    const chatId = String(meeting.chatSessionId);
    chatFilters.push({ _id: buildIdQuery(chatId) }, { id: chatId });
  }
  if (meetingIds.size > 0) {
    chatFilters.push({ sourceMeetingId: { $in: Array.from(meetingIds) } });
  }
  if (!chatFilters.length) return [];

  const userIdQuery = buildIdQuery(userId);
  const filter = { userId: userIdQuery, $or: chatFilters };
  const sessions = await db.collection<any>("chatSessions").find(filter).toArray();
  if (!sessions.length) return [];

  await db.collection<any>("chatSessions").updateMany(filter, {
    $set: { suggestedTasks: tasks, lastActivityAt: new Date() },
  });
  return sessions;
};

const cleanupChatTasksForSessions = async (
  db: any,
  userId: string,
  sessions: any[]
) => {
  if (!sessions.length) return;
  const sessionIds = new Set<string>();
  sessions.forEach((session) => {
    if (session?._id) sessionIds.add(String(session._id));
    if (session?.id) sessionIds.add(String(session.id));
  });
  if (!sessionIds.size) return;
  const userIdQuery = buildIdQuery(userId);
  await db.collection<any>("tasks").deleteMany({
    userId: userIdQuery,
    sourceSessionType: "chat",
    sourceSessionId: { $in: Array.from(sessionIds) },
  });
};

const syncBoardItemsToStatus = async (
  db: any,
  userId: string,
  taskId: string,
  nextStatus: string
) => {
  if (!taskId || !nextStatus) return;
  const userIdQuery = buildIdQuery(userId);
  const items = await db
    .collection<any>("boardItems")
    .find({ userId: userIdQuery, taskId })
    .toArray();
  if (!items.length) return;

  const boardIds = Array.from(new Set(items.map((item) => String(item.boardId))));
  const statuses = await db
    .collection<any>("boardStatuses")
    .find({
      userId: userIdQuery,
      boardId: { $in: boardIds },
      category: nextStatus,
    })
    .toArray();
  if (!statuses.length) return;

  const statusByBoard = new Map<string, string>();
  statuses.forEach((status) => {
    const boardId = String(status.boardId);
    const statusId = status._id?.toString?.() || status._id;
    statusByBoard.set(boardId, statusId);
  });

  const now = new Date();
  const rankByStatus = new Map<string, number>();
  for (const status of statuses) {
    const boardId = String(status.boardId);
    const statusId = status._id?.toString?.() || status._id;
    const key = `${boardId}:${statusId}`;
    const lastItem = await db
      .collection<any>("boardItems")
      .find({ userId: userIdQuery, boardId, statusId })
      .sort({ rank: -1 })
      .limit(1)
      .toArray();
    const baseRank = typeof lastItem[0]?.rank === "number" ? lastItem[0].rank : 0;
    rankByStatus.set(key, baseRank);
  }

  const operations = items
    .map((item) => {
      const boardId = String(item.boardId);
      const targetStatusId = statusByBoard.get(boardId);
      if (!targetStatusId) return null;
      const key = `${boardId}:${targetStatusId}`;
      const nextRank = (rankByStatus.get(key) || 0) + 1000;
      rankByStatus.set(key, nextRank);
      return {
        updateOne: {
          filter: { _id: item._id },
          update: {
            $set: {
              statusId: targetStatusId,
              rank: nextRank,
              updatedAt: now,
            },
          },
        },
      };
    })
    .filter(Boolean);

  if (operations.length) {
    await db.collection<any>("boardItems").bulkWrite(operations as any[], {
      ordered: false,
    });
  }
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const mode: RescanMode =
    body?.mode === "completed" || body?.mode === "new" || body?.mode === "both"
      ? body.mode
      : "both";
  const shouldScanNew = mode === "new" || mode === "both";
  const shouldScanCompleted = mode === "completed" || mode === "both";

  const db = await getDb();
  const userIdQuery = buildIdQuery(userId);
  const user = await db.collection<any>("users").findOne({ _id: userIdQuery });
  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  const idQuery = buildIdQuery(id);
  const meetingFilter = {
    userId: userIdQuery,
    $or: [{ _id: idQuery }, { id }],
  };
  const meeting = await db.collection<any>("meetings").findOne(meetingFilter);
  if (!meeting || meeting.isHidden) {
    return NextResponse.json({ error: "Meeting not found." }, { status: 404 });
  }

  const transcript =
    typeof meeting.originalTranscript === "string"
      ? meeting.originalTranscript.trim()
      : "";
  if (!transcript) {
    return NextResponse.json(
      { error: "Meeting transcript is missing." },
      { status: 400 }
    );
  }

  const detailLevel = resolveDetailLevel(user);
  const shouldAutoApprove = Boolean(user.autoApproveCompletedTasks);
  const completionMatchThreshold =
    typeof user.completionMatchThreshold === "number" &&
    Number.isFinite(user.completionMatchThreshold)
      ? Math.min(0.95, Math.max(0.4, user.completionMatchThreshold))
      : 0.6;

  const [analysisResult, completionSuggestions] = await Promise.all([
    shouldScanNew
      ? analyzeMeeting({ transcript, requestedDetailLevel: detailLevel })
      : Promise.resolve(null),
    shouldScanCompleted
      ? buildCompletionSuggestions({
          userId,
          transcript,
          attendees: [],
          requireAttendeeMatch: false,
          minMatchRatio: completionMatchThreshold,
        })
      : Promise.resolve([] as ExtractedTaskSchema[]),
  ]);

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
    shouldAutoApprove
  );
  const appliedCompletionIds = new Set<string>();
  if (completionUpdates.size && shouldScanCompleted) {
    const completionApplied = applyCompletionUpdates(
      updatedTasks,
      completionUpdates,
      appliedCompletionIds
    );
    updatedTasks = completionApplied.tasks;
  }

  const now = new Date();
  const update: Record<string, any> = {
    lastActivityAt: now,
  };
  const tasksChanged =
    newTasksAdded > 0 || (completionUpdates.size > 0 && appliedCompletionIds.size > 0);
  if (tasksChanged) {
    update.extractedTasks = updatedTasks;
  }

  if (tasksChanged) {
    await db.collection<any>("meetings").updateOne(meetingFilter, { $set: update });
  } else {
    await db.collection<any>("meetings").updateOne(meetingFilter, {
      $set: { lastActivityAt: now },
    });
  }

  const updatedMeeting = await db.collection<any>("meetings").findOne(meetingFilter);
  const workspaceId =
    updatedMeeting?.workspaceId || (await getWorkspaceIdForUser(db, userId));

  if (tasksChanged && updatedMeeting) {
    await syncTasksForSource(db, updatedTasks, {
      userId,
      workspaceId,
      sourceSessionId: String(updatedMeeting._id ?? id),
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
        boardId: defaultBoard._id,
        tasks: updatedTasks,
      });
    }
  }

  if (completionUpdates.size) {
    const sessionTargets = new Map<
      string,
      { type: "meeting" | "chat"; id: string; taskIds: Set<string> }
    >();

    completionSuggestions.forEach((suggestion) => {
      const targets = suggestion.completionTargets || [];
      targets.forEach((target) => {
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
      if (session.type === "meeting" && session.id === String(meeting._id ?? id)) {
        continue;
      }

      if (session.type === "chat") {
        const chatFilter = {
          userId: userIdQuery,
          $or: [{ _id: buildIdQuery(session.id) }, { id: session.id }],
        };
        const chatSession = await db.collection<any>("chatSessions").findOne(chatFilter);
        if (chatSession?.sourceMeetingId) {
          const linkedMeetingId = String(chatSession.sourceMeetingId);
          const meetingFilter = {
            userId: userIdQuery,
            $or: [
              { _id: buildIdQuery(linkedMeetingId) },
              { id: linkedMeetingId },
            ],
          };
          const linkedMeeting = await db
            .collection<any>("meetings")
            .findOne(meetingFilter);
          if (!linkedMeeting) continue;
          const linkedWorkspaceId = linkedMeeting.workspaceId || workspaceId;
          let linkedTasks = Array.isArray(linkedMeeting.extractedTasks)
            ? linkedMeeting.extractedTasks.map((task: any) => normalizeTask(task))
            : [];
          const updatesForSession = new Map(
            Array.from(session.taskIds).map((taskId) => [
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
            await db.collection<any>("meetings").updateOne(meetingFilter, {
              $set: { extractedTasks: linkedTasks, lastActivityAt: now },
            });
            await syncTasksForSource(db, linkedTasks, {
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
                boardId: defaultBoard._id,
                tasks: linkedTasks,
              });
            }
          }
          continue;
        }
      }

      if (session.type === "meeting") {
        const meetingFilter = {
          userId: userIdQuery,
          $or: [{ _id: buildIdQuery(session.id) }, { id: session.id }],
        };
        const otherMeeting = await db.collection<any>("meetings").findOne(meetingFilter);
        if (!otherMeeting) continue;
        const otherWorkspaceId = otherMeeting.workspaceId || workspaceId;
        const updatesForSession = new Map(
          Array.from(session.taskIds).map((taskId) => [
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
          await db.collection<any>("meetings").updateOne(meetingFilter, {
            $set: { extractedTasks: otherTasks, lastActivityAt: now },
          });
          await syncTasksForSource(db, otherTasks, {
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
              boardId: defaultBoard._id,
              tasks: otherTasks,
            });
          }
        }
        continue;
      }

      if (session.type === "chat") {
        const chatFilter = {
          userId: userIdQuery,
          $or: [{ _id: buildIdQuery(session.id) }, { id: session.id }],
        };
        const chatSession = await db.collection<any>("chatSessions").findOne(chatFilter);
        if (!chatSession) continue;
        const updatesForSession = new Map(
          Array.from(session.taskIds).map((taskId) => [
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
          await db.collection<any>("chatSessions").updateOne(chatFilter, {
            $set: { suggestedTasks: chatTasks, lastActivityAt: now },
          });
        }
      }
    }
  }

  if (completionUpdates.size) {
    const taskIds = Array.from(completionUpdates.keys()).filter(Boolean);
    const existingTasks = await db
      .collection<any>("tasks")
      .find({
        userId: userIdQuery,
        $or: [
          { _id: { $in: taskIds } },
          { id: { $in: taskIds } },
          { sourceTaskId: { $in: taskIds } },
        ],
      })
      .project({ _id: 1, id: 1, status: 1, completionSuggested: 1 })
      .toArray();

    const skipIds = new Set<string>();
    existingTasks.forEach((task) => {
      const alreadyDone = task?.status === "done" && !task?.completionSuggested;
      if (!alreadyDone) return;
      if (task?._id) skipIds.add(String(task._id));
      if (task?.id) skipIds.add(String(task.id));
    });

    const boardUpdateIds = new Set<string>();
    const updateOperations = taskIds.map((taskId) => {
      const updateFields = completionUpdates.get(taskId);
      if (!updateFields) return null;
      if (skipIds.has(taskId)) return null;
      appliedCompletionIds.add(taskId);
      boardUpdateIds.add(taskId);
      return {
        updateOne: {
          filter: {
            userId: userIdQuery,
            $or: [
              { _id: buildIdQuery(taskId) },
              { id: taskId },
              { sourceTaskId: taskId },
            ],
          },
          update: {
            $set: {
              status: "done",
              completionSuggested: updateFields.completionSuggested,
              completionConfidence: updateFields.completionConfidence ?? null,
              completionEvidence: updateFields.completionEvidence ?? null,
              completionTargets: updateFields.completionTargets ?? null,
              lastUpdated: now,
            },
          },
        },
      };
    });
    const filteredOps = updateOperations.filter(Boolean);
    if (filteredOps.length) {
      await db.collection<any>("tasks").bulkWrite(filteredOps as any[], {
        ordered: false,
      });
    }
    await Promise.all(
      Array.from(boardUpdateIds).map((taskId) =>
        syncBoardItemsToStatus(db, userId, taskId, "done")
      )
    );
  }

  return NextResponse.json({
    meeting: updatedMeeting ? serializeMeeting(updatedMeeting) : null,
    stats: {
      mode,
      newTasksAdded,
      completionUpdates: appliedCompletionIds.size || completionUpdates.size,
      autoApproved: shouldAutoApprove,
    },
  });
}
