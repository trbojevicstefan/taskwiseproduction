import { randomUUID } from "crypto";
import { analyzeMeeting } from "@/ai/flows/analyze-meeting-flow";
import { getDb } from "@/lib/db";
import {
  fetchFathomSummary,
  fetchFathomTranscript,
  formatFathomTranscript,
} from "@/lib/fathom";
import { sanitizeTaskForFirestore } from "@/lib/data";
import type { ExtractedTaskSchema } from "@/types/chat";
import type { DbUser } from "@/lib/db/users";
import {
  buildCompletionSuggestions,
  mergeCompletionSuggestions,
  type CompletionTarget,
} from "@/lib/task-completion";
import { buildIdQuery } from "@/lib/mongo-id";

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
          sanitizeTaskForFirestore(task as ExtractedTaskSchema)
        ),
        medium: (levels.medium || []).map((task: any) =>
          sanitizeTaskForFirestore(task as ExtractedTaskSchema)
        ),
        detailed: (levels.detailed || []).map((task: any) =>
          sanitizeTaskForFirestore(task as ExtractedTaskSchema)
        ),
      }
    : null;

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

  for (const target of uniqueTargets) {
    if (target.sourceType === "meeting") {
      await updateSessionTasks("meetings", "extractedTasks", target);
    } else if (target.sourceType === "chat") {
      await updateSessionTasks("chatSessions", "suggestedTasks", target);
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
  const existing = await db
    .collection<any>("meetings")
    .findOne({ userId: user._id.toString(), recordingId });
  if (existing) {
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

  const detailLevel = "light";
  const analysisResult = await analyzeMeeting({
    transcript: transcriptText,
    requestedDetailLevel: detailLevel,
  });

  const allTaskLevels = analysisResult.allTaskLevels || null;
  const selectedTasks =
    allTaskLevels?.[detailLevel as keyof typeof allTaskLevels] || [];

  const sanitizedTasks = selectedTasks.map((task: any) =>
    sanitizeTaskForFirestore(task as ExtractedTaskSchema)
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
    userId: user._id.toString(),
    transcript: transcriptText,
    attendees: uniquePeople,
  });

  const shouldAutoApprove = Boolean(user.autoApproveCompletedTasks);
  if (shouldAutoApprove && completionSuggestions.length) {
    await applyCompletionTargets(db, user._id.toString(), completionSuggestions);
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
    `Fathom Meeting ${recordingId}`
  );

  const meetingSummary =
    analysisResult.meetingSummary ||
    analysisResult.chatResponseText ||
    payload?.default_summary?.markdown_formatted ||
    (typeof summaryPayload === "string" ? summaryPayload : "") ||
    "";

  const now = new Date();
  const meetingId = randomUUID();
  const chatId = randomUUID();
  const planId = randomUUID();

  const meeting = {
    _id: meetingId,
    userId: user._id.toString(),
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
    recordingId,
    recordingUrl: pickFirst(
      payload.url,
      payload.meeting_url,
      payload?.recording?.url
    ),
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
    userId: user._id.toString(),
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
    userId: user._id.toString(),
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

  return { status: "created", meetingId };
};
