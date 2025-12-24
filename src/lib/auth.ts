import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { findUserByEmail, verifyUserPassword } from "@/lib/db/users";

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
  },
  providers: [
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
          workspace: user.workspace,
          firefliesWebhookToken: user.firefliesWebhookToken,
          slackTeamId: user.slackTeamId || null,
          taskGranularityPreference: user.taskGranularityPreference,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
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
