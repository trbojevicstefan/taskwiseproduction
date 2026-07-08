import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";
import {
  extractTranscriptSnippets,
  tokenize,
} from "@/lib/workspace-retrieval";

/**
 * Priority 9 — narrow additive extension backing the person profile's
 * "Recent transcript mentions" section (the meetings list API does not return
 * transcripts). Scans the workspace's most recent meetings' transcripts for
 * lines mentioning the person's name or aliases and returns short snippets.
 */

const MAX_MEETINGS_SCANNED = 25;
const MAX_SNIPPETS_PER_MEETING = 2;
const MAX_MENTIONS = 10;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = await getSessionUserId();
  if (!userId) {
    return apiError(401, "request_error", "Unauthorized");
  }

  const db = await getDb();
  const { workspaceId, workspaceMemberUserIds } =
    await resolveWorkspaceScopeForUser(db, userId, {
      minimumRole: "member",
      adminVisibilityKey: "people",
      includeMemberUserIds: true,
    });
  const workspaceFallbackScope = {
    $or: [
      { workspaceId },
      {
        workspaceId: { $exists: false },
        userId: { $in: workspaceMemberUserIds },
      },
    ],
  };

  const person = await db.collection("people").findOne({
    $and: [
      workspaceFallbackScope as any,
      { $or: [{ _id: id }, { id }, { slackId: id }] },
    ],
  } as any);
  if (!person) {
    return apiError(404, "request_error", "Person not found");
  }

  const names = [
    person.name,
    ...(Array.isArray(person.aliases) ? person.aliases : []),
  ].filter((name: unknown) => typeof name === "string" && name.trim());

  const query = tokenize(names.join(" "));
  if (!query.tokens.length && !query.phrases.length) {
    return NextResponse.json({ mentions: [] });
  }

  const meetings = await db
    .collection("meetings")
    .find({
      $and: [workspaceFallbackScope as any, { isHidden: { $ne: true } }],
    } as any)
    .project({ _id: 1, title: 1, startTime: 1, originalTranscript: 1 })
    .sort({ lastActivityAt: -1, _id: -1 })
    .limit(MAX_MEETINGS_SCANNED)
    .toArray();

  const mentions: Array<{
    meetingId: string;
    meetingTitle: string;
    startTime: string | null;
    snippet: string;
    timestamp: string | null;
  }> = [];

  for (const meeting of meetings) {
    if (mentions.length >= MAX_MENTIONS) break;
    const snippets = extractTranscriptSnippets(
      typeof meeting.originalTranscript === "string"
        ? meeting.originalTranscript
        : "",
      query,
      MAX_SNIPPETS_PER_MEETING
    );
    for (const snippet of snippets) {
      if (mentions.length >= MAX_MENTIONS) break;
      const startTime = meeting.startTime
        ? new Date(meeting.startTime)
        : null;
      mentions.push({
        meetingId: String(meeting._id),
        meetingTitle:
          typeof meeting.title === "string" && meeting.title.trim()
            ? meeting.title.trim()
            : "Untitled meeting",
        startTime:
          startTime && !Number.isNaN(startTime.getTime())
            ? startTime.toISOString()
            : null,
        snippet: snippet.snippet,
        timestamp: snippet.timestamp,
      });
    }
  }

  return NextResponse.json({ mentions });
}
