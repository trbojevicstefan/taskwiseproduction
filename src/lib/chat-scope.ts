import type { Db } from "mongodb";
import { ApiRouteError } from "@/lib/api-route";
import {
  ChatScopeSchema,
  type ChatScope,
} from "@/types/general-chat";

export type ChatScopeAccessParams = {
  db: Db;
  userId: string;
  workspaceId: string;
  memberUserIds?: string[];
  scope: unknown;
};

const identifierFilter = (id: string) => ({
  $or: [{ _id: id }, { id }],
});

export const buildWorkspaceVisibilityFilter = (
  workspaceId: string,
  memberUserIds: string[]
) => ({
  $or: [
    { workspaceId },
    {
      workspaceId: { $exists: false },
      userId: { $in: memberUserIds },
    },
  ],
});

export const buildChatSessionVisibilityFilter = (params: {
  workspaceId: string;
  userId: string;
  memberUserIds?: string[];
}) => {
  const visibleUserIds = Array.from(
    new Set(
      (params.memberUserIds?.length
        ? params.memberUserIds
        : [params.userId]
      )
        .map(String)
        .filter(Boolean)
    )
  );
  return buildWorkspaceVisibilityFilter(params.workspaceId, visibleUserIds);
};

export function resolveSessionChatScope(
  scope?: ChatScope | null,
  sourceMeetingId?: string | null
): ChatScope {
  const meetingId =
    typeof sourceMeetingId === "string" ? sourceMeetingId.trim() : "";
  if (meetingId) {
    return { type: "meeting", meetingId };
  }
  return scope ?? { type: "workspace" };
}

/**
 * Validate an explicit chat scope without disclosing whether an out-of-scope
 * entity exists. Workspace and planner scopes need no entity lookup.
 */
export async function assertChatScopeAccess(
  params: ChatScopeAccessParams
): Promise<ChatScope> {
  const parsed = ChatScopeSchema.safeParse(params.scope);
  if (!parsed.success) {
    throw new ApiRouteError(
      400,
      "invalid_chat_scope",
      "Invalid chat scope.",
      parsed.error.flatten()
    );
  }

  const scope = parsed.data;
  if (scope.type === "workspace" || scope.type === "planner") {
    return scope;
  }

  const memberUserIds = Array.from(
    new Set(
      (params.memberUserIds?.length
        ? params.memberUserIds
        : [params.userId]
      )
        .map(String)
        .filter(Boolean)
    )
  );

  let collectionName: "meetings" | "companies" | "people";
  let entityId: string;
  let visibilityFilter: Record<string, unknown>;
  switch (scope.type) {
    case "meeting":
      collectionName = "meetings";
      entityId = scope.meetingId;
      visibilityFilter = buildWorkspaceVisibilityFilter(
        params.workspaceId,
        memberUserIds
      );
      break;
    case "client":
      collectionName = "companies";
      entityId = scope.clientId;
      visibilityFilter = { workspaceId: params.workspaceId };
      break;
    case "person":
      collectionName = "people";
      entityId = scope.personId;
      visibilityFilter = buildWorkspaceVisibilityFilter(
        params.workspaceId,
        memberUserIds
      );
      break;
  }

  const entity = await params.db.collection(collectionName).findOne({
    $and: [identifierFilter(entityId), visibilityFilter],
  } as any);
  if (!entity) {
    throw new ApiRouteError(
      404,
      "chat_scope_not_found",
      "Chat scope was not found."
    );
  }
  return scope;
}
