import { ensureBoardItemsForTasks } from "@/lib/board-items";
import { ensureDefaultBoard } from "@/lib/boards";
import { upsertPeopleFromAttendees } from "@/lib/people-sync";
import { syncTasksForSource } from "@/lib/task-sync";
import { getWorkspaceIdForUser } from "@/lib/workspace";
import type { ExtractedTaskSchema } from "@/types/chat";

export type MeetingIngestionAttendee = {
  name?: string | null;
  email?: string | null;
  title?: string | null;
};

export type MeetingIngestionPayload = {
  meetingId: string;
  workspaceId?: string | null;
  title?: string | null;
  attendees?: MeetingIngestionAttendee[];
  extractedTasks?: ExtractedTaskSchema[];
};

export type MeetingIngestionResult = {
  people: { created: number; updated: number };
  tasks: { upserted: number; deleted: number };
  boardItemsCreated: number;
};

const shouldIncludeTaskForSession = (
  task: ExtractedTaskSchema,
  sessionType: "meeting" | "chat",
  sessionId: string
) => {
  if (!task.completionSuggested) return true;
  const targets = task.completionTargets || [];
  if (!targets.length) return true;
  return targets.some(
    (target: any) =>
      target.sourceType === sessionType &&
      String(target.sourceSessionId) === String(sessionId)
  );
};

const filterTasksForSessionSync = (
  tasks: ExtractedTaskSchema[],
  sessionType: "meeting" | "chat",
  sessionId: string
) => {
  const walk = (items: ExtractedTaskSchema[]): ExtractedTaskSchema[] =>
    items.reduce<ExtractedTaskSchema[]>((acc, task) => {
      if (!shouldIncludeTaskForSession(task, sessionType, sessionId)) {
        return acc;
      }
      if (task.subtasks?.length) {
        acc.push({
          ...task,
          subtasks: walk(task.subtasks),
        });
      } else {
        acc.push(task);
      }
      return acc;
    }, []);

  return walk(Array.isArray(tasks) ? tasks : []);
};

export const applyMeetingIngestionSideEffects = async (
  db: any,
  userId: string,
  payload: MeetingIngestionPayload
): Promise<MeetingIngestionResult> => {
  const meetingId = String(payload.meetingId || "").trim();
  if (!meetingId) {
    return {
      people: { created: 0, updated: 0 },
      tasks: { upserted: 0, deleted: 0 },
      boardItemsCreated: 0,
    };
  }

  const attendees = Array.isArray(payload.attendees) ? payload.attendees : [];
  const extractedTasks = Array.isArray(payload.extractedTasks)
    ? payload.extractedTasks
    : [];
  const workspaceId =
    typeof payload.workspaceId === "string" && payload.workspaceId.trim()
      ? payload.workspaceId.trim()
      : await getWorkspaceIdForUser(db, userId);

  let peopleResult = { created: 0, updated: 0 };
  if (attendees.length) {
    peopleResult = await upsertPeopleFromAttendees({
      db,
      userId,
      attendees,
      sourceSessionId: meetingId,
    });
  }

  let tasksResult = { upserted: 0, deleted: 0 };
  let boardItemsCreated = 0;
  if (extractedTasks.length) {
    const syncTasks = filterTasksForSessionSync(
      extractedTasks,
      "meeting",
      meetingId
    );
    const synced = await syncTasksForSource(db, syncTasks, {
      userId,
      workspaceId,
      sourceSessionId: meetingId,
      sourceSessionType: "meeting",
      sourceSessionName: payload.title || "Meeting",
      origin: "meeting",
      taskState: "active",
    });
    tasksResult = {
      upserted: synced.upserted,
      deleted: synced.deleted,
    };

    if (workspaceId) {
      const defaultBoard = await ensureDefaultBoard(db, userId, workspaceId);
      const boardResult = await ensureBoardItemsForTasks(db, {
        userId,
        workspaceId,
        boardId: String(defaultBoard._id),
        tasks: syncTasks,
      });
      boardItemsCreated = boardResult.created || 0;
    }
  }

  return {
    people: peopleResult,
    tasks: tasksResult,
    boardItemsCreated,
  };
};
