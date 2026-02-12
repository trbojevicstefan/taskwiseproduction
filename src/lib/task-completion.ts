import { randomUUID } from "crypto";
import type { ExtractedTaskSchema, TaskEvidence } from "@/types/chat";
import { getDb } from "@/lib/db";
import { detectCompletedTasks } from "@/ai/flows/detect-completed-tasks-flow";
import { normalizePersonNameKey } from "@/lib/transcript-utils";
import { normalizeTitleKey, isPlaceholderTitle, isValidTitle } from "@/lib/ai-utils";
import { buildIdQuery } from "@/lib/mongo-id";

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
const TASK_COMPLETION_TITLE_CAP = Math.min(
  120,
  Math.max(60, Number(process.env.TASK_COMPLETION_TITLE_CAP || 96))
);

const COMPLETION_CUE_REGEX =
  /\b(done|complete|completed|finished|resolved|fixed|shipped|delivered|launched|closed|closed out|wrapped up|wrapped|already did|already done|already handled|already taken care of|handled|taken care of|sorted|sorted out|checked off|signed off|approved|submitted|sent|filed|paid|merged|deployed|published|released|live|went live|in prod|in production|rolled out|ready|in place|all set|good to go|bought|purchased|acquired|ordered|booked|scheduled|set up|setup|implemented|configured|installed)\b/i;
