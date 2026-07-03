import { randomUUID } from "crypto";
import { ObjectId, type Db } from "mongodb";
import { enqueueJob } from "@/lib/jobs/store";
import { getValidSlackToken } from "@/lib/slack";
import { getAssigneeLabel, resolveAssigneePersonId } from "@/lib/task-assignee";
import { normalizePersonNameKey } from "@/lib/transcript-utils";
import { listActiveWorkspaceMembershipsForWorkspace } from "@/lib/workspace-memberships";
import {
  resolveSlackReminderSettings,
  type SlackReminderSettings,
} from "@/lib/workspace-settings";
import { findWorkspaceById, type WorkspaceDoc } from "@/lib/workspaces";

/**
 * Phase 10 — Slack scheduled task reminders.
 *
 * DESIGN DECISION: scheduling is done by OUR OWN job queue (`enqueueJob` with a
 * future `runAt`), NOT Slack's `chat.scheduleMessage`. Owning the schedule keeps
 * cancelation and rescheduling first-class (a reminder doc flip is enough — the
 * delayed send job simply no-ops), avoids Slack's 120-day horizon and
 * per-channel scheduled-message caps, and makes the `taskReminders` doc the
 * single audit trail (scheduled/sent/failed/canceled). The trade-off is that
 * delivery requires the standalone worker (`npm run jobs:worker`) or
 * request-traffic kicks — the settings UI states this explicitly.
 *
 * TIMEZONE: all "09:00 on <day>" math uses the workspace's
 * `settings.timezone`; when absent or invalid we fall back to UTC.
 *
 * DIGEST STATE: the daily-digest "sent today" guard is tracked on a small
 * `slackReminderState` doc (`_id = workspace:<id>` or `user:<id>`), field
 * `lastDigestSentAt` — kept out of workspace settings so digest bookkeeping
 * never races user-driven settings writes.
 */

export const TASK_REMINDERS_COLLECTION = "taskReminders";
const REMINDER_STATE_COLLECTION = "slackReminderState";

export type TaskReminderKind = "before_due" | "on_due" | "overdue" | "custom";
export type TaskReminderStatus = "scheduled" | "sent" | "failed" | "canceled";

export interface TaskReminderTarget {
  type: "dm" | "channel";
  slackUserId?: string | null;
  channelId?: string | null;
  assigneeName?: string | null;
}

export interface TaskReminderDoc {
  _id: string;
  workspaceId: string | null;
  /** Actor/owner user id — used for job scoping and people/person lookups. */
  userId: string;
  taskId: string;
  kind: TaskReminderKind;
  /** `taskId:kind:<stamp>` — see buildTaskReminderDedupKey. */
  dedupKey: string;
  status: TaskReminderStatus;
  runAt: Date;
  taskTitle: string;
  /** ISO snapshot of the task dueAt when the reminder was enrolled. */
  taskDueAt: string | null;
  target: TaskReminderTarget;
  attempts: number;
  sentAt?: Date | null;
  failedAt?: Date | null;
  canceledAt?: Date | null;
  cancelReason?: string | null;
  lastError?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type SendTaskReminderOutcome = "sent" | "skipped" | "failed";

const REMINDER_LOCAL_HOUR = 9;
const PAST_SKIP_GRACE_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
export const REMINDER_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

const getRemindersCollection = (db: Db) =>
  db.collection<TaskReminderDoc>(TASK_REMINDERS_COLLECTION);

// --- index bootstrap (mirrors webhookDeliveries' unique dedup partial index) ---

let taskReminderIndexesEnsured = false;
let taskReminderIndexesEnsuring: Promise<void> | null = null;

export const ensureTaskReminderIndexes = async (db: Db) => {
  if (taskReminderIndexesEnsured) return;
  if (taskReminderIndexesEnsuring) {
    await taskReminderIndexesEnsuring;
    return;
  }
  taskReminderIndexesEnsuring = (async () => {
    const collection = getRemindersCollection(db);
    await Promise.all([
      collection.createIndex(
        { workspaceId: 1, dedupKey: 1 },
        {
          name: "task_reminders_workspace_dedup_unique",
          unique: true,
          partialFilterExpression: { dedupKey: { $type: "string" } },
        }
      ),
      collection.createIndex(
        { workspaceId: 1, status: 1, runAt: 1 },
        { name: "task_reminders_workspace_status_run_at" }
      ),
      collection.createIndex(
        { taskId: 1, status: 1 },
        { name: "task_reminders_task_status" }
      ),
      collection.createIndex(
        { userId: 1, status: 1, runAt: 1 },
        { name: "task_reminders_user_status_run_at" }
      ),
    ]);
    taskReminderIndexesEnsured = true;
  })().finally(() => {
    taskReminderIndexesEnsuring = null;
  });
  await taskReminderIndexesEnsuring;
};

// --- timezone helpers ---

const isValidTimezone = (timeZone: string): boolean => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
};

