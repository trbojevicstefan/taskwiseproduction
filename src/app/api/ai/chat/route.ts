import { z } from "zod";
import {
  answerMeetingQuestion,
  answerWorkspaceQuestion,
} from "@/ai/flows/general-chat-flow";
import {
  apiError,
  apiSuccess,
  createRouteRequestContext,
  getApiErrorStatus,
  mapApiError,
  parseJsonBody,
} from "@/lib/api-route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";
import { planWorkspaceChatQuestion } from "@/lib/chat-query-planner";
import { runInternalChatTool } from "@/lib/internal-chat-tools";
import {
  searchWorkspaceContext,
  type WorkspaceRetrievalResult,
} from "@/lib/workspace-retrieval";
import type {
  GeneralChatAnswer,
  GeneralChatSource,
  GeneralChatSuggestedAction,
} from "@/types/general-chat";

const ROUTE = "/api/ai/chat";

// Strict payload caps: questions and history entries are bounded, and the
// history list itself is capped so oversized payloads are rejected up front.
const MAX_HISTORY_ENTRIES = 20;
const MAX_HISTORY_ENTRY_CHARS = 2000;
const HISTORY_RENDER_ENTRIES = 12;
const HISTORY_RENDER_ENTRY_CHARS = 500;
const HISTORY_RENDER_MAX_CHARS = 6000;
const MAX_RAW_TRANSCRIPT_CHARS = 200_000;

const historyEntrySchema = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string().trim().min(1).max(MAX_HISTORY_ENTRY_CHARS),
});

const requestSchema = z.object({
  question: z.string().trim().min(1).max(2000),
  sessionId: z.string().trim().min(1).max(200).optional(),
  meetingId: z.string().trim().min(1).max(200).optional(),
  history: z.array(historyEntrySchema).max(MAX_HISTORY_ENTRIES).optional(),
});

type ChatHistoryEntry = z.infer<typeof historyEntrySchema>;

const NO_EVIDENCE_ANSWER =
  "I couldn't find anything in your workspace that matches this question — no meetings, transcripts, tasks, or people lined up with it. Try syncing your latest meetings, or rephrase the question with a meeting title, person, or task name.";

const UNVERIFIED_SOURCES_CAVEAT =
  "Note: I could not verify the cited sources against your workspace data, so treat this answer with caution.";

const buildNoEvidenceAnswer = (): GeneralChatAnswer => ({
  answer: NO_EVIDENCE_ANSWER,
  confidence: "low",
  sources: [],
  suggestedActions: [],
});

const singleLine = (value: string): string =>
  value.replace(/\s+/g, " ").trim();

/**
 * Render capped chat history as a compact labeled block for the flows. Only
 * the most recent turns are kept and each line is truncated.
 */
const renderHistoryBlock = (
  history: ChatHistoryEntry[] | undefined
): string | undefined => {
  if (!history?.length) return undefined;
  const rendered = history
    .slice(-HISTORY_RENDER_ENTRIES)
    .map(
      (entry) =>
        `${entry.role === "user" ? "User" : "Assistant"}: ${singleLine(
          entry.text
        ).slice(0, HISTORY_RENDER_ENTRY_CHARS)}`
    )
    .join("\n")
    .slice(0, HISTORY_RENDER_MAX_CHARS);
  return rendered || undefined;
};

// ---------------------------------------------------------------------------
// Meeting-scoped chat context
// ---------------------------------------------------------------------------

type MeetingScope = {
  userId: string;
  workspaceId?: string | null;
  memberUserIds?: string[];
};

/**
 * Load a meeting applying the same workspace scope rules as the other meeting
 * routes: a workspace-stamped meeting must belong to the resolved workspace;
 * a legacy meeting without workspaceId must be owned by a workspace member.
 * Returns null (treated as 404) for missing, hidden, or out-of-scope meetings.
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

const buildMissingTranscriptAnswer = (
  meetingId: string,
  meetingTitle: string
): GeneralChatAnswer => ({
  answer: `I don't have a transcript or summary for "${meetingTitle}" yet, so I can't answer questions about what was said. Sync or re-import this meeting to attach its transcript, then ask again.`,
  confidence: "low",
  sources: [],
  suggestedActions: [
    {
      label: "Open meeting",
      actionType: "open_meeting",
      targetId: meetingId,
    },
  ],
});

/**
 * Anti-hallucination filter for meeting mode: every source must reference the
 * one meeting in context (transcript/meeting types only), and actions may only
 * target that meeting.
 */
