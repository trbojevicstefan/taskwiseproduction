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

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "to",
  "for",
  "of",
  "on",
  "in",
  "by",
  "with",
  "from",
  "that",
  "this",
  "it",
  "its",
  "our",
  "your",
  "their",
  "my",
]);

const OPEN_ITEMS_TRIGGER = /task\s*-?\s*wise\s+open\s+items?|open\s+items|running\s+items/i;

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

const normalizeEmail = (value?: string | null) =>
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

const flattenExtractedTasks = (
  tasks: ExtractedTaskSchema[] = []
): ExtractedTaskSchema[] => {
  const result: ExtractedTaskSchema[] = [];
  const walk = (items: ExtractedTaskSchema[]) => {
    items.forEach((task) => {
      result.push(task);
      if (task.subtasks && task.subtasks.length) {
        walk(task.subtasks);
      }
    });
  };
  walk(tasks);
  return result;
};

const taskIsOpen = (task: ExtractedTaskSchema | null | undefined) => {
  const status = task?.status || "todo";
  return status !== "done";
};

const candidateKeyForTask = (title: string, assigneeKey: string) => {
  const normalizedTitle = normalizeTitleKey(title);
  return `${normalizedTitle}|${assigneeKey}`;
};

const toTokens = (value: string) =>
  normalizeTitleKey(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));

const extractCandidateTokens = (candidate: CompletionCandidate) => {
  const titleTokens = toTokens(candidate.title || "");
  if (titleTokens.length >= 3) return titleTokens;
  const base = `${candidate.title || ""} ${candidate.description || ""}`;
  return toTokens(base);
};

const buildTranscriptTokenSet = (transcript: string) =>
  new Set(toTokens(transcript));

const matchRatio = (tokens: string[], transcriptTokens: Set<string>) => {
  if (!tokens.length) return 0;
  const matched = tokens.filter((token) => transcriptTokens.has(token)).length;
  return matched / tokens.length;
};

