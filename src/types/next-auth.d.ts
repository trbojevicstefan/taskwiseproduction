import "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      uid: string;
      userId: string;
      displayName?: string | null;
      photoURL?: string | null;
      avatarUrl?: string | null;
      onboardingCompleted?: boolean;
      workspace?: { id: string; name: string };
      firefliesWebhookToken?: string | null;
      slackTeamId?: string | null;
      taskGranularityPreference?: "light" | "medium" | "detailed";
    } & DefaultSession["user"];
  }

  interface User {
    uid?: string;
    userId?: string;
    displayName?: string | null;
    photoURL?: string | null;
    avatarUrl?: string | null;
    onboardingCompleted?: boolean;
    workspace?: { id: string; name: string };
    firefliesWebhookToken?: string | null;
    slackTeamId?: string | null;
    taskGranularityPreference?: "light" | "medium" | "detailed";
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    uid?: string;
    userId?: string;
    displayName?: string | null;
    photoURL?: string | null;
    avatarUrl?: string | null;
    onboardingCompleted?: boolean;
    workspace?: { id: string; name: string };
    firefliesWebhookToken?: string | null;
    slackTeamId?: string | null;
    taskGranularityPreference?: "light" | "medium" | "detailed";
  }
}
