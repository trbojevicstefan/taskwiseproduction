// src/lib/ai-utils.ts
import type { TaskType } from '@/ai/flows/schemas';
import type { ExtractedTaskSchema } from '@/types/chat';
import { TASK_TYPE_VALUES, type TaskTypeCategory } from '@/lib/task-types';

/**
 * Validates if a task title is meaningful and not just a placeholder.
 * @param title The title string to validate.
 * @returns boolean
 */
export function isPlaceholderTitle(title: string | undefined): boolean {
  if (!title) return true;
  const trimmed = title.trim().toLowerCase();
  if (!trimmed) return true;

  const genericOnly = /^(action item|action items|task|tasks|todo|to do|item|items|next step|meeting action|refined task|simplified task|root topic)$/;
  const genericWithNumber = /^(action item|task|todo|to do|item|next step|meeting action|refined task|simplified task|root topic)\s*#?\d+$/;
  return genericOnly.test(trimmed) || genericWithNumber.test(trimmed);
}

export function isValidTitle(title: string | undefined): boolean {
  if (!title || title.trim() === "") {
    return false;
  }
  if (isPlaceholderTitle(title)) {
    return false;
  }
  // This is a basic check; the prompt is the primary defense.
  const hasLetterPattern = /[a-zA-Z]/;
  if (!hasLetterPattern.test(title.trim())) {
     return false;
  }
  const purelyNumericOrAlpha = /^(?:[0-9]+|[a-zA-Z])$/;
  const simpleListMarker = /^[0-9a-zA-Z]{1,2}[\\.\\)]?$/;

  if (purelyNumericOrAlpha.test(title.trim()) || (title.trim().length <=3 && simpleListMarker.test(title.trim())) ) {
      return false;
  }
  return true;
}

/**
 * Recursively filters a task and its subtasks to remove any nodes with invalid titles.
 * @param task The task object to filter.
 * @returns The filtered task object or null if the root task itself is invalid.
 */
export function filterTaskRecursive(task: ExtractedTaskSchema): ExtractedTaskSchema | null {
    if (!isValidTitle(task.title)) {
        console.warn(`Filtering out task with invalid title: "${task.title}"`);
        return null;
    }
    if (task.subtasks && task.subtasks.length > 0) {
        task.subtasks = task.subtasks.map(filterTaskRecursive).filter(t => t !== null) as ExtractedTaskSchema[];
    }
    return task;
}

type LooseTaskNode = {
  id?: unknown;
  title?: unknown;
  description?: unknown;
  priority?: unknown;
  dueAt?: unknown;
  assigneeName?: unknown;
  status?: unknown;
  subtasks?: unknown;
};

function toTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function coerceTaskTitle(
  titleValue: unknown,
  descriptionValue: unknown,
  fallbackTitle: string
): string | null {
  const title = toTrimmedString(titleValue);
  if (title && isValidTitle(title)) {
    return title;
  }
  const description = toTrimmedString(descriptionValue);
  if (description) {
    const firstLine = description.split(/[\n.!?]/)[0]?.trim();
    const candidate = firstLine || description.slice(0, 80).trim();
    if (candidate && isValidTitle(candidate)) {
      return candidate;
    }
  }
  if (isValidTitle(fallbackTitle)) {
    return fallbackTitle;
  }
  return null;
}

