import { getServerSession } from "next-auth";
import { randomUUID } from "crypto";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { findUserById, updateUserById } from "@/lib/db/users";
import { apiError, apiSuccess, mapApiError, parseJsonBody } from "@/lib/api-route";
import { assertWorkspaceAccess, ensureWorkspaceBootstrapForUser } from "@/lib/workspace-context";
import {
  listActiveWorkspaceMembershipsForWorkspace,
  listWorkspaceMembershipsForUser,
} from "@/lib/workspace-memberships";
import { findWorkspaceById, listWorkspacesByIds, updateWorkspaceById } from "@/lib/workspaces";
import {
  resolveWorkspaceAdminAccess,
  type WorkspaceAdminAccessSettings,
} from "@/lib/workspace-settings";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  displayName: z.string().min(1).optional(),
  avatarUrl: z.string().optional().nullable(),
  photoURL: z.string().optional().nullable(),
  workspace: z
    .object({
      id: z.string().min(1).optional(),
      name: z.string().min(1),
      settings: z
        .object({
          adminAccess: z
            .object({
              tasks: z.boolean().optional(),
              people: z.boolean().optional(),
              projects: z.boolean().optional(),
              chatSessions: z.boolean().optional(),
              boards: z.boolean().optional(),
              integrations: z.boolean().optional(),
            })
            .partial()
            .optional(),
        })
        .optional(),
    })
    .optional(),
  onboardingCompleted: z.boolean().optional(),
  firefliesWebhookToken: z.string().optional().nullable(),
  slackTeamId: z.string().optional().nullable(),
  fathomWebhookToken: z.string().optional().nullable(),
  fathomConnected: z.boolean().optional(),
  fathomUserId: z.string().optional().nullable(),
  taskGranularityPreference: z.enum(["light", "medium", "detailed"]).optional(),
  autoApproveCompletedTasks: z.boolean().optional(),
  completionMatchThreshold: z.number().min(0.4).max(0.95).optional(),
  slackAutoShareEnabled: z.boolean().optional(),
  slackAutoShareChannelId: z.string().optional().nullable(),
});

type WorkspaceMembershipSummary = {
  membershipId: string;
  workspaceId: string;
  workspaceName: string;
  role: string;
  status: string;
  isActive: boolean;
  joinedAt: string | null;
  updatedAt: string | null;
};

type WorkspaceIntegrationProviderSummary = {
  connected: boolean;
  connectedByUserId: string | null;
  connectedByEmail: string | null;
  connectedByCurrentUser: boolean;
};

type WorkspaceIntegrationSummary = {
  slack: WorkspaceIntegrationProviderSummary;
  google: WorkspaceIntegrationProviderSummary;
  fathom: WorkspaceIntegrationProviderSummary;
};

const emptyIntegrationProviderSummary = (): WorkspaceIntegrationProviderSummary => ({
  connected: false,
  connectedByUserId: null,
  connectedByEmail: null,
  connectedByCurrentUser: false,
});

const emptyWorkspaceIntegrationSummary = (): WorkspaceIntegrationSummary => ({
  slack: emptyIntegrationProviderSummary(),
  google: emptyIntegrationProviderSummary(),
  fathom: emptyIntegrationProviderSummary(),
});

