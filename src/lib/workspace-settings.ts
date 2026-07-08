import type { WorkspaceDoc } from "@/lib/workspaces";
import type { WorkspaceRole } from "@/lib/workspace-roles";

export type WorkspaceAdminVisibilityKey =
  | "tasks"
  | "people"
  | "projects"
  | "chatSessions"
  | "boards"
  | "integrations";

export type WorkspaceAdminAccessSettings = Record<WorkspaceAdminVisibilityKey, boolean>;

export const DEFAULT_WORKSPACE_ADMIN_ACCESS: WorkspaceAdminAccessSettings = {
  tasks: true,
  people: true,
  projects: true,
  chatSessions: true,
  boards: true,
  integrations: true,
};

type WorkspaceSettingsShape = WorkspaceDoc["settings"] | null | undefined;

export const resolveWorkspaceAdminAccess = (
  settings: WorkspaceSettingsShape
): WorkspaceAdminAccessSettings => {
  const configured = settings?.adminAccess || null;
  return {
    ...DEFAULT_WORKSPACE_ADMIN_ACCESS,
    ...(configured || {}),
  };
};

export const isWorkspaceAdminVisibilityAllowed = (
  role: WorkspaceRole,
  settings: WorkspaceSettingsShape,
  visibilityKey: WorkspaceAdminVisibilityKey
) => {
  if (role !== "admin") {
    return true;
  }
  const adminAccess = resolveWorkspaceAdminAccess(settings);
  return Boolean(adminAccess[visibilityKey]);
};

// --- Task cleanup settings (Phase 3) ---

export type TaskCleanupStrictness = "light" | "balanced" | "aggressive";

export type TaskCleanupCategoryKey =
  | "scheduling_admin"
  | "meeting_logistics"
  | "already_completed"
  | "duplicate"
  | "low_specificity"
  | "stale_follow_up"
  | "expired_event";

export interface TaskCleanupSettings {
  enabled: boolean;
  strictness: TaskCleanupStrictness;
  autoExpireDays: number;
  categories: Record<TaskCleanupCategoryKey, boolean>;
}

export const DEFAULT_TASK_CLEANUP_SETTINGS: TaskCleanupSettings = {
  enabled: true,
  strictness: "balanced",
  autoExpireDays: 14,
  categories: {
    scheduling_admin: true,
    meeting_logistics: true,
    already_completed: true,
    duplicate: true,
    low_specificity: true,
    stale_follow_up: true,
    expired_event: true,
  },
};

const TASK_CLEANUP_STRICTNESS_VALUES: TaskCleanupStrictness[] = [
  "light",
  "balanced",
  "aggressive",
];

const normalizeAutoExpireDays = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_TASK_CLEANUP_SETTINGS.autoExpireDays;
  }
  return Math.min(365, Math.max(1, Math.round(parsed)));
};

// --- Slack reminder settings (Phase 10) ---

export type SlackReminderDeliverMode = "dm" | "channel";
export type SlackReminderDigestFrequency = "off" | "daily";

export interface SlackReminderSettings {
  enabled: boolean;
  /** Days before the due date to remind the assignee (integers, 1..30, max 3 entries). */
  remindDaysBefore: number[];
  remindOnDue: boolean;
  remindOverdue: boolean;
  /** Hard cap of scheduled+sent reminders per task (1..10). */
  maxRemindersPerTask: number;
  deliver: SlackReminderDeliverMode;
  defaultChannelId: string | null;
  /** Local hour (0..23). quietHoursStart === quietHoursEnd disables quiet hours. */
  quietHoursStart: number;
  quietHoursEnd: number;
  digest: SlackReminderDigestFrequency;
}

export const DEFAULT_SLACK_REMINDER_SETTINGS: SlackReminderSettings = {
  enabled: false,
  remindDaysBefore: [1],
  remindOnDue: true,
  remindOverdue: true,
  maxRemindersPerTask: 3,
  deliver: "dm",
  defaultChannelId: null,
  quietHoursStart: 22,
  quietHoursEnd: 7,
  digest: "off",
};

const MAX_REMIND_DAYS_BEFORE_ENTRIES = 3;