export const resolveReminderTimezone = (
  workspace: WorkspaceDoc | null | undefined
): string => {
  const timezone = workspace?.settings?.timezone;
  return typeof timezone === "string" && timezone && isValidTimezone(timezone)
    ? timezone
    : "UTC";
};

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

const getZonedParts = (date: Date, timeZone: string): ZonedParts => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts: Record<string, string> = {};
  formatter.formatToParts(date).forEach((part) => {
    parts[part.type] = part.value;
  });
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
  };
};

const zonedTimeToUtc = (
  timeZone: string,
  input: { year: number; month: number; day: number; hour?: number; minute?: number }
): Date => {
  const hour = input.hour ?? 0;
  const minute = input.minute ?? 0;
  const desired = Date.UTC(input.year, input.month - 1, input.day, hour, minute);
  let timestamp = desired;
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const actualParts = getZonedParts(new Date(timestamp), timeZone);
    const actual = Date.UTC(
      actualParts.year,
      actualParts.month - 1,
      actualParts.day,
      actualParts.hour,
      actualParts.minute
    );
    timestamp += desired - actual;
  }
  return new Date(timestamp);
};

const addDaysToDateParts = (
  parts: { year: number; month: number; day: number },
  days: number
) => {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day) + days * DAY_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
};

/** 09:00 workspace-local on (due day + dayOffset). */
const reminderInstantForDue = (dueDate: Date, timeZone: string, dayOffset: number) => {
  const dueParts = getZonedParts(dueDate, timeZone);
  const targetDay = addDaysToDateParts(dueParts, dayOffset);
  return zonedTimeToUtc(timeZone, { ...targetDay, hour: REMINDER_LOCAL_HOUR });
};

/**
 * If runAt's local hour falls inside quiet hours, shift it to the quiet-hours
 * end (same local day for the "morning" segment, next day for the "evening"
 * segment). quietHoursStart === quietHoursEnd disables quiet hours.
 */
export const shiftOutOfQuietHours = (
  runAt: Date,
  timeZone: string,
  quietHoursStart: number,
  quietHoursEnd: number
): Date => {
  if (quietHoursStart === quietHoursEnd) return runAt;
  const parts = getZonedParts(runAt, timeZone);
  const inQuiet =
    quietHoursStart < quietHoursEnd
      ? parts.hour >= quietHoursStart && parts.hour < quietHoursEnd
      : parts.hour >= quietHoursStart || parts.hour < quietHoursEnd;
  if (!inQuiet) return runAt;
  const baseDay = { year: parts.year, month: parts.month, day: parts.day };
  const targetDay = parts.hour < quietHoursEnd ? baseDay : addDaysToDateParts(baseDay, 1);
  return zonedTimeToUtc(timeZone, { ...targetDay, hour: quietHoursEnd });
};

