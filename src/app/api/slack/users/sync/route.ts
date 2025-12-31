import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getSessionUserId } from "@/lib/server-auth";
import { findUserById } from "@/lib/db/users";
import { getDb } from "@/lib/db";
import { getValidSlackToken } from "@/lib/slack";

type SlackMember = {
  id: string;
  name: string;
  realName: string;
  email?: string;
  image?: string;
  title?: string;
};

const fetchSlackMembers = async (accessToken: string): Promise<SlackMember[]> => {
  const members: SlackMember[] = [];
  let cursor = "";

  do {
    const params = new URLSearchParams({ limit: "200" });
    if (cursor) params.set("cursor", cursor);
    const response = await fetch(
      `https://slack.com/api/users.list?${params.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
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
        profile?: { email?: string; image_192?: string; title?: string };
      }>;
      response_metadata?: { next_cursor?: string };
    };

    if (!payload.ok) {
      throw new Error(payload.error || "Slack API error.");
    }

    const pageMembers =
      payload.members
        ?.filter(
          (member) =>
            !member.deleted &&
            !member.is_bot &&
            !member.is_app_user &&
            member.profile?.email
        )
        .map((member) => ({
          id: member.id,
          name: member.real_name || member.name || "Slack User",
          realName: member.real_name || member.name || "Slack User",
          email: member.profile?.email,
          image: member.profile?.image_192,
          title: member.profile?.title,
        })) || [];

    members.push(...pageMembers);
    cursor = payload.response_metadata?.next_cursor || "";
  } while (cursor);

  return members;
};

export async function POST(request: Request) {
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
    let selectedIds: Set<string> | null = null;
    try {
      const payload = await request.json();
      if (Array.isArray(payload?.selectedIds)) {
        selectedIds = new Set(
          payload.selectedIds.filter((id: unknown) => typeof id === "string")
        );
      }
    } catch (error) {
      console.warn("Slack sync request body not provided or invalid:", error);
    }

    const accessToken = await getValidSlackToken(user.slackTeamId);
    const members = await fetchSlackMembers(accessToken);
    const membersToSync = selectedIds
      ? members.filter((member) => selectedIds?.has(member.id))
      : members;
    const db = await getDb();

    let created = 0;
    let updated = 0;

    for (const member of membersToSync) {
      if (!member.email) continue;
      const existing = await db.collection<any>("people").findOne({
        userId,
        email: member.email,
      });

      if (existing) {
        await db.collection<any>("people").updateOne(
          { _id: existing._id, userId },
          {
            $set: {
              slackId: member.id,
              ...(existing.name ? {} : { name: member.realName }),
              ...(existing.title ? {} : { title: member.title || null }),
              ...(existing.avatarUrl ? {} : { avatarUrl: member.image || null }),
              lastSeenAt: new Date(),
            },
          }
        );
        updated += 1;
      } else {
        const now = new Date();
        await db.collection<any>("people").insertOne({
          _id: randomUUID(),
          userId,
          name: member.realName,
          email: member.email,
          title: member.title || null,
          avatarUrl: member.image || null,
          slackId: member.id,
          firefliesId: null,
          phantomBusterId: null,
          aliases: [],
          sourceSessionIds: [],
          createdAt: now,
          lastSeenAt: now,
        });
        created += 1;
      }
    }

    return NextResponse.json({ success: true, created, updated });
  } catch (error) {
    console.error("Slack user sync failed:", error);
    return NextResponse.json(
      { error: "Failed to sync Slack users." },
      { status: 500 }
    );
  }
}