function normalizeAiTaskNode(
  node: unknown,
  index: number,
  fallbackPrefix: string
): TaskType | null {
  if (typeof node === "string") {
    const title = node.trim();
    if (!isValidTitle(title)) {
      return null;
    }
    return {
      title,
      priority: "medium",
    };
  }
  if (!node || typeof node !== "object") return null;
  const task = node as LooseTaskNode & Record<string, unknown>;

  const fallbackTitle = `${fallbackPrefix} ${index + 1}`;
  const title = coerceTaskTitle(task.title, task.description, fallbackTitle);
  if (!title) return null;

  const description = toTrimmedString(task.description);
  const priorityRaw = toTrimmedString(task.priority)?.toLowerCase();
  const priority =
    priorityRaw === "high" || priorityRaw === "medium" || priorityRaw === "low"
      ? priorityRaw
      : "medium";
  const taskTypeRaw = toTrimmedString(task.taskType) as TaskTypeCategory | undefined;
  const taskType = taskTypeRaw && TASK_TYPE_VALUES.includes(taskTypeRaw) ? taskTypeRaw : undefined;
  const dueAt = toTrimmedString(task.dueAt);
  const assigneeName = toTrimmedString(task.assigneeName);
  const statusRaw = toTrimmedString(task.status)?.toLowerCase();
  const status =
    statusRaw === "todo" ||
    statusRaw === "inprogress" ||
    statusRaw === "done" ||
    statusRaw === "recurring"
      ? statusRaw
      : undefined;
  const id = toTrimmedString(task.id);

  const childPrefix = `${title} follow-up`;
  const subtasks = normalizeAiTasks(task.subtasks, childPrefix);
  const sourceEvidence = Array.isArray(task.sourceEvidence)
    ? task.sourceEvidence
        .map((entry) => {
          if (!entry || typeof entry !== "object") return null;
          const snippet =
            typeof entry.snippet === "string" && entry.snippet.trim()
              ? entry.snippet.trim()
              : undefined;
          if (!snippet) return null;
          return {
            snippet,
            speaker:
              typeof entry.speaker === "string" && entry.speaker.trim()
                ? entry.speaker.trim()
                : undefined,
            timestamp:
              typeof entry.timestamp === "string" && entry.timestamp.trim()
                ? entry.timestamp.trim()
                : undefined,
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    : undefined;

  return {
    id: id || undefined,
    title,
    description,
    priority,
    taskType,
    dueAt,
    status,
    assigneeName,
    subtasks: subtasks.length ? subtasks : undefined,
    sourceEvidence: sourceEvidence && sourceEvidence.length ? sourceEvidence : undefined,
  };
}

export function normalizeAiTasks(
  input: unknown,
  fallbackPrefix = "Next step"
): TaskType[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((task, index) => normalizeAiTaskNode(task, index, fallbackPrefix))
    .filter((task): task is TaskType => Boolean(task));
}

export function hasMeaningfulTasks(tasks: TaskType[]): boolean {
  return tasks.some((task) => !isPlaceholderTitle(task.title));
}

export type TaskAiProvider = "openai";

export function annotateTasksWithProvider(
  tasks: TaskType[],
  provider?: TaskAiProvider
): TaskType[] {
  if (!provider) return tasks;
  const apply = (items: TaskType[]): TaskType[] =>
    items.map((task) => ({
      ...task,
      aiProvider: task.aiProvider || provider,
      subtasks: task.subtasks ? apply(task.subtasks) : task.subtasks,
    }));
  return apply(tasks);
}

export const normalizeTitleKey = (title: string | undefined): string => {
  if (!title) return "";
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const findMatchingTask = (task: TaskType, candidates: TaskType[]): TaskType | null => {
  const lightKey = normalizeTitleKey(task.title);
  if (!lightKey) return null;
  const exact = candidates.find((candidate) => normalizeTitleKey(candidate.title) === lightKey);
  if (exact) return exact;
  return (
    candidates.find((candidate) => {
      const candidateKey = normalizeTitleKey(candidate.title);
      return candidateKey && (candidateKey.includes(lightKey) || lightKey.includes(candidateKey));
    }) || null
  );
};

export function alignTasksToLight(lightTasks: TaskType[], tasks: TaskType[]): TaskType[] {
  if (!lightTasks.length) return tasks;
  if (!tasks.length) return lightTasks;

  return lightTasks.map((lightTask, index) => {
    const match = findMatchingTask(lightTask, tasks) || tasks[index] || null;
    if (!match) return lightTask;
    const sourceEvidence =
      match.sourceEvidence && match.sourceEvidence.length
        ? match.sourceEvidence
        : lightTask.sourceEvidence;
    return {
      ...match,
      title: lightTask.title,
      description: match.description || lightTask.description,
      assigneeName: match.assigneeName || lightTask.assigneeName,
      dueAt: match.dueAt || lightTask.dueAt,
      taskType: match.taskType || lightTask.taskType,
      sourceEvidence,
    };
  });
}

const HIGH_PRIORITY_KEYWORDS = [
  "asap",
  "urgent",
  "critical",
  "top priority",
  "high priority",
  "eod",
  "end of day",
  "tomorrow",
  "deadline",
  "launch",
  "ship",
  "final",
  "finalize",
];

const LOW_PRIORITY_KEYWORDS = [
  "later",
  "someday",
  "nice to have",
  "optional",
  "if time",
  "when possible",
  "backlog",
];

const TASK_TYPE_RULES: Array<{ type: TaskTypeCategory; keywords: string[] }> = [
  { type: "legal", keywords: ["legal", "dpa", "contract", "compliance", "terms"] },
  { type: "sales", keywords: ["pricing", "proposal", "client", "deal", "sales"] },
  { type: "marketing", keywords: ["marketing", "campaign", "outreach", "brand"] },
  { type: "design", keywords: ["design", "ux", "ui", "mockup", "prototype"] },
  { type: "engineering", keywords: ["build", "implement", "develop", "code", "test", "deploy"] },
  { type: "documentation", keywords: ["doc", "document", "draft", "spec", "deck", "slides", "notes"] },
  { type: "delivery", keywords: ["launch", "release", "ship", "submit", "deliver", "publish"] },
  { type: "coordination", keywords: ["schedule", "meeting", "call", "sync", "follow up", "invite"] },
  { type: "communication", keywords: ["email", "send", "share", "update", "notify", "message"] },
  { type: "research", keywords: ["research", "analyze", "investigate", "review", "evaluate"] },
  { type: "operations", keywords: ["ops", "process", "workflow", "support", "onboarding"] },
];

const inferPriorityFromText = (text: string, dueAt?: string | null): TaskType["priority"] => {
  const lowered = text.toLowerCase();
  if (HIGH_PRIORITY_KEYWORDS.some((keyword) => lowered.includes(keyword))) {
    return "high";
  }
  if (LOW_PRIORITY_KEYWORDS.some((keyword) => lowered.includes(keyword))) {
    return "low";
  }
  if (dueAt) {
    const dueDate = new Date(dueAt);
    if (!Number.isNaN(dueDate.getTime())) {
      const diffMs = dueDate.getTime() - Date.now();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      if (diffDays <= 3) return "high";
      if (diffDays >= 30) return "low";
    }
  }
  return "medium";
};

const inferTaskTypeFromText = (text: string): TaskTypeCategory => {
  const lowered = text.toLowerCase();
  for (const rule of TASK_TYPE_RULES) {
    if (rule.keywords.some((keyword) => lowered.includes(keyword))) {
      return rule.type;
    }
  }
  return "general";
};

export function applyTaskMetadata(tasks: TaskType[]): TaskType[] {
  const apply = (items: TaskType[]): TaskType[] =>
    items.map((task) => {
      const evidence = task.sourceEvidence?.[0]?.snippet || "";
      const contextText = [task.title, task.description, evidence].filter(Boolean).join(" ");
      const inferredPriority = inferPriorityFromText(contextText, task.dueAt || undefined);
      const nextPriority =
        task.priority && task.priority !== "medium" ? task.priority : inferredPriority;
      const nextTaskType = task.taskType || inferTaskTypeFromText(contextText);
      return {
        ...task,
        priority: nextPriority,
        taskType: nextTaskType,
        subtasks: task.subtasks ? apply(task.subtasks) : task.subtasks,
      };
    });
  return apply(tasks);
}
