import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/server-auth";
import { findUserById } from "@/lib/db/users";
import { getValidSlackToken } from "@/lib/slack";

type SlackUser = {
  id: string;
  name: string;
  realName: string;
  email?: string;
  image?: string;
};

const fetchAllSlackUsers = async (
  accessToken: string
): Promise<SlackUser[]> => {
  const users: SlackUser[] = [];
  let cursor = "";

  do {
    const params = new URLSearchParams({ limit: "200" });
    if (cursor) params.set("cursor", cursor);

    const response = await fetch(
      `https://slack.com/api/users.list?${params.toString()}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    const payload = (await response.json()) as {
      ok: boolean;
      error?: string;
      members?: Array<{
        id: string;
        deleted?: boolean;
        is_bot?: boolean;
        is_app_user?: boolean;
        name?: string;
        real_name?: string;
        profile?: { email?: string; image_192?: string };
      }>;
      response_metadata?: { next_cursor?: string };
    };

    if (!payload.ok) {
      throw new Error(payload.error || "Slack API error.");
    }

    const pageUsers =
      payload.members
        ?.filter(
          (member) =>
            !member.deleted &&
            !member.is_bot &&
            !member.is_app_user &&
            member.id
        )
        .map((member) => ({
          id: member.id,
          name: member.name || member.real_name || "Slack User",
          realName: member.real_name || member.name || "Slack User",
          email: member.profile?.email,
          image: member.profile?.image_192,
        })) || [];

    users.push(...pageUsers);
    cursor = payload.response_metadata?.next_cursor || "";
  } while (cursor);

  return users;
};

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
    const users = await fetchAllSlackUsers(accessToken);
    return NextResponse.json({ users });
  } catch (error) {
    console.error("Slack user fetch failed:", error);
    return NextResponse.json(
      { error: "Failed to fetch Slack users." },
      { status: 500 }
    );
  }
}
