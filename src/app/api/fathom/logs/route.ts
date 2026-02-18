import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { getFathomIntegrationLogs } from "@/lib/fathom-logs";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";

const serializeLog = (log: any) => ({
  ...log,
  id: log._id?.toString?.() || log._id,
  _id: undefined,
  createdAt: log.createdAt?.toISOString?.() || log.createdAt,
});

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

  const logs = await getFathomIntegrationLogs(userId, 200);
  return NextResponse.json(logs.map(serializeLog));
}
