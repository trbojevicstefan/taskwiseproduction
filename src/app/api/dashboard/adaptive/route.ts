import {
  apiError,
  apiSuccess,
  createRouteRequestContext,
  getApiErrorStatus,
  mapApiError,
} from "@/lib/api-route";
import { getDb } from "@/lib/db";
import { evaluateAdaptiveDashboard, type AdaptiveDashboardSnapshot } from "@/lib/jev-dashboard";
import { getSessionUserId } from "@/lib/server-auth";
import { normalizePersonNameKey } from "@/lib/transcript-utils";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";

const ROUTE = "/api/dashboard/adaptive";
const DAY_MS = 24 * 60 * 60 * 1000;
const MEETING_LIMIT = 12;
const TASK_LIMIT = 100;
const PEOPLE_LIMIT = 100;
const SUMMARY_LIMIT = 320;

const buildScopeFilter = (workspaceId: string, memberUserIds: string[]) => ({
  $or: [
    { workspaceId },
    {
      workspaceId: { $exists: false },
      userId: { $in: memberUserIds },
    },
  ],
});

const safeString = (value: unknown, max = 160) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

const dateIso = (value: unknown): string | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value as string | number);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const attendeeName = (attendee: any) =>
  safeString(
    attendee?.name ||
      attendee?.displayName ||
      attendee?.fullName ||
      attendee?.speakerName ||
      "",
    100
  );

const isSuggestedTask = (task: any) =>
  task?.reviewStatus === "suggested" ||
  task?.taskState === "suggested" ||
  task?.status === "suggested";

