// src/app/api/planning/overview/route.ts
/**
 * Phase 5 — planning workspace data endpoint.
 *
 * GET /api/planning/overview
 * -> apiSuccess {
 *      sections: { today, thisWeek, blocked, waitingOnClient, needsOwner,
 *                  needsDueDate } (each Task[]),
 *      counts:   Record<sectionKey, number>  // uncapped totals
 *    }
 *
 * Task = the serializeTask shape used by the neighboring task routes
 * (TASK_LIST_PROJECTION fields) PLUS planningFlags:
 *   { overdue, blocked, waitingOnClient, needsOwner, needsDueDate }.
 *
 * Scope: open tasks (status != 'done', taskState != 'archived',
 * cleanupStatus != 'expired') via the workspace fallback $or, capped to the
 * 500 newest (createdAt desc).
 *
 * Flag semantics:
 *   overdue         dueAt < now
 *   blocked         BLOCKER_SIGNAL_REGEX (shared with src/lib/task-priority.ts)
 *                   matches title/description
 *   waitingOnClient assignee resolves (uid -> email -> nameKey precedence,
 *                   via resolveAssigneePersonId) to a client-type person
 *   needsOwner      no assignee at all
 *   needsDueDate    no dueAt
 *
 * Section assignment — every task appears in EXACTLY ONE section, by
 * precedence: overdue-or-due-today -> today; due within the current ISO week
 * (Mon-start, after today) -> thisWeek; blocked; waitingOnClient; needsOwner;
 * needsDueDate; tasks matching nothing are omitted. planningFlags still carry
 * ALL applicable flags so the UI can chip them.
 *
 * Sections are sorted by priorityScore desc (missing last) then dueAt asc,
 * and each capped at 50 entries; counts reflect the uncapped totals.
 */

import { differenceInCalendarDays, endOfWeek } from "date-fns";
import {
  apiError,
  apiSuccess,
  createRouteRequestContext,
  getApiErrorStatus,
  mapApiError,
} from "@/lib/api-route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import {
  isPlaceholderAssignee,
  resolveAssigneePersonId,
} from "@/lib/task-assignee";
import { BLOCKER_SIGNAL_REGEX } from "@/lib/task-priority";
import { TASK_LIST_PROJECTION } from "@/lib/task-projections";
import { normalizePersonNameKey } from "@/lib/transcript-utils";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";

const ROUTE = "/api/planning/overview";

const MAX_TASKS = 500;
const SECTION_CAP = 50;

const SECTION_KEYS = [
  "today",
  "thisWeek",
  "blocked",
  "waitingOnClient",
  "needsOwner",
  "needsDueDate",
] as const;

type SectionKey = (typeof SECTION_KEYS)[number];

type PlanningFlags = {
  overdue: boolean;
  blocked: boolean;
  waitingOnClient: boolean;
  needsOwner: boolean;
  needsDueDate: boolean;
};

