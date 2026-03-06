import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import {
  deleteFathomInstallation,
  deleteManagedFathomWebhooks,
  getFathomInstallation,
  getValidFathomAccessToken,
} from "@/lib/fathom";
import { updateUserById } from "@/lib/db/users";
import { listActiveWorkspaceMembershipsForWorkspace } from "@/lib/workspace-memberships";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";

const roleRank = (role: string | null | undefined) => {
  if (role === "owner") return 3;
  if (role === "admin") return 2;
  if (role === "member") return 1;
  return 0;
};

export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) {
    return apiError(401, "request_error", "Unauthorized");
  }

  const db = await getDb();
  let targetUserId = userId;

  try {
    const workspaceScope = await resolveWorkspaceScopeForUser(db, userId, {
      minimumRole: "member",
      adminVisibilityKey: "integrations",
    });
    const ownInstallation = await getFathomInstallation(userId);

    if (
      !ownInstallation &&
      (workspaceScope.membership.role === "owner" ||
        workspaceScope.membership.role === "admin")
    ) {
      const memberships = await listActiveWorkspaceMembershipsForWorkspace(
        db as any,
        workspaceScope.workspaceId
      );
      const membershipByUserId = new Map<string, any>();
      memberships.forEach((membership: any) => {
        membershipByUserId.set(String(membership.userId), membership);
      });

      const memberUserIds = Array.from(
        new Set(memberships.map((membership: any) => String(membership.userId)).filter(Boolean))
      );
      const validObjectIds = memberUserIds.filter((memberId) => ObjectId.isValid(memberId));

      if (validObjectIds.length) {
        const workspaceUsers = await (db as any)
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
                fathomConnected: 1,
              },
            }
          )
          .toArray();

        const workspaceConnectedUser = [...workspaceUsers]
          .sort((left: any, right: any) => {
            const leftRole = membershipByUserId.get(String(left._id))?.role;
            const rightRole = membershipByUserId.get(String(right._id))?.role;
            return roleRank(rightRole) - roleRank(leftRole);
          })
          .find((candidate: any) => Boolean(candidate.fathomConnected));

        if (workspaceConnectedUser?._id) {
          targetUserId = String(workspaceConnectedUser._id);
        }
      }
    }
  } catch (error: any) {
    return apiError(error?.status || 403, "request_error", error?.message || "Forbidden");
  }

  const installation = await getFathomInstallation(targetUserId);
  if (installation) {
    try {
      const accessToken = await getValidFathomAccessToken(targetUserId);
      await deleteManagedFathomWebhooks(accessToken);
    } catch (error) {
      console.warn("Failed to delete Fathom webhooks on disconnect:", error);
    }
  }

  await deleteFathomInstallation(targetUserId);
  await updateUserById(targetUserId, {
    fathomConnected: false,
    fathomWebhookToken: null,
    fathomUserId: null,
  });

  return NextResponse.json({ success: true, disconnectedUserId: targetUserId });
}

