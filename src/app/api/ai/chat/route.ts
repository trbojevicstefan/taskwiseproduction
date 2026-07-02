import { z } from "zod";
import { answerWorkspaceQuestion } from "@/ai/flows/general-chat-flow";
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

const requestSchema = z.object({
  question: z.string().trim().min(1).max(2000),
});

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

    const { question } = await parseJsonBody(
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
      { question, contextBlocks, today },
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
