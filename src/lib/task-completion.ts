import { randomUUID } from "crypto";
import type { ExtractedTaskSchema, TaskEvidence } from "@/types/chat";
import { getDb } from "@/lib/db";
import { detectCompletedTasks } from "@/ai/flows/detect-completed-tasks-flow";
import { isPlaceholderTitle, isValidTitle } from "@/lib/ai-utils";
import { recordExternalApiFailure } from "@/lib/observability-metrics";
import {
  buildAssigneeKey,
  buildEmbeddingText,
  candidateKeyForTask,
  chunkCandidates,
  cosineSimilarity,
  dedupeCompletionSnippets,
  extractCompletionSnippets,
  jaccardSimilarity,
  matchesAttendee,
  normalizeEmail,
  normalizeAssigneeName,
  toCompactCandidateTitle,
  toTokenSet,
} from "@/lib/task-completion-helpers";
export {
  applyCompletionTargets,
  filterTasksForSessionSync,
  mergeCompletionSuggestions,
} from "@/lib/task-completion-sync";

export { normalizeEmail } from "@/lib/task-completion-helpers";

export type CompletionTarget = {
  sourceType: "task" | "meeting" | "chat";
  sourceSessionId: string;
  taskId: string;
  sourceSessionName?: string | null;
};

export type CompletionDebugInfo = {
  candidateCounts: {
    taskCount: number;
    meetingCount: number;
    chatCount: number;
    stats: {
      tasks: { total: number; added: number };
      meetings: { total: number; added: number };
      chats: { total: number; added: number };
    };
    candidateCount: number;
  };
  snippets: {
    count: number;
    transcriptLength: number;
    completionTranscriptLength: number;
  };
  embeddings: {
    model: string;
    tasksCached: number;
    tasksEmbedded: number;
    candidatesEmbedded: number;
    snippetsEmbedded: number;
    embeddingsReady: boolean;
  };
  selection: {
    selectionThreshold: number;
    minimumCandidateScore: number;
    selectedCandidates: number;
    filteredCandidates: number;
  };
  completions: {
    chunks: number;
    completed: number;
    mapped: number;
    unmatched: number;
    fallbackMatches: number;
  };
};

type CompletionCandidate = {
  groupId: string;
  key: string;
  title: string;
  description?: string | null;
  assigneeName?: string | null;
  assigneeEmail?: string | null;
  dueAt?: string | Date | null;
  priority?: string | null;
  targets: CompletionTarget[];
};

type CompletionSnippet = {
  text: string;
  speaker?: string;
  timestamp?: string;
};

const EMBEDDING_MODEL =
  process.env.OPENAI_EMBEDDINGS_MODEL || "text-embedding-3-small";
const OPENAI_EMBEDDINGS_URL =
  process.env.OPENAI_EMBEDDINGS_URL || "https://api.openai.com/v1/embeddings";
const TASK_COMPLETION_LLM_SNIPPET_CAP = Math.min(
  12,
  Math.max(
    4,
    Number(process.env.TASK_COMPLETION_LLM_SNIPPET_CAP || 4)
  )
);
const TASK_COMPLETION_DIRECT_MATCH_MARGIN = Math.max(
  0.08,
  Number(process.env.TASK_COMPLETION_DIRECT_MATCH_MARGIN || 0.1)
);

const COMPLETION_DEBUG =
  process.env.TASK_COMPLETION_DEBUG === "1" ||
  process.env.NODE_ENV !== "production";

const debugLog = (...args: unknown[]) => {
  if (!COMPLETION_DEBUG) return;
  console.info("[task-completion]", ...args);
};

