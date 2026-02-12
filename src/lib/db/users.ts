import { ObjectId } from "mongodb";
import { randomUUID } from "crypto";
import { compare, hash } from "bcryptjs";
import { getDb } from "@/lib/db";

export interface DbUser {
  _id: ObjectId;
  email: string;
  passwordHash: string;
  name: string;
  avatarUrl: string | null;
  sourceSessionIds: string[];
  createdAt: Date;
  lastUpdated: Date;
  lastSeenAt: Date;
  onboardingCompleted: boolean;
  workspace: { id: string; name: string };
  firefliesWebhookToken: string | null;
  slackTeamId?: string | null;
  fathomWebhookToken?: string | null;
  fathomConnected?: boolean;
  fathomUserId?: string | null;
  taskGranularityPreference?: "light" | "medium" | "detailed";
  autoApproveCompletedTasks?: boolean;
  completionMatchThreshold?: number;
  slackAutoShareEnabled?: boolean;
  slackAutoShareChannelId?: string | null;
  googleAccessToken?: string | null;
  googleRefreshToken?: string | null;
  googleTokenExpiry?: number | null;
  googleScopes?: string | null;
  googleConnected?: boolean;
  googleEmail?: string | null;
  briefGenerationMonth?: string | null;
  briefGenerationCount?: number;
}

const USERS_COLLECTION = "users";

const normalizeEmail = (email: string) => email.trim().toLowerCase();

export const findUserByEmail = async (email: string): Promise<DbUser | null> => {
  const db = await getDb();
  return db.collection<DbUser>(USERS_COLLECTION).findOne({ email: normalizeEmail(email) });
};

export const findUserById = async (id: string): Promise<DbUser | null> => {
  const db = await getDb();
  return db.collection<DbUser>(USERS_COLLECTION).findOne({ _id: new ObjectId(id) });
};

export const createUser = async ({
  email,
  password,
  displayName,
}: {
  email: string;
  password: string;
  displayName?: string | null;
}): Promise<DbUser> => {
  const db = await getDb();
  const now = new Date();
  const normalizedEmail = normalizeEmail(email);
  const safeName = (displayName && displayName.trim()) || normalizedEmail.split("@")[0] || "User";
  const avatarUrl = `https://api.dicebear.com/8.x/initials/svg?seed=${encodeURIComponent(safeName)}`;
  const passwordHash = await hash(password, 10);

  const doc: Omit<DbUser, "_id"> = {
    email: normalizedEmail,
    passwordHash,
    name: safeName,
    avatarUrl,
    sourceSessionIds: [],
    createdAt: now,
    lastUpdated: now,
    lastSeenAt: now,
    onboardingCompleted: false,
    workspace: { id: randomUUID(), name: `${safeName}'s Workspace` },
    firefliesWebhookToken: null,
    slackTeamId: null,
    fathomWebhookToken: null,
    fathomConnected: false,
    fathomUserId: null,
    taskGranularityPreference: "medium",
    autoApproveCompletedTasks: false,
    completionMatchThreshold: 0.6,
    slackAutoShareEnabled: false,
    slackAutoShareChannelId: null,
    googleAccessToken: null,
    googleRefreshToken: null,
    googleTokenExpiry: null,
    googleScopes: null,
    googleConnected: false,
    googleEmail: null,
    briefGenerationMonth: null,
    briefGenerationCount: 0,
  };

  const result = await db.collection<DbUser>(USERS_COLLECTION).insertOne(doc as DbUser);
  return { ...doc, _id: result.insertedId };
};

export const verifyUserPassword = async (user: DbUser, password: string) => {
  return compare(password, user.passwordHash);
};

export const updateUserById = async (id: string, update: Partial<DbUser>) => {
  const db = await getDb();
  const now = new Date();
  const { _id, passwordHash, createdAt, ...safeUpdate } = update;

  await db.collection<DbUser>(USERS_COLLECTION).updateOne(
    { _id: new ObjectId(id) },
    {
      $set: {
        ...safeUpdate,
        lastUpdated: now,
      },
    }
  );
};

export const findUserByFathomWebhookToken = async (
  token: string
): Promise<DbUser | null> => {
  const db = await getDb();
  return db.collection<DbUser>(USERS_COLLECTION).findOne({
    fathomWebhookToken: token,
  });
};
