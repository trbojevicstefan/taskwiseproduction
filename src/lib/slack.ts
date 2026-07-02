import crypto from "crypto";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/db";
import { recordExternalApiFailure } from "@/lib/observability-metrics";

export interface SlackInstallationDoc {
  _id: string;
  teamId: string;
  teamName?: string | null;
  botUserId?: string | null;
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: number | null;
  scope?: string | null;
  installedByUserId?: string | null;
  installedAt?: Date;
}

const INSTALLATIONS_COLLECTION = "slackInstallations";
const OAUTH_STATE_COLLECTION = "slackOauthStates";

const SLACK_CLIENT_ID = process.env.SLACK_CLIENT_ID;
const SLACK_CLIENT_SECRET = process.env.SLACK_CLIENT_SECRET;

export const SLACK_SCOPES = [
  "chat:write",
  "chat:write.public",
  "channels:read",
  "groups:read",
  "im:write",
  "users:read",
  "users:read.email",
].join(",");

const getBaseUrl = () => {
  const raw =
    process.env.NEXTAUTH_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  if (!raw) {
    throw new Error("Missing base URL for Slack OAuth redirect.");
  }
  return raw.replace(/\/$/, "");
};

export const getSlackRedirectUri = () => `${getBaseUrl()}/api/slack/oauth/callback`;

export const createSlackOAuthState = async (userId: string): Promise<string> => {
  const db = await getDb();
  const state = crypto.randomBytes(24).toString("hex");
  await db.collection(OAUTH_STATE_COLLECTION).insertOne({
    _id: state,
    userId,
    createdAt: new Date(),
  });
  return state;
};

export const consumeSlackOAuthState = async (
  state: string
): Promise<string | null> => {
  const db = await getDb();
  const record = await db
    .collection(
      OAUTH_STATE_COLLECTION
    )
    .findOne({ _id: state });
  if (!record) return null;
  await db.collection(OAUTH_STATE_COLLECTION).deleteOne({ _id: state });
  return record.userId;
};

export const getSlackInstallation = async (
  teamId: string
): Promise<SlackInstallationDoc | null> => {
  const db = await getDb();
  return db
    .collection(INSTALLATIONS_COLLECTION)
    .findOne({ _id: teamId });
};

export const saveSlackInstallation = async (
  installation: SlackInstallationDoc
) => {
  const db = await getDb();
  await db
    .collection(INSTALLATIONS_COLLECTION)
    .updateOne(
      { _id: installation.teamId },
      { $set: installation },
      { upsert: true }
    );
};

export const deleteSlackInstallation = async (teamId: string) => {
  const db = await getDb();
  await db.collection(INSTALLATIONS_COLLECTION).deleteOne({ _id: teamId });
};

const refreshSlackToken = async (installation: SlackInstallationDoc) => {
  if (!SLACK_CLIENT_ID || !SLACK_CLIENT_SECRET) {
    throw new Error("Slack client credentials are not configured.");
  }
  if (!installation.refreshToken) {
    throw new Error("Missing Slack refresh token.");
  }

  const params = new URLSearchParams({
    client_id: SLACK_CLIENT_ID,
    client_secret: SLACK_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: installation.refreshToken,
  });

  let response: Response;
  try {
    response = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });
  } catch (error) {
    void recordExternalApiFailure({
      provider: "slack",
      operation: "oauth.token.refresh",
      error,
      metadata: {
        slackTeamId: installation.teamId,
      },
    });
    throw error;
  }

  const payload = (await response.json()) as {
    ok: boolean;
    error?: string;
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };

  if (!payload.ok || !payload.access_token) {
    void recordExternalApiFailure({
      provider: "slack",
      operation: "oauth.token.refresh",
      statusCode: response.status,
      error: payload.error || "Failed to refresh Slack token.",
      metadata: {
        slackTeamId: installation.teamId,
      },
    });
    throw new Error(payload.error || "Failed to refresh Slack token.");
  }

  const updated: SlackInstallationDoc = {
    ...installation,
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || installation.refreshToken,
    expiresAt: payload.expires_in
      ? Date.now() + payload.expires_in * 1000
      : installation.expiresAt || null,
  };

  await saveSlackInstallation(updated);
  return updated.accessToken;
};

export const getValidSlackToken = async (teamId: string): Promise<string> => {
  const installation = await getSlackInstallation(teamId);
  if (!installation) {
    throw new Error("Slack installation not found for this team.");
  }

  const now = Date.now();
  if (
    installation.expiresAt &&
    now >= installation.expiresAt - 60_000 &&
    installation.refreshToken
  ) {
    return refreshSlackToken(installation);
  }

  return installation.accessToken;
};

export const getSlackUserTeamId = async (
  userId: string
): Promise<string | null> => {
  const db = await getDb();
  const user = await db
    .collection("users")
    .findOne({ _id: new ObjectId(userId) });
  return user?.slackTeamId || null;
};

