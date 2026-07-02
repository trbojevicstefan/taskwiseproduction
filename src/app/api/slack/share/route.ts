import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { findUserById } from "@/lib/db/users";
import { getValidSlackToken } from "@/lib/slack";
import { formatTasksToSlackBlocks } from "@/lib/slack-format";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";
import type { ExtractedTaskSchema } from "@/types/chat";

type SharePayload = {
  tasks?: ExtractedTaskSchema[];
  channelId?: string;
  userId?: string;
  customMessage?: string;
  sourceTitle?: string;
  includeAiContent?: boolean;
};

const openDirectMessage = async (accessToken: string, userId: string) => {
  const response = await fetch("https://slack.com/api/conversations.open", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ users: userId }),
  });
  const payload = (await response.json()) as {
    ok: boolean;
    error?: string;
    channel?: { id?: string };
  };
  if (!payload.ok || !payload.channel?.id) {
    throw new Error(payload.error || "Failed to open DM.");
  }
  return payload.channel.id;
};

export async function POST(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return apiError(401, "request_error", "Unauthorized");
  }
  try {
    const db = await getDb();
    await resolveWorkspaceScopeForUser(db, userId, {
      minimumRole: "member",
      adminVisibilityKey: "integrations",
    });
  } catch (error: any) {
    return apiError(error?.status || 403, "request_error", error?.message || "Forbidden");
  }

  const body = (await request.json().catch(() => ({}))) as SharePayload;
  const tasks = body.tasks || [];
  const sourceTitle = body.sourceTitle || "TaskWiseAI";
  const channelId = body.channelId;
  const targetUserId = body.userId;

  if (!tasks.length) {
    return apiError(400, "request_error", "No tasks to share.");
  }
  if (!channelId && !targetUserId) {
    return apiError(400, "request_error", "Missing Slack channel or user.");
  }

  const user = await findUserById(userId);
  if (!user?.slackTeamId) {
    return apiError(400, "request_error", "Slack is not connected.");
  }

  try {
    const accessToken = await getValidSlackToken(user.slackTeamId);
    const destinationChannel = targetUserId
      ? await openDirectMessage(accessToken, targetUserId)
      : (channelId as string);

    const blocks = formatTasksToSlackBlocks(
      tasks,
      sourceTitle,
      body.customMessage,
      body.includeAiContent
    );

    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        channel: destinationChannel,
        blocks,
        text: `Action Items from: ${sourceTitle}`,
      }),
    });

    const payload = (await response.json()) as { ok: boolean; error?: string };
    if (!payload.ok) {
      return NextResponse.json(
        { error: payload.error || "Slack post failed." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      channelId: destinationChannel,
    });
  } catch (error) {
    console.error("Slack share failed:", error);
    return apiError(500, "request_error", "Failed to share tasks to Slack.");
  }
}