const COMPLETION_NEGATION_REGEX =
  /\b(?:not|never|no|hasn't|haven't|didn't|isn't|wasn't|can't|cannot|won't)\b[^.]{0,32}\b(?:done|complete|completed|finished|resolved|fixed|handled|taken care of|bought|purchased|ready|live|shipped|delivered|launched|approved)\b/i;
const GENERIC_COMPLETION_REGEX =
  /\b(?:that|it|this|task)\b.*\b(?:done|complete|completed|finished|resolved|fixed)\b/i;

const COMPLETION_DEBUG =
  process.env.TASK_COMPLETION_DEBUG === "1" ||
  process.env.NODE_ENV !== "production";

const debugLog = (...args: unknown[]) => {
  if (!COMPLETION_DEBUG) return;
  console.info("[task-completion]", ...args);
};

const UNASSIGNED_LABELS = new Set([
  "unassigned",
  "unknown",
  "none",
  "na",
  "n a",
  "tbd",
  "un assigned",
]);

const normalizeAssigneeName = (value?: string | null) => {
  if (!value) return "";
  const normalized = normalizePersonNameKey(value);
  if (!normalized) return "";
  if (UNASSIGNED_LABELS.has(normalized)) return "";
  return normalized;
};

export const normalizeEmail = (value?: string | null) =>
  value ? value.trim().toLowerCase() : "";

const buildAssigneeKey = (
  name?: string | null,
  email?: string | null,
  allowUnassigned = false
) => {
  const normalizedEmail = normalizeEmail(email);
  if (normalizedEmail) return `email:${normalizedEmail}`;
  const normalizedName = normalizeAssigneeName(name);
  if (normalizedName) return `name:${normalizedName}`;
  return allowUnassigned ? "unassigned" : "";
};

const toCompactCandidateTitle = (value?: string | null) => {
  const title = typeof value === "string" ? value.trim() : "";
  if (!title) return "";
  if (title.length <= TASK_COMPLETION_TITLE_CAP) return title;
  return `${title.slice(0, TASK_COMPLETION_TITLE_CAP - 3).trim()}...`;
};

const matchesAttendee = (
  assigneeName?: string | null,
  assigneeEmail?: string | null,
  attendeeNames = new Set<string>(),
  attendeeEmails = new Set<string>(),
  allowUnassigned = false
) => {
  const normalizedEmail = normalizeEmail(assigneeEmail);
  if (normalizedEmail && attendeeEmails.has(normalizedEmail)) return true;
  const normalizedName = normalizeAssigneeName(assigneeName);
  if (normalizedName && attendeeNames.has(normalizedName)) return true;
  if (allowUnassigned && !normalizedEmail && !normalizedName) return true;
  return false;
};

const chunkCandidates = <T,>(items: T[], size: number): T[][] => {
  if (size <= 0) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

const splitSentences = (text: string): string[] =>
  text
    .split(/(?:[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

const parseTranscriptLine = (
  line: string
): { text: string; speaker?: string; timestamp?: string } => {
  const match = line.match(
    /^(?:(\d{1,2}:\d{2}(?::\d{2})?)\s*-\s*)?(?:(.+?):\s*)?(.+)$/
  );
  if (!match) {
    return { text: line.trim() };
  }
  return {
    timestamp: match[1],
    speaker: match[2]?.trim(),
    text: match[3]?.trim() || "",
  };
};

const isGenericCompletion = (text: string) => {
  const normalized = normalizeTitleKey(text);
  if (!normalized) return true;
  const wordCount = normalized.split(" ").filter(Boolean).length;
  return wordCount <= 6 && GENERIC_COMPLETION_REGEX.test(text);
};

const extractCompletionSnippets = (transcript: string): CompletionSnippet[] => {
  const lines = transcript
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const snippets: CompletionSnippet[] = [];
  const seen = new Set<string>();
  let lastLineText = "";

  for (const line of lines) {
    const parsed = parseTranscriptLine(line);
    if (!parsed.text) {
      lastLineText = "";
      continue;
    }
    const sentences = splitSentences(parsed.text);
    const hasCompletionCue = sentences.some(
      (sentence) =>
        COMPLETION_CUE_REGEX.test(sentence) &&
        !COMPLETION_NEGATION_REGEX.test(sentence)
    );
    if (!hasCompletionCue) {
      lastLineText = parsed.text;
      continue;
    }

    let snippetText = parsed.text;
    if (isGenericCompletion(parsed.text) && lastLineText) {
      snippetText = `${lastLineText} ${parsed.text}`.trim();
    }

    const key = normalizeTitleKey(snippetText);
    if (!key || seen.has(key)) {
      lastLineText = parsed.text;
      continue;
    }
    seen.add(key);
    snippets.push({
      text: snippetText,
      speaker: parsed.speaker,
      timestamp: parsed.timestamp,
    });
    lastLineText = parsed.text;
  }

  return snippets;
};

const dedupeCompletionSnippets = (snippets: CompletionSnippet[]) => {
  const seen = new Set<string>();
  const deduped: CompletionSnippet[] = [];
  snippets.forEach((snippet) => {
    const key = normalizeTitleKey(snippet.text);
    if (!key || seen.has(key)) return;
    seen.add(key);
    deduped.push(snippet);
  });
  return deduped;
};

const buildEmbeddingText = (title?: string | null, description?: string | null) => {
  const titleText = typeof title === "string" ? title.trim() : "";
  const descriptionText = typeof description === "string" ? description.trim() : "";
  const parts = [titleText, descriptionText].filter(Boolean);
  if (!parts.length) return "";
  const combined = parts.join(" ");
  return combined.length > 800 ? combined.slice(0, 800) : combined;
};

const toTokenSet = (text: string): Set<string> => {
  const normalized = normalizeTitleKey(text);
  if (!normalized) return new Set();
  return new Set(normalized.split(" ").filter(Boolean));
};

const jaccardSimilarity = (a: Set<string>, b: Set<string>) => {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  return intersection / (a.size + b.size - intersection);
};

const cosineSimilarity = (a: number[], b: number[]) => {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0;
  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const valueA = a[i];
    const valueB = b[i];
    dot += valueA * valueB;
    sumA += valueA * valueA;
    sumB += valueB * valueB;
  }
  if (!sumA || !sumB) return 0;
  return dot / (Math.sqrt(sumA) * Math.sqrt(sumB));
};

const embedTexts = async (texts: string[]): Promise<number[][]> => {
  if (!texts.length) return [];
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("OPENAI_API_KEY is required for embeddings.");
    return [];
  }
  const batches = chunkCandidates(texts, 40);
  const output: number[][] = [];
  for (const batch of batches) {
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
      console.error("Embedding failed:", error);
      return [];
    }
  }
  return output;
};

const candidateKeyForTask = (title: string, assigneeKey: string) => {
  const normalizedTitle = normalizeTitleKey(title);
  return `${normalizedTitle}|${assigneeKey}`;
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
    attendees.map((person) => normalizeAssigneeName(person.name)).filter(Boolean)
  );
  const attendeeEmails = new Set(
    attendees.map((person) => normalizeEmail(person.email)).filter(Boolean)
  );
  const hasAttendees =
    requireAttendeeMatch && (attendeeNames.size > 0 || attendeeEmails.size > 0);

  let allowUnassigned = !hasAttendees || !requireAttendeeMatch;
  const db = await getDb();
  const userIdQuery = buildIdQuery(userId);
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
    userId: userIdQuery,
    status: { $ne: "done" },
  };
  if (workspaceFilter) {
    taskFilters.$and = [workspaceFilter];
  }
  const tasks = await db
    .collection<any>("tasks")
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

    tasks.forEach((task) => {
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
  tasks.forEach((task) => {
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
      tasksNeedingEmbedding.map((item) => item.text)
    );
    if (embeddings.length === tasksNeedingEmbedding.length) {
      const updates = tasksNeedingEmbedding.map((item, index) => ({
        updateOne: {
          filter: {
            $or: [{ _id: buildIdQuery(item.id) }, { id: item.id }],
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
        await db.collection<any>("tasks").bulkWrite(updates, { ordered: false });
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

  candidateList.forEach((candidate) => {
    const text = buildEmbeddingText(candidate.title, candidate.description);
    candidateTokens.set(candidate.groupId, text ? toTokenSet(text) : new Set());
    const taskTarget = candidate.targets.find(
      (target) => target.sourceType === "task"
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
      candidatesNeedingEmbedding.map((item) => item.text)
    );
    if (embeddings.length === candidatesNeedingEmbedding.length) {
      candidatesNeedingEmbedding.forEach((item, index) => {
        candidateEmbeddings.set(item.id, embeddings[index]);
      });
    }
  }

  const snippetTexts = completionSnippets.map((snippet) => snippet.text);
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
      .map((candidate) => {
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
      .sort((a, b) => b.score - a.score);
    rankedBySnippet.push({ snippet, scored });

    scored.slice(0, 8).forEach((item) => {
      if (item.score >= minimumCandidateScore) {
        selectedCandidateIds.add(item.id);
      }
    });
    scored
      .filter((item) => item.score >= selectionThreshold)
      .forEach((item) => selectedCandidateIds.add(item.id));
    scored.slice(0, 4).forEach((item) => {
      if (item.score >= 0.2) {
        shortlistCandidateIds.add(item.id);
      }
    });
  });

  const filteredCandidates =
    selectedCandidateIds.size > 0
      ? candidateList.filter((candidate) =>
        selectedCandidateIds.has(candidate.groupId)
      )
      : candidateList.filter((candidate) =>
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
    limitedCandidates.map((candidate) => candidate.groupId)
  );
  const candidateById = new Map(
    limitedCandidates.map((candidate) => [candidate.groupId, candidate])
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
    const scopedScores = scored.filter((item) =>
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
      .filter((item) => item.score >= llmCandidateScoreFloor)
      .slice(0, llmCandidateCountPerSnippet)
      .map((item) => candidateById.get(item.id))
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
    .sort((a, b) => b.topScore - a.topScore)
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
      candidates: review.candidates.map((candidate) => ({
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
    completedItems.forEach((item) => {
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
    limitedCandidates.map((candidate) => [candidate.groupId, candidate])
  );

  const normalizeGroupId = (value: string) =>
    value.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
  const candidateAliasMap = new Map(
    limitedCandidates.map((candidate) => [
      normalizeGroupId(candidate.groupId),
      candidate,
    ])
  );

  const matchedCandidates = new Set<string>();
  const results: ExtractedTaskSchema[] = [];
  const unmatched: Array<{
    item: { groupId: string; confidence?: number; evidence: TaskEvidence };
  }> = [];

  Array.from(completedById.values()).forEach((item) => {
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
      .map((entry) => entry.item.evidence?.snippet || "")
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

export const mergeCompletionSuggestions = (
  tasks: ExtractedTaskSchema[],
  suggestions: ExtractedTaskSchema[]
): ExtractedTaskSchema[] => {
  if (!suggestions.length) return tasks;

  const matchKey = (task: ExtractedTaskSchema) => {
    const assigneeName = task.assignee?.name || task.assigneeName || "";
    const assigneeEmail = task.assignee?.email || "";
    const assigneeKey = buildAssigneeKey(assigneeName, assigneeEmail, true);
    return `${normalizeTitleKey(task.title)}|${assigneeKey}`;
  };

  const suggestionByKey = new Map<string, ExtractedTaskSchema>();
  suggestions.forEach((suggestion) => {
    const key = matchKey(suggestion);
    if (!key) return;
    suggestionByKey.set(key, suggestion);
  });

  const applySuggestions = (items: ExtractedTaskSchema[]): ExtractedTaskSchema[] =>
    items.map((task) => {
      const key = matchKey(task);
      const suggestion = suggestionByKey.get(key);
      if (suggestion) {
        suggestionByKey.delete(key);
        return {
          ...task,
          status: task.status || "todo",
          completionSuggested: true,
          completionConfidence: suggestion.completionConfidence ?? null,
          completionEvidence: suggestion.completionEvidence ?? null,
          completionTargets: suggestion.completionTargets ?? null,
        };
      }
      if (task.subtasks?.length) {
        return { ...task, subtasks: applySuggestions(task.subtasks) };
      }
      return task;
    });

  const updated = applySuggestions(tasks);
  const remaining = Array.from(suggestionByKey.values()).map((suggestion) => ({
    ...suggestion,
    status: suggestion.status && suggestion.status !== "done" ? suggestion.status : "todo",
    completionSuggested: true,
  }));
  return remaining.length ? [...updated, ...remaining] : updated;
};

export const applyCompletionTargets = async (
  db: Awaited<ReturnType<typeof getDb>>,
  userId: string,
  suggestions: ExtractedTaskSchema[]
) => {
  const userIdQuery = buildIdQuery(userId);

  for (const suggestion of suggestions) {
    if (!suggestion.completionTargets?.length) continue;

    const evidence = suggestion.completionEvidence || undefined;
    const targets = suggestion.completionTargets;

    // 1. Update tasks targeted by ID (sourceType: 'task')
    const directTaskTargets = targets.filter(t => t.sourceType === "task");
    if (directTaskTargets.length) {
      const taskIds = directTaskTargets.map(t => t.taskId);
      await db.collection("tasks").updateMany(
        {
          userId: userIdQuery,
          $or: [{ _id: { $in: taskIds.map(id => buildIdQuery(id)) } }, { id: { $in: taskIds } }],
        },
        {
          $set: {
            status: "done",
            completionEvidence: evidence, // Save evidence!
            lastUpdated: new Date()
          }
        }
      );
    }

    // 2. Update tasks targeted by Session/Source ID
    const sessionTargets = targets.filter(t => t.sourceType !== "task");
    for (const target of sessionTargets) {
      const sessionIdQuery = buildIdQuery(target.sourceSessionId);
      const taskIdQuery = buildIdQuery(target.taskId);

      await db.collection("tasks").updateMany(
        {
          userId: userIdQuery,
          sourceSessionType: target.sourceType,
          $and: [
            {
              $or: [
                { sourceSessionId: sessionIdQuery },
                { sourceSessionId: target.sourceSessionId },
              ],
            },
            {
              $or: [
                { _id: taskIdQuery },
                { sourceTaskId: target.taskId },
                { sourceTaskId: taskIdQuery },
              ],
            },
          ],
        },
        {
          $set: {
            status: "done",
            completionEvidence: evidence, // Save evidence!
            completionSuggested: false,
            lastUpdated: new Date()
          }
        }
      );
    }
  }
};

export const filterTasksForSessionSync = (
  tasks: ExtractedTaskSchema[],
  sessionType: "meeting" | "chat",
  sessionId: string
) => {
  if (!tasks.length) return tasks;
  const sessionKey = String(sessionId);
  const shouldInclude = (task: ExtractedTaskSchema) => {
    if (!task.completionSuggested) return true;
    const targets = task.completionTargets || [];
    if (!targets.length) return true;
    return targets.some(
      (target) =>
        target.sourceType === sessionType &&
        String(target.sourceSessionId) === sessionKey
    );
  };

  const walk = (items: ExtractedTaskSchema[]): ExtractedTaskSchema[] =>
    items.reduce<ExtractedTaskSchema[]>((acc, task) => {
      if (!shouldInclude(task)) return acc;
      if (task.subtasks?.length) {
        acc.push({ ...task, subtasks: walk(task.subtasks) });
      } else {
        acc.push(task);
      }
      return acc;
    }, []);

  return walk(tasks);
};