const toAppUser = (
  user: Awaited<ReturnType<typeof findUserById>>,
  workspaceMemberships: WorkspaceMembershipSummary[] = [],
  options: {
    activeWorkspaceRole?: string | null;
    activeWorkspaceAdminAccess?: WorkspaceAdminAccessSettings | null;
    workspaceIntegrations?: WorkspaceIntegrationSummary;
  } = {}
) => {
  if (!user) return null;
  const id = user._id.toString();
  return {
    id,
    uid: id,
    userId: id,
    name: user.name,
    displayName: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
    photoURL: user.avatarUrl,
    createdAt: user.createdAt.toISOString(),
    lastUpdated: user.lastUpdated.toISOString(),
    lastSeenAt: user.lastSeenAt.toISOString(),
    onboardingCompleted: user.onboardingCompleted,
    workspace: user.workspace,
    activeWorkspaceId: user.activeWorkspaceId || user.workspace?.id || null,
    workspaceMemberships,
    activeWorkspaceRole: options.activeWorkspaceRole || null,
    activeWorkspaceAdminAccess: options.activeWorkspaceAdminAccess || null,
    workspaceIntegrations: options.workspaceIntegrations || emptyWorkspaceIntegrationSummary(),
    firefliesWebhookToken: user.firefliesWebhookToken,
    slackTeamId: user.slackTeamId || null,
    fathomWebhookToken: user.fathomWebhookToken || null,
    fathomConnected: Boolean(user.fathomConnected),
    fathomUserId: user.fathomUserId || null,
    sourceSessionIds: user.sourceSessionIds || [],
    taskGranularityPreference: user.taskGranularityPreference,
    autoApproveCompletedTasks: Boolean(user.autoApproveCompletedTasks),
    completionMatchThreshold:
      typeof user.completionMatchThreshold === "number"
        ? user.completionMatchThreshold
        : 0.6,
    slackAutoShareEnabled: Boolean(user.slackAutoShareEnabled),
    slackAutoShareChannelId: user.slackAutoShareChannelId || null,
    googleConnected: Boolean(user.googleConnected),
    googleEmail: user.googleEmail || null,
  };
};

const buildWorkspaceContext = async (
  db: Awaited<ReturnType<typeof getDb>>,
  userId: string,
  activeWorkspaceId: string | null
) => {
  const memberships = await listWorkspaceMembershipsForUser(db as any, userId);
  const workspaceIds = Array.from(
    new Set(memberships.map((membership: any) => membership.workspaceId).filter(Boolean))
  );
  const workspaces = await listWorkspacesByIds(db as any, workspaceIds);
  const workspaceById = new Map(workspaces.map((workspace: any) => [workspace._id, workspace]));

  const summaries = memberships.map((membership: any) => {
    const workspace = workspaceById.get(membership.workspaceId);
    return {
      membershipId: String(membership._id),
      workspaceId: membership.workspaceId,
      workspaceName: workspace?.name || membership.workspaceId,
      role: membership.role,
      status: membership.status,
      isActive: membership.workspaceId === activeWorkspaceId,
      joinedAt: membership.joinedAt?.toISOString?.() || null,
      updatedAt: membership.updatedAt?.toISOString?.() || null,
    };
  });

  const activeMembership = memberships.find(
    (membership: any) =>
      membership.workspaceId === activeWorkspaceId && membership.status === "active"
  );
  const activeWorkspace =
    activeWorkspaceId && workspaceById.has(activeWorkspaceId)
      ? workspaceById.get(activeWorkspaceId)
      : null;

  return {
    memberships: summaries,
    activeMembershipRole: activeMembership?.role || null,
    activeWorkspaceAdminAccess: resolveWorkspaceAdminAccess(activeWorkspace?.settings),
  };
};

const roleRank = (role: string | null | undefined) => {
  if (role === "owner") return 3;
  if (role === "admin") return 2;
  if (role === "member") return 1;
  return 0;
};

