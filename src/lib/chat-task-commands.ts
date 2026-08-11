import type { Db } from "mongodb";
import "@/lib/mcp-register-all";
import { executeRegisteredMcpTool } from "@/lib/mcp-registry";
import { McpToolCallError } from "@/lib/mcp-read-tools";
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
    }
  | {
      kind: "clarify";
      reason: "destructive" | "bulk";
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

export type ChatTaskCommandOptions = {
  selectedTaskIds?: string[];
  meetingId?: string | null;
};

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

const hasSelectedTaskReference = (value: string): boolean =>
  /\b(?:the\s+)?selected\s+(?:task|todo)\b/i.test(value);

const parseUnsafeTaskCommand = (question: string): ChatTaskCommand | null => {
  if (!/\b(?:tasks?|todos?)\b/i.test(question)) return null;

  const isPureDueDateRemoval =
    !/\b(?:and|then)\b/i.test(question) &&
    (/(?:^\s*(?:please\s+)?(?:clear|remove)\s+(?:the\s+)?(?:selected\s+)?(?:task|todo)(?:'s)?\s+due\s+date\s*[.!]?\s*$)/i.test(
      question
    ) ||
      /(?:^\s*(?:please\s+)?(?:clear|remove)\s+(?:the\s+)?(?:task|todo)\s+.+?\s+due\s+date\s*[.!]?\s*$)/i.test(
        question
      ) ||
      /(?:^\s*(?:please\s+)?(?:clear|remove)\s+(?:the\s+)?due\s+date\s+(?:for|on|from)\s+(?:the\s+)?(?:selected\s+)?(?:task|todo)(?:\s+.+?)?\s*[.!]?\s*$)/i.test(
        question
      ));
  const hasDestructiveTaskEdit =
    /\b(?:delete|archive|purge)\b/i.test(question) ||
    (/\bremove\b/i.test(question) && !isPureDueDateRemoval);
  if (hasDestructiveTaskEdit) {
    return { kind: "clarify", reason: "destructive" };
  }

  const hasMutationIntent =
    /\b(?:bulk|mark|set|update|change|edit|rename|retitle)\b/i.test(question);
  const hasBulkTarget =
    /\bbulk\b|\b(?:all|every|both|multiple)\s+(?:tasks?|todos?)\b|\b(?:these|those|selected)\s+(?:tasks|todos)\b/i.test(
      question
    );
  const taskTargetCount = question.match(/\b(?:tasks?|todos?)\b/gi)?.length ?? 0;
  if (hasMutationIntent && (hasBulkTarget || taskTargetCount > 1)) {
    return { kind: "clarify", reason: "bulk" };
  }
  return null;
};

const parseUpdateCommand = (
  question: string,
  now: Date
): ChatTaskCommand | null => {
  const quoted = quotedText(question);
  const selectedStatusMatch =
    /\b(?:mark|set|update|change|edit)\s+(?:the\s+)?selected\s+(?:task|todo)\s+(?:(?:to|as)\s+)?(todo|to do|in progress|in-progress|done|complete|completed)\b/i.exec(
      question
    );
  if (selectedStatusMatch) {
    const statusText = selectedStatusMatch[1].toLowerCase();
    const status = statusText.includes("progress")
      ? "inprogress"
      : statusText.includes("done") || statusText.includes("complete")
        ? "done"
        : "todo";
    return {
      kind: "update",
      matchText: "selected task",
      updates: { status },
      changeLabel: `set to ${status === "inprogress" ? "in progress" : status}`,
    };
  }

  const statusDone =
    /\b(?:mark|set|update|change|edit)\b.*\b(?:done|complete|completed)\b/i.test(
      question
    );
  if (statusDone) {
    const unquoted =
      quoted ??
      (hasSelectedTaskReference(question) ? "selected task" : null) ??
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

  const selectedRenameMatch =
    /\b(?:rename|retitle)\s+(?:the\s+)?selected\s+(?:task|todo)\s+(?:to|as)\s+(.+)$/i.exec(
      question
    );
  if (selectedRenameMatch) {
    const title = capitalizeFirst(
      stripWrappingQuotes(removeDuePhrase(selectedRenameMatch[1]))
    );
    if (!title) return null;
    return {
      kind: "update",
      matchText: "selected task",
      updates: { title },
      changeLabel: "renamed",
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

  const selectedDueMatch =
    /\b(?:set|update|change|edit)\s+(?:the\s+)?selected\s+(?:task|todo)\s+(?:due|by)\s+(today|tomorrow|\d{4}-\d{2}-\d{2})\b/i.exec(
      question
    );
  if (selectedDueMatch) {
    const dueAt = parseDueDate(selectedDueMatch[1], now);
    if (dueAt === undefined) return null;
    return {
      kind: "update",
      matchText: "selected task",
      updates: { dueAt },
      changeLabel: "updated due date",
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

  const clearSelectedDueDate =
    /\b(?:clear|remove)\s+(?:the\s+)?selected\s+(?:task|todo)(?:'s)?\s+due\s+date\b|\b(?:clear|remove)\s+(?:the\s+)?due\s+date\s+(?:for|on|from)\s+(?:the\s+)?selected\s+(?:task|todo)\b/i.test(
      question
    );
  if (clearSelectedDueDate) {
    return {
      kind: "update",
      matchText: "selected task",
      updates: { dueAt: null },
      changeLabel: "cleared due date",
    };
  }

  const clearDueMatch =
    /\b(?:clear|remove)\s+(?:the\s+)?(?:task|todo)\s+(.+?)\s+due\s+date\b/i.exec(
      question
    ) ??
    /\b(?:clear|remove)\s+(?:the\s+)?due\s+date\s+(?:for|on|from)\s+(?:the\s+)?(?:task|todo)\s+(.+)$/i.exec(
      question
    );
  if (clearDueMatch) {
    const matchText = stripWrappingQuotes(quoted ?? clearDueMatch[1]);
    if (!matchText) return null;
    return {
      kind: "update",
      matchText,
      updates: { dueAt: null },
      changeLabel: "cleared due date",
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
    parseUnsafeTaskCommand(normalized) ??
    parseUpdateCommand(normalized, now)
  );
};

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
  db: Db,
  scope: ChatTaskScope,
  matchText: string
): Promise<
  | { status: "none" }
  | { status: "ambiguous"; matches: any[] }
  | { status: "matched"; task: any }
> => {
  const normalizedNeedle = normalizeForMatch(matchText);
  if (!normalizedNeedle) return { status: "none" };

  const titlePattern = normalizedNeedle.split(" ").join("[^a-z0-9]+");
  const queryMatches = (pattern: string): Promise<any[]> =>
    db
      .collection("tasks")
      .find({
        ...buildScopeFilter(scope),
        taskState: { $ne: "archived" },
        title: { $regex: pattern, $options: "i" },
      })
      .sort({ lastUpdated: -1, _id: -1 })
      .limit(2)
      .toArray();

  const exact = await queryMatches(`^${titlePattern}$`);
  if (exact.length === 1) return { status: "matched", task: exact[0] };
  if (exact.length > 1) return { status: "ambiguous", matches: exact };

  const contains = await queryMatches(titlePattern);
  if (contains.length === 1) return { status: "matched", task: contains[0] };
  if (contains.length > 1) return { status: "ambiguous", matches: contains };

  return { status: "none" };
};

const findSelectedTasks = async (
  db: Db,
  scope: ChatTaskScope,
  selectedTaskId: string
): Promise<any[]> =>
  db
    .collection("tasks")
    .find({
      $and: [
        buildScopeFilter(scope),
        { taskState: { $ne: "archived" } },
        {
          $or: [
            { _id: selectedTaskId },
            { sourceTaskId: selectedTaskId },
          ],
        },
      ],
    } as any)
    .sort({ lastUpdated: -1, _id: -1 })
    .limit(2)
    .toArray();

const clarificationAnswer = (answer: string): GeneralChatAnswer => ({
  answer,
  confidence: "low",
  sources: [],
  suggestedActions: [],
});

const taskFromToolResult = (result: {
  data: Record<string, unknown>;
}): any | null => {
  const task = result.data?.task;
  if (!task || typeof task !== "object") return null;
  const taskRecord = task as Record<string, unknown>;
  const taskId = String(taskRecord.id ?? taskRecord._id ?? "").trim();
  const title =
    typeof taskRecord.title === "string" ? taskRecord.title.trim() : "";
  return taskId && title ? task : null;
};

export const runChatTaskCommand = async (
  db: Db,
  scope: ChatTaskScope,
  command: ChatTaskCommand,
  options: ChatTaskCommandOptions = {}
): Promise<GeneralChatAnswer> => {
  if (!scope.workspaceId) {
    return clarificationAnswer(
      "I couldn't resolve an active workspace for this task command, so I didn't change anything."
    );
  }

  if (command.kind === "clarify") {
    return clarificationAnswer(
      command.reason === "destructive"
        ? "I can't delete or archive tasks from chat. Open the task to review that change explicitly."
        : "I can update only one task at a time from chat. Select one task and try again."
    );
  }

  const selectedTaskIds = Array.from(
    new Set(
      (options.selectedTaskIds ?? [])
        .map((taskId) => String(taskId).trim())
        .filter(Boolean)
    )
  );
  if (selectedTaskIds.length > 1) {
    return clarificationAnswer(
      "I can update only one task at a time from chat. Select one task and try again."
    );
  }

  if (command.kind === "create") {
    const meetingId = options.meetingId?.trim() || null;
    const result = meetingId
      ? await executeRegisteredMcpTool(
          { db, workspaceId: scope.workspaceId },
          "create_task_from_meeting",
          {
            meetingId,
            title: command.title,
            description: command.description,
            dueAt: command.dueAt ?? undefined,
          }
        )
      : await executeRegisteredMcpTool(
          { db, workspaceId: scope.workspaceId },
          "create_task",
          {
            ownerUserId: scope.userId,
            title: command.title,
            description: command.description,
            dueAt: command.dueAt,
          }
        );
    const task = taskFromToolResult(result);
    if (!task) {
      return clarificationAnswer(
        "The task tool did not return a created task, so I couldn't confirm the change."
      );
    }
    return {
      answer: `Created task "${String(task.title || command.title)}".`,
      confidence: "high",
      sources: [taskSource(task)],
      suggestedActions: [openTaskAction(task)],
    };
  }

  const match = selectedTaskIds.length
    ? await (async () => {
        const tasks = await findSelectedTasks(db, scope, selectedTaskIds[0]);
        if (tasks.length > 1) {
          return { status: "ambiguous", matches: tasks } as const;
        }
        return tasks.length === 1
          ? ({ status: "matched", task: tasks[0] } as const)
          : ({ status: "selected_out_of_scope" } as const);
      })()
    : await findTaskMatch(db, scope, command.matchText);
  if (match.status === "selected_out_of_scope") {
    return clarificationAnswer(
      "I couldn't resolve the selected task inside the active workspace, so I didn't change anything."
    );
  }
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

  const taskId =
    match.task?._id === undefined || match.task?._id === null
      ? ""
      : String(match.task._id).trim();
  if (!taskId) {
    return clarificationAnswer(
      "I couldn't resolve the canonical task id, so I didn't change anything."
    );
  }

  const toolCall = command.updates.status
    ? {
        name: "update_task_status",
        args: { taskId, status: command.updates.status },
      }
    : command.updates.title
      ? {
          name: "action_items.update_title",
          args: { taskId, title: command.updates.title },
        }
      : Object.prototype.hasOwnProperty.call(command.updates, "dueAt")
        ? {
            name: "set_task_due_date",
            args: { taskId, dueAt: command.updates.dueAt ?? null },
          }
        : null;
  if (!toolCall) {
    return clarificationAnswer(
      "I couldn't identify a safe single-task change, so I didn't change anything."
    );
  }

  let result;
  try {
    result = await executeRegisteredMcpTool(
      { db, workspaceId: scope.workspaceId },
      toolCall.name,
      toolCall.args
    );
  } catch (error) {
    if (error instanceof McpToolCallError) {
      return clarificationAnswer(
        "The task tool couldn't confirm the authorized task change, so I didn't report it as completed."
      );
    }
    throw error;
  }
  const updatedTask = taskFromToolResult(result);
  if (!updatedTask) {
    return clarificationAnswer(
      "The task tool did not return a valid updated task, so I couldn't confirm the change."
    );
  }
  return {
    answer: `Updated task "${String(
      updatedTask.title || match.task.title || "Untitled task"
    )}" (${command.changeLabel}).`,
    confidence: "high",
    sources: [taskSource(updatedTask)],
    suggestedActions: [openTaskAction(updatedTask)],
  };
};
