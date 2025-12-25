import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/server-auth";
import { getFathomIntegrationLogs } from "@/lib/fathom-logs";

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

  const logs = await getFathomIntegrationLogs(userId, 200);
  return NextResponse.json(logs.map(serializeLog));
}