const localDateKey = (date: Date, timeZone: string) => {
  const parts = getZonedParts(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
};

// --- dedup key ---

/**
 * `on_due`/`overdue` are keyed on the task's dueAt ISO snapshot; `before_due`
 * and `custom` are keyed on the instance's (pre-quiet-shift) runAt ISO so
 * multiple `remindDaysBefore` entries produce distinct keys.
 */
export const buildTaskReminderDedupKey = (
  taskId: string,
  kind: TaskReminderKind,
  isoStamp: string
) => `${taskId}:${kind}:${isoStamp}`;

// --- task helpers ---

type TaskRecord = Record<string, any>;

const toDueIso = (value: unknown): string | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

/**
 * A reminder-eligible "open" task: todo/inprogress, not archived, not a mere
 * AI suggestion, not cleanup-expired.
 */
const isTaskOpen = (task: TaskRecord | null | undefined): boolean => {
  if (!task) return false;
  if (task.status !== "todo" && task.status !== "inprogress") return false;
  if (task.taskState === "archived" || task.taskState === "suggested") return false;
  if (task.cleanupStatus === "expired") return false;
  return true;
};

const taskIdOf = (task: TaskRecord) => String(task._id ?? task.id ?? "");

// --- Slack resolution ---

const roleRank = (role: string | null | undefined) => {
  if (role === "owner") return 3;
  if (role === "admin") return 2;
  if (role === "member") return 1;
  return 0;
};

/**
 * Picks the Slack team the reminder is sent through: role-ranked scan of the
 * workspace's active members (the /api/users/me provider-resolution pattern),
 * falling back to the reminder owner's own connection. Returns null when
 * nobody in scope has Slack connected.
 */
export const resolveReminderSlackTeamId = async (
  db: Db,
  workspaceId: string | null,
  userId: string
): Promise<string | null> => {
  try {
    if (workspaceId) {
      const memberships = await listActiveWorkspaceMembershipsForWorkspace(
        db,
        workspaceId
      );
      const orderedUserIds = [...memberships]
        .sort((left: any, right: any) => roleRank(right.role) - roleRank(left.role))
        .map((membership: any) => String(membership.userId))
        .filter((memberId) => ObjectId.isValid(memberId));
      if (orderedUserIds.length) {
        const users = await db
          .collection("users")
          .find(
            { _id: { $in: orderedUserIds.map((value) => new ObjectId(value)) } },
            { projection: { _id: 1, slackTeamId: 1 } }
          )
          .toArray();
        const userById = new Map(
          users.map((candidate: any) => [String(candidate._id), candidate] as const)
        );
        for (const memberId of orderedUserIds) {
          const candidate = userById.get(memberId);
          if (candidate?.slackTeamId) {
            return String(candidate.slackTeamId);
          }
        }
      }
    }
    if (ObjectId.isValid(userId)) {
      const owner = await db
        .collection("users")
        .findOne({ _id: new ObjectId(userId) }, { projection: { slackTeamId: 1, email: 1 } });
      return owner?.slackTeamId ? String(owner.slackTeamId) : null;
    }
  } catch {
    return null;
  }
  return null;
};

const slackApiPost = async (
  accessToken: string,
  method: string,
  body: Record<string, unknown>
): Promise<{ ok: boolean; error?: string; channel?: { id?: string } }> => {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });
  return (await response.json()) as {
    ok: boolean;
    error?: string;
    channel?: { id?: string };
  };
};

/** uid → email → nameKey person matching (the existing heuristic), then person.slackId. */
const resolveAssigneeSlackUserId = async (
  db: Db,
  ownerUserId: string,
  task: TaskRecord
): Promise<string | null> => {
  const directSlackId = task.assignee?.slackId;
  if (typeof directSlackId === "string" && directSlackId) {
    return directSlackId;
  }
  const people = await db
    .collection("people")
    .find(
      { userId: ownerUserId },
      { projection: { _id: 1, name: 1, email: 1, slackId: 1 } }
    )
    .toArray();
  if (!people.length) return null;

  const peopleById = new Map<string, any>();
  const personEmailToId = new Map<string, string>();
  const personNameKeyToId = new Map<string, string>();
  people.forEach((person: any) => {
    const personId = String(person._id);
    peopleById.set(personId, person);
    const email = typeof person.email === "string" ? person.email.toLowerCase() : "";
    if (email && !personEmailToId.has(email)) {
      personEmailToId.set(email, personId);
    }
    const nameKey = person.name ? normalizePersonNameKey(person.name) : "";
    if (nameKey && !personNameKeyToId.has(nameKey)) {
      personNameKeyToId.set(nameKey, personId);
    }
  });

  const personId = resolveAssigneePersonId(task as any, {
    peopleById: peopleById as any,
    personEmailToId,
    personNameKeyToId,
  });
  if (!personId) return null;
  const person = peopleById.get(String(personId));
  return typeof person?.slackId === "string" && person.slackId ? person.slackId : null;
};

const appBaseUrl = () =>
  (process.env.NEXTAUTH_URL || process.env.APP_URL || "").replace(/\/$/, "");

