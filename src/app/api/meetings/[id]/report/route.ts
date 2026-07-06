import { z } from "zod";
import {
  buildDeterministicReport,
  generateMeetingReport,
  type MeetingReportFlowInput,
} from "@/ai/flows/meeting-report-flow";
import {
  ApiRouteError,
  apiError,
  apiSuccess,
  createRouteRequestContext,
  getApiErrorStatus,
  mapApiError,
} from "@/lib/api-route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";
import type { GeneralChatSource } from "@/types/general-chat";

const ROUTE = "/api/meetings/[id]/report";

const requestSchema = z.object({
  /** Optional emphasis for the report (e.g. "focus on client commitments"). */
  focus: z.string().trim().min(1).max(500).optional(),
});

const MAX_TASK_LINES = 100;
const MAX_ATTENDEE_LINES = 60;
const MAX_DECISION_LINES = 40;
const MAX_COMPLETION_LINES = 40;
const MAX_RAW_TRANSCRIPT_CHARS = 200_000;
const TRANSCRIPT_HEAD_CHARS = 10_000;
const TRANSCRIPT_TAIL_CHARS = 4_000;

type MeetingScope = {
  userId: string;
  workspaceId?: string | null;
  memberUserIds?: string[];
};

/**
 * Load a meeting applying the same workspace scope rules as the other meeting
 * routes (see /api/ai/chat): a workspace-stamped meeting must belong to the
 * resolved workspace; a legacy meeting without workspaceId must be owned by a
 * workspace member. Returns null (treated as 404) for missing, hidden, or
 * out-of-scope meetings.
 */
const loadScopedMeeting = async (
  db: any,
  meetingId: string,
  scope: MeetingScope
): Promise<any | null> => {
  const meeting = await db
    .collection("meetings")
    .findOne({ $or: [{ _id: meetingId }, { id: meetingId }] });
  if (!meeting || meeting.isHidden) return null;

  const meetingWorkspaceId =
    typeof meeting.workspaceId === "string" ? meeting.workspaceId.trim() : "";
  if (meetingWorkspaceId) {
    if (!scope.workspaceId || meetingWorkspaceId !== scope.workspaceId) {
      return null;
    }
    return meeting;
  }

  const memberUserIds =
    Array.isArray(scope.memberUserIds) && scope.memberUserIds.length
      ? scope.memberUserIds
      : [scope.userId];
  if (!memberUserIds.includes(meeting.userId)) return null;
  return meeting;
};

/** Transcript from originalTranscript or the first transcript artifact. */
const extractMeetingTranscript = (meeting: any): string => {
  const direct =
    typeof meeting?.originalTranscript === "string"
      ? meeting.originalTranscript.trim()
      : "";
  if (direct) return direct.slice(0, MAX_RAW_TRANSCRIPT_CHARS);
  const artifacts = Array.isArray(meeting?.artifacts) ? meeting.artifacts : [];
  for (const artifact of artifacts) {
    if (
      artifact &&
      artifact.type === "transcript" &&
      typeof artifact.processedText === "string" &&
      artifact.processedText.trim()
    ) {
      return artifact.processedText.trim().slice(0, MAX_RAW_TRANSCRIPT_CHARS);
    }
  }
  return "";
};

const singleLine = (value: unknown): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

/** Deterministic head+tail reduction so the report sees start and wrap-up. */
const reduceTranscriptForReport = (transcript: string): string => {
  if (transcript.length <= TRANSCRIPT_HEAD_CHARS + TRANSCRIPT_TAIL_CHARS) {
    return transcript;
  }
  const head = transcript.slice(0, TRANSCRIPT_HEAD_CHARS);
  const tail = transcript.slice(-TRANSCRIPT_TAIL_CHARS);
  return `${head}\n[... transcript truncated ...]\n${tail}`;
};

/**
 * Agenda block. Canonical shape is Array<{ id, title, notes, order }>
 * (src/lib/meeting-agenda.ts); looser legacy shapes are tolerated.
 */
