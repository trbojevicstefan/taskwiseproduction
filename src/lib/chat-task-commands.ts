import { randomUUID } from "crypto";
import { normalizePersonNameKey } from "@/lib/transcript-utils";
import type { GeneralChatAnswer } from "@/types/general-chat";

export type ChatTaskCommand =
  | {
      kind: "create";
      title: string;
      dueAt: string | null;
      description?: string;
    }
  | {
      kind: "update";
      matchText: string;
      updates: {
        title?: string;
        status?: "todo" | "inprogress" | "done";
        dueAt?: string | null;
      };
      changeLabel: string;
    };

export type ChatTaskScope = {
  userId: string;
  workspaceId?: string | null;
  memberUserIds?: string[];
};

export type ChatTaskHistoryEntry = {
  role: "user" | "assistant";
  text: string;
};

const MAX_TASK_MATCHES = 25;

const singleLine = (value: string): string => value.replace(/\s+/g, " ").trim();

const capitalizeFirst = (value: string): string => {
  const trimmed = singleLine(value).replace(/[.?!]+$/g, "");
  if (!trimmed) return "";
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
};

const stripWrappingQuotes = (value: string): string =>
  singleLine(value).replace(/^["'“”]+|["'“”]+$/g, "").trim();

const parseDueDate = (value: string, now: Date): string | null | undefined => {
  const lowered = value.toLowerCase();
  const date = new Date(now);
  if (/\btoday\b/.test(lowered)) {
    date.setUTCHours(23, 59, 59, 999);
    return date.toISOString();
  }
  if (/\btomorrow\b/.test(lowered)) {
    date.setUTCDate(date.getUTCDate() + 1);
    date.setUTCHours(23, 59, 59, 999);
    return date.toISOString();
  }
  const isoDate = /\b(\d{4}-\d{2}-\d{2})\b/.exec(value)?.[1];
  if (isoDate) {
    const parsed = new Date(`${isoDate}T23:59:59.999Z`);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return undefined;
};

const removeDuePhrase = (value: string): string =>
  singleLine(
    value.replace(
      /\s+\b(?:due|by)\s+(?:today|tomorrow|\d{4}-\d{2}-\d{2})\b/gi,
      ""
    )
  );

const parseCreateCommand = (
  question: string,
  now: Date
): ChatTaskCommand | null => {
  const match =
    /^\s*(?:please\s+)?(?:create|add|make)\s+(?:a\s+|an\s+)?(?:new\s+)?(?:task|todo)(?:\s*[:-]|\s+(?:to|for|about))?\s+(.+)$/i.exec(
      question
    );
  if (!match) return null;
  const rawTitle = stripWrappingQuotes(removeDuePhrase(match[1]));
  const title = capitalizeFirst(rawTitle.replace(/^(?:to|for|about)\s+/i, ""));
  if (!title) return null;
  return {
    kind: "create",
    title,
    dueAt: parseDueDate(match[1], now) ?? null,
  };
};

const isContextualCreateRequest = (question: string): boolean => {
  const normalized = singleLine(question).toLowerCase();
  const hasCreateIntent = /\b(?:create\w*|creat\w*|add|make)\b/.test(
    normalized
  );
  const hasTaskIntent = /\b(?:task|todo)\b/.test(normalized);
  const hasContextPronoun = /\b(?:that|thtat|this|it)\b/.test(normalized);
  return hasCreateIntent && hasTaskIntent && hasContextPronoun;
};

const isTaskCommandLike = (text: string): boolean =>
  /\b(?:create\w*|creat\w*|add|make|set|mark|update|change|edit|rename|retitle)\b.*\b(?:task|todo)\b/i.test(
    text
  );

const inferTaskTitleFromHistory = (
  history: ChatTaskHistoryEntry[] | undefined
): { title: string; sourceText: string } | null => {
  const source = [...(history ?? [])]
    .reverse()
    .find(
      (entry) =>
        entry.role === "user" &&
        typeof entry.text === "string" &&
        entry.text.trim() &&
        !isTaskCommandLike(entry.text)
    );
  if (!source) return null;

  const sourceText = singleLine(source.text).replace(/[?!.]+$/g, "");
  const normalized = sourceText
    .replace(/^(?:please\s+)?(?:can you|could you|would you)\s+/i, "")
    .replace(/^how\s+(?:can|do|would|should)\s+i\s+/i, "")
    .replace(/^how\s+to\s+/i, "")
    .replace(/^what(?:'s| is)?\s+the\s+(?:best\s+)?way\s+to\s+/i, "")
    .replace(/^help\s+me\s+(?:to\s+)?/i, "")
    .replace(/^(?:i\s+need\s+to|i\s+want\s+to)\s+/i, "")
    .trim();

  const title = capitalizeFirst(normalized);
  return title ? { title, sourceText } : null;
};

const parseContextualCreateCommand = (
  question: string,
  history: ChatTaskHistoryEntry[] | undefined
): ChatTaskCommand | null => {
  if (!isContextualCreateRequest(question)) return null;
  const inferred = inferTaskTitleFromHistory(history);
  if (!inferred) return null;
  const wantsSteps = /\bstep\s+by\s+step\b|\bsteps\b/i.test(question);
  return {
    kind: "create",
    title: inferred.title,
    dueAt: null,
    description: wantsSteps
      ? `Created from chat follow-up. Original request: ${inferred.sourceText}. Requested as a step-by-step task.`
      : `Created from chat follow-up. Original request: ${inferred.sourceText}.`,
  };
};

const quotedText = (value: string): string | null => {
  const match = /["“]([^"”]{2,})["”]/.exec(value);
  return match ? singleLine(match[1]) : null;
};

const parseUpdateCommand = (
  question: string,
  now: Date
): ChatTaskCommand | null => {
  const quoted = quotedText(question);
  const statusDone =
    /\b(?:mark|set|update|change|edit)\b.*\b(?:done|complete|completed)\b/i.test(
      question
    );
  if (statusDone) {
    const unquoted =
      quoted ??
      /(?:task|todo)\s+(.+?)\s+(?:(?:to|as)\s+)?(?:done|complete|completed)\b/i.exec(
        question
      )?.[1];
    const matchText = stripWrappingQuotes(unquoted ?? "");
    if (!matchText) return null;
    return {
      kind: "update",
      matchText,
      updates: { status: "done" },
      changeLabel: "marked done",
    };
  }

  const statusMatch =
    /\b(?:set|update|change|edit)\s+(?:the\s+)?(?:task|todo)\s+(.+?)\s+(?:to|as)\s+(todo|to do|in progress|in-progress|done|complete|completed)\b/i.exec(
      question
    );
  if (statusMatch) {
    const statusText = statusMatch[2].toLowerCase();
    const status = statusText.includes("progress")
      ? "inprogress"
      : statusText.includes("done") ||
        statusText.includes("complete")
      ? "done"
      : "todo";
    return {
      kind: "update",
      matchText: stripWrappingQuotes(quoted ?? statusMatch[1]),
      updates: { status },
      changeLabel: `set to ${status === "inprogress" ? "in progress" : status}`,
    };
  }

  const renameMatch =
    /\b(?:rename|retitle)\s+(?:the\s+)?(?:task|todo)\s+(.+?)\s+(?:to|as)\s+(.+)$/i.exec(
      question
    );
  if (renameMatch) {
    const matchText = stripWrappingQuotes(quoted ?? renameMatch[1]);
    const title = capitalizeFirst(
      stripWrappingQuotes(removeDuePhrase(renameMatch[2]))
    );
    if (!matchText || !title) return null;
    return {
      kind: "update",
      matchText,
      updates: { title },
      changeLabel: "renamed",
    };
  }

  const dueMatch =
    /\b(?:set|update|change|edit)\s+(?:the\s+)?(?:task|todo)\s+(.+?)\s+(?:due|by)\s+(today|tomorrow|\d{4}-\d{2}-\d{2})\b/i.exec(
      question
    );
  if (dueMatch) {
    const dueAt = parseDueDate(dueMatch[2], now);
    const matchText = stripWrappingQuotes(quoted ?? dueMatch[1]);
    if (!matchText || dueAt === undefined) return null;
    return {
      kind: "update",
      matchText,
      updates: { dueAt },
      changeLabel: "updated due date",
    };
  }

  return null;
};

export const planChatTaskCommand = (
  question: string,
  now: Date = new Date(),
  history?: ChatTaskHistoryEntry[]
): ChatTaskCommand | null => {
  const normalized = singleLine(question);
  return (
    parseCreateCommand(normalized, now) ??
    parseContextualCreateCommand(normalized, history) ??
    parseUpdateCommand(normalized, now)
  );
};

const serializeTaskDates = (task: any) => ({
  ...task,
  createdAt: task.createdAt?.toISOString?.() || task.createdAt,
  lastUpdated: task.lastUpdated?.toISOString?.() || task.lastUpdated,
});

const taskSource = (task: any) => ({
  sourceType: "task" as const,
  sourceId: String(task._id ?? task.id),
  title: String(task.title || "Untitled task"),
  snippet: `status=${task.status || "todo"}`,
  sourceSessionId:
    typeof task.sourceSessionId === "string" ? task.sourceSessionId : undefined,
});

const openTaskAction = (task: any) => ({
  label: `Open ${String(task.title || "task")}`.slice(0, 80),
  actionType: "open_task" as const,
  targetId: String(task._id ?? task.id),
});

const buildScopeFilter = (scope: ChatTaskScope): Record<string, any> => {
  const memberUserIds =
    Array.isArray(scope.memberUserIds) && scope.memberUserIds.length
      ? scope.memberUserIds
      : [scope.userId];
  if (scope.workspaceId) {
    return {
      $or: [
        { workspaceId: scope.workspaceId },
        { workspaceId: { $exists: false }, userId: { $in: memberUserIds } },
      ],
    };
  }
  return { userId: { $in: memberUserIds } };
};

const normalizeForMatch = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const findTaskMatch = async (
  db: any,
  scope: ChatTaskScope,
  matchText: string
): Promise<
  | { status: "none" }
  | { status: "ambiguous"; matches: any[] }
  | { status: "matched"; task: any }
> => {
  const normalizedNeedle = normalizeForMatch(matchText);
  if (!normalizedNeedle) return { status: "none" };

  const tasks: any[] = await db
    .collection("tasks")
    .find({
      ...buildScopeFilter(scope),
      taskState: { $ne: "archived" },
    })
    .sort({ lastUpdated: -1, _id: -1 })
    .limit(MAX_TASK_MATCHES)
    .toArray();

  const activeTasks = tasks.filter((task) => String(task?.status ?? "") !== "done");
  const candidates = activeTasks.length ? activeTasks : tasks;
  const exact = candidates.filter(
    (task) => normalizeForMatch(String(task?.title ?? "")) === normalizedNeedle
  );
  if (exact.length === 1) return { status: "matched", task: exact[0] };
  if (exact.length > 1) return { status: "ambiguous", matches: exact };

  const contains = candidates.filter((task) =>
    normalizeForMatch(String(task?.title ?? "")).includes(normalizedNeedle)
  );
  if (contains.length === 1) return { status: "matched", task: contains[0] };
  if (contains.length > 1) return { status: "ambiguous", matches: contains };

  return { status: "none" };
};

export const runChatTaskCommand = async (
  db: any,
  scope: ChatTaskScope,
  command: ChatTaskCommand
): Promise<GeneralChatAnswer> => {
  if (command.kind === "create") {
    const now = new Date();
    const task = {
      _id: randomUUID(),
      title: command.title,
      description: command.description || "",
      status: "todo",
      priority: "medium",
      dueAt: command.dueAt,
      assignee: undefined,
      assigneeName: null,
      assigneeNameKey: null as string | null,
      aiSuggested: false,
      origin: "chat",
      projectId: null,
      workspaceId: scope.workspaceId ?? null,
      userId: scope.userId,
      parentId: null,
      order: 0,
      subtaskCount: 0,
      sourceSessionId: null,
      sourceSessionName: null,
      sourceSessionType: "chat",
      sourceTaskId: null,
      taskState: "active",
      researchBrief: null,
      aiAssistanceText: null,
      createdAt: now,
      lastUpdated: now,
    };
    await db.collection("tasks").insertOne(task);
    const serialized = serializeTaskDates(task);
    return {
      answer: `Created task "${serialized.title}".`,
      confidence: "high",
      sources: [taskSource(serialized)],
      suggestedActions: [openTaskAction(serialized)],
    };
  }

  const match = await findTaskMatch(db, scope, command.matchText);
  if (match.status === "none") {
    return {
      answer: `I couldn't find a task matching "${command.matchText}". Try the exact task title and I can update it.`,
      confidence: "low",
      sources: [],
      suggestedActions: [],
    };
  }
  if (match.status === "ambiguous") {
    const lines = match.matches
      .slice(0, 5)
      .map((task) => `- ${String(task.title || "Untitled task")}`)
      .join("\n");
    return {
      answer: `I found multiple matching tasks, so I didn't change anything. Please use the exact title:\n${lines}`,
      confidence: "low",
      sources: match.matches.slice(0, 5).map(taskSource),
      suggestedActions: match.matches.slice(0, 5).map(openTaskAction),
    };
  }

  const update: Record<string, unknown> = {
    ...command.updates,
    lastUpdated: new Date(),
  };
  if (typeof update.assigneeName === "string") {
    update.assigneeNameKey = normalizePersonNameKey(update.assigneeName);
  }

  const taskId = String(match.task._id ?? match.task.id);
  const updateFilter = { _id: taskId, ...buildScopeFilter(scope) };
  await db.collection("tasks").updateOne(updateFilter, { $set: update });
  const updatedTask =
    (await db.collection("tasks").findOne(updateFilter)) ?? {
      ...match.task,
      ...update,
    };
  const serialized = serializeTaskDates(updatedTask);
  return {
    answer: `Updated task "${serialized.title}" (${command.changeLabel}).`,
    confidence: "high",
    sources: [taskSource(serialized)],
    suggestedActions: [openTaskAction(serialized)],
  };
};
