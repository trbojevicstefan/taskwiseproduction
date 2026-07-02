export type WorkspaceRole = "owner" | "admin" | "member";

export type WorkspacePermission =
  | "workspace.read"
  | "workspace.switch"
  | "workspace.update"
  | "workspace.invite"
  | "workspace.members.read"
  | "workspace.members.update"
  | "workspace.members.remove"
  | "workspace.delete"
  | "workspace.transfer_ownership";

const WORKSPACE_ROLE_RANK: Record<WorkspaceRole, number> = {
  owner: 3,
  admin: 2,
  member: 1,
};

const ROLE_PERMISSION_MATRIX: Record<WorkspaceRole, readonly WorkspacePermission[]> = {
  owner: [
    "workspace.read",
    "workspace.switch",
    "workspace.update",
    "workspace.invite",
    "workspace.members.read",
    "workspace.members.update",
    "workspace.members.remove",
    "workspace.delete",
    "workspace.transfer_ownership",
  ],
  admin: [
    "workspace.read",
    "workspace.switch",
    "workspace.update",
    "workspace.invite",
    "workspace.members.read",
    "workspace.members.update",
    "workspace.members.remove",
  ],
  member: ["workspace.read", "workspace.switch"],
};

export const WORKSPACE_ROLE_ORDER: WorkspaceRole[] = ["member", "admin", "owner"];

export const isWorkspaceRole = (value: string | null | undefined): value is WorkspaceRole =>
  value === "owner" || value === "admin" || value === "member";

export const normalizeWorkspaceRole = (
  value: string | null | undefined,
  fallback: WorkspaceRole = "member"
): WorkspaceRole => {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (isWorkspaceRole(normalized)) {
    return normalized;
  }
  return fallback;
};

export const hasWorkspaceRoleAtLeast = (
  role: WorkspaceRole,
  minimumRole: WorkspaceRole
) => WORKSPACE_ROLE_RANK[role] >= WORKSPACE_ROLE_RANK[minimumRole];

export const canWorkspaceRole = (role: WorkspaceRole, permission: WorkspacePermission) =>
  ROLE_PERMISSION_MATRIX[role].includes(permission);

export const getWorkspacePermissionMatrix = () => ROLE_PERMISSION_MATRIX;