const formatDueDate = (dueIso: string | null, timeZone: string) => {
  if (!dueIso) return null;
  const date = new Date(dueIso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const buildDuePhrase = (
  kind: TaskReminderKind,
  dueIso: string | null,
  timeZone: string
) => {
  const dateText = formatDueDate(dueIso, timeZone);
  if (!dateText) return "No due date";
  switch (kind) {
    case "before_due":
      return `Due ${dateText}`;
    case "on_due":
      return `Due today (${dateText})`;
    case "overdue":
      return `Overdue — was due ${dateText}`;
    default:
      return `Due ${dateText}`;
  }
};

/** Compact Block Kit reminder message (mirrors formatTasksToSlackBlocks conventions). */
const buildReminderBlocks = (
  reminder: TaskReminderDoc,
  task: TaskRecord,
  timeZone: string
) => {
  const duePhrase = buildDuePhrase(reminder.kind, reminder.taskDueAt, timeZone);
  const priority = task.priorityLabel || task.priority;
  const details: string[] = [`_${duePhrase}_`];
  if (typeof priority === "string" && priority && priority !== "medium") {
    details.push(`_Priority: ${priority}_`);
  }
  const text = `:alarm_clock: *Task reminder:* ${reminder.taskTitle}\n>${details.join(" | ")}`;
  const blocks: Array<{ type: string; [key: string]: any }> = [
    {
      type: "section",
      text: { type: "mrkdwn", text },
    },
  ];
  const baseUrl = appBaseUrl();
  if (baseUrl) {
    blocks.push({
      type: "context",
      elements: [
        { type: "mrkdwn", text: `<${baseUrl}/review|Open in Taskwise>` },
      ],
    });
  }
  return {
    blocks,
    fallbackText: `Task reminder: ${reminder.taskTitle} (${duePhrase})`,
  };
};

// --- cancelation ---

/**
 * Flips every scheduled reminder for the given task(s) to canceled in one
 * updateMany. Cheap by design: used inline in the task.status.changed handler
 * and the dueAt-change hook; already-enqueued send jobs no-op afterwards.
 */
export const cancelRemindersForTask = async (
  db: Db,
  taskId: string | string[],
  reason: string
): Promise<{ canceled: number }> => {
  const taskIds = (Array.isArray(taskId) ? taskId : [taskId])
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  if (!taskIds.length) {
    return { canceled: 0 };
  }
  const now = new Date();
  const result = await getRemindersCollection(db).updateMany(
    { taskId: { $in: taskIds }, status: "scheduled" },
    {
      $set: {
        status: "canceled" as TaskReminderStatus,
        canceledAt: now,
        cancelReason: reason,
        updatedAt: now,
      },
    }
  );
  return { canceled: result?.modifiedCount || 0 };
};

// --- sweep job enqueue (duplicate-pending guarded) ---

/**
 * Enqueues a 'slack-reminder-sweep' job unless one is already pending
 * (status queued) for the same workspace. Used by the sweep job itself for
 * self-perpetuation and by API routes that need to (re)start the loop.
 */
export const enqueueReminderSweepJob = async (
  db: Db,
  input: {
    workspaceId: string | null;
    userId: string;
    runAt?: Date;
    correlationId?: string;
  }
): Promise<{ enqueued: boolean; jobId: string }> => {
  const workspaceId = input.workspaceId ?? null;
  const existing = await db.collection("jobs").findOne(
    {
      type: "slack-reminder-sweep",
      status: "queued",
      "payload.workspaceId": workspaceId,
    },
    { projection: { _id: 1 } }
  );
  if (existing) {
    return { enqueued: false, jobId: String(existing._id) };
  }
  const job = await enqueueJob(db, {
    type: "slack-reminder-sweep",
    userId: input.userId,
    correlationId: input.correlationId,
    payload: { workspaceId },
    maxAttempts: 1,
    runAt: input.runAt,
  });
  return { enqueued: true, jobId: job._id };
};

// --- sweep ---

type DesiredInstance = {
  kind: TaskReminderKind;
  runAt: Date;
  dedupKey: string;
};

const computeDesiredInstances = (
  taskId: string,
  dueDate: Date,
  dueIso: string,
  settings: SlackReminderSettings,
  timeZone: string
): DesiredInstance[] => {
  const nominal: Array<{ kind: TaskReminderKind; at: Date }> = [];
  settings.remindDaysBefore.forEach((days) => {
    nominal.push({ kind: "before_due", at: reminderInstantForDue(dueDate, timeZone, -days) });
  });
  if (settings.remindOnDue) {
    nominal.push({ kind: "on_due", at: reminderInstantForDue(dueDate, timeZone, 0) });
  }
  if (settings.remindOverdue) {
    nominal.push({ kind: "overdue", at: reminderInstantForDue(dueDate, timeZone, 1) });
  }
  return nominal
    .map((instance) => ({
      kind: instance.kind,
      runAt: shiftOutOfQuietHours(
        instance.at,
        timeZone,
        settings.quietHoursStart,
        settings.quietHoursEnd
      ),
      dedupKey: buildTaskReminderDedupKey(
        taskId,
        instance.kind,
        instance.kind === "before_due" ? instance.at.toISOString() : dueIso
      ),
    }))
    .sort((left, right) => left.runAt.getTime() - right.runAt.getTime());
};

const isDuplicateKeyError = (error: unknown) =>
  Boolean(
    error &&
      typeof error === "object" &&
      ((error as { code?: number }).code === 11000 ||
        /E11000/i.test((error as { message?: string }).message || ""))
  );

export type ReminderSweepResult = {
  enrolled: number;
  canceledStale: number;
  skipped: number;
  /** Additive: whether reminders are enabled for the swept scope. */
  enabled: boolean;
  /** Additive: whether this sweep sent the daily digest. */
  digestSent: boolean;
};

/**
 * Enrolls the scope's open due-dated tasks into reminder instances, cancels
 * stale scheduled reminders (task closed or dueAt drifted), and — when digest
 * is 'daily' — sends at most one summary per local day.
 *
 * Scope: a workspaceId scopes by task.workspaceId; a null workspaceId falls
 * back to the actor's personal tasks (task.userId) — personal scopes use
 * default settings (disabled) until a workspace configures slackReminders.
 */
export const runReminderSweep = async (
  db: Db,
  input: {
    workspaceId: string | null;
    userId: string;
    correlationId?: string;
    now?: Date;
  }
): Promise<ReminderSweepResult> => {
  const workspaceId = input.workspaceId ?? null;
  const userId = input.userId;
  const now = input.now ?? new Date();

  const workspace = workspaceId ? await findWorkspaceById(db, workspaceId) : null;
  const settings = resolveSlackReminderSettings(workspace);
  if (!settings.enabled) {
    return { enrolled: 0, canceledStale: 0, skipped: 0, enabled: false, digestSent: false };
  }

  await ensureTaskReminderIndexes(db);
  const timeZone = resolveReminderTimezone(workspace);
  const taskScope: Record<string, unknown> = workspaceId ? { workspaceId } : { userId };
  const reminderScope: Record<string, unknown> = workspaceId
    ? { workspaceId }
    : { workspaceId: null, userId };

  const dueTasks = (await db
    .collection("tasks")
    .find(
      {
        ...taskScope,
        status: { $in: ["todo", "inprogress"] },
        dueAt: { $exists: true, $nin: [null, ""] },
      },
      {
        projection: {
          _id: 1,
          id: 1,
          title: 1,
          status: 1,
          taskState: 1,
          cleanupStatus: 1,
          dueAt: 1,
          priority: 1,
          priorityLabel: 1,
          priorityScore: 1,
          assignee: 1,
          assigneeName: 1,
          assigneeNameKey: 1,
          assigneeEmail: 1,
        },
      }
    )
    .toArray()) as TaskRecord[];

  const openTasks = dueTasks.filter(
    (task) => isTaskOpen(task) && toDueIso(task.dueAt) && taskIdOf(task)
  );

  let enrolled = 0;
  let skipped = 0;

  const openTaskIds = openTasks.map((task) => taskIdOf(task));
  const remindersCollection = getRemindersCollection(db);
  const existingForTasks = openTaskIds.length
    ? ((await remindersCollection
        .find({ ...reminderScope, taskId: { $in: openTaskIds } })
        .toArray()) as TaskReminderDoc[])
    : [];
  // Dedup considers every status: the unique index blocks re-inserting a key
  // even after cancel/failure, which is the desired no-respam behavior.
  const existingDedupKeys = new Set(existingForTasks.map((doc) => doc.dedupKey));
  const activeCountByTask = new Map<string, number>();
  existingForTasks.forEach((doc) => {
    if (doc.status === "scheduled" || doc.status === "sent") {
      activeCountByTask.set(doc.taskId, (activeCountByTask.get(doc.taskId) || 0) + 1);
    }
  });

  for (const task of openTasks) {
    const taskId = taskIdOf(task);
    const dueIso = toDueIso(task.dueAt) as string;
    const dueDate = new Date(dueIso);
    const instances = computeDesiredInstances(taskId, dueDate, dueIso, settings, timeZone);

    for (const instance of instances) {
      if (existingDedupKeys.has(instance.dedupKey)) {
        skipped += 1;
        continue;
      }
      if (instance.runAt.getTime() < now.getTime() - PAST_SKIP_GRACE_MS) {
        skipped += 1;
        continue;
      }
      const activeCount = activeCountByTask.get(taskId) || 0;
      if (activeCount >= settings.maxRemindersPerTask) {
        skipped += 1;
        continue;
      }

      const reminder: TaskReminderDoc = {
        _id: randomUUID(),
        workspaceId,
        userId,
        taskId,
        kind: instance.kind,
        dedupKey: instance.dedupKey,
        status: "scheduled",
        runAt: instance.runAt,
        taskTitle: String(task.title || "Untitled task"),
        taskDueAt: dueIso,
        target: {
          type: settings.deliver === "channel" ? "channel" : "dm",
          slackUserId: null,
          channelId: settings.deliver === "channel" ? settings.defaultChannelId : null,
          assigneeName: getAssigneeLabel(task as any) || null,
        },
        attempts: 0,
        sentAt: null,
        failedAt: null,
        canceledAt: null,
        cancelReason: null,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      };

      try {
        await remindersCollection.insertOne(reminder);
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          existingDedupKeys.add(instance.dedupKey);
          skipped += 1;
          continue;
        }
        throw error;
      }

      existingDedupKeys.add(instance.dedupKey);
      activeCountByTask.set(taskId, activeCount + 1);
      enrolled += 1;
      await enqueueJob(db, {
        type: "slack-reminder-send",
        userId,
        correlationId: input.correlationId,
        payload: { reminderId: reminder._id },
        maxAttempts: 1,
        runAt: instance.runAt,
      });
    }
  }

  // --- cancel stale scheduled reminders (task closed or dueAt drifted) ---
  const scheduled = (await remindersCollection
    .find({ ...reminderScope, status: "scheduled" })
    .toArray()) as TaskReminderDoc[];

  let canceledStale = 0;
  if (scheduled.length) {
    const taskById = new Map<string, TaskRecord>();
    dueTasks.forEach((task) => taskById.set(taskIdOf(task), task));
    const missingTaskIds = Array.from(
      new Set(
        scheduled
          .map((doc) => doc.taskId)
          .filter((candidateId) => !taskById.has(candidateId))
      )
    );
    if (missingTaskIds.length) {
      const extraTasks = (await db
        .collection("tasks")
        .find(
          { $or: [{ _id: { $in: missingTaskIds } }, { id: { $in: missingTaskIds } }] } as any,
          {
            projection: {
              _id: 1,
              id: 1,
              status: 1,
              taskState: 1,
              cleanupStatus: 1,
              dueAt: 1,
            },
          }
        )
        .toArray()) as TaskRecord[];
      extraTasks.forEach((task) => {
        taskById.set(taskIdOf(task), task);
        if (task.id) taskById.set(String(task.id), task);
      });
    }

    const staleIds = scheduled
      .filter((doc) => {
        const task = taskById.get(doc.taskId) || null;
        if (!task || !isTaskOpen(task)) return true;
        if (doc.kind !== "custom" && toDueIso(task.dueAt) !== doc.taskDueAt) return true;
        return false;
      })
      .map((doc) => doc._id);

    if (staleIds.length) {
      const result = await remindersCollection.updateMany(
        { _id: { $in: staleIds }, status: "scheduled" },
        {
          $set: {
            status: "canceled" as TaskReminderStatus,
            canceledAt: now,
            cancelReason: "stale",
            updatedAt: now,
          },
        }
      );
      canceledStale = result?.modifiedCount || 0;
    }
  }

  // --- daily digest (at most once per workspace-local day) ---
  let digestSent = false;
  if (settings.digest === "daily") {
    digestSent = await maybeSendDailyDigest(db, {
      workspaceId,
      userId,
      settings,
      timeZone,
      openTasks,
      now,
    });
  }

  return { enrolled, canceledStale, skipped, enabled: true, digestSent };
};

// --- daily digest ---

const maybeSendDailyDigest = async (
  db: Db,
  input: {
    workspaceId: string | null;
    userId: string;
    settings: SlackReminderSettings;
    timeZone: string;
    openTasks: TaskRecord[];
    now: Date;
  }
): Promise<boolean> => {
  const { workspaceId, userId, settings, timeZone, openTasks, now } = input;
  try {
    const stateId = workspaceId ? `workspace:${workspaceId}` : `user:${userId}`;
    const state = await db.collection(REMINDER_STATE_COLLECTION).findOne({ _id: stateId } as any);
    const todayKey = localDateKey(now, timeZone);
    const lastSentAt = state?.lastDigestSentAt ? new Date(state.lastDigestSentAt) : null;
    if (lastSentAt && !Number.isNaN(lastSentAt.getTime())) {
      if (localDateKey(lastSentAt, timeZone) === todayKey) {
        return false;
      }
    }

    const nowParts = getZonedParts(now, timeZone);
    const startOfToday = zonedTimeToUtc(timeZone, {
      year: nowParts.year,
      month: nowParts.month,
      day: nowParts.day,
      hour: 0,
    });
    const startOfTomorrow = zonedTimeToUtc(timeZone, {
      ...addDaysToDateParts(nowParts, 1),
      hour: 0,
    });

    const withDue = openTasks
      .map((task) => ({ task, dueIso: toDueIso(task.dueAt) }))
      .filter((entry): entry is { task: TaskRecord; dueIso: string } => Boolean(entry.dueIso));
    const overdue = withDue.filter(
      (entry) => new Date(entry.dueIso).getTime() < startOfToday.getTime()
    );
    const dueToday = withDue.filter((entry) => {
      const time = new Date(entry.dueIso).getTime();
      return time >= startOfToday.getTime() && time < startOfTomorrow.getTime();
    });
    if (!overdue.length && !dueToday.length) {
      return false;
    }

    const teamId = await resolveReminderSlackTeamId(db, workspaceId, userId);
    if (!teamId) return false;
    const accessToken = await getValidSlackToken(teamId);

    let channelId: string | null = settings.defaultChannelId;
    if (!channelId) {
      // Fall back to the sweep owner's DM (email → person.slackId mapping).
      const ownerSlackId = await resolveOwnerSlackUserId(db, userId);
      if (!ownerSlackId) return false;
      const opened = await slackApiPost(accessToken, "conversations.open", {
        users: ownerSlackId,
      });
      if (!opened.ok || !opened.channel?.id) return false;
      channelId = opened.channel.id;
    }

    const topTasks = [...overdue, ...dueToday]
      .sort(
        (left, right) =>
          (Number(right.task.priorityScore) || 0) - (Number(left.task.priorityScore) || 0)
      )
      .slice(0, 5);
    const taskLines = topTasks
      .map((entry) => {
        const dueText = formatDueDate(entry.dueIso, timeZone);
        return `• *${entry.task.title || "Untitled task"}*${dueText ? ` — due ${dueText}` : ""}`;
      })
      .join("\n");
    const baseUrl = appBaseUrl();
    const blocks: Array<{ type: string; [key: string]: any }> = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:calendar: *Daily task digest*\n${overdue.length} overdue · ${dueToday.length} due today`,
        },
      },
    ];
    if (taskLines) {
      blocks.push({ type: "section", text: { type: "mrkdwn", text: taskLines } });
    }
    if (baseUrl) {
      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: `<${baseUrl}/review|Open in Taskwise>` }],
      });
    }

    const posted = await slackApiPost(accessToken, "chat.postMessage", {
      channel: channelId,
      blocks,
      text: `Daily task digest: ${overdue.length} overdue, ${dueToday.length} due today`,
    });
    if (!posted.ok) return false;

    await db.collection(REMINDER_STATE_COLLECTION).updateOne(
      { _id: stateId } as any,
      { $set: { lastDigestSentAt: now, updatedAt: now } },
      { upsert: true }
    );
    return true;
  } catch {
    // Digest is best-effort; never fail the sweep for it.
    return false;
  }
};

const resolveOwnerSlackUserId = async (db: Db, userId: string): Promise<string | null> => {
  if (!ObjectId.isValid(userId)) return null;
  const owner = await db
    .collection("users")
    .findOne({ _id: new ObjectId(userId) }, { projection: { email: 1 } });
  const email = typeof owner?.email === "string" ? owner.email : "";
  if (!email) return null;
  const person = await db.collection("people").findOne(
    {
      userId,
      email,
      slackId: { $type: "string", $ne: "" },
    },
    { projection: { slackId: 1 } }
  );
  return person?.slackId ? String(person.slackId) : null;
};

// --- send ---

const markReminderFailed = async (
  db: Db,
  reminderId: string,
  errorMessage: string,
  now: Date
) => {
  await getRemindersCollection(db).updateOne(
    { _id: reminderId, status: "scheduled" },
    {
      $set: {
        status: "failed" as TaskReminderStatus,
        failedAt: now,
        lastError: errorMessage,
        updatedAt: now,
      },
      $inc: { attempts: 1 },
    }
  );
};

/**
 * Sends one reminder. Never throws — every outcome is written to the reminder
 * doc (the audit trail). No-ops with 'skipped' whenever the doc is no longer
 * 'scheduled' (the workflow-delivery skip pattern) so canceled/rescheduled
 * reminders make their already-enqueued send jobs harmless.
 */
export const sendTaskReminder = async (
  db: Db,
  reminderId: string
): Promise<SendTaskReminderOutcome> => {
  const remindersCollection = getRemindersCollection(db);
  const reminder = (await remindersCollection.findOne({
    _id: reminderId,
  })) as TaskReminderDoc | null;
  if (!reminder || reminder.status !== "scheduled") {
    return "skipped";
  }

  const now = new Date();
  try {
    const task = (await db.collection("tasks").findOne({
      $or: [{ _id: reminder.taskId }, { id: reminder.taskId }],
    } as any)) as TaskRecord | null;

    const currentDueIso = toDueIso(task?.dueAt);
    const stale =
      !task ||
      !isTaskOpen(task) ||
      (reminder.kind !== "custom" && currentDueIso !== reminder.taskDueAt);
    if (stale) {
      await remindersCollection.updateOne(
        { _id: reminderId, status: "scheduled" },
        {
          $set: {
            status: "canceled" as TaskReminderStatus,
            canceledAt: now,
            cancelReason: "task_changed",
            updatedAt: now,
          },
        }
      );
      return "skipped";
    }

    const workspace = reminder.workspaceId
      ? await findWorkspaceById(db, reminder.workspaceId)
      : null;
    const settings = resolveSlackReminderSettings(workspace);
    const timeZone = resolveReminderTimezone(workspace);

    // Resolve the intended target with fresh settings + person mapping.
    let slackUserId: string | null = null;
    if (settings.deliver === "dm") {
      slackUserId = await resolveAssigneeSlackUserId(db, reminder.userId, task);
    }
    const fallbackChannelId = settings.defaultChannelId;
    if (!slackUserId && !fallbackChannelId) {
      await markReminderFailed(db, reminderId, "no_slack_target", now);
      return "failed";
    }

    const teamId = await resolveReminderSlackTeamId(
      db,
      reminder.workspaceId,
      reminder.userId
    );
    if (!teamId) {
      await markReminderFailed(db, reminderId, "no_slack_connection", now);
      return "failed";
    }

    let accessToken: string;
    try {
      accessToken = await getValidSlackToken(teamId);
    } catch (error) {
      // Vanished/revoked installation — audit as failed, never throw.
      const message =
        error instanceof Error && error.message ? error.message : "no_slack_connection";
      await markReminderFailed(db, reminderId, message, now);
      return "failed";
    }

    let destinationChannelId: string | null = null;
    let deliveredType: TaskReminderTarget["type"] = "channel";
    if (slackUserId) {
      const opened = await slackApiPost(accessToken, "conversations.open", {
        users: slackUserId,
      });
      if (opened.ok && opened.channel?.id) {
        destinationChannelId = opened.channel.id;
        deliveredType = "dm";
      }
    }
    if (!destinationChannelId && fallbackChannelId) {
      destinationChannelId = fallbackChannelId;
      deliveredType = "channel";
    }
    if (!destinationChannelId) {
      await markReminderFailed(db, reminderId, "no_slack_target", now);
      return "failed";
    }

    const message = buildReminderBlocks(reminder, task, timeZone);
    const posted = await slackApiPost(accessToken, "chat.postMessage", {
      channel: destinationChannelId,
      blocks: message.blocks,
      text: message.fallbackText,
    });
    if (!posted.ok) {
      await markReminderFailed(db, reminderId, posted.error || "slack_post_failed", now);
      return "failed";
    }

    await remindersCollection.updateOne(
      { _id: reminderId, status: "scheduled" },
      {
        $set: {
          status: "sent" as TaskReminderStatus,
          sentAt: now,
          lastError: null,
          updatedAt: now,
          target: {
            type: deliveredType,
            slackUserId: deliveredType === "dm" ? slackUserId : null,
            channelId: destinationChannelId,
            assigneeName: reminder.target?.assigneeName ?? null,
          },
        },
        $inc: { attempts: 1 },
      }
    );
    return "sent";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await markReminderFailed(db, reminderId, message, now);
    } catch {
      // Swallow — sendTaskReminder must never throw.
    }
    return "failed";
  }
};

// --- serialization ---

const serializeDate = (value: Date | string | null | undefined) => {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
};

export const serializeTaskReminder = (reminder: TaskReminderDoc | null) => {
  if (!reminder) return null;
  return {
    id: reminder._id,
    workspaceId: reminder.workspaceId ?? null,
    userId: reminder.userId,
    taskId: reminder.taskId,
    kind: reminder.kind,
    dedupKey: reminder.dedupKey,
    status: reminder.status,
    runAt: serializeDate(reminder.runAt),
    taskTitle: reminder.taskTitle,
    taskDueAt: reminder.taskDueAt ?? null,
    target: {
      type: reminder.target?.type || "dm",
      slackUserId: reminder.target?.slackUserId ?? null,
      channelId: reminder.target?.channelId ?? null,
      assigneeName: reminder.target?.assigneeName ?? null,
    },
    attempts: reminder.attempts || 0,
    sentAt: serializeDate(reminder.sentAt),
    failedAt: serializeDate(reminder.failedAt),
    canceledAt: serializeDate(reminder.canceledAt),
    cancelReason: reminder.cancelReason ?? null,
    lastError: reminder.lastError ?? null,
    createdAt: serializeDate(reminder.createdAt),
    updatedAt: serializeDate(reminder.updatedAt),
  };
};