const normalizeRemindDaysBefore = (value: unknown): number[] => {
  if (!Array.isArray(value)) {
    return [...DEFAULT_SLACK_REMINDER_SETTINGS.remindDaysBefore];
  }
  const normalized = value
    .map((entry) => (typeof entry === "number" ? Math.round(entry) : Number(entry)))
    .filter((entry) => Number.isInteger(entry) && entry > 0 && entry <= 30);
  const unique = Array.from(new Set(normalized)).sort((left, right) => left - right);
  return unique.slice(0, MAX_REMIND_DAYS_BEFORE_ENTRIES);
};

const normalizeBoundedInt = (
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const rounded = Math.round(parsed);
  if (rounded < min || rounded > max) {
    return fallback;
  }
  return rounded;
};

export const resolveSlackReminderSettings = (
  workspace: WorkspaceDoc | null | undefined
): SlackReminderSettings => {
  const configured =
    ((workspace?.settings as
      | { slackReminders?: Partial<SlackReminderSettings> }
      | null
      | undefined)?.slackReminders as Partial<SlackReminderSettings> | null | undefined) ||
    null;

  const deliver: SlackReminderDeliverMode =
    configured?.deliver === "channel" || configured?.deliver === "dm"
      ? configured.deliver
      : DEFAULT_SLACK_REMINDER_SETTINGS.deliver;
  const digest: SlackReminderDigestFrequency =
    configured?.digest === "daily" || configured?.digest === "off"
      ? configured.digest
      : DEFAULT_SLACK_REMINDER_SETTINGS.digest;
  const defaultChannelId =
    typeof configured?.defaultChannelId === "string" &&
    configured.defaultChannelId.trim()
      ? configured.defaultChannelId.trim()
      : null;

  return {
    enabled:
      typeof configured?.enabled === "boolean"
        ? configured.enabled
        : DEFAULT_SLACK_REMINDER_SETTINGS.enabled,
    remindDaysBefore: normalizeRemindDaysBefore(configured?.remindDaysBefore),
    remindOnDue:
      typeof configured?.remindOnDue === "boolean"
        ? configured.remindOnDue
        : DEFAULT_SLACK_REMINDER_SETTINGS.remindOnDue,
    remindOverdue:
      typeof configured?.remindOverdue === "boolean"
        ? configured.remindOverdue
        : DEFAULT_SLACK_REMINDER_SETTINGS.remindOverdue,
    maxRemindersPerTask: normalizeBoundedInt(
      configured?.maxRemindersPerTask,
      DEFAULT_SLACK_REMINDER_SETTINGS.maxRemindersPerTask,
      1,
      10
    ),
    deliver,
    defaultChannelId,
    quietHoursStart: normalizeBoundedInt(
      configured?.quietHoursStart,
      DEFAULT_SLACK_REMINDER_SETTINGS.quietHoursStart,
      0,
      23
    ),
    quietHoursEnd: normalizeBoundedInt(
      configured?.quietHoursEnd,
      DEFAULT_SLACK_REMINDER_SETTINGS.quietHoursEnd,
      0,
      23
    ),
    digest,
  };
};

export const resolveTaskCleanupSettings = (
  workspace: WorkspaceDoc | null | undefined
): TaskCleanupSettings => {
  const configured =
    ((workspace?.settings as { taskCleanup?: Partial<TaskCleanupSettings> } | null | undefined)
      ?.taskCleanup as Partial<TaskCleanupSettings> | null | undefined) || null;

  const strictness = TASK_CLEANUP_STRICTNESS_VALUES.includes(
    configured?.strictness as TaskCleanupStrictness
  )
    ? (configured?.strictness as TaskCleanupStrictness)
    : DEFAULT_TASK_CLEANUP_SETTINGS.strictness;

  const categories: Record<TaskCleanupCategoryKey, boolean> = {
    ...DEFAULT_TASK_CLEANUP_SETTINGS.categories,
  };
  const configuredCategories = configured?.categories;
  if (configuredCategories && typeof configuredCategories === "object") {
    (Object.keys(categories) as TaskCleanupCategoryKey[]).forEach((key) => {
      const value = (configuredCategories as Record<string, unknown>)[key];
      if (typeof value === "boolean") {
        categories[key] = value;
      }
    });
  }

  return {
    enabled:
      typeof configured?.enabled === "boolean"
        ? configured.enabled
        : DEFAULT_TASK_CLEANUP_SETTINGS.enabled,
    strictness,
    autoExpireDays: normalizeAutoExpireDays(configured?.autoExpireDays),
    categories,
  };
};
