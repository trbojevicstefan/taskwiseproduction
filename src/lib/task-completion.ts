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

const normalizeAssigneeName = (value?: string | null) =>
  value ? normalizePersonNameKey(value) : "";

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

const extractCandidateTokens = (candidate: CompletionCandidate) => {
  const base = `${candidate.title || ""} ${candidate.description || ""}`;
  const normalized = normalizeTitleKey(base);
  return normalized
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
};

const filterCandidatesByTranscript = (
  candidates: CompletionCandidate[],
  transcript: string,
  openItemsTrigger: boolean
) => {
  if (openItemsTrigger) return candidates;
  const transcriptLower = transcript.toLowerCase();
  return candidates.filter((candidate) =>
    extractCandidateTokens(candidate).some((token) => transcriptLower.includes(token))
  );
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
}: {
  userId: string;
  transcript: string;
  attendees: Array<{ name: string; email?: string | null }>;
  excludeMeetingId?: string;
}): Promise<ExtractedTaskSchema[]> => {
  if (!userId || !transcript) return [];

  const attendeeNames = new Set(
    attendees.map((person) => normalizeAssigneeName(person.name)).filter(Boolean)
  );
  const attendeeEmails = new Set(
    attendees.map((person) => normalizeEmail(person.email)).filter(Boolean)
  );

  const openItemsTrigger = OPEN_ITEMS_TRIGGER.test(transcript);
  const allowUnassigned = openItemsTrigger;
  const db = await getDb();
  const userIdQuery = buildIdQuery(userId);
  const candidates = new Map<string, CompletionCandidate>();

  const tasks = await db
    .collection<any>("tasks")
    .find({ userId: userIdQuery, status: { $ne: "done" } })
    .toArray();

  tasks.forEach((task) => {
    const assigneeName = task.assignee?.name || task.assigneeName || null;
    const assigneeEmail = task.assignee?.email || task.assigneeEmail || null;
    if (!matchesAttendee(assigneeName, assigneeEmail, attendeeNames, attendeeEmails, allowUnassigned)) {
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
      allowUnassigned
    );
  });

  const meetings = await db
    .collection<any>("meetings")
    .find({ userId: userIdQuery })
    .project({ _id: 1, title: 1, extractedTasks: 1 })
    .toArray();

  meetings.forEach((meeting) => {
    if (excludeMeetingId && String(meeting._id) === excludeMeetingId) return;
    const extracted = flattenExtractedTasks(meeting.extractedTasks || []);
    extracted.forEach((task) => {
      if (!taskIsOpen(task)) return;
      const assigneeName = task.assignee?.name || task.assigneeName || null;
      const assigneeEmail = task.assignee?.email || null;
      if (!matchesAttendee(assigneeName, assigneeEmail, attendeeNames, attendeeEmails, allowUnassigned)) {
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
        allowUnassigned
      );
    });
  });

  const chatSessions = await db
    .collection<any>("chatSessions")
    .find({ userId: userIdQuery })
    .project({ _id: 1, title: 1, suggestedTasks: 1 })
    .toArray();

  chatSessions.forEach((session) => {
    const extracted = flattenExtractedTasks(session.suggestedTasks || []);
    extracted.forEach((task) => {
      if (!taskIsOpen(task)) return;
      const assigneeName = task.assignee?.name || task.assigneeName || null;
      const assigneeEmail = task.assignee?.email || null;
      if (!matchesAttendee(assigneeName, assigneeEmail, attendeeNames, attendeeEmails, allowUnassigned)) {
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
        allowUnassigned
      );
    });
  });

  const allCandidates = Array.from(candidates.values());
  const filteredCandidates = filterCandidatesByTranscript(
    allCandidates,
    transcript,
    openItemsTrigger
  );
  const candidateList = filteredCandidates.length ? filteredCandidates : allCandidates;

  if (!candidateList.length) {
    return [];
  }

  const limitedCandidates = candidateList.slice(0, 40);

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