const renderAgendaBlock = (agenda: unknown): string | undefined => {
  if (typeof agenda === "string" && agenda.trim()) return agenda.trim();
  if (Array.isArray(agenda)) {
    const lines = agenda
      .map((item, index) => {
        if (typeof item === "string") {
          return { text: singleLine(item), order: index, index };
        }
        const record = item as any;
        const title = singleLine(record?.title) || singleLine(record?.text);
        const notes = singleLine(record?.notes);
        const order =
          typeof record?.order === "number" ? record.order : index;
        return {
          text: title ? (notes ? `${title} — ${notes}` : title) : "",
          order,
          index,
        };
      })
      .filter((entry) => entry.text)
      .sort((a, b) => a.order - b.order || a.index - b.index)
      .map((entry) => `- ${entry.text}`);
    return lines.length ? lines.join("\n") : undefined;
  }
  return undefined;
};

const renderAttendeesBlock = (meeting: any): string | undefined => {
  const attendees = Array.isArray(meeting?.attendees) ? meeting.attendees : [];
  const lines = attendees
    .slice(0, MAX_ATTENDEE_LINES)
    .map((person: any) => {
      const name = singleLine(person?.name);
      if (!name) return "";
      const parts = [name];
      if (singleLine(person?.title)) parts.push(singleLine(person.title));
      if (singleLine(person?.email)) parts.push(singleLine(person.email));
      const role = person?.role === "mentioned" ? "mentioned" : "attendee";
      parts.push(role);
      return `- ${parts.join(" | ")}`;
    })
    .filter(Boolean);
  return lines.length ? lines.join("\n") : undefined;
};

const renderDecisionsBlock = (meeting: any): string | undefined => {
  const lines: string[] = [];
  const keyMoments = Array.isArray(meeting?.keyMoments) ? meeting.keyMoments : [];
  keyMoments.slice(0, MAX_DECISION_LINES).forEach((moment: any) => {
    const description = singleLine(moment?.description);
    if (!description) return;
    const stamp = singleLine(moment?.timestamp);
    lines.push(`- ${stamp ? `[${stamp}] ` : ""}${description}`);
  });
  const blockers = Array.isArray(meeting?.meetingMetadata?.blockers)
    ? meeting.meetingMetadata.blockers
    : [];
  blockers.slice(0, MAX_DECISION_LINES).forEach((blocker: any) => {
    const text = singleLine(blocker);
    if (text) lines.push(`- BLOCKER: ${text}`);
  });
  return lines.length ? lines.join("\n") : undefined;
};

type ReportTask = {
  id: string;
  sourceTaskId?: string | null;
  title?: string;
  status?: string;
  assigneeName?: string | null;
  dueAt?: unknown;
  cleanupStatus?: string | null;
  completionSuggested?: boolean | null;
  completionEvidence?: Array<{ snippet?: string; timestamp?: string | null }> | null;
  cleanupEvidence?: Array<{ snippet?: string }> | null;
};

const toIsoDay = (value: unknown): string => {
  if (!value) return "";
  const parsed = new Date(value as string | number | Date);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
};

const renderTasksBlock = (tasks: ReportTask[]): string | undefined => {
  const lines = tasks.slice(0, MAX_TASK_LINES).map((task) => {
    const parts = [
      `TASK ${task.id}`,
      singleLine(task.title) || "Untitled task",
      `status=${singleLine(task.status) || "todo"}`,
    ];
    const due = toIsoDay(task.dueAt);
    if (due) parts.push(`due=${due}`);
    if (singleLine(task.assigneeName)) {
      parts.push(`owner=${singleLine(task.assigneeName)}`);
    }
    return parts.join(" | ");
  });
  return lines.length ? lines.join("\n") : undefined;
};

