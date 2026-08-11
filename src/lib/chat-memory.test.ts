import {
  CHAT_MEMORY_RECENT_TURNS,
  CHAT_MEMORY_SUMMARY_MAX_CHARS,
  loadDurableChatMemory,
} from "@/lib/chat-memory";

type StoredMessage = {
  id: string;
  sender: "user" | "ai";
  text: string;
  chatAnswer?: {
    answer: string;
    confidence: "low" | "medium" | "high";
    sources: Array<{
      sourceType: "meeting";
      sourceId: string;
      title: string;
      snippet: string;
      timestamp?: unknown;
    }>;
    suggestedActions: [];
  };
  sources?: Array<{ timestamp: string; snippet: string }>;
};

const userMessage = (id: string, text: string): StoredMessage => ({
  id,
  sender: "user",
  text,
});

const assistantMessage = (
  id: string,
  text: string,
  grounded = false
): StoredMessage => ({
  id,
  sender: "ai",
  text,
  ...(grounded
    ? {
        chatAnswer: {
          answer: text,
          confidence: "high" as const,
          sources: [
            {
              sourceType: "meeting" as const,
              sourceId: `source-${id}`,
              title: `Meeting ${id}`,
              snippet: `Grounded evidence for ${id}`,
            },
          ],
          suggestedActions: [] as [],
        },
      }
    : {}),
});

const createDb = (session: Record<string, unknown> | null) => {
  const findOne = jest.fn().mockResolvedValue(session);
  const updateOne = jest.fn().mockResolvedValue({ matchedCount: 1 });
  const db = {
    collection: jest.fn((name: string) => {
      expect(name).toBe("chatSessions");
      return { findOne, updateOne };
    }),
  } as any;
  return { db, findOne, updateOne };
};

