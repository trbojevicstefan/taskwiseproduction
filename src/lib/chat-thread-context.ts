import type { GeneralChatSource } from "@/types/general-chat";

export type ThreadHistoryEntry = {
  role: "user" | "assistant";
  text: string;
  sources?: GeneralChatSource[];
};

type ThreadEntityType = "meeting" | "person" | "client" | "task";

type ThreadMeeting = {
  meetingId: string;
  title: string;
};

type ThreadEntity = {
  entityId: string;
  name: string;
  entityType: ThreadEntityType;
};

export type ChatThreadContext = {
  meetings: ThreadMeeting[];
  entities: ThreadEntity[];
};

export type ThreadFollowUpResolution =
  | { kind: "none" }
  | { kind: "meeting"; meetingId: string }
  | {
      kind: "retrieval_enrichment";
      entityId: string;
      entityType: Exclude<ThreadEntityType, "meeting">;
      enrichedQuestion: string;
    }
  | { kind: "ambiguous"; entityType: ThreadEntityType };

const ORDINAL_HINTS: Array<{ pattern: RegExp; index: number }> = [
  { pattern: /\bfirst\b/i, index: 0 },
  { pattern: /\bsecond\b/i, index: 1 },
  { pattern: /\bthird\b/i, index: 2 },
];

const isMeetingReference = (question: string) =>
  /\bmeeting\b|\bwho attended\b|\bwho said that\b|\bwho said it\b|\battended\b|\bfirst one\b|\bsecond one\b|\bthird one\b|\blast one\b|\bit\b/i.test(
    question
  );

const isPersonReference = (question: string) =>
  /\bhe\b|\bhim\b|\bhis\b|\bthat person\b|\bthat client\b|\bwhat tasks does\b|\bwhat else did\b/i.test(
    question
  );

const normalizeSources = (sources: GeneralChatSource[] | undefined) =>
  Array.isArray(sources) ? sources.filter(Boolean) : [];

export function buildThreadContext(
  history: ThreadHistoryEntry[] | undefined
): ChatThreadContext {
  const meetings: ThreadMeeting[] = [];
  const entities: ThreadEntity[] = [];

  for (const entry of history ?? []) {
    if (entry.role !== "assistant") continue;
    for (const source of normalizeSources(entry.sources)) {
      if (source.sourceType === "meeting" || source.sourceType === "transcript") {
        if (!meetings.some((meeting) => meeting.meetingId === source.sourceId)) {
          meetings.push({
            meetingId: source.sourceId,
            title: source.title,
          });
        }
        continue;
      }

      if (
        source.sourceType === "person" ||
        source.sourceType === "client" ||
        source.sourceType === "task"
      ) {
        if (!entities.some((entity) => entity.entityId === source.sourceId)) {
          entities.push({
            entityId: source.sourceId,
            name: source.title,
            entityType: source.sourceType,
          });
        }
      }
    }
  }

  return { meetings, entities };
}

export function resolveThreadFollowUp(
  question: string,
  context: ChatThreadContext
): ThreadFollowUpResolution {
  const trimmed = question.trim();

  for (const hint of ORDINAL_HINTS) {
    if (hint.pattern.test(trimmed) && context.meetings[hint.index]) {
      return { kind: "meeting", meetingId: context.meetings[hint.index].meetingId };
    }
  }

  if (/\blast\b/i.test(trimmed) && context.meetings.length > 0) {
    return {
      kind: "meeting",
      meetingId: context.meetings[context.meetings.length - 1].meetingId,
    };
  }

  if (isMeetingReference(trimmed)) {
    if (context.meetings.length === 1) {
      return { kind: "meeting", meetingId: context.meetings[0].meetingId };
    }
    if (context.meetings.length > 1) {
      return { kind: "ambiguous", entityType: "meeting" };
    }
  }

  if (isPersonReference(trimmed)) {
    const lastEntity = [...context.entities]
      .reverse()
      .find((entity) => entity.entityType === "person" || entity.entityType === "client");
    if (lastEntity) {
      return {
        kind: "retrieval_enrichment",
        entityId: lastEntity.entityId,
        entityType: lastEntity.entityType as "person" | "client",
        enrichedQuestion: `${trimmed}\n\nResolved thread context: ${lastEntity.name}`,
      };
    }
  }

  return { kind: "none" };
}