const embedTexts = async (texts: string[]): Promise<number[][]> => {
  if (!texts.length) return [];
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    void recordExternalApiFailure({
      provider: "openai",
      operation: "embeddings.create",
      error: "OPENAI_API_KEY is required for embeddings.",
      metadata: {
        model: EMBEDDING_MODEL,
        inputs: texts.length,
      },
    });
    console.error("OPENAI_API_KEY is required for embeddings.");
    return [];
  }
  const batches = chunkCandidates(texts, 40);
  const output: number[][] = [];
  for (const batch of batches) {
    const requestStartedAtMs = Date.now();
    try {
      const response = await fetch(OPENAI_EMBEDDINGS_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input: batch,
        }),
      });
      if (!response.ok) {
        const payload = await response.text();
        void recordExternalApiFailure({
          provider: "openai",
          operation: "embeddings.create",
          statusCode: response.status,
          durationMs: Date.now() - requestStartedAtMs,
          error: payload || response.statusText,
          metadata: {
            model: EMBEDDING_MODEL,
            batchSize: batch.length,
          },
        });
        console.error(
          `OpenAI embeddings failed: ${response.status} ${payload}`
        );
        return [];
      }
      const payload = await response.json();
      const data = Array.isArray(payload.data) ? payload.data : [];
      const usageTokens =
        typeof payload?.usage?.total_tokens === "number"
          ? payload.usage.total_tokens
          : null;
      if (usageTokens !== null) {
        debugLog("embedding batch usage", {
          model: EMBEDDING_MODEL,
          inputs: batch.length,
          usageTokens,
        });
      }
      output.push(...data.map((item: any) => item.embedding || []));
    } catch (error) {
      void recordExternalApiFailure({
        provider: "openai",
        operation: "embeddings.create",
        durationMs: Date.now() - requestStartedAtMs,
        error,
        metadata: {
          model: EMBEDDING_MODEL,
          batchSize: batch.length,
        },
      });
      console.error("Embedding failed:", error);
      return [];
    }
  }
  return output;
};

const upsertCandidate = (
  candidates: Map<string, CompletionCandidate>,
  payload: {
    title: string;
    description?: string | null;
    assigneeName?: string | null;
    assigneeEmail?: string | null;
    dueAt?: string | Date | null;
    priority?: string | null;
    sourceRank: number;
  },
  target: CompletionTarget,
  allowUnassigned: boolean
) => {
  if (!payload.title || !isValidTitle(payload.title) || isPlaceholderTitle(payload.title)) {
    return;
  }

  const assigneeKey = buildAssigneeKey(
    payload.assigneeName,
    payload.assigneeEmail,
    allowUnassigned
  );
  if (!assigneeKey) return;

  const key = candidateKeyForTask(payload.title, assigneeKey);
  if (!key) return;

  const existing = candidates.get(key);
  if (!existing) {
    candidates.set(key, {
      groupId: `cand_${candidates.size + 1}`,
      key,
      title: payload.title,
      description: payload.description,
      assigneeName: payload.assigneeName,
      assigneeEmail: payload.assigneeEmail,
      dueAt: payload.dueAt ?? null,
      priority: payload.priority ?? null,
      targets: [target],
    });
    return;
  }

  const targetKey = `${target.sourceType}:${target.sourceSessionId}:${target.taskId}`;
  const existingTargets = new Set(
    existing.targets.map(
      (item) => `${item.sourceType}:${item.sourceSessionId}:${item.taskId}`
    )
  );
  if (!existingTargets.has(targetKey)) {
    existing.targets.push(target);
  }

  const shouldReplace =
    !existing.description ||
    (payload.description && payload.description.length > existing.description.length) ||
    payload.sourceRank < 1;

  if (shouldReplace) {
    existing.description = payload.description ?? existing.description;
    existing.dueAt = payload.dueAt ?? existing.dueAt;
    existing.priority = payload.priority ?? existing.priority;
  }
};

