import { randomUUID } from "crypto";
import { isAsyncDomainEventProcessingEnabled } from "@/lib/core-first-flags";
import { enqueueJob } from "@/lib/jobs/store";
import { createLogger, serializeError } from "@/lib/observability";
import { syncBoardItemsToStatusByTaskRecord } from "@/lib/services/board-status-sync";
import { applyMeetingIngestionSideEffects } from "@/lib/services/meeting-ingestion-side-effects";
import { normalizePersonNameKey } from "@/lib/transcript-utils";
import type { ExtractedTaskSchema } from "@/types/chat";

type TaskStatus = "todo" | "inprogress" | "done" | "recurring";

export type DomainEventType =
  | "task.status.changed"
  | "meeting.ingested"
  | "board.item.updated";

export type TaskStatusChangedPayload = {
  taskId: string;
  status: TaskStatus;
  sourceSessionType?: "meeting" | "chat";
  sourceSessionId?: string;
};

type MeetingAttendee = {
  name?: string | null;
  email?: string | null;
  title?: string | null;
};

export type MeetingIngestedPayload = {
  meetingId: string;
  workspaceId?: string | null;
  title?: string | null;
  attendees?: MeetingAttendee[];
  extractedTasks?: ExtractedTaskSchema[];
};

export type BoardItemUpdatedPayload = {
  taskId: string;
  statusCategory?: string | null;
  workspaceId?: string | null;
  boardId?: string | null;
  taskUpdates?: Record<string, any>;
};

export type DomainEventPayloadByType = {
  "task.status.changed": TaskStatusChangedPayload;
  "meeting.ingested": MeetingIngestedPayload;
  "board.item.updated": BoardItemUpdatedPayload;
};

export type DomainEventResultByType = {
  "task.status.changed": { matchedTasks: number };
  "meeting.ingested": {
    people: { created: number; updated: number };
    tasks: { upserted: number; deleted: number };
    boardItemsCreated: number;
  };
  "board.item.updated": { updated: boolean; taskId: string };
};

export type DomainEvent<TType extends DomainEventType = DomainEventType> = {
  type: TType;
  userId: string;
  correlationId?: string | null;
  payload: DomainEventPayloadByType[TType];
};

type DomainEventStatus = "queued" | "processing" | "handled" | "failed";

type PersistedDomainEvent = {
  _id: string;
  type: DomainEventType;
  userId: string;
  correlationId?: string | null;
  payload: DomainEventPayloadByType[DomainEventType];
  status: DomainEventStatus;
  createdAt: Date;
  updatedAt: Date;
  handledAt?: Date;
  failedAt?: Date;
  error?: ReturnType<typeof serializeError>;
  result?: DomainEventResultByType[DomainEventType];
};

const DOMAIN_EVENT_RETENTION_DAYS = Math.max(
  1,
  Number(process.env.DOMAIN_EVENT_RETENTION_DAYS || 30)
);
const DOMAIN_EVENT_RETENTION_MS =
  DOMAIN_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000;

let domainEventIndexesEnsured = false;
let domainEventIndexesEnsuring: Promise<void> | null = null;

const TASK_STATUS_VALUES = new Set<TaskStatus>([
  "todo",
  "inprogress",
  "done",
  "recurring",
]);

const isTaskStatus = (value: unknown): value is TaskStatus =>
  typeof value === "string" && TASK_STATUS_VALUES.has(value as TaskStatus);

const handleTaskStatusChanged = async (
  db: any,
  userId: string,
  payload: TaskStatusChangedPayload
): Promise<DomainEventResultByType["task.status.changed"]> => {
  const taskId = String(payload.taskId || "").trim();
  if (!taskId || !isTaskStatus(payload.status)) {
    return { matchedTasks: 0 };
  }

  const filter: Record<string, any> = {
    userId,
    $or: [{ _id: taskId }, { sourceTaskId: taskId }],
  };
  if (payload.sourceSessionType) {
    filter.sourceSessionType = payload.sourceSessionType;
  }
  if (payload.sourceSessionId) {
    filter.sourceSessionId = payload.sourceSessionId;
  }

  const tasks = await db.collection("tasks").find(filter).toArray();
  if (!tasks.length) {
    return { matchedTasks: 0 };
  }

  await Promise.all(
    tasks.map((task: any) =>
      syncBoardItemsToStatusByTaskRecord(db, userId, task, payload.status)
    )
  );

  return { matchedTasks: tasks.length };
};