const filterMeetingSources = (
  sources: GeneralChatSource[],
  meetingIds: Set<string>
): GeneralChatSource[] =>
  sources.filter(
    (source) =>
      (source.sourceType === "meeting" || source.sourceType === "transcript") &&
      meetingIds.has(source.sourceId)
  );

const filterMeetingSuggestedActions = (
  actions: GeneralChatSuggestedAction[],
  meetingIds: Set<string>
): GeneralChatSuggestedAction[] =>
  actions.filter((action) => {
    switch (action.actionType) {
      case "open_meeting":
        return Boolean(action.targetId) && meetingIds.has(action.targetId!);
      case "create_task":
      case "schedule_slack_reminder":
        return !action.targetId || meetingIds.has(action.targetId);
      default:
        return false;
    }
  });

/**
 * Render the retrieval result as compact labeled context blocks. One entity
 * per line, ids immediately after the label so the LLM can copy them exactly.
 */
const renderContextBlocks = (result: WorkspaceRetrievalResult): string => {
  const lines: string[] = [];

  for (const meeting of result.meetings) {
    const date = meeting.startTime
      ? meeting.startTime.slice(0, 10)
      : "date unknown";
    lines.push(`MEETING ${meeting.id} | ${singleLine(meeting.title)} | ${date}`);
    if (meeting.summarySnippet) {
      lines.push(`  SUMMARY: ${singleLine(meeting.summarySnippet)}`);
    }
    for (const snippet of meeting.transcriptSnippets) {
      const stamp = snippet.timestamp ? `[${snippet.timestamp}] ` : "";
      lines.push(`  ${stamp}${singleLine(snippet.snippet)}`);
    }
  }

  for (const task of result.tasks) {
    const parts = [
      `TASK ${task.id}`,
      singleLine(task.title),
      `status=${task.status}`,
      `due=${task.dueAt ? task.dueAt.slice(0, 10) : "none"}`,
    ];
    if (task.assigneeName) parts.push(`assignee=${singleLine(task.assigneeName)}`);
    if (task.overdue) parts.push("OVERDUE");
    lines.push(parts.join(" | "));
  }

  for (const person of result.people) {
    const parts = [
      `PERSON ${person.id}`,
      singleLine(person.name),
      person.personType,
    ];
    if (person.email) parts.push(person.email);
    if (typeof person.openTaskCount === "number") {
      parts.push(`openTasks=${person.openTaskCount}`);
    }
    lines.push(parts.join(" | "));
  }

  return lines.join("\n");
};

type RetrievedIdSets = {
  meetingIds: Set<string>;
  taskIds: Set<string>;
  personIds: Set<string>;
};

const collectRetrievedIds = (result: WorkspaceRetrievalResult): RetrievedIdSets => ({
  meetingIds: new Set(result.meetings.map((meeting) => meeting.id)),
  taskIds: new Set(result.tasks.map((task) => task.id)),
  personIds: new Set(result.people.map((person) => person.id)),
});

/**
 * Anti-hallucination filter: keep only sources whose sourceId exists in the
 * retrieved context. Transcript sources must reference a retrieved meeting id.
 */
const filterSources = (
  sources: GeneralChatSource[],
  ids: RetrievedIdSets
): GeneralChatSource[] =>
  sources.filter((source) => {
    switch (source.sourceType) {
      case "meeting":
      case "transcript":
        return ids.meetingIds.has(source.sourceId);
      case "task":
        return ids.taskIds.has(source.sourceId);
      case "person":
      case "client":
        return ids.personIds.has(source.sourceId);
      default:
        return false;
    }
  });

/**
 * Validate suggested actions against retrieved ids. Actions with actionType
 * 'none' or with targetIds that do not exist in the retrieved context are
 * dropped entirely.
 */
const filterSuggestedActions = (
  actions: GeneralChatSuggestedAction[],
  ids: RetrievedIdSets
): GeneralChatSuggestedAction[] =>
  actions.filter((action) => {
    switch (action.actionType) {
      case "none":
        return false;
      case "open_meeting":
        return Boolean(action.targetId) && ids.meetingIds.has(action.targetId!);
      case "open_task":
        return Boolean(action.targetId) && ids.taskIds.has(action.targetId!);
      case "create_task":
      case "schedule_slack_reminder":
        return (
          !action.targetId ||
          ids.taskIds.has(action.targetId) ||
          ids.meetingIds.has(action.targetId) ||
          ids.personIds.has(action.targetId)
        );
      default:
        return false;
    }
  });

