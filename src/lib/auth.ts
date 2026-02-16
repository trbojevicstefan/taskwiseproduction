import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { randomBytes, randomUUID } from "crypto";
import { cookies } from "next/headers";
import { findUserByEmail, findUserById, verifyUserPassword, createUser, updateUserById } from "@/lib/db/users";
import { GOOGLE_INTEGRATION_USER_COOKIE } from "@/lib/integration-cookies";

type WorkspaceInfo = { id: string; name: string };

const ensureWorkspaceId = async (user: {
  _id: { toString: () => string };
  name?: string | null;
  workspace?: { id?: string; name?: string };
}): Promise<WorkspaceInfo> => {
  if (user.workspace?.id) {
    return {
      id: user.workspace.id,
      name: user.workspace.name || `${user.name || "Workspace"}'s Workspace`,
    };
  }
  const workspaceName =
    user.workspace?.name || `${user.name || "Workspace"}'s Workspace`;
  const workspace: WorkspaceInfo = { id: randomUUID(), name: workspaceName };
  await updateUserById(user._id.toString(), { workspace });
  return workspace;
};

const providers: any[] = [
  CredentialsProvider({
    name: "Credentials",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    async authorize(credentials) {
      const email = credentials?.email?.trim().toLowerCase();
      const password = credentials?.password;

      if (!email || !password) {
        return null;
      }

      const user = await findUserByEmail(email);
      if (!user) {
        return null;
      }

      const isValid = await verifyUserPassword(user, password);
      if (!isValid) {
        return null;
      }

      const workspace = await ensureWorkspaceId(user);
      const userId = user._id.toString();

      return {
        id: userId,
        uid: userId,
        userId,
        name: user.name,
        displayName: user.name,
        email: user.email,
        image: user.avatarUrl || undefined,
        photoURL: user.avatarUrl || null,
        avatarUrl: user.avatarUrl || null,
        onboardingCompleted: user.onboardingCompleted,
        workspace,
        firefliesWebhookToken: user.firefliesWebhookToken,
        slackTeamId: user.slackTeamId || null,
        taskGranularityPreference: user.taskGranularityPreference,
      };
    },
  }),
];

const googleAuthClientId = process.env.GOOGLE_CLIENT_ID;
const googleAuthClientSecret = process.env.GOOGLE_CLIENT_SECRET;
const googleIntegrationClientId = process.env.GOOGLE_INTEGRATION_CLIENT_ID;
const googleIntegrationClientSecret = process.env.GOOGLE_INTEGRATION_CLIENT_SECRET;

if (googleAuthClientId && googleAuthClientSecret) {
  providers.push(
    GoogleProvider({
      clientId: googleAuthClientId,
      clientSecret: googleAuthClientSecret,
      authorization: {
        params: {
          scope: [
            "openid",
            "email",
            "profile",
          ].join(" "),
        },
      },
    })
  );
}

