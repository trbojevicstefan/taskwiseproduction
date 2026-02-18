import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  apiError,
  createRouteRequestContext,
  getApiErrorStatus,
  mapApiError,
  parseJsonBody,
} from "@/lib/api-route";
import { getDb } from "@/lib/db";
import { attachCorrelationIdHeader } from "@/lib/observability";
import { getSessionUserId } from "@/lib/server-auth";
import { normalizePersonNameKey } from "@/lib/transcript-utils";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";
import type { ExtractedTaskSchema } from "@/types/chat";

const ROUTE = "/api/people";

const createPersonSchema = z
  .object({
    name: z.string().optional(),
    email: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
    avatarUrl: z.string().nullable().optional(),
    aliases: z.array(z.string()).optional(),
    isBlocked: z.boolean().optional(),
    sourceSessionId: z.string().optional(),
  })
  .passthrough();

const serializePerson = (person: any) => ({
  ...person,
  id: person._id,
  _id: undefined,
  createdAt: person.createdAt?.toISOString?.() || person.createdAt,
  lastSeenAt: person.lastSeenAt?.toISOString?.() || person.lastSeenAt,
});

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
      logger.warn("api.request.unauthorized", {
        durationMs: durationMs(),
      });
      return apiError(401, "request_error", "Unauthorized", undefined, {
        correlationId,
      });
    }
    setMetricUserId(userId);

    const db = await getDb();
    const { workspaceId, workspaceMemberUserIds } = await resolveWorkspaceScopeForUser(db, userId, {
      minimumRole: "member",
      adminVisibilityKey: "people",
      includeMemberUserIds: true,
    });

    const workspaceFallbackScope = {
      $or: [
        { workspaceId },
        {
          workspaceId: { $exists: false },
          userId: { $in: workspaceMemberUserIds },
        },
      ],
    };

    const people = await db
      .collection("people")
      .find(workspaceFallbackScope as any)
      .sort({ lastSeenAt: -1 })
      .toArray();

    const tasks = await db
      .collection("tasks")
      .find({
        $or: [
          { workspaceId },
          {
            workspaceId: { $exists: false },
            userId: { $in: workspaceMemberUserIds },
          },
        ],
      } as any)
      .project({
        _id: 1,
        status: 1,
        sourceSessionType: 1,
        sourceSessionId: 1,
        assignee: 1,
        assigneeId: 1,
        assigneeEmail: 1,
        assigneeName: 1,
        assigneeNameKey: 1,
      })
      .toArray();
    const meetings = await db
      .collection("meetings")
      .find({
        $or: [
          { workspaceId },
          {
            workspaceId: { $exists: false },
            userId: { $in: workspaceMemberUserIds },
          },
        ],
      } as any)
      .project({ _id: 1, extractedTasks: 1 })
      .toArray();
    const chatSessions = await db
      .collection("chatSessions")
      .find({
        $or: [
          { workspaceId },
          {
            workspaceId: { $exists: false },
            userId: { $in: workspaceMemberUserIds },
          },
        ],
      } as any)
      .project({ _id: 1, suggestedTasks: 1 })
      .toArray();

    type TaskStatus = "todo" | "inprogress" | "done" | "recurring";
    const emptyCounts = () => ({
      total: 0,
      open: 0,
      todo: 0,
      inprogress: 0,
      done: 0,
      recurring: 0,
    });

    const statusCounts = new Map<string, ReturnType<typeof emptyCounts>>();
    const emailToId = new Map<string, string>();
    const nameToId = new Map<string, string>();

    people.forEach((person: any) => {
      const personId = String(person._id);
      statusCounts.set(personId, emptyCounts());
      if (person.email) {
        const emailKey = person.email.toLowerCase();
        if (!emailToId.has(emailKey)) emailToId.set(emailKey, personId);
      }
      if (person.name) {
        const nameKey = normalizePersonNameKey(person.name);
        if (nameKey && !nameToId.has(nameKey)) nameToId.set(nameKey, personId);
      }
      if (Array.isArray(person.aliases)) {
        person.aliases.forEach((alias: string) => {
          const aliasKey = normalizePersonNameKey(alias);
          if (aliasKey && !nameToId.has(aliasKey)) nameToId.set(aliasKey, personId);
        });
      }
    });

    const normalizeStatus = (status: any): TaskStatus => {
      const raw = typeof status === "string" ? status.toLowerCase().trim() : "";
      if (raw === "in progress" || raw === "in-progress" || raw === "in_progress") {
        return "inprogress";
      }
      if (raw === "todo" || raw === "to do" || raw === "to-do") {
        return "todo";
      }
      if (raw === "done" || raw === "completed" || raw === "complete") {
        return "done";
      }
      if (raw === "recurring") {
        return "recurring";
      }
      if (
        status === "todo" ||
        status === "inprogress" ||
        status === "done" ||
        status === "recurring"
      ) {
        return status;
      }
      return "todo";
    };

    const increment = (personId: string, status: TaskStatus) => {
      const key = String(personId);
      const counts = statusCounts.get(key);
      if (!counts) return;
      counts.total += 1;
      counts[status] += 1;
      if (status !== "done") {
        counts.open += 1;
      }
    };

    const resolvePersonId = (task: any) => {
      const assigneeId =
        task?.assignee?.uid ?? task?.assignee?.id ?? task?.assigneeId ?? null;
      if (assigneeId && statusCounts.has(String(assigneeId))) {
        return String(assigneeId);
      }
      const emailKey =
        task?.assignee?.email?.toLowerCase?.() ??
        task?.assigneeEmail?.toLowerCase?.();
      if (emailKey && emailToId.has(emailKey)) {
        return emailToId.get(emailKey) || null;
      }
      const nameKeyRaw =
        task?.assigneeNameKey || task?.assigneeName || task?.assignee?.name;
      if (nameKeyRaw) {
        const nameKey = task?.assigneeNameKey || normalizePersonNameKey(nameKeyRaw);
        if (nameKey && nameToId.has(nameKey)) {
          return nameToId.get(nameKey) || null;
        }
      }
      return null;
    };

    const matchTaskToPerson = (task: any) => {
      const personId = resolvePersonId(task);
      if (!personId) return;
      increment(personId, normalizeStatus(task?.status));
    };

    const flattenExtractedTasks = (items: ExtractedTaskSchema[] = []) => {
      const result: ExtractedTaskSchema[] = [];
      const walk = (tasksToWalk: ExtractedTaskSchema[]) => {
        tasksToWalk.forEach((task: any) => {
          result.push(task);
          if (task.subtasks && task.subtasks.length) {
            walk(task.subtasks);
          }
        });
      };
      walk(items);
      return result;
    };

    const meetingSessionsWithTasks = new Set<string>();
    const chatSessionsWithTasks = new Set<string>();

    tasks.forEach((task: any) => {
      if (task?.sourceSessionType === "meeting" && task.sourceSessionId) {
        meetingSessionsWithTasks.add(String(task.sourceSessionId));
      }
      if (task?.sourceSessionType === "chat" && task.sourceSessionId) {
        chatSessionsWithTasks.add(String(task.sourceSessionId));
      }
      matchTaskToPerson(task);
    });

    meetings.forEach((meeting: any) => {
      const meetingId = String(meeting._id ?? meeting.id);
      if (meetingSessionsWithTasks.has(meetingId)) return;
      const flattened = flattenExtractedTasks(meeting.extractedTasks || []);
      flattened.forEach(matchTaskToPerson);
    });

    chatSessions.forEach((session: any) => {
      const sessionId = String(session._id ?? session.id);
      if (chatSessionsWithTasks.has(sessionId)) return;
      const flattened = flattenExtractedTasks(session.suggestedTasks || []);
      flattened.forEach(matchTaskToPerson);
    });

    const peopleWithCounts = people.map((person: any) => {
      const counts = statusCounts.get(String(person._id)) || emptyCounts();
      return {
        ...serializePerson(person),
        taskCount: counts.open,
        taskCounts: counts,
      };
    });

    logger.info("api.request.succeeded", {
      status: 200,
      durationMs: durationMs(),
      resultCount: peopleWithCounts.length,
    });
    emitMetric(200, "success", {
      resultCount: peopleWithCounts.length,
    });
    return attachCorrelationIdHeader(
      NextResponse.json(peopleWithCounts),
      correlationId
    );
  } catch (error) {
    const statusCode = getApiErrorStatus(error);
    emitMetric(statusCode, "error");
    return mapApiError(error, "Failed to fetch people.", {
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

export async function POST(request: Request) {
  const routeContext = createRouteRequestContext({
    request,
    route: ROUTE,
    method: "POST",
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

    const body = await parseJsonBody(
      request,
      createPersonSchema,
      "Invalid person payload."
    );
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const sourceSessionId =
      typeof body.sourceSessionId === "string" ? body.sourceSessionId : null;

    if (!name) {
      emitMetric(400, "error", { reason: "missing_name" });
      logger.warn("api.request.invalid", {
        reason: "missing_name",
        durationMs: durationMs(),
      });
      return apiError(400, "request_error", "Person name is required.", undefined, {
        correlationId,
      });
    }

    const db = await getDb();
    const { workspaceId, workspaceMemberUserIds } = await resolveWorkspaceScopeForUser(db, userId, {
      minimumRole: "member",
      includeMemberUserIds: true,
    });
    const existing = await db.collection("people").findOne({
      name,
      $or: [
        { workspaceId },
        {
          workspaceId: { $exists: false },
          userId: { $in: workspaceMemberUserIds },
        },
      ],
    } as any);
    const now = new Date();

    if (existing) {
      const updatedSourceSessions = new Set(existing.sourceSessionIds || []);
      if (sourceSessionId) updatedSourceSessions.add(sourceSessionId);

      await db.collection("people").updateOne(
        { _id: existing._id },
        {
          $set: {
            lastSeenAt: now,
            ...(body.email ? { email: body.email } : {}),
            ...(body.title ? { title: body.title } : {}),
            ...(body.avatarUrl ? { avatarUrl: body.avatarUrl } : {}),
            sourceSessionIds: Array.from(updatedSourceSessions),
          },
        }
      );

      const refreshed = await db.collection("people").findOne({
        _id: existing._id,
      });
      logger.info("api.request.succeeded", {
        status: 200,
        durationMs: durationMs(),
        personId: existing._id,
        operation: "upsert_existing",
      });
      emitMetric(200, "success", {
        personId: existing._id,
        operation: "upsert_existing",
      });
      return attachCorrelationIdHeader(
        NextResponse.json(serializePerson(refreshed)),
        correlationId
      );
    }

    const person = {
      _id: randomUUID(),
      userId,
      workspaceId,
      name,
      email: body.email || null,
      title: body.title || null,
      avatarUrl: body.avatarUrl || null,
      slackId: null,
      firefliesId: null,
      phantomBusterId: null,
      aliases: body.aliases || [],
      isBlocked: Boolean(body.isBlocked),
      sourceSessionIds: sourceSessionId ? [sourceSessionId] : [],
      createdAt: now,
      lastSeenAt: now,
    };

    await db.collection("people").insertOne(person);

    logger.info("api.request.succeeded", {
      status: 200,
      durationMs: durationMs(),
      personId: person._id,
      operation: "create",
    });
    emitMetric(200, "success", {
      personId: person._id,
      operation: "create",
    });
    return attachCorrelationIdHeader(
      NextResponse.json(serializePerson(person)),
      correlationId
    );
  } catch (error) {
    const statusCode = getApiErrorStatus(error);
    emitMetric(statusCode, "error");
    return mapApiError(error, "Failed to create person.", {
      correlationId,
      logger,
      context: {
        route: ROUTE,
        method: "POST",
        durationMs: durationMs(),
      },
    });
  }
}





