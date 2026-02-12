import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { buildIdQuery } from "@/lib/mongo-id";
import { upsertPeopleFromAttendees } from "@/lib/people-sync";
import { syncTasksForSource } from "@/lib/task-sync";
import { ensureDefaultBoard } from "@/lib/boards";
import { ensureBoardItemsForTasks } from "@/lib/board-items";
import { getWorkspaceIdForUser } from "@/lib/workspace";
import { postMeetingAutomationToSlack } from "@/lib/slack-automation";
import type { ExtractedTaskSchema } from "@/types/chat";
import {
  applyCompletionTargets,
  buildCompletionSuggestions,
  filterTasksForSessionSync,
  mergeCompletionSuggestions,
} from "@/lib/task-completion";

const resolveCompletionMatchThreshold = (user: any) => {
  const value = user?.completionMatchThreshold;
  if (typeof value !== "number" || !Number.isFinite(value)) return 0.6;
  return Math.min(0.95, Math.max(0.4, value));
};

const shouldAutoApproveSuggestion = (
  task: ExtractedTaskSchema,
  minMatchRatio: number
) => {
  if (!task.completionSuggested) return false;
  const confidence =
    typeof task.completionConfidence === "number" &&
      Number.isFinite(task.completionConfidence)
      ? task.completionConfidence
      : null;
  if (confidence === null) return false;
  return confidence >= minMatchRatio;
};

const applyAutoApprovalFlags = (
  tasks: ExtractedTaskSchema[],
  minMatchRatio: number
) => {
  const walk = (items: ExtractedTaskSchema[]): ExtractedTaskSchema[] =>
    items.map((task) => {
      const nextTask = {
        ...task,
        subtasks: task.subtasks ? walk(task.subtasks) : task.subtasks,
      };
      if (shouldAutoApproveSuggestion(nextTask, minMatchRatio)) {
        return { ...nextTask, status: "done", completionSuggested: false };
      }
      return nextTask;
    });
  return walk(tasks);
};

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

const MEETING_LIST_PROJECTION = {
  _id: 1,
  id: 1,
  userId: 1,
  workspaceId: 1,
  title: 1,
  summary: 1,
  attendees: 1,
  extractedTasks: 1,
  chatSessionId: 1,
  planningSessionId: 1,
  createdAt: 1,
  lastActivityAt: 1,
  conferenceId: 1,
  calendarEventId: 1,
  recordingUrl: 1,
  shareUrl: 1,
  organizerEmail: 1,
  startTime: 1,
  endTime: 1,
  state: 1,
  ingestSource: 1,
  fathomNotificationReadAt: 1,
  artifacts: 1,
  tags: 1,
  duration: 1,
  overallSentiment: 1,
  speakerActivity: 1,
  meetingMetadata: 1,
} as const;

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userIdQuery = buildIdQuery(userId);
  const db = await getDb();
  const meetings = await db
    .collection<any>("meetings")
    .find(
      { userId: userIdQuery, isHidden: { $ne: true } },
      { projection: MEETING_LIST_PROJECTION }
    )
    .sort({ lastActivityAt: -1 })
    .toArray();

  if (meetings.length > 0) {
    try {
      const { hydrateTaskReferenceLists } = await import("@/lib/task-hydration");
      const hydratedTaskLists = await hydrateTaskReferenceLists(
        userId,
        meetings.map((meeting: any) =>
          Array.isArray(meeting.extractedTasks) ? meeting.extractedTasks : []
        )
      );
      meetings.forEach((meeting: any, index: number) => {
        meeting.extractedTasks = hydratedTaskLists[index] || [];
      });
    } catch (e) {
      console.error("Failed to hydrate meetings list", e);
    }
  }

  return NextResponse.json(meetings.map(serializeMeeting));
}