export const buildCompletionSuggestions = async ({
  userId,
  transcript,
  summary,
  attendees,
  excludeMeetingId,
  requireAttendeeMatch = false,
  minMatchRatio = 0.6,
  workspaceId,
  debug,
}: {
  userId: string;
  transcript: string;
  summary?: string | null;
  attendees: Array<{ name: string; email?: string | null }>;
  excludeMeetingId?: string;
  requireAttendeeMatch?: boolean;
  minMatchRatio?: number;
  workspaceId?: string | null;
  debug?: (info: CompletionDebugInfo) => void;
}): Promise<ExtractedTaskSchema[]> => {
  const fullTranscript = typeof transcript === "string" ? transcript.trim() : "";
  if (!userId || !fullTranscript) return [];
  void excludeMeetingId;

  const attendeeNames = new Set(
    attendees.map((person: any) => normalizeAssigneeName(person.name)).filter(Boolean)
  );
  const attendeeEmails = new Set(
    attendees.map((person: any) => normalizeEmail(person.email)).filter(Boolean)
  );
  const hasAttendees =
    requireAttendeeMatch && (attendeeNames.size > 0 || attendeeEmails.size > 0);

  let allowUnassigned = !hasAttendees || !requireAttendeeMatch;
  const db = await getDb();
  const shouldIncludeAssignee = (
    assigneeName?: string | null,
    assigneeEmail?: string | null,
    allowUnassignedMatch = true,
    requireAttendeeMatch = false
  ) => {
    if (!hasAttendees || !requireAttendeeMatch) return true;
    return matchesAttendee(
      assigneeName,
      assigneeEmail,
      attendeeNames,
      attendeeEmails,
      allowUnassignedMatch
    );
  };

  const workspaceFilter =
    workspaceId && workspaceId.trim()
      ? {
        $or: [
          { workspaceId },
          { workspaceId: null },
          { workspaceId: { $exists: false } },
        ],
      }
      : null;

  const taskFilters: Record<string, any> = {
    userId,
    status: { $ne: "done" },
  };
  if (workspaceFilter) {
    taskFilters.$and = [workspaceFilter];
  }
  const tasks = await db
    .collection("tasks")
    .find(taskFilters)
    .toArray();


  const debugInfo: CompletionDebugInfo = {
    candidateCounts: {
      taskCount: 0,
      meetingCount: 0,
      chatCount: 0,
      stats: {
        tasks: { total: 0, added: 0 },
        meetings: { total: 0, added: 0 },
        chats: { total: 0, added: 0 },
      },
      candidateCount: 0,
    },
    snippets: {
      count: 0,
      transcriptLength: fullTranscript.length,
      completionTranscriptLength: fullTranscript.length,
    },
    embeddings: {
      model: EMBEDDING_MODEL,
      tasksCached: 0,
      tasksEmbedded: 0,
      candidatesEmbedded: 0,
      snippetsEmbedded: 0,
      embeddingsReady: false,
    },
    selection: {
      selectionThreshold: 0,
      minimumCandidateScore: 0,
      selectedCandidates: 0,
      filteredCandidates: 0,
    },
    completions: {
      chunks: 0,
      completed: 0,
      mapped: 0,
      unmatched: 0,
      fallbackMatches: 0,
    },
  };

  const buildCandidates = (
    allowUnassignedMatch: boolean,
    requireAttendeeMatch = false
  ) => {
    const candidates = new Map<string, CompletionCandidate>();
    const stats = {
      tasks: { total: 0, added: 0 },
      meetings: { total: 0, added: 0 },
      chats: { total: 0, added: 0 },
    };

    tasks.forEach((task: any) => {
      stats.tasks.total += 1;
      const assigneeName = task.assignee?.name || task.assigneeName || null;
      const assigneeEmail = task.assignee?.email || task.assigneeEmail || null;
      if (
        !shouldIncludeAssignee(
          assigneeName,
          assigneeEmail,
          allowUnassignedMatch,
          requireAttendeeMatch
        )
      ) {
        return;
      }
      const beforeSize = candidates.size;
      upsertCandidate(
        candidates,
        {
          title: task.title,
          description: task.description,
          assigneeName,
          assigneeEmail,
          dueAt: task.dueAt ?? null,
          priority: task.priority ?? null,
          sourceRank: 0,
        },
        {
          sourceType: "task",
          sourceSessionId: task._id?.toString?.() || task.id,
          taskId: task._id?.toString?.() || task.id,
          sourceSessionName: null,
        },
        allowUnassignedMatch
      );
      if (candidates.size > beforeSize) {
        stats.tasks.added += 1;
      }
    });

    debugLog("candidate build", {
      taskCount: tasks.length,
      meetingCount: 0,
      chatCount: 0,
      stats,
      candidateCount: candidates.size,
    });
    debugInfo.candidateCounts = {
      taskCount: tasks.length,
      meetingCount: 0,
      chatCount: 0,
      stats,
      candidateCount: candidates.size,
    };

    return candidates;
  };

  let candidates = buildCandidates(allowUnassigned, requireAttendeeMatch);
  if (!candidates.size && hasAttendees) {
    allowUnassigned = true;
    candidates = buildCandidates(true, false);
  }

  const allCandidates = Array.from(candidates.values());
  const candidateList = allCandidates;
  if (!candidateList.length) {
    return [];
  }

  const summaryText = typeof summary === "string" ? summary.trim() : "";
  const transcriptCompletionSnippets = extractCompletionSnippets(fullTranscript);
  const summaryCompletionSnippets = summaryText
    ? extractCompletionSnippets(summaryText)
    : [];
  const completionSnippets = dedupeCompletionSnippets([
    ...transcriptCompletionSnippets,
    ...summaryCompletionSnippets,
  ]);
  debugLog("completion snippets", {
    snippetCount: completionSnippets.length,
    transcriptLength: fullTranscript.length,
    transcriptSnippetCount: transcriptCompletionSnippets.length,
    summarySnippetCount: summaryCompletionSnippets.length,
  });
  debugInfo.snippets.count = completionSnippets.length;
  debugInfo.snippets.completionTranscriptLength = fullTranscript.length;
  if (!completionSnippets.length) {
    debugInfo.selection.selectionThreshold = Math.min(0.95, Math.max(0.4, minMatchRatio));
    debugInfo.selection.minimumCandidateScore = Math.max(
      0.45,
      debugInfo.selection.selectionThreshold - 0.15
    );
    if (debug) {
      debug(debugInfo);
    }
    return [];
  }

  const taskEmbeddingById = new Map<string, number[]>();
  const tasksNeedingEmbedding: Array<{ id: string; text: string }> = [];
  tasks.forEach((task: any) => {
    const rawId = task._id?.toString?.() || task._id || task.id;
    const taskId = rawId ? String(rawId) : "";
    if (!taskId || !task.title) return;
    if (
      Array.isArray(task.embedding) &&
      task.embedding.length &&
      task.embeddingModel === EMBEDDING_MODEL
    ) {
      taskEmbeddingById.set(taskId, task.embedding as number[]);
      return;
    }
    const text = buildEmbeddingText(task.title, task.description);
    if (!text) return;
    tasksNeedingEmbedding.push({ id: taskId, text });
  });

  if (tasksNeedingEmbedding.length) {
    const embeddings = await embedTexts(
      tasksNeedingEmbedding.map((item: any) => item.text)
    );
    if (embeddings.length === tasksNeedingEmbedding.length) {
      const updates = tasksNeedingEmbedding.map((item, index) => ({
        updateOne: {
          filter: {
            $or: [{ _id: item.id }, { id: item.id }],
          },
          update: {
            $set: {
              embedding: embeddings[index],
              embeddingModel: EMBEDDING_MODEL,
              embeddingUpdatedAt: new Date(),
            },
          },
        },
      }));
      if (updates.length) {
        await db.collection("tasks").bulkWrite(updates, { ordered: false });
      }
      tasksNeedingEmbedding.forEach((item, index) => {
        taskEmbeddingById.set(item.id, embeddings[index]);
      });
    }
  }
  debugLog("task embeddings", {
    embedder: EMBEDDING_MODEL,
    cached: taskEmbeddingById.size,
    newlyEmbedded: tasksNeedingEmbedding.length,
  });
  debugInfo.embeddings.tasksCached = taskEmbeddingById.size;
  debugInfo.embeddings.tasksEmbedded = tasksNeedingEmbedding.length;

  const candidateEmbeddings = new Map<string, number[]>();
  const candidateTokens = new Map<string, Set<string>>();
  const candidatesNeedingEmbedding: Array<{ id: string; text: string }> = [];

  candidateList.forEach((candidate: any) => {
    const text = buildEmbeddingText(candidate.title, candidate.description);
    candidateTokens.set(candidate.groupId, text ? toTokenSet(text) : new Set());
    const taskTarget = candidate.targets.find(
      (target: any) => target.sourceType === "task"
    );
    if (taskTarget?.taskId) {
      const taskEmbedding = taskEmbeddingById.get(String(taskTarget.taskId));
      if (taskEmbedding) {
        candidateEmbeddings.set(candidate.groupId, taskEmbedding);
        return;
      }
    }
    if (text) {
      candidatesNeedingEmbedding.push({ id: candidate.groupId, text });
    }
  });

  if (candidatesNeedingEmbedding.length) {
    const embeddings = await embedTexts(
      candidatesNeedingEmbedding.map((item: any) => item.text)
    );
    if (embeddings.length === candidatesNeedingEmbedding.length) {
      candidatesNeedingEmbedding.forEach((item, index) => {
        candidateEmbeddings.set(item.id, embeddings[index]);
      });
    }
  }

  const snippetTexts = completionSnippets.map((snippet: any) => snippet.text);
  const snippetEmbeddings = completionSnippets.length
    ? await embedTexts(snippetTexts)
    : [];
  const embeddingsReady =
    completionSnippets.length > 0 &&
    snippetEmbeddings.length === completionSnippets.length &&
    candidateEmbeddings.size > 0;
  debugLog("snippet embeddings", {
    snippetCount: completionSnippets.length,
    embedded: snippetEmbeddings.length,
    candidatesWithEmbeddings: candidateEmbeddings.size,
    embeddingsReady,
  });
  debugInfo.embeddings.candidatesEmbedded = candidatesNeedingEmbedding.length;
  debugInfo.embeddings.snippetsEmbedded = snippetEmbeddings.length;
  debugInfo.embeddings.embeddingsReady = embeddingsReady;

  type RankedCandidateScore = {
    id: string;
    score: number;
    tokenScore: number;
    embeddingScore: number;
  };
  const rankedBySnippet: Array<{
    snippet: CompletionSnippet;
    scored: RankedCandidateScore[];
  }> = [];

  const selectedCandidateIds = new Set<string>();
  const shortlistCandidateIds = new Set<string>();
  const selectionThreshold = Math.min(0.95, Math.max(0.4, minMatchRatio));
  const minimumCandidateScore = Math.max(0.45, selectionThreshold - 0.15);
  debugInfo.selection.selectionThreshold = selectionThreshold;
  debugInfo.selection.minimumCandidateScore = minimumCandidateScore;

  completionSnippets.forEach((snippet, index) => {
    const snippetTokens = toTokenSet(snippet.text);
    const scored = candidateList
      .map((candidate: any) => {
        const tokenScore = jaccardSimilarity(
          snippetTokens,
          candidateTokens.get(candidate.groupId) || new Set()
        );
        const candidateEmbedding = candidateEmbeddings.get(candidate.groupId);
        const snippetEmbedding = embeddingsReady ? snippetEmbeddings[index] : null;
        const embeddingScore =
          snippetEmbedding && candidateEmbedding
            ? cosineSimilarity(snippetEmbedding, candidateEmbedding)
            : 0;
        const combinedScore = embeddingScore
          ? embeddingScore * 0.75 + tokenScore * 0.25
          : tokenScore;
        return {
          id: candidate.groupId,
          score: combinedScore,
          tokenScore,
          embeddingScore,
        };
      })
      .sort((a: any, b: any) => b.score - a.score);
    rankedBySnippet.push({ snippet, scored });

    scored.slice(0, 8).forEach((item: any) => {
      if (item.score >= minimumCandidateScore) {
        selectedCandidateIds.add(item.id);
      }
    });
    scored
      .filter((item: any) => item.score >= selectionThreshold)
      .forEach((item: any) => selectedCandidateIds.add(item.id));
    scored.slice(0, 4).forEach((item: any) => {
      if (item.score >= 0.2) {
        shortlistCandidateIds.add(item.id);
      }
    });
  });

  const filteredCandidates =
    selectedCandidateIds.size > 0
      ? candidateList.filter((candidate: any) =>
        selectedCandidateIds.has(candidate.groupId)
      )
      : candidateList.filter((candidate: any) =>
        shortlistCandidateIds.has(candidate.groupId)
      );

  debugLog("candidate selection", {
    selectionThreshold,
    minimumCandidateScore,
    selectedCandidates: selectedCandidateIds.size,
    filteredCandidates: filteredCandidates.length,
  });
  debugInfo.selection.selectedCandidates = selectedCandidateIds.size;
  debugInfo.selection.filteredCandidates = filteredCandidates.length;
  if (!filteredCandidates.length) {
    if (debug) {
      debug(debugInfo);
    }
    return [];
  }

  const limitedCandidates = filteredCandidates;
  const limitedCandidateIds = new Set(
    limitedCandidates.map((candidate: any) => candidate.groupId)
  );
  const candidateById = new Map(
    limitedCandidates.map((candidate: any) => [candidate.groupId, candidate])
  );
  const llmCandidateCountPerSnippet = 4;
  const llmSnippetCap = TASK_COMPLETION_LLM_SNIPPET_CAP;
  const llmCandidateScoreFloor = Math.max(0.32, minimumCandidateScore - 0.1);
  const directMatchThreshold = Math.max(
    minimumCandidateScore + 0.2,
    selectionThreshold + 0.1
  );
  const directMatchMargin = TASK_COMPLETION_DIRECT_MATCH_MARGIN;
  const completedById = new Map<
    string,
    { groupId: string; confidence?: number; evidence: TaskEvidence }
  >();
  const snippetReviewQueue: Array<{
    snippet: CompletionSnippet;
    topScore: number;
    candidates: CompletionCandidate[];
  }> = [];
  const mergeCompletion = (payload: {
    groupId: string;
    confidence?: number | null;
    evidence: TaskEvidence;
  }) => {
    const existing = completedById.get(payload.groupId);
    const existingConfidence = existing?.confidence ?? 0;
    const nextConfidence =
      typeof payload.confidence === "number" && Number.isFinite(payload.confidence)
        ? Math.max(0, Math.min(1, payload.confidence))
        : 0.6;
    if (!existing || nextConfidence >= existingConfidence) {
      completedById.set(payload.groupId, {
        groupId: payload.groupId,
        confidence: nextConfidence,
        evidence: payload.evidence,
      });
    }
  };

  let directMatches = 0;
  rankedBySnippet.forEach(({ snippet, scored }) => {
    const scopedScores = scored.filter((item: any) =>
      limitedCandidateIds.has(item.id)
    );
    if (!scopedScores.length) return;
    const top = scopedScores[0];
    const runnerUp = scopedScores[1];
    const topCandidate = candidateById.get(top.id);
    if (!topCandidate) return;

    const margin = runnerUp ? top.score - runnerUp.score : top.score;
    const evidence: TaskEvidence = {
      snippet: snippet.text,
      speaker: snippet.speaker || undefined,
      timestamp: snippet.timestamp || undefined,
    };

    if (top.score >= directMatchThreshold && margin >= directMatchMargin) {
      directMatches += 1;
      mergeCompletion({
        groupId: topCandidate.groupId,
        confidence: top.score,
        evidence,
      });
      return;
    }

    const llmCandidates = scopedScores
      .filter((item: any) => item.score >= llmCandidateScoreFloor)
      .slice(0, llmCandidateCountPerSnippet)
      .map((item: any) => candidateById.get(item.id))
      .filter((candidate): candidate is CompletionCandidate => Boolean(candidate));
    if (!llmCandidates.length) {
      if (top.score >= minimumCandidateScore && margin >= directMatchMargin + 0.05) {
        directMatches += 1;
        mergeCompletion({
          groupId: topCandidate.groupId,
          confidence: top.score,
          evidence,
        });
      }
      return;
    }
    snippetReviewQueue.push({
      snippet,
      topScore: top.score,
      candidates: llmCandidates,
    });
  });

  let llmReviewCalls = 0;
  let llmMatches = 0;
  const snippetsForModel = snippetReviewQueue
    .sort((a: any, b: any) => b.topScore - a.topScore)
    .slice(0, llmSnippetCap);
  for (const review of snippetsForModel) {
    const prefix = [review.snippet.timestamp, review.snippet.speaker]
      .filter(Boolean)
      .join(" - ");
    const snippetTranscript = prefix
      ? `${prefix}: ${review.snippet.text}`
      : review.snippet.text;
    const completionResponse = await detectCompletedTasks({
      transcript: snippetTranscript,
      candidates: review.candidates.map((candidate: any) => ({
        groupId: candidate.groupId,
        title: toCompactCandidateTitle(candidate.title),
        assigneeKey: buildAssigneeKey(
          candidate.assigneeName,
          candidate.assigneeEmail,
          true
        ),
      })),
    });
    llmReviewCalls += 1;
    const completedItems = completionResponse.completed || [];
    if (!completedItems.length) {
      if (review.candidates.length === 1 && review.topScore >= minimumCandidateScore + 0.05) {
        mergeCompletion({
          groupId: review.candidates[0].groupId,
          confidence: review.topScore,
          evidence: {
            snippet: review.snippet.text,
            speaker: review.snippet.speaker || undefined,
            timestamp: review.snippet.timestamp || undefined,
          },
        });
        llmMatches += 1;
      }
      continue;
    }
    completedItems.forEach((item: any) => {
      mergeCompletion({
        groupId: item.groupId,
        confidence: item.confidence ?? review.topScore,
        evidence: {
          snippet: item.evidence.snippet,
          speaker: item.evidence.speaker || undefined,
          timestamp: item.evidence.timestamp || undefined,
        },
      });
      llmMatches += 1;
    });
  }

  debugLog("completion results", {
    chunks: llmReviewCalls,
    completed: completedById.size,
    directMatches,
    llmMatches,
    reviewQueue: snippetReviewQueue.length,
    reviewedSnippets: snippetsForModel.length,
  });
  debugInfo.completions.chunks = llmReviewCalls;
  debugInfo.completions.completed = completedById.size;
  if (debug) {
    debug(debugInfo);
  }

  const candidateMap = new Map(
    limitedCandidates.map((candidate: any) => [candidate.groupId, candidate])
  );

  const normalizeGroupId = (value: string) =>
    value.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
  const candidateAliasMap = new Map(
    limitedCandidates.map((candidate: any) => [
      normalizeGroupId(candidate.groupId),
      candidate,
    ])
  );

  const matchedCandidates = new Set<string>();
  const results: ExtractedTaskSchema[] = [];
  const unmatched: Array<{
    item: { groupId: string; confidence?: number; evidence: TaskEvidence };
  }> = [];

  Array.from(completedById.values()).forEach((item: any) => {
    const rawGroupId = String(item.groupId || "");
    const normalizedGroupId = normalizeGroupId(rawGroupId);
    const candidate =
      candidateMap.get(rawGroupId) || candidateAliasMap.get(normalizedGroupId);
    if (!candidate) {
      unmatched.push({ item });
      return;
    }
    if (matchedCandidates.has(candidate.groupId)) return;
    matchedCandidates.add(candidate.groupId);
    const evidence: TaskEvidence[] = [
      {
        snippet: item.evidence.snippet,
        speaker: item.evidence.speaker,
        timestamp: item.evidence.timestamp,
      },
    ];
    results.push({
      id: randomUUID(),
      title: candidate.title,
      description: candidate.description || null,
      priority: (candidate.priority as ExtractedTaskSchema["priority"]) || "medium",
      dueAt: candidate.dueAt ?? null,
      status: "todo",
      assigneeName: candidate.assigneeName ?? null,
      completionSuggested: true,
      completionConfidence: item.confidence ?? null,
      completionEvidence: evidence,
      completionTargets: candidate.targets,
    } as ExtractedTaskSchema);
  });

  const resolveFallbackCandidates = async () => {
    if (!unmatched.length || matchedCandidates.size >= limitedCandidates.length) return;
    const evidenceTexts = unmatched
      .map((entry: any) => entry.item.evidence?.snippet || "")
      .filter(Boolean);
    if (!evidenceTexts.length) return;
    const evidenceEmbeddings =
      embeddingsReady && evidenceTexts.length
        ? await embedTexts(evidenceTexts)
        : [];
    let evidenceIndex = 0;

    for (const entry of unmatched) {
      const evidenceText = entry.item.evidence?.snippet || "";
      if (!evidenceText) continue;
      const evidenceTokens = toTokenSet(evidenceText);
      const evidenceEmbedding =
        evidenceEmbeddings.length === evidenceTexts.length
          ? evidenceEmbeddings[evidenceIndex]
          : null;
      evidenceIndex += 1;

      let bestCandidate: CompletionCandidate | null = null;
      let bestScore = 0;
      for (const candidate of limitedCandidates) {
        if (matchedCandidates.has(candidate.groupId)) continue;
        const tokenScore = jaccardSimilarity(
          evidenceTokens,
          candidateTokens.get(candidate.groupId) || new Set()
        );
        const candidateEmbedding = candidateEmbeddings.get(candidate.groupId);
        const embeddingScore =
          evidenceEmbedding && candidateEmbedding
            ? cosineSimilarity(evidenceEmbedding, candidateEmbedding)
            : 0;
        const combinedScore = embeddingScore
          ? embeddingScore * 0.75 + tokenScore * 0.25
          : tokenScore;
        if (combinedScore > bestScore) {
          bestScore = combinedScore;
          bestCandidate = candidate;
        }
      }

      if (!bestCandidate) continue;
      if (bestScore < minimumCandidateScore) continue;
      matchedCandidates.add(bestCandidate.groupId);
      debugInfo.completions.fallbackMatches += 1;
      const evidence: TaskEvidence[] = [
        {
          snippet: entry.item.evidence.snippet,
          speaker: entry.item.evidence.speaker,
          timestamp: entry.item.evidence.timestamp,
        },
      ];
      results.push({
        id: randomUUID(),
        title: bestCandidate.title,
        description: bestCandidate.description || null,
        priority: (bestCandidate.priority as ExtractedTaskSchema["priority"]) || "medium",
        dueAt: bestCandidate.dueAt ?? null,
        status: "todo",
        assigneeName: bestCandidate.assigneeName ?? null,
        completionSuggested: true,
        completionConfidence: entry.item.confidence ?? null,
        completionEvidence: evidence,
        completionTargets: bestCandidate.targets,
      } as ExtractedTaskSchema);
    }
  };

  debugInfo.completions.unmatched = unmatched.length;
  if (unmatched.length) {
    await resolveFallbackCandidates();
  }

  debugInfo.completions.mapped = results.length;

  return results;
};