const renderCompletionSignalsBlock = (
  tasks: ReportTask[]
): string | undefined => {
  const lines: string[] = [];
  for (const task of tasks) {
    const isSignal =
      task.cleanupStatus === "completed_suggested" ||
      task.completionSuggested === true;
    if (!isSignal) continue;
    const snippets = [
      ...(Array.isArray(task.completionEvidence) ? task.completionEvidence : []),
      ...(Array.isArray(task.cleanupEvidence) ? task.cleanupEvidence : []),
    ]
      .map((item) => singleLine(item?.snippet))
      .filter(Boolean);
    const evidence = snippets[0] ? ` | evidence: "${snippets[0]}"` : "";
    lines.push(
      `TASK ${task.id} | ${singleLine(task.title) || "Untitled task"} | looks already done${evidence}`
    );
    if (lines.length >= MAX_COMPLETION_LINES) break;
  }
  return lines.length ? lines.join("\n") : undefined;
};

/**
 * Anti-hallucination filter (same pattern as /api/ai/chat): meeting/transcript
 * sources must reference the one meeting in context and task sources must
 * reference a real extracted task id. Everything else is dropped.
 */
const filterReportSources = (
  sources: GeneralChatSource[],
  meetingIds: Set<string>,
  taskIds: Set<string>
): GeneralChatSource[] =>
  sources.filter((source) => {
    switch (source.sourceType) {
      case "meeting":
      case "transcript":
        return meetingIds.has(source.sourceId);
      case "task":
        return taskIds.has(source.sourceId);
      default:
        return false;
    }
  });