if (googleIntegrationClientId && googleIntegrationClientSecret) {
  providers.push(
    GoogleProvider({
      id: "google-integration",
      name: "Google Calendar",
      clientId: googleIntegrationClientId,
      clientSecret: googleIntegrationClientSecret,
      authorization: {
        params: {
          scope: [
            "openid",
            "email",
            "profile",
            "https://www.googleapis.com/auth/calendar.readonly",
            "https://www.googleapis.com/auth/calendar.events",
            "https://www.googleapis.com/auth/tasks",
          ].join(" "),
          access_type: "offline",
          prompt: "consent",
        },
      },
    })
  );
}

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
  },
  providers,
  callbacks: {
    async signIn({ account }) {
      if (account?.provider === "google-integration") {
        const cookieStore = await cookies();
        const integrationUserId = cookieStore.get(GOOGLE_INTEGRATION_USER_COOKIE)?.value;
        if (!integrationUserId) {
          return false;
        }
        const dbUser = await findUserById(integrationUserId);
        if (!dbUser) {
          return false;
        }
      }
      return true;
    },
    async jwt({ token, user, account, profile }) {
      if (account?.provider === "google") {
        const email =
          (profile as { email?: string | null })?.email ||
          (token.email as string | undefined);

        if (email) {
          const normalizedEmail = email.trim().toLowerCase();
          let dbUser = await findUserByEmail(normalizedEmail);
          if (!dbUser) {
            const randomPassword = randomBytes(20).toString("hex");
            dbUser = await createUser({
              email: normalizedEmail,
              password: randomPassword,
              displayName: (profile as { name?: string | null })?.name || null,
            });
          }

          const workspace = await ensureWorkspaceId(dbUser);
          const userId = dbUser._id.toString();
          token.id = userId;
          token.uid = userId;
          token.userId = userId;
          token.name = dbUser.name;
          token.email = dbUser.email;
          token.image = dbUser.avatarUrl || undefined;
          token.displayName = dbUser.name;
          token.photoURL = dbUser.avatarUrl || null;
          token.avatarUrl = dbUser.avatarUrl || null;
          token.onboardingCompleted = dbUser.onboardingCompleted;
          token.workspace = workspace;
          token.firefliesWebhookToken = dbUser.firefliesWebhookToken;
          token.slackTeamId = dbUser.slackTeamId;
          token.taskGranularityPreference = dbUser.taskGranularityPreference;
        }
      }

      if (account?.provider === "google-integration") {
        const email =
          (profile as { email?: string | null })?.email ||
          (token.email as string | undefined);
        const normalizedEmail = email?.trim().toLowerCase();
        const existingUserId = (token.id as string | undefined) || (token.uid as string | undefined);
        const cookieStore = await cookies();
        const integrationUserId = cookieStore.get(GOOGLE_INTEGRATION_USER_COOKIE)?.value;
        const candidateUserId = existingUserId || integrationUserId;
        const dbUser = candidateUserId ? await findUserById(candidateUserId) : null;

        if (dbUser) {
          const workspace = await ensureWorkspaceId(dbUser);
          const userId = dbUser._id.toString();
          token.id = userId;
          token.uid = userId;
          token.userId = userId;
          token.name = dbUser.name;
          token.email = dbUser.email;
          token.image = dbUser.avatarUrl || undefined;
          token.displayName = dbUser.name;
          token.photoURL = dbUser.avatarUrl || null;
          token.avatarUrl = dbUser.avatarUrl || null;
          token.onboardingCompleted = dbUser.onboardingCompleted;
          token.workspace = workspace;
          token.firefliesWebhookToken = dbUser.firefliesWebhookToken;
          token.slackTeamId = dbUser.slackTeamId;
          token.taskGranularityPreference = dbUser.taskGranularityPreference;

          const update: Record<string, unknown> = {
            googleConnected: true,
            ...(normalizedEmail ? { googleEmail: normalizedEmail } : {}),
            ...(account.scope ? { googleScopes: account.scope } : {}),
          };
          if (account.access_token) {
            update.googleAccessToken = account.access_token;
          }
          if (account.refresh_token) {
            update.googleRefreshToken = account.refresh_token;
          }
          if (account.expires_at) {
            update.googleTokenExpiry = account.expires_at * 1000;
          }
          await updateUserById(userId, update);
        }
      }

      if (user && account?.provider === "credentials") {
        token.id = user.id;
        token.uid = (user as any).uid;
        token.userId = (user as any).userId;
        token.name = user.name;
        token.email = user.email;
        token.image = user.image;
        token.displayName = (user as any).displayName;
        token.photoURL = (user as any).photoURL;
        token.avatarUrl = (user as any).avatarUrl;
        token.onboardingCompleted = (user as any).onboardingCompleted;
        token.workspace = (user as any).workspace;
        token.firefliesWebhookToken = (user as any).firefliesWebhookToken;
        token.slackTeamId = (user as any).slackTeamId;
        token.taskGranularityPreference = (user as any).taskGranularityPreference;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.uid = token.uid as string;
        session.user.userId = token.userId as string;
        session.user.displayName = (token.displayName as string) || session.user.name || null;
        session.user.photoURL = (token.photoURL as string) || null;
        session.user.avatarUrl = (token.avatarUrl as string) || null;
        session.user.onboardingCompleted = (token.onboardingCompleted as boolean) || false;
        session.user.workspace = (token.workspace as any) || undefined;
        session.user.firefliesWebhookToken = (token.firefliesWebhookToken as string) || null;
        session.user.slackTeamId = (token.slackTeamId as string) || null;
        session.user.taskGranularityPreference =
          (token.taskGranularityPreference as "light" | "medium" | "detailed") || undefined;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
};
