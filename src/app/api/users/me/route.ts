import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { findUserById, updateUserById } from "@/lib/db/users";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  displayName: z.string().min(1).optional(),
  avatarUrl: z.string().optional().nullable(),
  photoURL: z.string().optional().nullable(),
  workspace: z.object({ name: z.string().min(1) }).optional(),
  onboardingCompleted: z.boolean().optional(),
  firefliesWebhookToken: z.string().optional().nullable(),
  slackTeamId: z.string().optional().nullable(),
  fathomWebhookToken: z.string().optional().nullable(),
  fathomConnected: z.boolean().optional(),
  fathomUserId: z.string().optional().nullable(),
  taskGranularityPreference: z.enum(["light", "medium", "detailed"]).optional(),
  autoApproveCompletedTasks: z.boolean().optional(),
});

const toAppUser = (user: Awaited<ReturnType<typeof findUserById>>) => {
  if (!user) return null;
  const id = user._id.toString();
  return {
    id,
    uid: id,
    userId: id,
    name: user.name,
    displayName: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
    photoURL: user.avatarUrl,
    createdAt: user.createdAt.toISOString(),
    lastUpdated: user.lastUpdated.toISOString(),
    lastSeenAt: user.lastSeenAt.toISOString(),
    onboardingCompleted: user.onboardingCompleted,
    workspace: user.workspace,
    firefliesWebhookToken: user.firefliesWebhookToken,
    slackTeamId: user.slackTeamId || null,
    fathomWebhookToken: user.fathomWebhookToken || null,
    fathomConnected: Boolean(user.fathomConnected),
    fathomUserId: user.fathomUserId || null,
    sourceSessionIds: user.sourceSessionIds || [],
    taskGranularityPreference: user.taskGranularityPreference,
    autoApproveCompletedTasks: Boolean(user.autoApproveCompletedTasks),
    googleConnected: Boolean(user.googleConnected),
    googleEmail: user.googleEmail || null,
  };
};

export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await findUserById(userId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json(toAppUser(user));
}

export async function PATCH(request: Request) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid update payload." }, { status: 400 });
  }

  const update = parsed.data;
  const name = update.displayName || update.name;
  const avatarUrl = update.photoURL || update.avatarUrl;

  await updateUserById(userId, {
    ...(name ? { name } : {}),
    ...(avatarUrl !== undefined ? { avatarUrl } : {}),
    ...(update.workspace ? { workspace: update.workspace } : {}),
    ...(update.onboardingCompleted !== undefined
      ? { onboardingCompleted: update.onboardingCompleted }
      : {}),
    ...(update.firefliesWebhookToken !== undefined
      ? { firefliesWebhookToken: update.firefliesWebhookToken }
      : {}),
    ...(update.slackTeamId !== undefined ? { slackTeamId: update.slackTeamId } : {}),
    ...(update.fathomWebhookToken !== undefined
      ? { fathomWebhookToken: update.fathomWebhookToken }
      : {}),
    ...(update.fathomConnected !== undefined
      ? { fathomConnected: update.fathomConnected }
      : {}),
    ...(update.fathomUserId !== undefined ? { fathomUserId: update.fathomUserId } : {}),
    ...(update.taskGranularityPreference !== undefined
      ? { taskGranularityPreference: update.taskGranularityPreference }
      : {}),
    ...(update.autoApproveCompletedTasks !== undefined
      ? { autoApproveCompletedTasks: update.autoApproveCompletedTasks }
      : {}),
  });

  const user = await findUserById(userId);
  return NextResponse.json(toAppUser(user));
}

