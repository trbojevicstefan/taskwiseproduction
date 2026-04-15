import { randomUUID } from "crypto";
import type { Db } from "mongodb";
import { serializeError } from "@/lib/observability";

export type WebhookDeliveryStatus = "queued" | "sending" | "sent" | "failed" | "disabled";
export type WebhookDeliveryAttemptStatus = "sending" | "sent" | "failed";

export interface WebhookDeliveryRequestDoc {
  url: string;
  method: "POST";
  headers?: Record<string, string> | null;
  body?: unknown;
  bodySha256?: string | null;
}

export interface WebhookDeliveryResponseDoc {
  statusCode?: number | null;
  headers?: Record<string, string | string[] | null> | null;
  body?: string | null;
  durationMs?: number | null;
  receivedAt?: Date | null;
}

export interface WebhookDeliveryAttemptDoc {
  attemptNumber: number;
  status: WebhookDeliveryAttemptStatus;
  queuedAt?: Date | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  request?: WebhookDeliveryRequestDoc | null;
  response?: WebhookDeliveryResponseDoc | null;
  error?: ReturnType<typeof serializeError> | null;
}

export interface WebhookDeliveryDoc {
  _id: string;
  workspaceId: string;
  workflowId: string;
  workflowVersion: number;
  connectionId?: string | null;
  eventType: string;
  sourceEventId?: string | null;
  deliveryKey?: string | null;
  status: WebhookDeliveryStatus;
  maxAttempts: number;
  attemptCount: number;
  request: WebhookDeliveryRequestDoc;
  attempts: WebhookDeliveryAttemptDoc[];
  latestResponse?: WebhookDeliveryResponseDoc | null;
  lastError?: ReturnType<typeof serializeError> | null;
  nextAttemptAt?: Date | null;
  queuedAt: Date;
  sentAt?: Date | null;
  failedAt?: Date | null;
  disabledAt?: Date | null;
  replayOfDeliveryId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const WEBHOOK_DELIVERIES_COLLECTION = "webhookDeliveries";

const serializeDate = (value: Date | string | null | undefined) => {
  if (!value) return null;
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
};

const serializeWebhookDeliveryResponse = (response: WebhookDeliveryResponseDoc | null | undefined) =>
  response
    ? {
        statusCode:
          typeof response.statusCode === "number" ? response.statusCode : null,
        headers: response.headers || {},
        body: response.body || null,
        durationMs:
          typeof response.durationMs === "number" ? response.durationMs : null,
        receivedAt: serializeDate(response.receivedAt),
      }
    : null;

const serializeWebhookDeliveryAttempt = (attempt: WebhookDeliveryAttemptDoc) => ({
  attemptNumber: attempt.attemptNumber,
  status: attempt.status,
  queuedAt: serializeDate(attempt.queuedAt),
  startedAt: serializeDate(attempt.startedAt),
  finishedAt: serializeDate(attempt.finishedAt),
  request: attempt.request
    ? {
        url: attempt.request.url,
        method: attempt.request.method,
        headers: attempt.request.headers || {},
        body: attempt.request.body ?? null,
        bodySha256: attempt.request.bodySha256 || null,
      }
    : null,
  response: serializeWebhookDeliveryResponse(attempt.response),
  error: attempt.error || null,
});

export const ensureWebhookDeliveryIndexes = async (db: Db) => {
  const collection = db.collection<WebhookDeliveryDoc>(WEBHOOK_DELIVERIES_COLLECTION);
  await Promise.all([
    collection.createIndex({ workspaceId: 1, status: 1, createdAt: -1 }),
    collection.createIndex({ workflowId: 1, createdAt: -1 }),
    collection.createIndex({ connectionId: 1, createdAt: -1 }, { sparse: true }),
    collection.createIndex({ sourceEventId: 1, createdAt: -1 }, { sparse: true }),
    collection.createIndex(
      { workspaceId: 1, deliveryKey: 1 },
      {
        unique: true,
        sparse: true,
        partialFilterExpression: { deliveryKey: { $type: "string" } },
      }
    ),
    collection.createIndex({ status: 1, nextAttemptAt: 1, updatedAt: 1 }),
  ]);
};

export const createWebhookDelivery = async (
  db: Db,
  input: {
    workspaceId: string;
    workflowId: string;
    workflowVersion: number;
    request: WebhookDeliveryRequestDoc;
    eventType: string;
    connectionId?: string | null;
    sourceEventId?: string | null;
    deliveryKey?: string | null;
    maxAttempts?: number;
    nextAttemptAt?: Date | null;
    replayOfDeliveryId?: string | null;
    id?: string;
  }
) => {
  const now = new Date();
  const delivery: WebhookDeliveryDoc = {
    _id: input.id || randomUUID(),
    workspaceId: input.workspaceId,
    workflowId: input.workflowId,
    workflowVersion: Math.max(1, input.workflowVersion),
    connectionId: input.connectionId || null,
    eventType: input.eventType,
    sourceEventId: input.sourceEventId || null,
    deliveryKey: input.deliveryKey || null,
    status: "queued",
    maxAttempts: Math.max(1, input.maxAttempts || 5),
    attemptCount: 0,
    request: {
      url: input.request.url,
      method: "POST",
      headers: input.request.headers || {},
      body: input.request.body ?? null,
      bodySha256: input.request.bodySha256 || null,
    },
    attempts: [],
    latestResponse: null,
    lastError: null,
    nextAttemptAt: input.nextAttemptAt || null,
    queuedAt: now,
    sentAt: null,
    failedAt: null,
    disabledAt: null,
    replayOfDeliveryId: input.replayOfDeliveryId || null,
    createdAt: now,
    updatedAt: now,
  };

  await db.collection<WebhookDeliveryDoc>(WEBHOOK_DELIVERIES_COLLECTION).insertOne(delivery);
  return delivery;
};

export const findWebhookDeliveryById = async (db: Db, deliveryId: string) =>
  db.collection<WebhookDeliveryDoc>(WEBHOOK_DELIVERIES_COLLECTION).findOne({
    _id: deliveryId,
  });

export const listWebhookDeliveriesForWorkspace = async (
  db: Db,
  workspaceId: string,
  options: {
    workflowId?: string;
    status?: WebhookDeliveryStatus;
    limit?: number;
  } = {}
) => {
  const filter: Record<string, unknown> = { workspaceId };
  if (options.workflowId) {
    filter.workflowId = options.workflowId;
  }
  if (options.status) {
    filter.status = options.status;
  }

  return db
    .collection<WebhookDeliveryDoc>(WEBHOOK_DELIVERIES_COLLECTION)
    .find(filter)
    .sort({ createdAt: -1 })
    .limit(Math.max(1, options.limit || 50))
    .toArray();
};

export const appendWebhookDeliveryAttempt = async (
  db: Db,
  deliveryId: string,
  input: Omit<WebhookDeliveryAttemptDoc, "attemptNumber"> & {
    attemptNumber?: number;
    nextAttemptAt?: Date | null;
  }
) => {
  const existing = await findWebhookDeliveryById(db, deliveryId);
  if (!existing) {
    return null;
  }

  const attemptNumber = Math.max(1, input.attemptNumber || existing.attemptCount + 1);
  const attempt: WebhookDeliveryAttemptDoc = {
    attemptNumber,
    status: input.status,
    queuedAt: input.queuedAt || null,
    startedAt: input.startedAt || null,
    finishedAt: input.finishedAt || null,
    request: input.request || null,
    response: input.response || null,
    error: input.error || null,
  };

  const now = new Date();
  const nextStatus: WebhookDeliveryStatus =
    input.status === "sending"
      ? "sending"
      : input.status === "sent"
        ? "sent"
        : input.nextAttemptAt
          ? "queued"
          : "failed";

  await db.collection<WebhookDeliveryDoc>(WEBHOOK_DELIVERIES_COLLECTION).updateOne(
    { _id: deliveryId },
    {
      $set: {
        status: nextStatus,
        attemptCount: Math.max(existing.attemptCount, attemptNumber),
        latestResponse: input.response || null,
        lastError: input.error || null,
        nextAttemptAt: input.nextAttemptAt || null,
        updatedAt: now,
        ...(nextStatus === "sent" ? { sentAt: input.finishedAt || now, failedAt: null } : {}),
        ...(nextStatus === "failed" ? { failedAt: input.finishedAt || now } : {}),
      },
      $push: {
        attempts: attempt,
      },
    }
  );

  return findWebhookDeliveryById(db, deliveryId);
};

export const disableWebhookDeliveryById = async (db: Db, deliveryId: string) => {
  await db.collection<WebhookDeliveryDoc>(WEBHOOK_DELIVERIES_COLLECTION).updateOne(
    { _id: deliveryId },
    {
      $set: {
        status: "disabled",
        disabledAt: new Date(),
        updatedAt: new Date(),
      },
    }
  );

  return findWebhookDeliveryById(db, deliveryId);
};

export const createWebhookDeliveryReplay = async (
  db: Db,
  deliveryId: string,
  overrides: {
    deliveryKey?: string | null;
    nextAttemptAt?: Date | null;
  } = {}
) => {
  const existing = await findWebhookDeliveryById(db, deliveryId);
  if (!existing) {
    return null;
  }

  return createWebhookDelivery(db, {
    workspaceId: existing.workspaceId,
    workflowId: existing.workflowId,
    workflowVersion: existing.workflowVersion,
    request: existing.request,
    eventType: existing.eventType,
    connectionId: existing.connectionId || null,
    sourceEventId: existing.sourceEventId || null,
    deliveryKey:
      overrides.deliveryKey !== undefined ? overrides.deliveryKey : existing.deliveryKey,
    maxAttempts: existing.maxAttempts,
    nextAttemptAt: overrides.nextAttemptAt || null,
    replayOfDeliveryId: existing._id,
  });
};

export const serializeWebhookDelivery = (delivery: WebhookDeliveryDoc | null) => {
  if (!delivery) return null;

  return {
    id: delivery._id,
    workspaceId: delivery.workspaceId,
    workflowId: delivery.workflowId,
    workflowVersion: delivery.workflowVersion,
    connectionId: delivery.connectionId || null,
    eventType: delivery.eventType,
    sourceEventId: delivery.sourceEventId || null,
    deliveryKey: delivery.deliveryKey || null,
    status: delivery.status,
    maxAttempts: delivery.maxAttempts,
    attemptCount: delivery.attemptCount,
    request: {
      url: delivery.request.url,
      method: delivery.request.method,
      headers: delivery.request.headers || {},
      body: delivery.request.body ?? null,
      bodySha256: delivery.request.bodySha256 || null,
    },
    attempts: delivery.attempts.map(serializeWebhookDeliveryAttempt),
    latestResponse: serializeWebhookDeliveryResponse(delivery.latestResponse),
    lastError: delivery.lastError || null,
    nextAttemptAt: serializeDate(delivery.nextAttemptAt),
    queuedAt: serializeDate(delivery.queuedAt),
    sentAt: serializeDate(delivery.sentAt),
    failedAt: serializeDate(delivery.failedAt),
    disabledAt: serializeDate(delivery.disabledAt),
    replayOfDeliveryId: delivery.replayOfDeliveryId || null,
    createdAt: delivery.createdAt.toISOString(),
    updatedAt: delivery.updatedAt.toISOString(),
  };
};
