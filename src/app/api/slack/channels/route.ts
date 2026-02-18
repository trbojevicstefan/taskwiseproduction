import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { findUserById } from "@/lib/db/users";
import { getValidSlackToken } from "@/lib/slack";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";

type SlackChannel = { id: string; name: string };

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const db = await getDb();
    await resolveWorkspaceScopeForUser(db, userId, {
      minimumRole: "member",
      adminVisibilityKey: "integrations",
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Forbidden" },
      { status: error?.status || 403 }
    );
  }

  const user = await findUserById(userId);
  if (!user?.slackTeamId) {
    return NextResponse.json(
      { error: "Slack is not connected." },
      { status: 400 }
    );
  }

  try {
    const accessToken = await getValidSlackToken(user.slackTeamId);
    const response = await fetch(
      "https://slack.com/api/conversations.list?types=public_channel,private_channel&limit=200",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    const payload = (await response.json()) as {
      ok: boolean;
      error?: string;
      channels?: Array<{ id: string; name: string; is_archived?: boolean }>;
    };

    if (!payload.ok) {
      return NextResponse.json(
        { error: payload.error || "Slack API error." },
        { status: 500 }
      );
    }

    const channels: SlackChannel[] =
      payload.channels
        ?.filter((channel: any) => !channel.is_archived)
        .map((channel: any) => ({ id: channel.id, name: channel.name })) || [];

    return NextResponse.json({ channels });
  } catch (error) {
    console.error("Slack channel fetch failed:", error);
    return NextResponse.json(
      { error: "Failed to fetch Slack channels." },
      { status: 500 }
    );
  }
}