const filterCandidatesByTranscript = (
  candidates: CompletionCandidate[],
  transcriptTokens: Set<string>,
  minMatchRatio = 0.6
) => {
  return candidates
    .map((candidate) => {
      const tokens = extractCandidateTokens(candidate);
      return {
        candidate,
        score: matchRatio(tokens, transcriptTokens),
      };
    })
    .filter((item) => item.score >= minMatchRatio)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.candidate);
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
  attendees,
  excludeMeetingId,
  requireAttendeeMatch = true,
  minMatchRatio = 0.6,
  workspaceId,
}: {
  userId: string;
  transcript: string;
  attendees: Array<{ name: string; email?: string | null }>;
  excludeMeetingId?: string;
  requireAttendeeMatch?: boolean;
  minMatchRatio?: number;
  workspaceId?: string | null;
}): Promise<ExtractedTaskSchema[]> => {
  if (!userId || !transcript) return [];

  const attendeeNames = new Set(
    attendees.map((person) => normalizeAssigneeName(person.name)).filter(Boolean)
  );
  const attendeeEmails = new Set(
    attendees.map((person) => normalizeEmail(person.email)).filter(Boolean)
  );
  const hasAttendees =
    requireAttendeeMatch && (attendeeNames.size > 0 || attendeeEmails.size > 0);

  const openItemsTrigger = OPEN_ITEMS_TRIGGER.test(transcript);
  let allowUnassigned = openItemsTrigger || !hasAttendees || !requireAttendeeMatch;
  const ratioThreshold = Math.min(0.95, Math.max(0.4, minMatchRatio));
  const db = await getDb();
  const userIdQuery = buildIdQuery(userId);
  const shouldIncludeAssignee = (
    assigneeName?: string | null,
    assigneeEmail?: string | null,
    allowUnassignedMatch = false,
    requireAttendeeMatch = true
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

  const meetingFilters: Record<string, any> = { userId: userIdQuery };
  if (workspaceFilter) {
    meetingFilters.$and = [workspaceFilter];
  }
  const meetings = await db
    .collection<any>("meetings")
    .find(meetingFilters)
    .project({ _id: 1, title: 1, extractedTasks: 1 })
    .toArray();

  const chatFilters: Record<string, any> = { userId: userIdQuery };
  if (workspaceFilter) {
    chatFilters.$and = [workspaceFilter];
  }
  const chatSessions = await db
    .collection<any>("chatSessions")
    .find(chatFilters)
    .project({ _id: 1, title: 1, suggestedTasks: 1 })
    .toArray();

  const buildCandidates = (
    allowUnassignedMatch: boolean,
    requireAttendeeMatch = true
  ) => {
    const candidates = new Map<string, CompletionCandidate>();

    tasks.forEach((task) => {
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
    });

    meetings.forEach((meeting) => {
      if (excludeMeetingId && String(meeting._id) === excludeMeetingId) return;
      const extracted = flattenExtractedTasks(meeting.extractedTasks || []);
      extracted.forEach((task) => {
        if (!taskIsOpen(task)) return;
        const assigneeName = task.assignee?.name || task.assigneeName || null;
        const assigneeEmail = task.assignee?.email || null;
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
        upsertCandidate(
          candidates,
          {
            title: task.title,
            description: task.description ?? null,
            assigneeName,
            assigneeEmail,
            dueAt: task.dueAt ?? null,
            priority: task.priority ?? null,
            sourceRank: 1,
          },
          {
            sourceType: "meeting",
            sourceSessionId: String(meeting._id),
            taskId: task.id,
            sourceSessionName: meeting.title,
          },
          allowUnassignedMatch
        );
      });
    });

    chatSessions.forEach((session) => {
      const extracted = flattenExtractedTasks(session.suggestedTasks || []);
      extracted.forEach((task) => {
        if (!taskIsOpen(task)) return;
        const assigneeName = task.assignee?.name || task.assigneeName || null;
        const assigneeEmail = task.assignee?.email || null;
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
        upsertCandidate(
          candidates,
          {
            title: task.title,
            description: task.description ?? null,
            assigneeName,
            assigneeEmail,
            dueAt: task.dueAt ?? null,
            priority: task.priority ?? null,
            sourceRank: 2,
          },
          {
            sourceType: "chat",
            sourceSessionId: String(session._id),
            taskId: task.id,
            sourceSessionName: session.title,
          },
          allowUnassignedMatch
        );
      });
    });

    return candidates;
  };

  let candidates = buildCandidates(allowUnassigned, requireAttendeeMatch);
  if (!candidates.size && hasAttendees) {
    allowUnassigned = true;
    candidates = buildCandidates(true, false);
  }

  const allCandidates = Array.from(candidates.values());
  const transcriptTokens = buildTranscriptTokenSet(transcript);
  const candidateList = filterCandidatesByTranscript(
    allCandidates,
    transcriptTokens,
    ratioThreshold
  );

  if (!candidateList.length) {
    return [];
  }

  const limitedCandidates = candidateList.slice(0, 80);

  const completionResponse = await detectCompletedTasks({
    transcript,
    openItemsTrigger,
    candidates: limitedCandidates.map((candidate) => ({
      groupId: candidate.groupId,
      title: candidate.title,
      description: candidate.description || undefined,
      assigneeName: candidate.assigneeName || undefined,
      assigneeEmail: candidate.assigneeEmail || undefined,
      dueAt: candidate.dueAt ? String(candidate.dueAt) : undefined,
      priority: candidate.priority || undefined,
    })),
  });

  const candidateMap = new Map(
    limitedCandidates.map((candidate) => [candidate.groupId, candidate])
  );

  return (completionResponse.completed || [])
    .map((item) => {
      const candidate = candidateMap.get(item.groupId);
      if (!candidate) return null;
      const evidence: TaskEvidence[] = [
        {
          snippet: item.evidence.snippet,
          speaker: item.evidence.speaker,
          timestamp: item.evidence.timestamp,
        },
      ];
      return {
        id: randomUUID(),
        title: candidate.title,
        description: candidate.description || null,
        priority: (candidate.priority as ExtractedTaskSchema["priority"]) || "medium",
        dueAt: candidate.dueAt ?? null,
        status: "done",
        assigneeName: candidate.assigneeName ?? null,
        completionSuggested: true,
        completionConfidence: item.confidence ?? null,
        completionEvidence: evidence,
        completionTargets: candidate.targets,
      } as ExtractedTaskSchema;
    })
    .filter((task): task is ExtractedTaskSchema => Boolean(task));
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
          status: "done",
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
  const remaining = Array.from(suggestionByKey.values());
  return remaining.length ? [...updated, ...remaining] : updated;
};