const buildOperationalFallbackAnswer = (
  queryPlan: { rationale: string },
  toolResult: { contextBlocks: string }
): GeneralChatAnswer | null => {
  if (queryPlan.rationale !== "meeting_count_this_week") {
    return null;
  }

  const count = (toolResult.contextBlocks.match(/^MEETING /gm) || []).length;
  return {
    answer:
      count === 0
        ? "You had no meetings this week based on the workspace calendar data I could access."
        : `You had ${count} meeting${
            count === 1 ? "" : "s"
          } this week based on the workspace calendar data I could access.`,
    confidence: "high",
    sources: [],
    suggestedActions: [],
  };
};

export async function POST(request: Request) {
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

    const { question, sessionId, meetingId, history } = await parseJsonBody(
      request,
      requestSchema,
      "Invalid chat question payload."
    );

    const db = await getDb();
    const { workspaceId, workspaceMemberUserIds } =
      await resolveWorkspaceScopeForUser(db, userId, {
        minimumRole: "member",
        includeMemberUserIds: true,
      });

    const historyBlock = renderHistoryBlock(history);

    // Resolve the meeting context: an explicit meetingId wins; otherwise a
    // sessionId whose chat session carries sourceMeetingId keeps the whole
    // session meeting-scoped (follow-ups like "Who said that?" stay grounded
    // in the same transcript even if the client omits meetingId).
    let effectiveMeetingId = meetingId ?? null;
    if (!effectiveMeetingId && sessionId) {
      const session = await db
        .collection("chatSessions")
        .findOne(
          { userId, $or: [{ _id: sessionId }, { id: sessionId }] },
          { projection: { sourceMeetingId: 1 } }
        );
      if (session?.sourceMeetingId) {
        effectiveMeetingId = String(session.sourceMeetingId);
      }
    }

    if (effectiveMeetingId) {
      const meeting = await loadScopedMeeting(db, effectiveMeetingId, {
        userId,
        workspaceId,
        memberUserIds: workspaceMemberUserIds,
      });
      if (!meeting) {
        emitMetric(404, "error", { reason: "meeting_not_found" });
        logger.warn("api.request.meeting_not_found", {
          durationMs: durationMs(),
        });
        return apiError(404, "not_found", "Meeting not found.", undefined, {
          correlationId,
        });
      }

      const canonicalMeetingId = String(meeting._id ?? effectiveMeetingId);
      const meetingIds = new Set<string>([
        canonicalMeetingId,
        effectiveMeetingId,
      ]);
      const meetingTitle =
        typeof meeting.title === "string" && meeting.title.trim()
          ? meeting.title.trim()
          : "Untitled meeting";
      const transcript = extractMeetingTranscript(meeting);
      const summary =
        typeof meeting.summary === "string" ? meeting.summary.trim() : "";

      if (!transcript && !summary) {
        // Deterministic missing-transcript answer — never call the LLM
        // without any meeting context.
        const data = buildMissingTranscriptAnswer(
          canonicalMeetingId,
          meetingTitle
        );
        logger.info("api.request.succeeded", {
          status: 200,
          durationMs: durationMs(),
          outcome: "meeting_no_transcript",
        });
        emitMetric(200, "success", { outcome: "meeting_no_transcript" });
        return apiSuccess({ data }, { correlationId });
      }

      const today = new Date().toISOString().slice(0, 10);
      const meetingDateSource =
        meeting.startTime ?? meeting.createdAt ?? meeting.lastActivityAt;
      const meetingDate = (() => {
        if (!meetingDateSource) return "";
        const parsed = new Date(meetingDateSource);
        return Number.isNaN(parsed.getTime())
          ? ""
          : parsed.toISOString().slice(0, 10);
      })();

      const flowResult = await answerMeetingQuestion(
        {
          question,
          meetingId: canonicalMeetingId,
          meetingTitle,
          meetingDate,
          summary: summary || undefined,
          transcript,
          history: historyBlock,
          today,
        },
        { correlationId, userId }
      );

      const sources = filterMeetingSources(flowResult.sources, meetingIds);
      const suggestedActions = filterMeetingSuggestedActions(
        flowResult.suggestedActions,
        meetingIds
      );

      let answer = flowResult.answer;
      let confidence = flowResult.confidence;
      const droppedSourceCount = flowResult.sources.length - sources.length;
      if (flowResult.sources.length > 0 && sources.length === 0) {
        // The model cited sources outside the meeting context — degrade and
        // caveat instead of presenting unverified claims.
        confidence = "low";
        answer = `${answer.trim()} ${UNVERIFIED_SOURCES_CAVEAT}`;
      }

      const data: GeneralChatAnswer = {
        answer,
        confidence,
        sources,
        suggestedActions,
      };

      logger.info("api.request.succeeded", {
        status: 200,
        durationMs: durationMs(),
        outcome: "meeting_answered",
        confidence,
        meetingId: canonicalMeetingId,
        hasTranscript: Boolean(transcript),
        sourceCount: sources.length,
        droppedSourceCount,
        suggestedActionCount: suggestedActions.length,
      });
      emitMetric(200, "success", {
        outcome: "meeting_answered",
        confidence,
        sourceCount: sources.length,
        droppedSourceCount,
      });
      return apiSuccess({ data }, { correlationId });
    }

    const queryPlan = planWorkspaceChatQuestion(question);

    if (queryPlan.mode === "workspace_tool") {
      const toolResult = await runInternalChatTool({
        db,
        workspaceId,
        toolName: queryPlan.toolName,
        toolArgs: queryPlan.toolArgs,
      });
      const today = new Date().toISOString().slice(0, 10);
      const contextBlocks = toolResult.answerHint
        ? `${toolResult.contextBlocks}\nHINT ${toolResult.answerHint}`
        : toolResult.contextBlocks;

      const flowResult = await answerWorkspaceQuestion(
        { question, contextBlocks, today, history: historyBlock },
        { correlationId, userId }
      );

      const operationalFallback = buildOperationalFallbackAnswer(
        queryPlan,
        toolResult
      );
      const data: GeneralChatAnswer = operationalFallback ?? {
        answer: flowResult.answer,
        confidence: flowResult.confidence,
        sources: flowResult.sources,
        suggestedActions: flowResult.suggestedActions,
      };

      logger.info("api.request.succeeded", {
        status: 200,
        durationMs: durationMs(),
        outcome: "workspace_tool_answered",
        confidence: data.confidence,
        toolName: queryPlan.toolName,
        rationale: queryPlan.rationale,
      });
      emitMetric(200, "success", {
        outcome: "workspace_tool_answered",
        confidence: data.confidence,
      });
      return apiSuccess({ data }, { correlationId });
    }

    const retrieval = await searchWorkspaceContext(
      db,
      {
        userId,
        workspaceId,
        memberUserIds: workspaceMemberUserIds,
      },
      question
    );

    if (retrieval.isEmpty) {
      // Deterministic no-evidence answer — never call the LLM without context.
      const data = buildNoEvidenceAnswer();
      logger.info("api.request.succeeded", {
        status: 200,
        durationMs: durationMs(),
        outcome: "no_evidence",
      });
      emitMetric(200, "success", { outcome: "no_evidence" });
      return apiSuccess({ data }, { correlationId });
    }

    const contextBlocks = renderContextBlocks(retrieval);
    const today = new Date().toISOString().slice(0, 10);

    const flowResult = await answerWorkspaceQuestion(
      { question, contextBlocks, today, history: historyBlock },
      { correlationId, userId }
    );

    const ids = collectRetrievedIds(retrieval);
    const sources = filterSources(flowResult.sources, ids);
    const suggestedActions = filterSuggestedActions(
      flowResult.suggestedActions,
      ids
    );

    let answer = flowResult.answer;
    let confidence = flowResult.confidence;
    const droppedSourceCount = flowResult.sources.length - sources.length;
    if (flowResult.sources.length > 0 && sources.length === 0) {
      // The model cited facts but none of its sources exist in the retrieved
      // context — degrade and caveat instead of presenting unverified claims.
      confidence = "low";
      answer = `${answer.trim()} ${UNVERIFIED_SOURCES_CAVEAT}`;
    }

    const data: GeneralChatAnswer = {
      answer,
      confidence,
      sources,
      suggestedActions,
    };

    logger.info("api.request.succeeded", {
      status: 200,
      durationMs: durationMs(),
      outcome: "answered",
      confidence,
      sourceCount: sources.length,
      droppedSourceCount,
      suggestedActionCount: suggestedActions.length,
      retrievedMeetingCount: retrieval.meetings.length,
      retrievedTaskCount: retrieval.tasks.length,
      retrievedPersonCount: retrieval.people.length,
    });
    emitMetric(200, "success", {
      outcome: "answered",
      confidence,
      sourceCount: sources.length,
      droppedSourceCount,
    });
    return apiSuccess({ data }, { correlationId });
  } catch (error) {
    const statusCode = getApiErrorStatus(error);
    emitMetric(statusCode, "error");
    return mapApiError(error, "Failed to answer workspace question.", {
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
