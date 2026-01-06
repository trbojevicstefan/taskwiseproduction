import { randomUUID } from "crypto";
import { analyzeMeeting } from "@/ai/flows/analyze-meeting-flow";
import { getDb } from "@/lib/db";
import {
  fetchFathomSummary,
  fetchFathomTranscript,
  formatFathomTranscript,
  hashFathomRecordingId,
} from "@/lib/fathom";
import { normalizeTask } from "@/lib/data";
import type { ExtractedTaskSchema } from "@/types/chat";
import type { DbUser } from "@/lib/db/users";
import {
  buildCompletionSuggestions,
  mergeCompletionSuggestions,
  type CompletionTarget,
} from "@/lib/task-completion";
import { buildIdQuery } from "@/lib/mongo-id";
import { upsertPeopleFromAttendees } from "@/lib/people-sync";
import { syncTasksForSource } from "@/lib/task-sync";
import { ensureDefaultBoard } from "@/lib/boards";
import { ensureBoardItemsForTasks } from "@/lib/board-items";

type FathomIngestResult =
  | { status: "created"; meetingId: string }
  | { status: "duplicate"; meetingId: string }
  | { status: "no_transcript" };

const pickFirst = (...values: Array<string | null | undefined>) =>
  values.find((value) => value && value.trim()) || null;

const toDateOrNull = (value: any) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const sanitizeLevels = (levels: any) =>
  levels
    ? {
        light: (levels.light || []).map((task: any) =>
          normalizeTask(task as ExtractedTaskSchema)
        ),
        medium: (levels.medium || []).map((task: any) =>
          normalizeTask(task as ExtractedTaskSchema)
        ),
        detailed: (levels.detailed || []).map((task: any) =>
          normalizeTask(task as ExtractedTaskSchema)
        ),
      }
    : null;

const resolveDetailLevel = (user: DbUser): "light" | "medium" | "detailed" => {
  const preference = user.taskGranularityPreference;
  if (preference === "light" || preference === "medium" || preference === "detailed") {
    return preference;
  }
  return "medium";
};

const resolveCompletionMatchThreshold = (user: DbUser): number => {
  const value = user.completionMatchThreshold;
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(0.95, Math.max(0.4, value));
  }
  return 0.6;
};

