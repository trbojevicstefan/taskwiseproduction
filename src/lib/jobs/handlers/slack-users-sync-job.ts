import { randomUUID } from "crypto";
import { ApiRouteError } from "@/lib/api-route";
import { getDb } from "@/lib/db";
import { findUserById } from "@/lib/db/users";
import { recordExternalApiFailure } from "@/lib/observability-metrics";
import { getValidSlackToken } from "@/lib/slack";
import {
  createLogger,
  ensureCorrelationId,
  type StructuredLogger,
} from "@/lib/observability";

type SlackMember = {
  id: string;
  name: string;
  realName: string;
  email?: string;
  image?: string;
  title?: string;
};

const getErrorStatusCode = (error: unknown): number | undefined => {
  if (!error || typeof error !== "object") return undefined;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return typeof statusCode === "number" ? statusCode : undefined;
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
      const error = new Error(payload.error || "Slack API error.") as Error & {
        statusCode?: number;
      };
      error.statusCode = response.status;
      throw error;
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
        .map((member: any) => ({
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

export const runSlackUsersSyncJob = async ({
  userId,
  selectedIds,
  correlationId,
  logger: baseLogger,
}: {
  userId: string;
  selectedIds?: string[];
  correlationId?: string;
  logger?: StructuredLogger;
}) => {
  const resolvedCorrelationId = ensureCorrelationId(correlationId);
  const logger = (baseLogger || createLogger({ scope: "jobs.slack-users-sync" })).child({
    correlationId: resolvedCorrelationId,
    userId,
    selectedCount: selectedIds?.length || 0,
  });
  const startedAtMs = Date.now();
  logger.info("jobs.slack-users-sync.started");

  const user = await findUserById(userId);
  if (!user?.slackTeamId) {
    throw new ApiRouteError(400, "slack_not_connected", "Slack is not connected.");
  }

  const selectedIdSet =
    selectedIds && selectedIds.length ? new Set(selectedIds.filter(Boolean)) : null;
  let accessToken = "";
  try {
    accessToken = await getValidSlackToken(user.slackTeamId);
  } catch (error) {
    void recordExternalApiFailure({
      provider: "slack",
      operation: "oauth.token",
      userId,
      correlationId: resolvedCorrelationId,
      durationMs: Date.now() - startedAtMs,
      error,
      metadata: { slackTeamId: user.slackTeamId },
    });
    throw error;
  }

  let members: SlackMember[] = [];
  try {
    members = await fetchSlackMembers(accessToken);
  } catch (error) {
    void recordExternalApiFailure({
      provider: "slack",
      operation: "users.list",
      userId,
      correlationId: resolvedCorrelationId,
      statusCode: getErrorStatusCode(error),
      durationMs: Date.now() - startedAtMs,
      error,
      metadata: { slackTeamId: user.slackTeamId },
    });
    throw error;
  }

  const membersToSync = selectedIdSet
    ? members.filter((member: any) => selectedIdSet.has(member.id))
    : members;
  const db = await getDb();

  let created = 0;
  let updated = 0;

  for (const member of membersToSync) {
    if (!member.email) continue;
    const existing = await db.collection("people").findOne({
      userId,
      email: member.email,
    });

    if (existing) {
      await db.collection("people").updateOne(
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
      await db.collection("people").insertOne({
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

  logger.info("jobs.slack-users-sync.succeeded", {
    durationMs: Date.now() - startedAtMs,
    fetched: members.length,
    attempted: membersToSync.length,
    created,
    updated,
  });

  return { success: true, created, updated };
};