const buildWorkspaceIntegrationSummary = async (
  db: Awaited<ReturnType<typeof getDb>>,
  workspaceId: string | null,
  currentUserId: string
): Promise<WorkspaceIntegrationSummary> => {
  if (!workspaceId) {
    return emptyWorkspaceIntegrationSummary();
  }

  const memberships = await listActiveWorkspaceMembershipsForWorkspace(
    db as any,
    workspaceId
  );
  const memberUserIds = Array.from(
    new Set(memberships.map((membership: any) => String(membership.userId)).filter(Boolean))
  );
  if (!memberUserIds.length) {
    return emptyWorkspaceIntegrationSummary();
  }

  const validObjectIds = memberUserIds.filter((memberId) => ObjectId.isValid(memberId));
  if (!validObjectIds.length) {
    return emptyWorkspaceIntegrationSummary();
  }

  const users = await (db as any)
    .collection("users")
    .find(
      {
        _id: {
          $in: validObjectIds.map((value) => new ObjectId(value)),
        },
      },
      {
        projection: {
          _id: 1,
          email: 1,
          slackTeamId: 1,
          googleConnected: 1,
          fathomConnected: 1,
        },
      }
    )
    .toArray();

  const membershipByUserId = new Map<string, any>();
  memberships.forEach((membership: any) => {
    membershipByUserId.set(String(membership.userId), membership);
  });

  const sortedUsers = [...users].sort((left: any, right: any) => {
    const leftRole = membershipByUserId.get(String(left._id))?.role;
    const rightRole = membershipByUserId.get(String(right._id))?.role;
    return roleRank(rightRole) - roleRank(leftRole);
  });

  const resolveProvider = (selector: (candidate: any) => boolean) => {
    const connectedUser = sortedUsers.find(selector);
    if (!connectedUser) {
      return emptyIntegrationProviderSummary();
    }
    const connectedByUserId = String(connectedUser._id);
    return {
      connected: true,
      connectedByUserId,
      connectedByEmail: connectedUser.email || null,
      connectedByCurrentUser: connectedByUserId === currentUserId,
    };
  };

  return {
    slack: resolveProvider((candidate: any) => Boolean(candidate.slackTeamId)),
    google: resolveProvider((candidate: any) => Boolean(candidate.googleConnected)),
    fathom: resolveProvider((candidate: any) => Boolean(candidate.fathomConnected)),
  };
};

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;

    if (!userId) {
      return apiError(401, "unauthorized", "Unauthorized");
    }

    const db = await getDb();
    await ensureWorkspaceBootstrapForUser(db as any, userId);

    let user = await findUserById(userId);
    if (!user) {
      return apiError(404, "not_found", "User not found");
    }

    const shouldInitializeWorkspace = !user.workspace?.id;
    const shouldInitializeActiveWorkspace =
      !user.activeWorkspaceId && Boolean(user.workspace?.id);

    if (shouldInitializeWorkspace || shouldInitializeActiveWorkspace) {
      const workspaceName =
        user.workspace?.name || `${user.name || "Workspace"}'s Workspace`;
      const workspace = user.workspace?.id
        ? { id: user.workspace.id, name: workspaceName }
        : { id: randomUUID(), name: workspaceName };
      const activeWorkspaceId = user.activeWorkspaceId || workspace.id;
      await updateUserById(userId, { workspace, activeWorkspaceId } as any);
      user = { ...user, workspace, activeWorkspaceId };
    }

    const activeWorkspaceId = user.activeWorkspaceId || user.workspace?.id || null;
    const workspaceContext = await buildWorkspaceContext(db, userId, activeWorkspaceId);
    const workspaceIntegrations = await buildWorkspaceIntegrationSummary(
      db,
      activeWorkspaceId,
      userId
    );

    const appUser = toAppUser(user, workspaceContext.memberships, {
      activeWorkspaceRole: workspaceContext.activeMembershipRole,
      activeWorkspaceAdminAccess: workspaceContext.activeWorkspaceAdminAccess,
      workspaceIntegrations,
    });
    if (!appUser) {
      return apiError(404, "not_found", "User not found");
    }

    return apiSuccess(appUser);
  } catch (error) {
    return mapApiError(error, "Failed to fetch user profile.");
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;

    if (!userId) {
      return apiError(401, "unauthorized", "Unauthorized");
    }

    const db = await getDb();
    await ensureWorkspaceBootstrapForUser(db as any, userId);

    const update = await parseJsonBody(request, updateSchema, "Invalid update payload.");
    const name = update.displayName || update.name;
    const avatarUrl = update.photoURL || update.avatarUrl;

    const existingUser = await findUserById(userId);
    if (!existingUser) {
      return apiError(404, "not_found", "User not found");
    }

    let workspace:
      | {
          id: string;
          name: string;
        }
      | undefined;
    if (update.workspace) {
      const targetWorkspaceId =
        update.workspace.id || existingUser.activeWorkspaceId || existingUser.workspace?.id;
      if (!targetWorkspaceId) {
        return apiError(400, "request_error", "Workspace ID is required.");
      }

      await assertWorkspaceAccess(db as any, userId, targetWorkspaceId, "admin");
      const existingWorkspace = await findWorkspaceById(db as any, targetWorkspaceId);
      if (!existingWorkspace) {
        return apiError(404, "not_found", "Workspace not found");
      }
      const nextAdminAccess = update.workspace.settings?.adminAccess
        ? {
            ...resolveWorkspaceAdminAccess(existingWorkspace.settings),
            ...update.workspace.settings.adminAccess,
          }
        : resolveWorkspaceAdminAccess(existingWorkspace.settings);
      const nextSettings = {
        ...(existingWorkspace.settings || {}),
        adminAccess: nextAdminAccess,
      };
      await updateWorkspaceById(db as any, targetWorkspaceId, {
        name: update.workspace.name,
        settings: nextSettings as any,
      });
      workspace = {
        id: targetWorkspaceId,
        name: update.workspace.name,
      };
    }
    const activeWorkspaceId = workspace
      ? workspace.id
      : existingUser.activeWorkspaceId || existingUser.workspace?.id || null;

    await updateUserById(userId, {
      ...(name ? { name } : {}),
      ...(avatarUrl !== undefined ? { avatarUrl } : {}),
      ...(workspace ? { workspace } : {}),
      ...(activeWorkspaceId ? { activeWorkspaceId } : {}),
      ...(update.onboardingCompleted !== undefined
        ? { onboardingCompleted: update.onboardingCompleted }
        : {}),
      ...(update.firefliesWebhookToken !== undefined
        ? { firefliesWebhookToken: update.firefliesWebhookToken }
        : {}),
      ...(update.slackTeamId !== undefined ? { slackTeamId: update.slackTeamId } : {}),
      ...(update.fathomWebhookToken !== undefined
        ? { fathomWebhookToken: update.fathomWebhookToken }
        : {}),
      ...(update.fathomConnected !== undefined
        ? { fathomConnected: update.fathomConnected }
        : {}),
      ...(update.fathomUserId !== undefined ? { fathomUserId: update.fathomUserId } : {}),
      ...(update.taskGranularityPreference !== undefined
        ? { taskGranularityPreference: update.taskGranularityPreference }
        : {}),
      ...(update.autoApproveCompletedTasks !== undefined
        ? { autoApproveCompletedTasks: update.autoApproveCompletedTasks }
        : {}),
      ...(update.completionMatchThreshold !== undefined
        ? { completionMatchThreshold: update.completionMatchThreshold }
        : {}),
      ...(update.slackAutoShareEnabled !== undefined
        ? { slackAutoShareEnabled: update.slackAutoShareEnabled }
        : {}),
      ...(update.slackAutoShareChannelId !== undefined
        ? { slackAutoShareChannelId: update.slackAutoShareChannelId }
        : {}),
    });

    const user = await findUserById(userId);
    const resolvedActiveWorkspaceId =
      user?.activeWorkspaceId || user?.workspace?.id || null;
    const workspaceContext = await buildWorkspaceContext(
      db,
      userId,
      resolvedActiveWorkspaceId
    );
    const workspaceIntegrations = await buildWorkspaceIntegrationSummary(
      db,
      resolvedActiveWorkspaceId,
      userId
    );
    const appUser = toAppUser(user, workspaceContext.memberships, {
      activeWorkspaceRole: workspaceContext.activeMembershipRole,
      activeWorkspaceAdminAccess: workspaceContext.activeWorkspaceAdminAccess,
      workspaceIntegrations,
    });
    if (!appUser) {
      return apiError(404, "not_found", "User not found");
    }

    return apiSuccess(appUser);
  } catch (error) {
    return mapApiError(error, "Failed to update user profile.");
  }
}

