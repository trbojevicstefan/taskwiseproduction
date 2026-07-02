import type { Db } from "mongodb";
import {
  findActiveWorkspaceMembership,
  type WorkspaceMembershipDoc,
} from "@/lib/workspace-memberships";
import { hasWorkspaceRoleAtLeast, type WorkspaceRole } from "@/lib/workspace-roles";
import { findWorkspaceById, type WorkspaceDoc } from "@/lib/workspaces";
import { workspaceForbiddenError, workspaceNotFoundError } from "@/lib/workspace-errors";

export interface WorkspaceAccessContext {
  workspace: WorkspaceDoc;
  membership: WorkspaceMembershipDoc;
}

const normalizeIdentifier = (value: string) => value.trim();

export const assertWorkspaceAccess = async (
  db: Db,
  userId: string,
  workspaceId: string,
  minimumRole: WorkspaceRole = "member"
): Promise<WorkspaceAccessContext> => {
  const normalizedUserId = normalizeIdentifier(userId || "");
  const normalizedWorkspaceId = normalizeIdentifier(workspaceId || "");

  if (!normalizedUserId || !normalizedWorkspaceId) {
    throw workspaceForbiddenError("Forbidden");
  }

  const membership = await findActiveWorkspaceMembership(
    db,
    normalizedWorkspaceId,
    normalizedUserId
  );
  if (!membership) {
    throw workspaceForbiddenError("Forbidden");
  }

  if (!hasWorkspaceRoleAtLeast(membership.role, minimumRole)) {
    throw workspaceForbiddenError("Forbidden");
  }

  const workspace = await findWorkspaceById(db, normalizedWorkspaceId);
  if (!workspace || workspace.status === "deleted") {
    throw workspaceNotFoundError("Workspace not found.");
  }

  return { workspace, membership };
};
