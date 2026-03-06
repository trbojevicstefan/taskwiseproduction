import { apiError } from "@/lib/api-route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { getWorkspaceIdForUser } from "@/lib/workspace";
import {
  assertWorkspaceAccess,
  ensureWorkspaceBootstrapForUser,
} from "@/lib/workspace-context";

const formatHeading = (value: unknown) => {
  if (typeof value !== "string") return "Untitled Meeting";
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "Untitled Meeting";
};

const formatDate = (value: unknown) => {
  if (!value) return "Unknown";
  const date = new Date(value as any);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toISOString();
};

export async function GET(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return apiError(401, "request_error", "Unauthorized");
  }

  const db = await getDb();
  await ensureWorkspaceBootstrapForUser(db as any, userId);

  const searchParams = new URL(request.url).searchParams;
  const workspaceId =
    searchParams.get("workspaceId")?.trim() ||
    (await getWorkspaceIdForUser(db, userId));

  if (!workspaceId) {
    return apiError(400, "request_error", "Workspace is not configured.");
  }

  await assertWorkspaceAccess(db as any, userId, workspaceId, "member");

  const meetings = await db
    .collection("meetings")
    .find(
      {
        workspaceId,
        isHidden: { $ne: true },
        originalTranscript: { $type: "string", $ne: "" },
      },
      {
        projection: {
          _id: 1,
          title: 1,
          originalTranscript: 1,
          startTime: 1,
          createdAt: 1,
        },
      }
    )
    .sort({ lastActivityAt: -1, _id: -1 })
    .toArray();

  const exportedAt = new Date().toISOString();
  const header = [
    "# TaskWise Meeting Transcript Export",
    `Exported At: ${exportedAt}`,
    `Workspace ID: ${workspaceId}`,
    `Total Meetings: ${meetings.length}`,
    "",
  ].join("\n");

  const sections = meetings.map((meeting: any, index: number) => {
    const meetingDate = formatDate(meeting.startTime || meeting.createdAt);
    return [
      `## ${index + 1}. ${formatHeading(meeting.title)}`,
      `Meeting ID: ${String(meeting._id || "unknown")}`,
      `Date: ${meetingDate}`,
      "",
      "### Transcript",
      String(meeting.originalTranscript || "").trim(),
      "",
      "---",
      "",
    ].join("\n");
  });

  const content = [header, ...sections].join("\n");
  const fileName = `taskwise-transcripts-${new Date()
    .toISOString()
    .slice(0, 10)}.md`;

  return new Response(content, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