// Same defensive coercion as src/app/api/calendar/route.ts — stored dates
// may be Date objects or strings.
const toDate = (value: unknown): Date | null => {
  if (!value) return null;
  const date =
    value instanceof Date ? value : new Date(value as string | number);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * Same fallback semantics the workspace-scoped list routes use: docs tagged
 * with the workspace id, plus legacy docs without a workspaceId that belong
 * to a workspace member.
 */
const buildScopeFilter = (
  workspaceId: string,
  memberUserIds: string[]
): Record<string, any> => ({
  $or: [
    { workspaceId },
    {
      workspaceId: { $exists: false },
      userId: { $in: memberUserIds },
    },
  ],
});

// Same serialization the neighboring task routes use (see /api/tasks).
const serializeTask = (task: any) => ({
  ...task,
  id: task._id,
  _id: undefined,
  createdAt: task.createdAt?.toISOString?.() || task.createdAt,
  lastUpdated: task.lastUpdated?.toISOString?.() || task.lastUpdated,
});

type ClientAssigneeMaps = {
  peopleById: Map<string, any>;
  personEmailToId: Map<string, string>;
  personNameKeyToId: Map<string, string>;
};

const buildClientAssigneeMaps = (people: any[]): ClientAssigneeMaps => {
  const peopleById = new Map<string, any>();
  const personEmailToId = new Map<string, string>();
  const personNameKeyToId = new Map<string, string>();
  for (const person of people) {
    const id = person?._id ? String(person._id) : "";
    if (!id) continue;
    peopleById.set(id, person);
    const email =
      typeof person?.email === "string"
        ? person.email.trim().toLowerCase()
        : "";
    if (email && !personEmailToId.has(email)) {
      personEmailToId.set(email, id);
    }
    const names = [
      person?.name,
      ...(Array.isArray(person?.aliases) ? person.aliases : []),
    ];
    for (const name of names) {
      if (typeof name !== "string") continue;
      const key = normalizePersonNameKey(name);
      if (key && !personNameKeyToId.has(key)) {
        personNameKeyToId.set(key, id);
      }
    }
  }
  return { peopleById, personEmailToId, personNameKeyToId };
};

const hasAssignee = (task: any): boolean => {
  const assignee = task?.assignee || {};
  return Boolean(
    assignee.uid ||
      assignee.id ||
      assignee.email ||
      task?.assigneeEmail ||
      !isPlaceholderAssignee(assignee.name) ||
      !isPlaceholderAssignee(assignee.displayName) ||
      !isPlaceholderAssignee(task?.assigneeName) ||
      (typeof task?.assigneeNameKey === "string" &&
        task.assigneeNameKey.trim())
  );
};

const computePlanningFlags = (
  task: any,
  now: Date,
  clientMaps: ClientAssigneeMaps
): PlanningFlags => {
  const due = toDate(task.dueAt);
  const owned = hasAssignee(task);
  const blockerText = `${task.title || ""} ${task.description || ""}`;
  return {
    overdue: Boolean(due && due.getTime() < now.getTime()),
    blocked: BLOCKER_SIGNAL_REGEX.test(blockerText),
    waitingOnClient:
      owned && Boolean(resolveAssigneePersonId(task, clientMaps)),
    needsOwner: !owned,
    needsDueDate: !due,
  };
};

/**
 * Exactly-one-section precedence: today -> thisWeek -> blocked ->
 * waitingOnClient -> needsOwner -> needsDueDate -> omitted.
 */
const pickSection = (
  flags: PlanningFlags,
  due: Date | null,
  now: Date,
  weekEnd: Date
): SectionKey | null => {
  if (due && (flags.overdue || differenceInCalendarDays(due, now) === 0)) {
    return "today";
  }
  if (
    due &&
    differenceInCalendarDays(due, now) > 0 &&
    due.getTime() <= weekEnd.getTime()
  ) {
    return "thisWeek";
  }
  if (flags.blocked) return "blocked";
  if (flags.waitingOnClient) return "waitingOnClient";
  if (flags.needsOwner) return "needsOwner";
  if (flags.needsDueDate) return "needsDueDate";
  return null;
};

// priorityScore desc (missing last), then dueAt asc (missing last).
const compareSectionTasks = (a: any, b: any): number => {
  const scoreA = typeof a.priorityScore === "number" ? a.priorityScore : null;
  const scoreB = typeof b.priorityScore === "number" ? b.priorityScore : null;
  if (scoreA !== scoreB) {
    if (scoreA === null) return 1;
    if (scoreB === null) return -1;
    return scoreB - scoreA;
  }
  const dueA = toDate(a.dueAt);
  const dueB = toDate(b.dueAt);
  if (dueA && dueB) return dueA.getTime() - dueB.getTime();
  if (dueA) return -1;
  if (dueB) return 1;
  return 0;
};

export async function GET(request: Request) {
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
      logger.warn("api.request.unauthorized", {
        durationMs: durationMs(),
      });
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

    const openTaskFilter = {
      ...scopeFilter,
      status: { $ne: "done" },
      taskState: { $ne: "archived" },
      cleanupStatus: { $ne: "expired" },
    };

    const [taskDocs, clientPeople] = await Promise.all([
      db
        .collection("tasks")
        .find(openTaskFilter, { projection: TASK_LIST_PROJECTION })
        .sort({ createdAt: -1, _id: -1 })
        .limit(MAX_TASKS)
        .toArray(),
      db
        .collection("people")
        .find(
          { ...scopeFilter, personType: "client" },
          { projection: { _id: 1, name: 1, email: 1, aliases: 1 } }
        )
        .toArray(),
    ]);

    const clientMaps = buildClientAssigneeMaps(clientPeople);
    const now = new Date();
    const weekEnd = endOfWeek(now, { weekStartsOn: 1 });

    const buckets: Record<SectionKey, any[]> = {
      today: [],
      thisWeek: [],
      blocked: [],
      waitingOnClient: [],
      needsOwner: [],
      needsDueDate: [],
    };

    for (const task of taskDocs) {
      const flags = computePlanningFlags(task, now, clientMaps);
      const section = pickSection(flags, toDate(task.dueAt), now, weekEnd);
      if (!section) continue;
      buckets[section].push({ ...serializeTask(task), planningFlags: flags });
    }

    const sections = {} as Record<SectionKey, any[]>;
    const counts = {} as Record<SectionKey, number>;
    for (const key of SECTION_KEYS) {
      const sorted = buckets[key].sort(compareSectionTasks);
      counts[key] = sorted.length;
      sections[key] = sorted.slice(0, SECTION_CAP);
    }

    logger.info("api.request.succeeded", {
      status: 200,
      durationMs: durationMs(),
      taskCount: taskDocs.length,
      workspaceId,
    });
    emitMetric(200, "success", { taskCount: taskDocs.length });
    return apiSuccess({ sections, counts }, { correlationId });
  } catch (error) {
    const statusCode = getApiErrorStatus(error);
    emitMetric(statusCode, "error");
    return mapApiError(error, "Failed to load planning overview.", {
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
