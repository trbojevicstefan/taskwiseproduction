import type { Db } from "mongodb";
import { ApiRouteError } from "@/lib/api-route";
import { buildChatSessionVisibilityFilter } from "@/lib/chat-scope";
import type {
  ChatHistoryEntry,
  GeneralChatSource,
} from "@/types/general-chat";

export const CHAT_MEMORY_RECENT_TURNS = 12;
export const CHAT_MEMORY_SUMMARY_MAX_CHARS = 6_000;

type StoredChatMessage = {
  id?: unknown;
  sender?: unknown;
  text?: unknown;
  chatAnswer?: {
    sources?: unknown;
  } | null;
  sources?: unknown;
};

type DurableEntry = ChatHistoryEntry & { id: string };

const parseGeneralChatSource = (value: unknown): GeneralChatSource | null => {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const sourceType = String(source.sourceType);
  if (
    !["meeting", "transcript", "task", "person", "client"].includes(
      sourceType
    ) ||
    typeof source.sourceId !== "string" ||
    !source.sourceId.trim() ||
    typeof source.title !== "string" ||
    !source.title.trim() ||
    typeof source.snippet !== "string" ||
    !source.snippet.trim()
  ) {
    return null;
  }
  return {
    sourceType: sourceType as GeneralChatSource["sourceType"],
    sourceId: source.sourceId,
    title: source.title,
    snippet: source.snippet,
    ...(typeof source.timestamp === "string"
      ? { timestamp: source.timestamp }
      : {}),
  };
};

const toDurableEntry = (
  message: StoredChatMessage,
  sourceMeetingId?: string | null
): DurableEntry | null => {
  const id = typeof message.id === "string" ? message.id : "";
  if (!id || id === "ai-typing-indicator") return null;
  if (message.sender !== "user" && message.sender !== "ai") return null;
  const text = typeof message.text === "string" ? message.text : "";
  if (!text.trim()) return null;

  let sources: GeneralChatSource[] = Array.isArray(message.chatAnswer?.sources)
    ? message.chatAnswer.sources
        .map(parseGeneralChatSource)
        .filter((source): source is GeneralChatSource => Boolean(source))
    : [];
  if (!sources.length && sourceMeetingId && Array.isArray(message.sources)) {
    sources = message.sources
      .filter(
        (source): source is { snippet: string; timestamp?: string } =>
          Boolean(source) &&
          typeof source === "object" &&
          typeof (source as Record<string, unknown>).snippet === "string" &&
          Boolean(
            ((source as Record<string, unknown>).snippet as string).trim()
          )
      )
      .map((source) => ({
        sourceType: "transcript" as const,
        sourceId: sourceMeetingId,
        title: "Transcript",
        snippet: source.snippet,
        ...(typeof source.timestamp === "string" && source.timestamp !== "N/A"
          ? { timestamp: source.timestamp }
          : {}),
      }));
  }
  return {
    id,
    role: message.sender === "user" ? "user" : "assistant",
    text,
    ...(sources.length ? { sources } : {}),
  };
};

const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();

const renderGroundedSummaryEntry = (
  entry: DurableEntry,
  precedingUser?: DurableEntry
) => {
  const lines: string[] = [];
  if (precedingUser?.role === "user") {
    lines.push(`User: ${oneLine(precedingUser.text).slice(0, 500)}`);
  }
  lines.push(`Assistant: ${oneLine(entry.text).slice(0, 1_000)}`);
  lines.push(
    `Sources: ${(entry.sources ?? [])
      .map(
        (source) =>
          `[${source.sourceType}:${source.sourceId}] ${oneLine(
            source.title
          ).slice(0, 200)} — ${oneLine(source.snippet).slice(0, 600)}`
      )
      .join("; ")}`
  );
  return lines.join("\n");
};

const appendBoundedSummary = (
  existingSummary: string | null,
  additions: string[]
) => {
  const combined = [existingSummary?.trim(), ...additions]
    .filter((value): value is string => Boolean(value))
    .join("\n\n");
  if (!combined) return null;
  return combined.slice(-CHAT_MEMORY_SUMMARY_MAX_CHARS);
};

export async function loadDurableChatMemory(params: {
  db: Db;
  userId: string;
  workspaceId: string;
  sessionId: string;
  memberUserIds?: string[];
}): Promise<{ recentHistory: ChatHistoryEntry[]; summary: string | null }> {
  const visibilityFilter = buildChatSessionVisibilityFilter({
    workspaceId: params.workspaceId,
    userId: params.userId,
    memberUserIds: params.memberUserIds,
  });
  const sessionFilter = {
    $and: [
      { $or: [{ _id: params.sessionId }, { id: params.sessionId }] },
      visibilityFilter,
    ],
  };
  const collection = params.db.collection("chatSessions");
  const session = await collection.findOne(sessionFilter as any);
  if (!session) {
    throw new ApiRouteError(
      404,
      "chat_session_not_found",
      "Chat session was not found."
    );
  }

  const entries = (Array.isArray(session.messages) ? session.messages : [])
    .map((message) =>
      toDurableEntry(message as StoredChatMessage, session.sourceMeetingId)
    )
    .filter((entry): entry is DurableEntry => Boolean(entry));
  const recentEntries = entries.slice(-CHAT_MEMORY_RECENT_TURNS);
  const olderEntries = entries.slice(0, -CHAT_MEMORY_RECENT_TURNS);
  const rawExistingSummary =
    typeof session.memorySummary === "string" && session.memorySummary.trim()
      ? session.memorySummary.trim()
      : null;
  const existingSummary = rawExistingSummary
    ? rawExistingSummary.slice(-CHAT_MEMORY_SUMMARY_MAX_CHARS)
    : null;
  const existingSummaryWasCapped =
    Boolean(rawExistingSummary) && rawExistingSummary !== existingSummary;
  const previousMarker =
    typeof session.memorySummarizedThroughMessageId === "string"
      ? session.memorySummarizedThroughMessageId
      : null;
  const markerIndex = previousMarker
    ? olderEntries.findIndex((entry) => entry.id === previousMarker)
    : -1;
  const unsummarizedEntries = olderEntries.slice(markerIndex + 1);
  const additions: string[] = [];
  for (let index = 0; index < unsummarizedEntries.length; index += 1) {
    const entry = unsummarizedEntries[index];
    if (entry.role !== "assistant" || !entry.sources?.length) continue;
    const absoluteIndex = olderEntries.findIndex(
      (candidate) => candidate.id === entry.id
    );
    const precedingUser =
      absoluteIndex > 0 && olderEntries[absoluteIndex - 1].role === "user"
        ? olderEntries[absoluteIndex - 1]
        : undefined;
    additions.push(renderGroundedSummaryEntry(entry, precedingUser));
  }

  let summary = existingSummary;
  if (additions.length > 0) {
    summary = appendBoundedSummary(existingSummary, additions);
    await collection.updateOne(sessionFilter as any, {
      $set: {
        memorySummary: summary,
        memorySummarizedThroughMessageId:
          olderEntries[olderEntries.length - 1]?.id ?? null,
        memoryUpdatedAt: new Date(),
      },
    });
  } else if (existingSummaryWasCapped) {
    summary = existingSummary;
    await collection.updateOne(sessionFilter as any, {
      $set: {
        memorySummary: summary,
        memoryUpdatedAt: new Date(),
      },
    });
  }

  return {
    recentHistory: recentEntries.map((entry) => ({
      role: entry.role,
      text: entry.text,
      ...(entry.sources?.length ? { sources: entry.sources } : {}),
    })),
    summary,
  };
}
