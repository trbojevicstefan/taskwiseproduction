import type { PersonSchemaType, TaskType } from "@/ai/flows/schemas";
import { isPlaceholderTitle, isValidTitle, normalizeTitleKey } from "@/lib/ai-utils";

type TranscriptLine = {
  speaker?: string;
  email?: string;
  title?: string;
  text: string;
};

const LEADING_TIMESTAMP_REGEX =
  /^\s*(?:\[(\d{1,2}:\d{2}(?::\d{2})?)\]|\((\d{1,2}:\d{2}(?::\d{2})?)\)|(\d{1,2}:\d{2}(?::\d{2})?))\s*/;
const SPEAKER_LINE_REGEX =
  /^([\p{L}][\p{L}0-9\s.'-]*[\p{L}0-9])\s*(?:\(([^)]*)\))?\s*(?:\[(\d{1,2}:\d{2}(?::\d{2})?)\]|\((\d{1,2}:\d{2}(?::\d{2})?)\))?\s*[:\-\u2013\u2014]\s*(.*)$/u;
const SPEAKER_ONLY_REGEX =
  /^([\p{L}][\p{L}0-9\s.'-]*[\p{L}0-9])\s*(?:\(([^)]*)\))?\s*[:\-\u2013\u2014]?\s*$/u;
const EMAIL_REGEX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const ACTION_VERBS = [
  "send",
  "review",
  "finalize",
  "start",
  "schedule",
  "draft",
  "create",
  "launch",
  "deliver",
  "design",
  "provide",
  "prepare",
  "share",
  "complete",
  "update",
  "build",
  "target",
  "handle",
];

const INVALID_NAME_WORDS = new Set([
  "team",
  "teams",
  "group",
  "department",
  "dept",
  "date",
  "time",
  "title",
  "weekly",
  "monthly",
  "daily",
  "everyone",
  "all",
  "folks",
  "guys",
  "gals",
  "you",
  "your",
  "we",
  "our",
  "us",
  "legal",
  "design",
  "engineering",
  "product",
  "marketing",
  "sales",
  "support",
  "ops",
  "operations",
  "finance",
  "hr",
  "people",
  "attendees",
  "clients",
  "client",
  "investors",
  "recording",
  "view",
  "meeting",
  "transcript",
  "call",
  "session",
  "agenda",
  "summary",
  "minutes",
  "mins",
  "highlight",
  "highlights",
]);

const INVALID_NAME_PHRASES = new Set([
  "your team",
  "my team",
  "the team",
  "design team",
  "product team",
  "engineering team",
  "sales team",
  "marketing team",
  "legal team",
  "support team",
  "ops team",
  "operations team",
  "our team",
  "their team",
  "everyone",
  "all hands",
  "meeting date",
  "meeting time",
  "meeting title",
  "meeting agenda",
  "meeting notes",
  "meeting summary",
  "meeting minutes",
  "meeting attendees",
  "meeting location",
  "weekly meeting",
  "daily standup",
]);

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
]);

const splitMetaParts = (input: string): { email?: string; title?: string } => {
  const parts = input
    .split(",")
    .map((part: any) => part.trim())
    .filter(Boolean);
  let email: string | undefined;
  let title: string | undefined;
  for (const part of parts) {
    if (!email && part.includes("@")) {
      email = part;
    } else if (!title) {
      title = part;
    }
  }
  return { email, title };
};

const splitIntoSentences = (text: string): string[] =>
  text
    .split(/(?<=[.!?])\s+/)
    .map((sentence: any) => sentence.trim())
    .filter(Boolean);

const containsActionVerb = (phrase: string): boolean => {
  const lowered = phrase.toLowerCase();
  return ACTION_VERBS.some((verb: any) => lowered.includes(verb));
};

const normalizeNameKey = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const normalizePersonNameKey = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const isValidPersonName = (value: string | undefined): boolean => {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.match(EMAIL_REGEX)) return false;
  const normalized = normalizeNameKey(trimmed);
  if (!normalized) return false;
  if (INVALID_NAME_PHRASES.has(normalized)) return false;
  const words = normalized.split(" ").filter(Boolean);
  if (!words.length) return false;
  if (words.length > 4) return false;
  if (words.every((word) => INVALID_NAME_WORDS.has(word))) return false;
  if (words.some((word: any) => INVALID_NAME_WORDS.has(word)) && words.length === 1) return false;
  return true;
};

const normalizeAssigneeName = (value: string): string | undefined => {
  const cleaned = value
    .split(/\s+/)
    .map((part: any) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
    .trim();
  return isValidPersonName(cleaned) ? cleaned : undefined;
};

const normalizeTranscriptLine = (line: string): string => {
  let cleaned = line.trim();
  if (!cleaned) return cleaned;
  cleaned = cleaned.replace(/^#+\s+/, "");
  cleaned = cleaned.replace(/^[\*\-\u2022]\s+/, "");
  cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, "$1");
  cleaned = cleaned.replace(/_([^_]+)_/g, "$1");
  cleaned = cleaned.replace(/\*+\s*(\[\d{1,2}:\d{2}(?::\d{2})?\])\s*\*+/g, "$1");
  cleaned = cleaned.replace(/_+\s*(\[\d{1,2}:\d{2}(?::\d{2})?\])\s*_+/g, "$1");
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  return cleaned;
};

const normalizeTaskTitle = (phrase: string): string | null => {
  let cleaned = phrase.trim();
  cleaned = cleaned.replace(/^(to|the|a|an)\s+/i, "");
  cleaned = cleaned.replace(/\s+(?:by|before|after|once|when|if)\b.+$/i, "");
  cleaned = cleaned.replace(/\s+/g, " ");
  if (!cleaned) return null;
  const title = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  if (!isValidTitle(title) || isPlaceholderTitle(title)) {
    return null;
  }
  return title;
};

const isGenericActionPhrase = (phrase: string): boolean => {
  const lowered = phrase.toLowerCase();
  const shortTokens = lowered.split(/\s+/).filter(Boolean);
  if (shortTokens.length <= 2 && (lowered.includes("that") || lowered.includes("it"))) {
    return true;
  }
  return false;
};

const cleanDescription = (sentence: string, title?: string): string | undefined => {
  let cleaned = sentence.trim();
  cleaned = cleaned.replace(/^(yeah|yep|yes|ok|okay|alright|right|sure)[,!.\s]+/i, "");
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.length < 8) return undefined;
  if (title) {
    const titleKey = normalizeTitleKey(title);
    const descKey = normalizeTitleKey(cleaned);
    if (titleKey && descKey && (descKey === titleKey || descKey.includes(titleKey))) {
      return undefined;
    }
  }
  return cleaned;
};

const extractTaskFromSentence = (
  sentence: string,
  speaker?: string
): { title: string; assigneeName?: string; description?: string } | null => {
  const trimmed = sentence.trim();
  if (!trimmed) return null;
  const isQuestion = /\?\s*$/.test(trimmed);

  const patterns: Array<{
    regex: RegExp;
    assigneeFrom?: "speaker" | number;
    phraseGroup: number;
    requireActionVerb?: boolean;
    titlePrefix?: string;
  }> = [
    {
      regex:
        /^(?:please\s+)?((?:create|set up|setup|build|purchase|buy|discuss|review|finalize|prepare|send|share|schedule|update|fix|resolve|design|implement|test|deploy|launch)\b.+)/i,
      assigneeFrom: "speaker",
      phraseGroup: 1,
      requireActionVerb: false,
    },
    {
      regex: /\b([A-Z][a-z]+)\b,\s*(?:can|could|please)\s+(?:you|your team)\s+(.+)/i,
      assigneeFrom: 1,
      phraseGroup: 2,
      requireActionVerb: true,
    },
    {
      regex: /\bI\s*(?:'ll| will| am going to|’ll)\s+(.+)/i,
      assigneeFrom: "speaker",
      phraseGroup: 1,
      requireActionVerb: true,
    },
    {
      regex: /\bI\s+want\s+to\s+(.+)/i,
      assigneeFrom: "speaker",
      phraseGroup: 1,
      requireActionVerb: true,
    },
    {
      regex: /\bWe\s*(?:'ll| will| can| need to)\s+(.+)/i,
      assigneeFrom: "speaker",
      phraseGroup: 1,
      requireActionVerb: true,
    },
    {
      regex: /\bneed\s+([A-Za-z][A-Za-z\s]+?)\s+to\s+(.+)/i,
      assigneeFrom: 1,
      phraseGroup: 2,
      requireActionVerb: true,
    },
    {
      regex: /\bneed\s+(?:the\s+)?(.+?)\s+from\s+(.+?)(?:\s+by|\s+before|\s+after|$)/i,
      assigneeFrom: 2,
      phraseGroup: 1,
      requireActionVerb: false,
      titlePrefix: "Provide",
    },
    {
      regex: /\blet's\s+(.+)/i,
      assigneeFrom: "speaker",
      phraseGroup: 1,
      requireActionVerb: true,
    },
    {
      regex: /\btarget\s+(.+)/i,
      assigneeFrom: "speaker",
      phraseGroup: 1,
      requireActionVerb: true,
    },
    {
      regex: /\bcan\s+start\s+(.+)/i,
      assigneeFrom: "speaker",
      phraseGroup: 1,
      requireActionVerb: false,
      titlePrefix: "Start",
    },
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern.regex);
    if (!match) continue;
    if (isQuestion && pattern.assigneeFrom === "speaker" && pattern.phraseGroup === 1) {
      continue;
    }
    let phrase = match[pattern.phraseGroup]?.trim();
    if (!phrase) continue;
    if (pattern.requireActionVerb && !containsActionVerb(phrase)) continue;
    if (isGenericActionPhrase(phrase)) continue;
    if (pattern.titlePrefix) {
      phrase = `${pattern.titlePrefix} ${phrase}`.trim();
    }
    const title = normalizeTaskTitle(phrase);
    if (!title) continue;
    const assigneeRaw =
      pattern.assigneeFrom === "speaker"
        ? speaker
        : pattern.assigneeFrom !== undefined
          ? match[pattern.assigneeFrom]
          : undefined;
    const assigneeName = assigneeRaw ? normalizeAssigneeName(assigneeRaw) : undefined;
    return {
      title,
      assigneeName,
      description: cleanDescription(trimmed, title),
    };
  }

  return null;
};

const parseSpeakerLine = (line: string): TranscriptLine | null => {
  const trimmed = normalizeTranscriptLine(line);
  if (!trimmed) return null;
  const hadTimestamp = LEADING_TIMESTAMP_REGEX.test(trimmed);
  const withoutTimestamp = trimmed.replace(LEADING_TIMESTAMP_REGEX, "");
  const cleaned = withoutTimestamp.replace(/^(?:[-\u2013\u2014]\s*)/, "");
  const match = cleaned.match(SPEAKER_LINE_REGEX);
  if (match) {
    const name = match[1]?.trim();
    if (!name || !isValidPersonName(name)) return null;
    const meta = match[2];
    const text = (match[5] ?? "").trim();
    const { email, title } = meta ? splitMetaParts(meta) : {};
    return { speaker: name, email, title, text };
  }

  if (!hadTimestamp) return null;
  const speakerOnly = cleaned.match(SPEAKER_ONLY_REGEX);
  if (!speakerOnly) return null;
  const name = speakerOnly[1]?.trim();
  if (!name || !isValidPersonName(name)) return null;
  const meta = speakerOnly[2];
  const { email, title } = meta ? splitMetaParts(meta) : {};
  return { speaker: name, email, title, text: "" };
};

const extractLines = (transcript: string): TranscriptLine[] => {
  const lines = transcript
    .split(/\r?\n/)
    .map((line: any) => line.trim())
    .filter(Boolean);

  const output: TranscriptLine[] = [];
  let currentSpeaker: TranscriptLine | null = null;

  for (const line of lines) {
    const parsed = parseSpeakerLine(line);
    if (parsed) {
      currentSpeaker = parsed;
      output.push(currentSpeaker);
      continue;
    }

    if (currentSpeaker) {
      currentSpeaker.text = `${currentSpeaker.text} ${line}`.trim();
    } else {
      output.push({ text: line });
    }
  }

  return output;
};

export const extractTranscriptAttendees = (transcript: string): PersonSchemaType[] => {
  const attendees: PersonSchemaType[] = [];
  const seen = new Set<string>();
  for (const line of extractLines(transcript)) {
    if (!line.speaker) continue;
    if (!line.text || !line.text.trim()) continue;
    const key = line.speaker.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    attendees.push({
      name: line.speaker,
      email: line.email,
      title: line.title,
    });
  }
  return attendees;
};

export const extractTranscriptEmails = (transcript: string): string[] => {
  const emails = new Set<string>();
  const matches = transcript.match(EMAIL_REGEX) || [];
  matches.forEach((email: any) => emails.add(email.trim().toLowerCase()));
  return Array.from(emails);
};

const mentionPatterns: RegExp[] = [
  /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*,/g,
  /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:can|could|will|should|please|needs?)\b/g,
  /\b(?:ask|tell|ping|follow up with|sync with|reach out to)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g,
];

export const extractTranscriptMentionNames = (
  transcript: string,
  speakerNames: string[] = []
): string[] => {
  const mentioned = new Set<string>();
  const speakerSet = new Set(speakerNames.map((name: any) => normalizePersonNameKey(name)));
  const lines = extractLines(transcript);

  for (const line of lines) {
    const text = line.text;
    if (!text) continue;
    for (const pattern of mentionPatterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        const raw = match[1]?.trim();
        if (!raw) continue;
        const normalized = normalizePersonNameKey(raw);
        if (!normalized || speakerSet.has(normalized)) continue;
        if (!isValidPersonName(raw)) continue;
        mentioned.add(raw);
      }
    }
  }

  return Array.from(mentioned);
};