export async function POST(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { recordingId, recordingIdHash, ...safeBody } = body || {};
  const now = new Date();
  const db = await getDb();
  const userIdQuery = buildIdQuery(userId);
  const user = await db.collection<any>("users").findOne({ _id: userIdQuery });
  const workspaceId = await getWorkspaceIdForUser(db, userId);
  const originalAiTasks = safeBody.originalAiTasks || safeBody.extractedTasks || [];
  const meeting = {
    _id: randomUUID(),
    userId,
    workspaceId,
    title: safeBody.title || "Meeting",
    originalTranscript: safeBody.originalTranscript || "",
    summary: safeBody.summary || "",
    attendees: safeBody.attendees || [],
    extractedTasks: safeBody.extractedTasks || [],
    originalAiTasks,
    originalAllTaskLevels: safeBody.originalAllTaskLevels || safeBody.allTaskLevels || null,
    taskRevisions: safeBody.taskRevisions || [],
    chatSessionId: safeBody.chatSessionId ?? null,
    planningSessionId: safeBody.planningSessionId ?? null,
    allTaskLevels: safeBody.allTaskLevels ?? null,
    createdAt: now,
    lastActivityAt: now,
  };

  const transcript =
    typeof meeting.originalTranscript === "string"
      ? meeting.originalTranscript.trim()
      : "";
  if (user && transcript) {
    const completionMatchThreshold = resolveCompletionMatchThreshold(user);
    const completionSuggestions = await buildCompletionSuggestions({
      userId,
      transcript,
      summary: meeting.summary,
      attendees: Array.isArray(meeting.attendees) ? meeting.attendees : [],
      workspaceId,
      requireAttendeeMatch: false,
      minMatchRatio: completionMatchThreshold,
    });
    if (completionSuggestions.length) {
      const mergedTasks = mergeCompletionSuggestions(
        meeting.extractedTasks as ExtractedTaskSchema[],
        completionSuggestions
      );
      const shouldAutoApprove = Boolean(user.autoApproveCompletedTasks);
      meeting.extractedTasks = shouldAutoApprove
        ? applyAutoApprovalFlags(mergedTasks, completionMatchThreshold)
        : mergedTasks;
      if (shouldAutoApprove) {
        const autoApproveSuggestions = completionSuggestions.filter((task) =>
          shouldAutoApproveSuggestion(task, completionMatchThreshold)
        );
        if (autoApproveSuggestions.length) {
          await applyCompletionTargets(db, userId, autoApproveSuggestions);
        }
      }
    }
  }

  await db.collection<any>("meetings").insertOne(meeting);

  if (Array.isArray(meeting.attendees) && meeting.attendees.length) {
    try {
      await upsertPeopleFromAttendees({
        db,
        userId,
        attendees: meeting.attendees,
        sourceSessionId: String(meeting._id),
      });
    } catch (error) {
      console.error("Failed to upsert people from meeting attendees:", error);
    }
  }

  if (Array.isArray(meeting.extractedTasks)) {
    try {
      const syncTasks = filterTasksForSessionSync(
        meeting.extractedTasks as ExtractedTaskSchema[],
        "meeting",
        meeting._id
      );
      await syncTasksForSource(db, syncTasks, {
        userId,
        workspaceId,
        sourceSessionId: meeting._id,
        sourceSessionType: "meeting",
        sourceSessionName: meeting.title,
        origin: "meeting",
        taskState: "active",
      });
      if (workspaceId) {
        const defaultBoard = await ensureDefaultBoard(db, userId, workspaceId);
        await ensureBoardItemsForTasks(db, {
          userId,
          workspaceId,
          boardId: defaultBoard._id,
          tasks: syncTasks,
        });
      }
    } catch (error) {
      console.error("Failed to sync meeting tasks after creation:", error);
    }
  }

  if (user) {
    await postMeetingAutomationToSlack({
      user,
      meetingTitle: meeting.title || "Meeting",
      meetingSummary: meeting.summary || "",
      tasks: (meeting.extractedTasks || []) as ExtractedTaskSchema[],
    });
  }

  return NextResponse.json(serializeMeeting(meeting));
}