const resolveSummaryText = (payload: any, summaryPayload: any) => {
  const payloadSummary =
    payload?.default_summary?.markdown_formatted ||
    payload?.default_summary?.markdownFormatted ||
    payload?.summary ||
    payload?.recording?.summary;
  const payloadSummaryText =
    typeof payloadSummary === "string"
      ? payloadSummary
      : payloadSummary?.markdown_formatted ||
        payloadSummary?.markdownFormatted ||
        payloadSummary?.text ||
        payloadSummary?.summary ||
        null;
  const summaryText =
    typeof summaryPayload === "string"
      ? summaryPayload
      : summaryPayload?.markdown_formatted ||
        summaryPayload?.markdownFormatted ||
        summaryPayload?.text ||
        summaryPayload?.summary ||
        null;
  return pickFirst(payloadSummaryText, summaryText);
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

const updateTaskStatusInList = (
  tasks: ExtractedTaskSchema[],
  taskId: string,
  status: ExtractedTaskSchema["status"]
) => {
  let updated = false;
  const walk = (items: ExtractedTaskSchema[]): ExtractedTaskSchema[] =>
    items.map((task) => {
      let nextTask = task;
      let childUpdated = false;

      if (task.subtasks && task.subtasks.length) {
        const updatedSubtasks = walk(task.subtasks);
        if (updatedSubtasks !== task.subtasks) {
          childUpdated = true;
          nextTask = { ...nextTask, subtasks: updatedSubtasks };
        }
      }

      if (task.id === taskId) {
        updated = true;
        return { ...nextTask, status, completionSuggested: false };
      }

      if (childUpdated) {
        updated = true;
        return nextTask;
      }

      return task;
    });

  const nextTasks = walk(tasks);
  return { tasks: nextTasks, updated };
};

const applyAutoApprovalFlags = (tasks: ExtractedTaskSchema[]) => {
  const walk = (items: ExtractedTaskSchema[]): ExtractedTaskSchema[] =>
    items.map((task) => {
      const nextTask = {
        ...task,
        subtasks: task.subtasks ? walk(task.subtasks) : task.subtasks,
      };
      if (nextTask.completionSuggested) {
        return { ...nextTask, status: "done", completionSuggested: false };
      }
      return nextTask;
    });
  return walk(tasks);
};

const applyCompletionTargets = async (
  db: Awaited<ReturnType<typeof getDb>>,
  userId: string,
  suggestions: ExtractedTaskSchema[]
) => {
  const allTargets: CompletionTarget[] = [];
  suggestions.forEach((suggestion) => {
    if (suggestion.completionTargets?.length) {
      allTargets.push(...suggestion.completionTargets);
    }
  });
  if (!allTargets.length) return;

  const uniqueTargets = Array.from(
    new Map(
      allTargets.map((target) => [
        `${target.sourceType}:${target.sourceSessionId}:${target.taskId}`,
        target,
      ])
    ).values()
  );

  const userIdQuery = buildIdQuery(userId);
  const taskTargets = uniqueTargets.filter((target) => target.sourceType === "task");
  if (taskTargets.length) {
    const taskIds = Array.from(
      new Set(taskTargets.map((target) => target.taskId))
    );
    await db.collection("tasks").updateMany(
      {
        userId: userIdQuery,
        $or: [{ _id: { $in: taskIds } }, { id: { $in: taskIds } }],
      },
      { $set: { status: "done" } }
    );
  }

  const updateSessionTasks = async (
    collectionName: "meetings" | "chatSessions",
    taskField: "extractedTasks" | "suggestedTasks",
    target: CompletionTarget
  ) => {
    const sessionIdQuery = buildIdQuery(target.sourceSessionId);
    const filter = {
      userId: userIdQuery,
      $or: [{ _id: sessionIdQuery }, { id: target.sourceSessionId }],
    };
    const session = await db.collection<any>(collectionName).findOne(filter);
    if (!session) return;
    const currentTasks = session[taskField] || [];
    const { tasks, updated } = updateTaskStatusInList(
      currentTasks,
      target.taskId,
      "done"
    );
    if (!updated) return;
    await db.collection<any>(collectionName).updateOne(filter, {
      $set: { [taskField]: tasks, lastActivityAt: new Date() },
    });
  };

  const updateTaskCollectionForSessionTarget = async (target: CompletionTarget) => {
    const sessionIdQuery = buildIdQuery(target.sourceSessionId);
    const taskIdQuery = buildIdQuery(target.taskId);
    await db.collection("tasks").updateMany(
      {
        userId: userIdQuery,
        sourceSessionType: target.sourceType,
        $and: [
          {
            $or: [
              { sourceSessionId: sessionIdQuery },
              { sourceSessionId: target.sourceSessionId },
            ],
          },
          {
            $or: [
              { _id: taskIdQuery },
              { sourceTaskId: target.taskId },
              { sourceTaskId: taskIdQuery },
            ],
          },
        ],
      },
      { $set: { status: "done", completionSuggested: false, lastUpdated: new Date() } }
    );
  };

  for (const target of uniqueTargets) {
    if (target.sourceType === "meeting") {
      await updateSessionTasks("meetings", "extractedTasks", target);
      await updateTaskCollectionForSessionTarget(target);
    } else if (target.sourceType === "chat") {
      await updateSessionTasks("chatSessions", "suggestedTasks", target);
      await updateTaskCollectionForSessionTarget(target);
    }
  }
};

export const ingestFathomMeeting = async ({
  user,
  recordingId,
  data,
  accessToken,
}: {
  user: DbUser;
  recordingId: string;
  data?: any;
  accessToken: string;
}): Promise<FathomIngestResult> => {
  const db = await getDb();
  const userId = user._id.toString();
  const userIdQuery = buildIdQuery(userId);
  const recordingIdHash = hashFathomRecordingId(userId, recordingId);
  const existing = await db
    .collection<any>("meetings")
    .findOne({
      userId: userIdQuery,
      $or: [{ recordingIdHash }, { recordingId }],
    });
  if (existing) {
    const payload = data || {};
    const update: Record<string, any> = {
      lastActivityAt: new Date(),
      recordingIdHash,
      ingestSource: existing.ingestSource || "fathom",
    };
    const existingTranscript =
      typeof existing.originalTranscript === "string"
        ? existing.originalTranscript.trim()
        : "";
    let transcriptText = "";

    if (!existingTranscript) {
      let transcriptPayload =
        payload.transcript ||
        payload.transcript_segments ||
        payload?.recording?.transcript ||
        payload?.recording?.transcript_segments;
      if (!transcriptPayload) {
        transcriptPayload = await fetchFathomTranscript(recordingId, accessToken).catch(
          () => null
        );
      }
      transcriptText = formatFathomTranscript(transcriptPayload);
      if (transcriptText) {
        update.originalTranscript = transcriptText;
      }
    } else {
      transcriptText = existingTranscript;
    }

    const existingSummary =
      typeof existing.summary === "string" ? existing.summary.trim() : "";
    if (!existingSummary) {
      const summaryPayload =
        payload.summary ||
        payload?.recording?.summary ||
        (await fetchFathomSummary(recordingId, accessToken).catch(() => null));
      const summaryText = resolveSummaryText(payload, summaryPayload);
      if (summaryText) {
        update.summary = summaryText;
      }
    }

    const recordingUrl = pickFirst(
      payload.url,
      payload.meeting_url,
      payload?.recording?.url
    );
    if (recordingUrl && !existing.recordingUrl) {
      update.recordingUrl = recordingUrl;
    }
    const shareUrl = pickFirst(
      payload.share_url,
      payload.meeting_share_url,
      payload?.recording?.share_url
    );
    if (shareUrl && !existing.shareUrl) {
      update.shareUrl = shareUrl;
    }

    const startTime = toDateOrNull(
      payload.recording_start_time ||
        payload.start_time ||
        payload.started_at ||
        payload?.recording?.start_time ||
        payload.scheduled_start_time
    );
    if (startTime && !existing.startTime) {
      update.startTime = startTime;
    }
    const endTime = toDateOrNull(
      payload.recording_end_time ||
        payload.end_time ||
        payload.ended_at ||
        payload?.recording?.end_time ||
        payload.scheduled_end_time
    );
    if (endTime && !existing.endTime) {
      update.endTime = endTime;
    }
    const duration =
      payload.duration || payload.duration_seconds || payload?.recording?.duration;
    if (duration && !existing.duration) {
      update.duration = duration;
    }

    const updateOps: Record<string, any> = { $set: update };
    if (existing.recordingId) {
      updateOps.$unset = { recordingId: "" };
    }

    await db.collection<any>("meetings").updateOne(
      { _id: existing._id },
      updateOps
    );

    const workspaceId = existing.workspaceId || user.workspace?.id || null;
    const shouldReanalyze =
      !existing.extractedTasks?.length ||
      !existingTranscript ||
      !existing.allTaskLevels ||
      !existing.chatSessionId ||
      !existing.planningSessionId;

    if (shouldReanalyze) {
      if (!transcriptText) {
        return { status: "no_transcript" };
      }

      const summaryPayload =
        payload.summary ||
        payload?.recording?.summary ||
        (await fetchFathomSummary(recordingId, accessToken).catch(() => null));
      const summaryText = resolveSummaryText(payload, summaryPayload);
      const detailLevel = resolveDetailLevel(user);

      const analysisResult = await analyzeMeeting({
        transcript: transcriptText,
        requestedDetailLevel: detailLevel,
      });

      const allTaskLevels = analysisResult.allTaskLevels || null;
      const selectedTasks = selectTasksForLevel(allTaskLevels, detailLevel);

      const sanitizedTasks = selectedTasks.map((task: any) =>
        normalizeTask(task as ExtractedTaskSchema)
      );
      let sanitizedTaskLevels = sanitizeLevels(allTaskLevels);

      const attendees = (analysisResult.attendees || []).map((person) => ({
        ...person,
        role: "attendee" as const,
      }));
      const mentioned = (analysisResult.mentionedPeople || []).map((person) => ({
        ...person,
        role: "mentioned" as const,
      }));
      const combinedPeople = [...attendees, ...mentioned];
      const uniquePeople = Array.from(
        new Map(
          combinedPeople.map((person) => [person.name.toLowerCase(), person])
        ).values()
      );

      const completionSuggestions = await buildCompletionSuggestions({
        userId,
        transcript: transcriptText,
        attendees: uniquePeople,
        workspaceId,
        minMatchRatio: resolveCompletionMatchThreshold(user),
      });

      const shouldAutoApprove = Boolean(user.autoApproveCompletedTasks);
      if (shouldAutoApprove && completionSuggestions.length) {
        await applyCompletionTargets(db, userId, completionSuggestions);
      }

      const mergedTasks = mergeCompletionSuggestions(
        sanitizedTasks,
        completionSuggestions
      );
      const finalizedTasks = shouldAutoApprove
        ? applyAutoApprovalFlags(mergedTasks)
        : mergedTasks;

      if (sanitizedTaskLevels) {
        sanitizedTaskLevels = {
          light: mergeCompletionSuggestions(
            sanitizedTaskLevels.light || [],
            completionSuggestions
          ),
          medium: mergeCompletionSuggestions(
            sanitizedTaskLevels.medium || [],
            completionSuggestions
          ),
          detailed: mergeCompletionSuggestions(
            sanitizedTaskLevels.detailed || [],
            completionSuggestions
          ),
        };
        if (shouldAutoApprove) {
          sanitizedTaskLevels = {
            light: applyAutoApprovalFlags(sanitizedTaskLevels.light || []),
            medium: applyAutoApprovalFlags(sanitizedTaskLevels.medium || []),
            detailed: applyAutoApprovalFlags(sanitizedTaskLevels.detailed || []),
          };
        }
      }

      const meetingTitle = pickFirst(
        existing.title,
        payload.meeting_title,
        payload.title,
        payload?.recording?.title,
        payload?.recording_name,
        analysisResult.sessionTitle,
        "Fathom Meeting"
      );

      const meetingSummary =
        pickFirst(
          existingSummary,
          analysisResult.meetingSummary,
          analysisResult.chatResponseText,
          summaryText
        ) || "";

      const now = new Date();
      const meetingUpdate: Record<string, any> = {
        lastActivityAt: now,
        title: meetingTitle,
        summary: meetingSummary,
        attendees: uniquePeople,
        extractedTasks: finalizedTasks,
        allTaskLevels: sanitizedTaskLevels,
        originalAiTasks: sanitizedTasks,
        originalAllTaskLevels: sanitizedTaskLevels,
        keyMoments: analysisResult.keyMoments || [],
        overallSentiment: analysisResult.overallSentiment ?? null,
        speakerActivity: analysisResult.speakerActivity || [],
        meetingMetadata: analysisResult.meetingMetadata || undefined,
        state: "tasks_ready",
      };

      let chatSessionId = existing.chatSessionId
        ? String(existing.chatSessionId)
        : null;
      if (!chatSessionId) {
        chatSessionId = randomUUID();
        meetingUpdate.chatSessionId = chatSessionId;
        await db.collection("chatSessions").insertOne({
          _id: chatSessionId,
          userId,
          workspaceId,
          title: `Chat about "${meetingTitle}"`,
          messages: [],
          suggestedTasks: finalizedTasks,
          originalAiTasks: sanitizedTasks,
          originalAllTaskLevels: sanitizedTaskLevels,
          taskRevisions: [],
          people: uniquePeople,
          folderId: null,
          sourceMeetingId: existing._id.toString(),
          allTaskLevels: sanitizedTaskLevels,
          meetingMetadata: analysisResult.meetingMetadata || undefined,
          createdAt: now,
          lastActivityAt: now,
        });
      } else {
        await db.collection("chatSessions").updateMany(
          {
            userId: userIdQuery,
            $or: [{ _id: buildIdQuery(chatSessionId) }, { id: chatSessionId }],
          },
          {
            $set: {
              title: `Chat about "${meetingTitle}"`,
              suggestedTasks: finalizedTasks,
              originalAiTasks: sanitizedTasks,
              originalAllTaskLevels: sanitizedTaskLevels,
              people: uniquePeople,
              allTaskLevels: sanitizedTaskLevels,
              meetingMetadata: analysisResult.meetingMetadata || undefined,
              lastActivityAt: now,
            },
          }
        );
      }

      let planningSessionId = existing.planningSessionId
        ? String(existing.planningSessionId)
        : null;
      if (!planningSessionId) {
        planningSessionId = randomUUID();
        meetingUpdate.planningSessionId = planningSessionId;
        await db.collection("planningSessions").insertOne({
          _id: planningSessionId,
          userId,
          workspaceId,
          title: `Plan from "${meetingTitle}"`,
          inputText: meetingSummary,
          extractedTasks: finalizedTasks,
          originalAiTasks: sanitizedTasks,
          originalAllTaskLevels: sanitizedTaskLevels,
          taskRevisions: [],
          folderId: null,
          sourceMeetingId: existing._id.toString(),
          allTaskLevels: sanitizedTaskLevels,
          meetingMetadata: analysisResult.meetingMetadata || undefined,
          createdAt: now,
          lastActivityAt: now,
        });
      } else {
        await db.collection("planningSessions").updateMany(
          {
            userId: userIdQuery,
            $or: [
              { _id: buildIdQuery(planningSessionId) },
              { id: planningSessionId },
            ],
          },
          {
            $set: {
              title: `Plan from "${meetingTitle}"`,
              inputText: meetingSummary,
              extractedTasks: finalizedTasks,
              originalAiTasks: sanitizedTasks,
              originalAllTaskLevels: sanitizedTaskLevels,
              allTaskLevels: sanitizedTaskLevels,
              meetingMetadata: analysisResult.meetingMetadata || undefined,
              lastActivityAt: now,
            },
          }
        );
      }

      await db.collection<any>("meetings").updateOne(
        { _id: existing._id },
        { $set: meetingUpdate }
      );

      if (uniquePeople.length) {
        try {
          await upsertPeopleFromAttendees({
            db,
            userId,
            attendees: uniquePeople,
            sourceSessionId: existing._id.toString(),
          });
        } catch (error) {
          console.error("Failed to upsert people from Fathom attendees:", error);
        }
      }

      await syncTasksForSource(db, finalizedTasks, {
        userId,
        workspaceId,
        sourceSessionId: existing._id.toString(),
        sourceSessionType: "meeting",
        sourceSessionName: meetingTitle,
        origin: "meeting",
        taskState: "active",
      });

      if (workspaceId) {
        const defaultBoard = await ensureDefaultBoard(db, userId, workspaceId);
        await ensureBoardItemsForTasks(db, {
          userId,
          workspaceId,
          boardId: defaultBoard._id,
          tasks: finalizedTasks,
        });
      }
    } else if (Array.isArray(existing.extractedTasks) && existing.extractedTasks.length) {
      await syncTasksForSource(db, existing.extractedTasks as ExtractedTaskSchema[], {
        userId,
        workspaceId,
        sourceSessionId: existing._id.toString(),
        sourceSessionType: "meeting",
        sourceSessionName: existing.title || "Meeting",
        origin: "meeting",
        taskState: "active",
      });
      if (workspaceId) {
        const defaultBoard = await ensureDefaultBoard(db, userId, workspaceId);
        await ensureBoardItemsForTasks(db, {
          userId,
          workspaceId,
          boardId: defaultBoard._id,
          tasks: existing.extractedTasks as ExtractedTaskSchema[],
        });
      }
    }
    return { status: "duplicate", meetingId: existing._id.toString() };
  }

  const payload = data || {};
  let transcriptPayload =
    payload.transcript ||
    payload.transcript_segments ||
    payload?.recording?.transcript ||
    payload?.recording?.transcript_segments;
  if (!transcriptPayload) {
    transcriptPayload = await fetchFathomTranscript(recordingId, accessToken);
  }

  const transcriptText = formatFathomTranscript(transcriptPayload);
  if (!transcriptText) {
    return { status: "no_transcript" };
  }

  const summaryPayload =
    payload.summary ||
    payload?.recording?.summary ||
    (await fetchFathomSummary(recordingId, accessToken).catch(() => null));
  const summaryText = resolveSummaryText(payload, summaryPayload);

  const detailLevel = resolveDetailLevel(user);
  const analysisResult = await analyzeMeeting({
    transcript: transcriptText,
    requestedDetailLevel: detailLevel,
  });

  const allTaskLevels = analysisResult.allTaskLevels || null;
  const selectedTasks = selectTasksForLevel(allTaskLevels, detailLevel);

  const sanitizedTasks = selectedTasks.map((task: any) =>
    normalizeTask(task as ExtractedTaskSchema)
  );
  let sanitizedTaskLevels = sanitizeLevels(allTaskLevels);

  const attendees = (analysisResult.attendees || []).map((person) => ({
    ...person,
    role: "attendee" as const,
  }));
  const mentioned = (analysisResult.mentionedPeople || []).map((person) => ({
    ...person,
    role: "mentioned" as const,
  }));
  const combinedPeople = [...attendees, ...mentioned];
  const uniquePeople = Array.from(
    new Map(
      combinedPeople.map((person) => [person.name.toLowerCase(), person])
    ).values()
  );

  const completionSuggestions = await buildCompletionSuggestions({
    userId,
    transcript: transcriptText,
    attendees: uniquePeople,
    workspaceId,
    minMatchRatio: resolveCompletionMatchThreshold(user),
  });

  const shouldAutoApprove = Boolean(user.autoApproveCompletedTasks);
  if (shouldAutoApprove && completionSuggestions.length) {
    await applyCompletionTargets(db, userId, completionSuggestions);
  }

  const mergedTasks = mergeCompletionSuggestions(
    sanitizedTasks,
    completionSuggestions
  );
  const finalizedTasks = shouldAutoApprove
    ? applyAutoApprovalFlags(mergedTasks)
    : mergedTasks;

  if (sanitizedTaskLevels) {
    sanitizedTaskLevels = {
      light: mergeCompletionSuggestions(
        sanitizedTaskLevels.light || [],
        completionSuggestions
      ),
      medium: mergeCompletionSuggestions(
        sanitizedTaskLevels.medium || [],
        completionSuggestions
      ),
      detailed: mergeCompletionSuggestions(
        sanitizedTaskLevels.detailed || [],
        completionSuggestions
      ),
    };
    if (shouldAutoApprove) {
      sanitizedTaskLevels = {
        light: applyAutoApprovalFlags(sanitizedTaskLevels.light || []),
        medium: applyAutoApprovalFlags(sanitizedTaskLevels.medium || []),
        detailed: applyAutoApprovalFlags(sanitizedTaskLevels.detailed || []),
      };
    }
  }

  const meetingTitle = pickFirst(
    payload.meeting_title,
    payload.title,
    payload?.recording?.title,
    payload?.recording_name,
    analysisResult.sessionTitle,
    "Fathom Meeting"
  );

  const meetingSummary =
    pickFirst(
      analysisResult.meetingSummary,
      analysisResult.chatResponseText,
      summaryText
    ) || "";

  const now = new Date();
  const meetingId = randomUUID();
  const chatId = randomUUID();
  const planId = randomUUID();

  const workspaceId = user.workspace?.id || null;
  const meeting = {
    _id: meetingId,
    userId,
    workspaceId,
    title: meetingTitle,
    originalTranscript: transcriptText,
    summary: meetingSummary,
    attendees: uniquePeople,
    extractedTasks: finalizedTasks,
    originalAiTasks: sanitizedTasks,
    originalAllTaskLevels: sanitizedTaskLevels,
    taskRevisions:
      sanitizedTasks.length > 0
        ? [
            {
              id: randomUUID(),
              createdAt: Date.now(),
              source: "ai",
              summary: "Initial AI extraction",
              tasksSnapshot: sanitizedTasks,
            },
          ]
        : [],
    chatSessionId: chatId,
    planningSessionId: planId,
    allTaskLevels: sanitizedTaskLevels,
    keyMoments: analysisResult.keyMoments || [],
    overallSentiment: analysisResult.overallSentiment ?? null,
    speakerActivity: analysisResult.speakerActivity || [],
    meetingMetadata: analysisResult.meetingMetadata || undefined,
    recordingIdHash,
    recordingUrl: pickFirst(
      payload.url,
      payload.meeting_url,
      payload?.recording?.url
    ),
    ingestSource: "fathom",
    fathomNotificationReadAt: null,
    shareUrl: pickFirst(
      payload.share_url,
      payload.meeting_share_url,
      payload?.recording?.share_url
    ),
    startTime: toDateOrNull(
      payload.recording_start_time ||
        payload.start_time ||
        payload.started_at ||
        payload?.recording?.start_time ||
        payload.scheduled_start_time
    ),
    endTime: toDateOrNull(
      payload.recording_end_time ||
        payload.end_time ||
        payload.ended_at ||
        payload?.recording?.end_time ||
        payload.scheduled_end_time
    ),
    duration: payload.duration || payload.duration_seconds || payload?.recording?.duration,
    state: "tasks_ready",
    createdAt: now,
    lastActivityAt: now,
  };

  const chatSession = {
    _id: chatId,
    userId,
    workspaceId,
    title: `Chat about "${meetingTitle}"`,
    messages: [],
    suggestedTasks: finalizedTasks,
    originalAiTasks: sanitizedTasks,
    originalAllTaskLevels: sanitizedTaskLevels,
    taskRevisions: [],
    people: uniquePeople,
    folderId: null,
    sourceMeetingId: meetingId,
    allTaskLevels: sanitizedTaskLevels,
    meetingMetadata: analysisResult.meetingMetadata || undefined,
    createdAt: now,
    lastActivityAt: now,
  };

  const planningSession = {
    _id: planId,
    userId,
    workspaceId,
    title: `Plan from "${meetingTitle}"`,
    inputText: meetingSummary,
    extractedTasks: finalizedTasks,
    originalAiTasks: sanitizedTasks,
    originalAllTaskLevels: sanitizedTaskLevels,
    taskRevisions: [],
    folderId: null,
    sourceMeetingId: meetingId,
    allTaskLevels: sanitizedTaskLevels,
    meetingMetadata: analysisResult.meetingMetadata || undefined,
    createdAt: now,
    lastActivityAt: now,
  };

  await db.collection("meetings").insertOne(meeting);
  await db.collection("chatSessions").insertOne(chatSession);
  await db.collection("planningSessions").insertOne(planningSession);
  if (uniquePeople.length) {
    try {
      await upsertPeopleFromAttendees({
        db,
        userId,
        attendees: uniquePeople,
        sourceSessionId: meetingId,
      });
    } catch (error) {
      console.error("Failed to upsert people from Fathom attendees:", error);
    }
  }
  await syncTasksForSource(db, finalizedTasks, {
    userId,
    workspaceId,
    sourceSessionId: meetingId,
    sourceSessionType: "meeting",
    sourceSessionName: meetingTitle,
    origin: "meeting",
    taskState: "active",
  });

  if (workspaceId) {
    const defaultBoard = await ensureDefaultBoard(db, userId, workspaceId);
    await ensureBoardItemsForTasks(db, {
      userId,
      workspaceId,
      boardId: defaultBoard._id,
      tasks: finalizedTasks,
    });
  }

  return { status: "created", meetingId };
};