describe("loadDurableChatMemory", () => {
  const params = {
    userId: "user-1",
    workspaceId: "workspace-1",
    sessionId: "session-1",
    memberUserIds: ["user-1", "user-2"],
  };

  it("ignores typing indicators and empty messages while retaining the latest 12 real turns verbatim", async () => {
    const realMessages = Array.from({ length: 14 }, (_, index) =>
      index % 2 === 0
        ? userMessage(`message-${index}`, ` user turn ${index} `)
        : assistantMessage(`message-${index}`, `assistant turn ${index}`)
    );
    const { db } = createDb({
      _id: "session-1",
      messages: [
        userMessage("ai-typing-indicator", "Thinking"),
        userMessage("empty-user", "   "),
        assistantMessage("empty-ai", ""),
        ...realMessages,
      ],
    });

    const result = await loadDurableChatMemory({ ...params, db });

    expect(result.recentHistory).toHaveLength(CHAT_MEMORY_RECENT_TURNS);
    expect(result.recentHistory[0]).toEqual({
      role: "user",
      text: " user turn 2 ",
    });
    expect(result.recentHistory.at(-1)).toEqual({
      role: "assistant",
      text: "assistant turn 13",
    });
  });

  it("omits a non-string optional source timestamp from durable history", async () => {
    const message = assistantMessage("grounded", "Grounded answer", true);
    message.chatAnswer!.sources[0].timestamp = 12345;
    const { db } = createDb({ _id: "session-1", messages: [message] });

    const result = await loadDurableChatMemory({ ...params, db });

    expect(result.recentHistory[0].sources?.[0]).toEqual({
      sourceType: "meeting",
      sourceId: "source-grounded",
      title: "Meeting grounded",
      snippet: "Grounded evidence for grounded",
    });
  });

  it("summarizes older grounded sources within the cap and persists metadata without overwriting messages", async () => {
    const oldGrounded = assistantMessage(
      "grounded-old",
      `A grounded answer ${"x".repeat(CHAT_MEMORY_SUMMARY_MAX_CHARS * 2)}`,
      true
    );
    const recent = Array.from({ length: CHAT_MEMORY_RECENT_TURNS }, (_, index) =>
      index % 2 === 0
        ? userMessage(`recent-${index}`, `question ${index}`)
        : assistantMessage(`recent-${index}`, `answer ${index}`)
    );
    const { db, updateOne } = createDb({
      _id: "session-1",
      messages: [
        userMessage("old-question", "What was decided?"),
        oldGrounded,
        ...recent,
      ],
    });

    const result = await loadDurableChatMemory({ ...params, db });

    expect(result.summary).toContain("Meeting grounded-old");
    expect(result.summary).toContain("Grounded evidence for grounded-old");
    expect(result.summary!.length).toBeLessThanOrEqual(
      CHAT_MEMORY_SUMMARY_MAX_CHARS
    );
    expect(updateOne).toHaveBeenCalledWith(
      expect.any(Object),
      {
        $set: {
          memorySummary: result.summary,
          memorySummarizedThroughMessageId: "grounded-old",
          memoryUpdatedAt: expect.any(Date),
        },
      }
    );
    const update = updateOne.mock.calls[0][1];
    expect(update.$set.messages).toBeUndefined();
  });

  it("summarizes legacy transcript sources when the session is meeting-linked", async () => {
    const legacyGrounded: StoredMessage = {
      id: "legacy-answer",
      sender: "ai",
      text: "The legacy answer",
      sources: [{ timestamp: "01:20", snippet: "Legacy transcript evidence" }],
    };
    const recent = Array.from({ length: CHAT_MEMORY_RECENT_TURNS }, (_, index) =>
      userMessage(`recent-${index}`, `recent ${index}`)
    );
    const { db } = createDb({
      _id: "session-1",
      sourceMeetingId: "meeting-legacy",
      messages: [legacyGrounded, ...recent],
    });

    const result = await loadDurableChatMemory({ ...params, db });

    expect(result.summary).toContain("[transcript:meeting-legacy]");
    expect(result.summary).toContain("Legacy transcript evidence");
  });

  it("rolls new grounded evidence into an existing persisted summary", async () => {
    const recent = Array.from({ length: CHAT_MEMORY_RECENT_TURNS }, (_, index) =>
      userMessage(`recent-${index}`, `recent ${index}`)
    );
    const { db } = createDb({
      _id: "session-1",
      memorySummary: "Earlier grounded context",
      memorySummarizedThroughMessageId: "already-summarized",
      messages: [
        assistantMessage("already-summarized", "old", true),
        assistantMessage("new-grounded", "new facts", true),
        ...recent,
      ],
    });

    const result = await loadDurableChatMemory({ ...params, db });

    expect(result.summary).toContain("Earlier grounded context");
    expect(result.summary).toContain("Meeting new-grounded");
    expect(result.summary).not.toContain("Meeting already-summarized");
  });

  it("caps and persists an oversized existing summary even without new grounded turns", async () => {
    const { db, updateOne } = createDb({
      _id: "session-1",
      memorySummary: `old-${"x".repeat(CHAT_MEMORY_SUMMARY_MAX_CHARS * 2)}`,
      memorySummarizedThroughMessageId: "old-message",
      messages: [],
    });

    const result = await loadDurableChatMemory({ ...params, db });

    expect(result.summary).toHaveLength(CHAT_MEMORY_SUMMARY_MAX_CHARS);
    expect(updateOne).toHaveBeenCalledWith(expect.any(Object), {
      $set: {
        memorySummary: result.summary,
        memoryUpdatedAt: expect.any(Date),
      },
    });
  });

  it("loads only a session visible through the active workspace member contract", async () => {
    const { db, findOne } = createDb({
      _id: "session-1",
      workspaceId: "workspace-1",
      userId: "user-2",
      messages: [userMessage("member-message", "Visible teammate context")],
    });

    const result = await loadDurableChatMemory({ ...params, db });

    expect(findOne).toHaveBeenCalledWith({
      $and: [
        { $or: [{ _id: "session-1" }, { id: "session-1" }] },
        {
          $or: [
            { workspaceId: "workspace-1" },
            {
              workspaceId: { $exists: false },
              userId: { $in: ["user-1", "user-2"] },
            },
          ],
        },
      ],
    });
    expect(result.recentHistory).toEqual([
      { role: "user", text: "Visible teammate context" },
    ]);
  });

  it("rejects a missing, outsider-owned legacy, or cross-workspace session", async () => {
    const { db } = createDb(null);

    await expect(loadDurableChatMemory({ ...params, db })).rejects.toMatchObject({
      status: 404,
      code: "chat_session_not_found",
    });
  });
});