export async function GET(request?: Request) {
  const routeContext = createRouteRequestContext({
    request,
    route: ROUTE,
    method: "GET",
  });
  const { correlationId, logger, durationMs, setMetricUserId, emitMetric } =
    routeContext;

  try {
    const userId = await getSessionUserId();
    if (!userId) {
      emitMetric(401, "error", { reason: "unauthorized" });
      return apiError(401, "request_error", "Unauthorized", undefined, {
        correlationId,
      });
    }
    setMetricUserId(userId);

    const db = await getDb();
    const { workspaceId, workspaceMemberUserIds } =
      await resolveWorkspaceScopeForUser(db, userId, {
        minimumRole: "member",
        adminVisibilityKey: "tasks",
        includeMemberUserIds: true,
      });

    const scopeFilter = buildScopeFilter(workspaceId, workspaceMemberUserIds);
    const now = new Date();
    const recentSince = new Date(now.getTime() - 14 * DAY_MS);
    const upcomingUntil = new Date(now.getTime() + 14 * DAY_MS);

    const [meetingDocs, taskDocs, peopleDocs] = await Promise.all([
      db
        .collection("meetings")
        .find(
          {
            $and: [
              scopeFilter,
              { isHidden: { $ne: true } },
              {
                $or: [
                  { startTime: { $gte: recentSince, $lte: upcomingUntil } },
                  {
                    startTime: { $exists: false },
                    lastActivityAt: { $gte: recentSince },
                  },
                ],
              },
            ],
          },
          {
            projection: {
              _id: 1,
              title: 1,
              summary: 1,
              startTime: 1,
              createdAt: 1,
              lastActivityAt: 1,
              attendees: 1,
              extractedTasks: 1,
            },
          }
        )
        .sort({ startTime: -1, lastActivityAt: -1, _id: -1 })
        .limit(MEETING_LIMIT)
        .toArray(),
      db
        .collection("tasks")
        .find(
          {
            ...scopeFilter,
            status: { $ne: "done" },
            taskState: { $ne: "archived" },
            cleanupStatus: { $ne: "expired" },
          },
          {
            projection: {
              _id: 1,
              title: 1,
              status: 1,
              dueAt: 1,
              assignee: 1,
              assigneeName: 1,
              priorityScore: 1,
              priorityLabel: 1,
              priorityReason: 1,
              reviewStatus: 1,
              taskState: 1,
              sourceSessionId: 1,
              lastUpdated: 1,
            },
          }
        )
        .sort({ priorityScore: -1, lastUpdated: -1, _id: -1 })
        .limit(TASK_LIMIT)
        .toArray(),
      db
        .collection("people")
        .find(scopeFilter, {
          projection: {
            _id: 1,
            name: 1,
            aliases: 1,
            personType: 1,
          },
        })
        .limit(PEOPLE_LIMIT)
        .toArray(),
    ]);

    const pastMeetingDocs = meetingDocs.filter((meeting: any) => {
      const value = meeting.startTime || meeting.lastActivityAt || meeting.createdAt;
      const iso = dateIso(value);
      return iso ? new Date(iso).getTime() <= now.getTime() : true;
    });
    const upcomingMeetingCount = meetingDocs.filter((meeting: any) => {
      const iso = dateIso(meeting.startTime);
      if (!iso) return false;
      const ts = new Date(iso).getTime();
      return ts > now.getTime() && ts <= upcomingUntil.getTime();
    }).length;

    const recentMeetings = pastMeetingDocs.slice(0, 6).map((meeting: any) => {
      const extractedTasks = Array.isArray(meeting.extractedTasks)
        ? meeting.extractedTasks
        : [];
      return {
        id: String(meeting._id || meeting.id || ""),
        title: safeString(meeting.title, 140) || "Untitled meeting",
        summary: safeString(meeting.summary, SUMMARY_LIMIT),
        occurredAt: dateIso(
          meeting.startTime || meeting.lastActivityAt || meeting.createdAt
        ),
        attendeeNames: Array.from(
          new Set(
            (Array.isArray(meeting.attendees) ? meeting.attendees : [])
              .map(attendeeName)
              .filter(Boolean)
          )
        ).slice(0, 8) as string[],
        extractedTaskCount: extractedTasks.length,
        suggestedTaskCount: extractedTasks.filter(isSuggestedTask).length,
      };
    });

    const topTasks = taskDocs.slice(0, 8).map((task: any) => ({
      id: String(task._id || task.id || ""),
      title: safeString(task.title, 160) || "Untitled task",
      priorityScore:
        typeof task.priorityScore === "number" && Number.isFinite(task.priorityScore)
          ? task.priorityScore
          : null,
      priorityLabel: safeString(task.priorityLabel, 32) || null,
      priorityReason: safeString(task.priorityReason, 180) || null,
      dueAt: dateIso(task.dueAt),
      assigneeName:
        safeString(task.assigneeName || task.assignee?.name, 100) || null,
      status: safeString(task.status, 32) || null,
    }));

    const meetingCountByName = new Map<string, number>();
    for (const meeting of recentMeetings) {
      for (const name of meeting.attendeeNames) {
        const key = normalizePersonNameKey(name);
        if (!key) continue;
        meetingCountByName.set(key, (meetingCountByName.get(key) || 0) + 1);
      }
    }

    const taskCountByName = new Map<string, number>();
    for (const task of taskDocs) {
      const name = safeString(task.assigneeName || task.assignee?.name, 100);
      const key = normalizePersonNameKey(name);
      if (!key) continue;
      taskCountByName.set(key, (taskCountByName.get(key) || 0) + 1);
    }

    const peopleSignals = peopleDocs
      .map((person: any) => {
        const names = [
          safeString(person.name, 100),
          ...(Array.isArray(person.aliases)
            ? person.aliases.map((alias: unknown) => safeString(alias, 100))
            : []),
        ].filter(Boolean);
        const keys = names.map(normalizePersonNameKey).filter(Boolean);
        const recentMeetingCount = Math.max(
          0,
          ...keys.map((key) => meetingCountByName.get(key) || 0)
        );
        const openTaskCount = Math.max(
          0,
          ...keys.map((key) => taskCountByName.get(key) || 0)
        );
        return {
          id: String(person._id || person.id || ""),
          name: safeString(person.name, 100) || "Unknown person",
          recentMeetingCount,
          openTaskCount,
          client: person.personType === "client",
        };
      })
      .filter(
        (person: any) =>
          person.recentMeetingCount > 0 || person.openTaskCount > 0
      )
      .sort(
        (a: any, b: any) =>
          b.recentMeetingCount + b.openTaskCount -
          (a.recentMeetingCount + a.openTaskCount)
      )
      .slice(0, 8);

    const snapshot: AdaptiveDashboardSnapshot = {
      recentMeetingCount: pastMeetingDocs.length,
      meetingsNeedingReview: recentMeetings.filter(
        (meeting: AdaptiveDashboardSnapshot["recentMeetings"][number]) =>
          meeting.suggestedTaskCount > 0
      ).length,
      upcomingMeetingCount,
      urgentTaskCount: taskDocs.filter(
        (task: any) => task.priorityLabel === "urgent"
      ).length,
      highPriorityTaskCount: taskDocs.filter(
        (task: any) => task.priorityLabel === "high"
      ).length,
      openTaskCount: taskDocs.length,
      peopleFollowupCount: peopleSignals.filter(
        (person: any) =>
          person.openTaskCount > 0 &&
          (person.client || person.recentMeetingCount >= 2)
      ).length,
      recentMeetings,
      topTasks,
      peopleSignals,
    };

    const decision = await evaluateAdaptiveDashboard(snapshot);

    logger.info("api.request.succeeded", {
      status: 200,
      durationMs: durationMs(),
      workspaceId,
      decisionSource: decision.source,
      decisionFocus: decision.focus,
      recentMeetingCount: snapshot.recentMeetingCount,
      openTaskCount: snapshot.openTaskCount,
    });
    emitMetric(200, "success", {
      decisionSource: decision.source,
      decisionFocus: decision.focus,
    });

    return apiSuccess(
      {
        decision,
        context: {
          recentMeetingCount: snapshot.recentMeetingCount,
          meetingsNeedingReview: snapshot.meetingsNeedingReview,
          upcomingMeetingCount: snapshot.upcomingMeetingCount,
          urgentTaskCount: snapshot.urgentTaskCount,
          highPriorityTaskCount: snapshot.highPriorityTaskCount,
          openTaskCount: snapshot.openTaskCount,
          peopleFollowupCount: snapshot.peopleFollowupCount,
        },
      },
      { correlationId }
    );
  } catch (error) {
    const statusCode = getApiErrorStatus(error);
    emitMetric(statusCode, "error");
    return mapApiError(error, "Failed to load adaptive dashboard guidance.", {
      correlationId,
      logger,
      context: {
        route: ROUTE,
        method: "GET",
        durationMs: durationMs(),
      },
    });
  }
}