export const extractTranscriptTasks = (transcript: string): TaskType[] => {
  const tasks: TaskType[] = [];
  const seen = new Set<string>();
  const lines = extractLines(transcript);

  for (const line of lines) {
    if (!line.text) continue;
    const sentences = splitIntoSentences(line.text);
    for (const sentence of sentences) {
      const taskData = extractTaskFromSentence(sentence, line.speaker);
      if (!taskData) continue;
      const key = `${taskData.title}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      tasks.push({
        title: taskData.title,
        description: taskData.description,
        priority: "medium",
        assigneeName: taskData.assigneeName,
        sourceEvidence: [
          {
            speaker: line.speaker,
            snippet: sentence.trim(),
          },
        ],
      });
    }
  }

  return tasks;
};

const normalizeNameFromTask = (task: TaskType): string | undefined => {
  const assignee = task.assigneeName;
  if (!assignee) return undefined;
  const normalized = normalizeAssigneeName(assignee);
  return normalized;
};

const normalizeAssigneeMap = (tasks: TaskType[]): Map<string, string> => {
  const map = new Map<string, string>();
  const walk = (items: TaskType[]) => {
    items.forEach((task: any) => {
      const key = normalizeTitleKey(task.title);
      const assignee = normalizeNameFromTask(task);
      if (key && assignee && !map.has(key)) {
        map.set(key, assignee);
      }
      if (task.subtasks) {
        walk(task.subtasks);
      }
    });
  };
  walk(tasks);
  return map;
};

const speakerCommitmentRegex = /\b(I(?:'ll| will| am going to| can)|I'm on it|We(?:'ll| will| can))\b/i;

export const assignAssigneesFromTranscript = (
  tasks: TaskType[],
  transcript: string
): TaskType[] => {
  if (!tasks.length) return tasks;
  const transcriptTasks = extractTranscriptTasks(transcript);
  if (!transcriptTasks.length) return tasks;

  const assigneeMap = normalizeAssigneeMap(transcriptTasks);
  const assign = (items: TaskType[]): TaskType[] =>
    items.map((task: any) => {
      const key = normalizeTitleKey(task.title);
      const currentAssignee = normalizeNameFromTask(task);
      const fallbackAssignee = key ? assigneeMap.get(key) : undefined;
      let nextAssignee = currentAssignee || fallbackAssignee;
      if (!nextAssignee && task.sourceEvidence?.length) {
        const evidence = task.sourceEvidence[0];
        const speakerName = evidence.speaker ? normalizeAssigneeName(evidence.speaker) : undefined;
        if (speakerName && evidence.snippet && speakerCommitmentRegex.test(evidence.snippet)) {
          nextAssignee = speakerName;
        }
      }
      return {
        ...task,
        assigneeName: nextAssignee,
        subtasks: task.subtasks ? assign(task.subtasks) : task.subtasks,
      };
    });
  return assign(tasks);
};

export const sanitizeTaskAssignees = (
  tasks: TaskType[],
  validNames: Set<string>
): TaskType[] => {
  const hasValidNames = validNames.size > 0;
  const sanitize = (items: TaskType[]): TaskType[] =>
    items.map((task: any) => {
      const assignee = normalizeNameFromTask(task);
      const assigneeKey = assignee ? normalizePersonNameKey(assignee) : "";
      const validAssignee =
        assignee && (!hasValidNames || (assigneeKey && validNames.has(assigneeKey)))
          ? assignee
          : undefined;
      return {
        ...task,
        assigneeName: validAssignee,
        subtasks: task.subtasks ? sanitize(task.subtasks) : task.subtasks,
      };
    });
  return sanitize(tasks);
};

export const sanitizeTaskDescriptions = (tasks: TaskType[]): TaskType[] => {
  const sanitize = (items: TaskType[]): TaskType[] =>
    items.map((task: any) => ({
      ...task,
      description: task.description ? cleanDescription(task.description, task.title) : task.description,
      subtasks: task.subtasks ? sanitize(task.subtasks) : task.subtasks,
    }));
  return sanitize(tasks);
};

export const attachEvidenceToTasks = (
  tasks: TaskType[],
  transcript: string
): TaskType[] => {
  const lines = extractLines(transcript);
  if (!lines.length) return tasks;

  const attachToTask = (task: TaskType): TaskType => {
    const nextSubtasks = task.subtasks ? task.subtasks.map(attachToTask) : task.subtasks;
    if (task.sourceEvidence && task.sourceEvidence.length > 0) {
      return {
        ...task,
        subtasks: nextSubtasks,
      };
    }
    const title = task.title || "";
    const keywords = title
      .split(/\s+/)
      .map((word: any) => word.replace(/[^a-zA-Z]/g, "").toLowerCase())
      .filter((word: any) => word.length > 2 && !STOP_WORDS.has(word));

    if (!keywords.length) {
      return {
        ...task,
        subtasks: nextSubtasks,
      };
    }

    const matched = lines.find((line: any) => {
      const text = line.text.toLowerCase();
      return keywords.some((keyword: any) => text.includes(keyword));
    });

    if (!matched) {
      return {
        ...task,
        subtasks: nextSubtasks,
      };
    }

    return {
      ...task,
      subtasks: nextSubtasks,
      sourceEvidence: [
        {
          speaker: matched.speaker,
          snippet: matched.text,
        },
      ],
    };
  };

  return tasks.map(attachToTask);
};

