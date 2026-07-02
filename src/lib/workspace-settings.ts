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