const handleMeetingIngested = async (
  db: any,
  userId: string,
  payload: MeetingIngestedPayload
): Promise<DomainEventResultByType["meeting.ingested"]> => {
  return applyMeetingIngestionSideEffects(db, userId, payload);
};

const handleBoardItemUpdated = async (
  db: any,
  userId: string,
  payload: BoardItemUpdatedPayload
): Promise<DomainEventResultByType["board.item.updated"]> => {
  const taskId = String(payload.taskId || "").trim();
  if (!taskId) {
    return { updated: false, taskId: "" };
  }

  const updates =
    payload.taskUpdates && typeof payload.taskUpdates === "object"
      ? payload.taskUpdates
      : {};

  const taskUpdate: Record<string, any> = {};

  if (typeof updates.title === "string") {
    const title = updates.title.trim();
    if (title) taskUpdate.title = title;
  }
  if (typeof updates.description === "string") {
    taskUpdate.description = updates.description;
  }
  if (typeof updates.priority === "string") {
    taskUpdate.priority = updates.priority;
  }
  if (typeof updates.dueAt === "string" || updates.dueAt === null) {
    taskUpdate.dueAt = updates.dueAt;
  }
  if (typeof updates.assignee === "object" || updates.assignee === null) {
    taskUpdate.assignee = updates.assignee;
  }
  if (
    typeof updates.assigneeName === "string" ||
    updates.assigneeName === null
  ) {
    taskUpdate.assigneeName = updates.assigneeName;
    const rawName = updates.assigneeName || updates.assignee?.name || null;
    taskUpdate.assigneeNameKey = rawName ? normalizePersonNameKey(rawName) : null;
  }

  if (isTaskStatus(updates.status)) {
    taskUpdate.status = updates.status;
  } else if (isTaskStatus(payload.statusCategory)) {
    taskUpdate.status = payload.statusCategory;
  }

  if (!Object.keys(taskUpdate).length) {
    return { updated: false, taskId };
  }

  taskUpdate.lastUpdated = new Date();
  const result = await db.collection("tasks").updateOne(
    { userId, $or: [{ _id: taskId }, { id: taskId }] },
    { $set: taskUpdate }
  );

  return { updated: (result.modifiedCount || 0) > 0, taskId };
};

const dispatchDomainEvent = async <TType extends DomainEventType>(
  db: any,
  event: DomainEvent<TType>
): Promise<DomainEventResultByType[TType]> => {
  switch (event.type) {
    case "task.status.changed":
      return (await handleTaskStatusChanged(
        db,
        event.userId,
        event.payload as TaskStatusChangedPayload
      )) as DomainEventResultByType[TType];
    case "meeting.ingested":
      return (await handleMeetingIngested(
        db,
        event.userId,
        event.payload as MeetingIngestedPayload
      )) as DomainEventResultByType[TType];
    case "board.item.updated":
      return (await handleBoardItemUpdated(
        db,
        event.userId,
        event.payload as BoardItemUpdatedPayload
      )) as DomainEventResultByType[TType];
    default: {
      const unreachable: never = event.type;
      throw new Error(`Unsupported domain event type: ${unreachable}`);
    }
  }
};

const buildEmptyResultByType = (type: DomainEventType) => {
  switch (type) {
    case "task.status.changed":
      return { matchedTasks: 0 };
    case "meeting.ingested":
      return {
        people: { created: 0, updated: 0 },
        tasks: { upserted: 0, deleted: 0 },
        boardItemsCreated: 0,
      };
    case "board.item.updated":
      return { updated: false, taskId: "" };
    default: {
      const unreachable: never = type;
      throw new Error(`Unsupported domain event type: ${unreachable}`);
    }
  }
};

const buildDomainEventExpiry = (now = new Date()) =>
  new Date(now.getTime() + DOMAIN_EVENT_RETENTION_MS);

export const ensureDomainEventIndexes = async (db: any) => {
  if (domainEventIndexesEnsured) return;
  if (domainEventIndexesEnsuring) {
    await domainEventIndexesEnsuring;
    return;
  }

  domainEventIndexesEnsuring = (async () => {
    const collection = db.collection("domainEvents");
    await Promise.all([
      collection.createIndex(
        { userId: 1, status: 1, createdAt: 1, _id: 1 },
        { name: "domain_events_user_status_created_cursor" }
      ),
      collection.createIndex(
        { userId: 1, type: 1, createdAt: -1 },
        { name: "domain_events_user_type_created" }
      ),
      collection.createIndex(
        { expiresAt: 1 },
        { name: "domain_events_expires_at_ttl", expireAfterSeconds: 0 }
      ),
    ]);
    domainEventIndexesEnsured = true;
  })().finally(() => {
    domainEventIndexesEnsuring = null;
  });

  await domainEventIndexesEnsuring;
};