const buildScopeFilter = (
  workspaceId: string | null | undefined,
  memberUserIds: string[]
): Record<string, any> =>
  workspaceId
    ? {
        $or: [
          { workspaceId },
          { workspaceId: { $exists: false }, userId: { $in: memberUserIds } },
        ],
      }
    : { userId: { $in: memberUserIds } };

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const routeContext = createRouteRequestContext({
    request,
    route: ROUTE,
    method: "POST",
  });
  const { correlationId, logger, durationMs, setMetricUserId, emitMetric } =
    routeContext;

  try {
    const userId = await getSessionUserId();
    if (!userId) {
      emitMetric(401, "error", { reason: "unauthorized" });
      logger.warn("api.request.unauthorized", { durationMs: durationMs() });
      return apiError(401, "unauthorized", "Unauthorized", undefined, {
        correlationId,
      });
    }
    setMetricUserId(userId);

    const { id } = await params;
    if (!id) {
      emitMetric(400, "error", { reason: "missing_meeting_id" });
      return apiError(400, "invalid_request", "Meeting ID is required.", undefined, {
        correlationId,
      });
    }

    // Missing/empty JSON bodies are tolerated the way the sibling rescan
    // route tolerates them; a present body must validate against the schema.
    const rawBody = await request.json().catch(() => ({}));
    const parsedBody = requestSchema.safeParse(rawBody ?? {});
    if (!parsedBody.success) {
      throw new ApiRouteError(
        400,
        "invalid_payload",
        "Invalid report request payload.",
        parsedBody.error.flatten()
      );
    }
    const body = parsedBody.data;

    const db = await getDb();
    const { workspaceId, workspaceMemberUserIds } =
      await resolveWorkspaceScopeForUser(db, userId, {
        minimumRole: "member",
        includeMemberUserIds: true,
      });

    const meeting = await loadScopedMeeting(db, id, {
      userId,
      workspaceId,
      memberUserIds: workspaceMemberUserIds,
    });
    if (!meeting) {
      emitMetric(404, "error", { reason: "meeting_not_found" });
      logger.warn("api.request.meeting_not_found", { durationMs: durationMs() });
      return apiError(404, "not_found", "Meeting not found.", undefined, {
        correlationId,
      });
    }

    const canonicalMeetingId = String(meeting._id ?? id);
    const meetingIds = new Set<string>([canonicalMeetingId, id]);
    const meetingTitle =
      typeof meeting.title === "string" && meeting.title.trim()
        ? meeting.title.trim()
        : "Untitled meeting";
    const transcript = extractMeetingTranscript(meeting);
    const summary =
      typeof meeting.summary === "string" ? meeting.summary.trim() : "";

    const memberUserIds =
      Array.isArray(workspaceMemberUserIds) && workspaceMemberUserIds.length
        ? workspaceMemberUserIds
        : [userId];
    const tasks: ReportTask[] = (
      await db
        .collection("tasks")
        .find(
          {
            ...buildScopeFilter(workspaceId, memberUserIds),
            sourceSessionType: "meeting",
            sourceSessionId: { $in: Array.from(meetingIds) },
          },
          {
            projection: {
              _id: 1,
              sourceTaskId: 1,
              title: 1,
              status: 1,
              assigneeName: 1,
              dueAt: 1,
              cleanupStatus: 1,
              completionSuggested: 1,
              completionEvidence: 1,
              cleanupEvidence: 1,
            },
          }
        )
        .limit(MAX_TASK_LINES * 2)
        .toArray()
    ).map((task: any) => ({ ...task, id: String(task._id) }));

    const taskIds = new Set<string>();
    tasks.forEach((task) => {
      taskIds.add(task.id);
      if (task.sourceTaskId) taskIds.add(String(task.sourceTaskId));
    });

    const meetingDateSource =
      meeting.startTime ?? meeting.createdAt ?? meeting.lastActivityAt;
    const flowInput: MeetingReportFlowInput = {
      meetingId: canonicalMeetingId,
      meetingTitle,
      meetingDate: toIsoDay(meetingDateSource),
      summary: summary || undefined,
      agenda: renderAgendaBlock(meeting.agenda),
      decisionsBlock: renderDecisionsBlock(meeting),
      tasksBlock: renderTasksBlock(tasks),
      attendeesBlock: renderAttendeesBlock(meeting),
      completionSignalsBlock: renderCompletionSignalsBlock(tasks),
      transcript: transcript ? reduceTranscriptForReport(transcript) : undefined,
      focus: body.focus,
      today: new Date().toISOString().slice(0, 10),
    };

    if (!transcript && !summary) {
      // Deterministic no-evidence path — never call the LLM without any
      // grounding transcript/summary. Structured data (tasks, attendees)
      // still renders deterministically.
      const fallback = buildDeterministicReport(flowInput);
      const data = {
        meetingId: canonicalMeetingId,
        report: `${fallback.report}\n\n_Note: this meeting has no transcript or summary attached, so this report only reflects structured data (tasks, attendees, agenda)._`,
        sources: [] as GeneralChatSource[],
        grounded: false,
        generatedAt: new Date().toISOString(),
      };
      logger.info("api.request.succeeded", {
        status: 200,
        durationMs: durationMs(),
        outcome: "no_evidence",
        meetingId: canonicalMeetingId,
      });
      emitMetric(200, "success", { outcome: "no_evidence" });
      return apiSuccess({ data }, { correlationId });
    }

    const flowResult = await generateMeetingReport(flowInput, {
      correlationId,
      userId,
    });

    const sources = filterReportSources(flowResult.sources, meetingIds, taskIds);
    const droppedSourceCount = flowResult.sources.length - sources.length;

    const data = {
      meetingId: canonicalMeetingId,
      report: flowResult.report,
      sources,
      grounded: true,
      generatedAt: new Date().toISOString(),
    };

    logger.info("api.request.succeeded", {
      status: 200,
      durationMs: durationMs(),
      outcome: "report_generated",
      meetingId: canonicalMeetingId,
      hasTranscript: Boolean(transcript),
      taskCount: tasks.length,
      sourceCount: sources.length,
      droppedSourceCount,
    });
    emitMetric(200, "success", {
      outcome: "report_generated",
      sourceCount: sources.length,
      droppedSourceCount,
    });
    return apiSuccess({ data }, { correlationId });
  } catch (error) {
    const statusCode = getApiErrorStatus(error);
    emitMetric(statusCode, "error");
    return mapApiError(error, "Failed to generate meeting report.", {
      correlationId,
      logger,
      context: {
        route: ROUTE,
        method: "POST",
        durationMs: durationMs(),
      },
    });
  }
}
