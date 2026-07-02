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