export const dispatchQueuedDomainEventById = async (
  db: any,
  eventId: string,
  userId?: string
) => {
  await ensureDomainEventIndexes(db);
  const scopeFilter: Record<string, any> = { _id: eventId };
  if (userId) {
    scopeFilter.userId = userId;
  }

  const existing = (await db
    .collection("domainEvents")
    .findOne(scopeFilter)) as PersistedDomainEvent | null;
  if (!existing) {
    return null;
  }

  if (existing.status === "handled") {
    return {
      status: "already_handled" as const,
      eventType: existing.type,
      result: existing.result || buildEmptyResultByType(existing.type),
    };
  }

  const now = new Date();
  const claimed = (await db.collection("domainEvents").findOneAndUpdate(
    {
      ...scopeFilter,
      status: { $in: ["queued", "processing"] },
    },
    {
      $set: {
        status: "processing",
        updatedAt: now,
      },
    },
    { returnDocument: "after" }
  )) as PersistedDomainEvent | null;

  if (!claimed) {
    const latest = (await db
      .collection("domainEvents")
      .findOne(scopeFilter)) as PersistedDomainEvent | null;
    if (!latest) {
      return null;
    }
    return {
      status: "already_handled" as const,
      eventType: latest.type,
      result: latest.result || buildEmptyResultByType(latest.type),
    };
  }

  const logger = createLogger({
    scope: "domain-events",
    eventId: claimed._id,
    eventType: claimed.type,
    userId: claimed.userId,
    correlationId: claimed.correlationId ?? null,
  });
  logger.info("domain-events.dispatch.started");

  const dispatchableEvent: DomainEvent = {
    type: claimed.type,
    userId: claimed.userId,
    correlationId: claimed.correlationId ?? null,
    payload: claimed.payload as any,
  };

  try {
    const result = await dispatchDomainEvent(db, dispatchableEvent as any);
    await db.collection("domainEvents").updateOne(
      { _id: claimed._id },
      {
        $set: {
          status: "handled",
          handledAt: new Date(),
          updatedAt: new Date(),
          result,
          expiresAt: buildDomainEventExpiry(),
        },
      }
    );
    logger.info("domain-events.dispatch.succeeded");
    return {
      status: "handled" as const,
      eventType: claimed.type,
      result,
    };
  } catch (error) {
    await db.collection("domainEvents").updateOne(
      { _id: claimed._id },
      {
        $set: {
          status: "failed",
          error: serializeError(error),
          failedAt: new Date(),
          updatedAt: new Date(),
          expiresAt: buildDomainEventExpiry(),
        },
      }
    );
    logger.error("domain-events.dispatch.failed", {
      error: serializeError(error),
    });
    throw error;
  }
};

export const publishDomainEvent = async <TType extends DomainEventType>(
  db: any,
  event: DomainEvent<TType>
): Promise<DomainEventResultByType[TType]> => {
  await ensureDomainEventIndexes(db);
  const eventId = randomUUID();
  const now = new Date();
  const asyncDispatchEnabled = isAsyncDomainEventProcessingEnabled();
  const logger = createLogger({
    scope: "domain-events",
    eventId,
    eventType: event.type,
    userId: event.userId,
    correlationId: event.correlationId ?? null,
  });

  await db.collection("domainEvents").insertOne({
    _id: eventId,
    type: event.type,
    userId: event.userId,
    correlationId: event.correlationId ?? null,
    payload: event.payload,
    status: asyncDispatchEnabled ? "queued" : "processing",
    createdAt: now,
    updatedAt: now,
    expiresAt: buildDomainEventExpiry(now),
  });

  if (asyncDispatchEnabled) {
    await enqueueJob(db, {
      type: "domain-event-dispatch",
      userId: event.userId,
      correlationId:
        typeof event.correlationId === "string" ? event.correlationId : undefined,
      payload: {
        eventId,
      },
    });
    void import("@/lib/jobs/worker")
      .then(({ kickJobWorker }) => kickJobWorker())
      .catch(() => undefined);
    logger.info("domain-events.dispatch.queued");
    return buildEmptyResultByType(event.type) as DomainEventResultByType[TType];
  }

  const dispatchResult = await dispatchQueuedDomainEventById(db, eventId, event.userId);
  if (!dispatchResult) {
    throw new Error("Failed to load persisted domain event for dispatch.");
  }
  return dispatchResult.result as DomainEventResultByType[TType];
};
