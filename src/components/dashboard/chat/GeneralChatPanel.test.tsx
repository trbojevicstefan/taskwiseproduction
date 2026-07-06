import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import GeneralChatPanel, {
  GENERAL_CHAT_SUGGESTED_PROMPTS,
  buildChatHistoryPayload,
  normalizeGeneralChatAnswer,
  panelMessagesToStoredMessages,
  resolveSourceHref,
  storedMessagesToPanelMessages,
  type PanelMessage,
  type StoredChatMessage,
} from "@/components/dashboard/chat/GeneralChatPanel";

jest.mock("next/navigation", () => ({
  useRouter: jest.fn(() => ({ push: jest.fn() })),
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...props }: any) =>
    React.createElement("a", { href, ...props }, children),
}));

jest.mock("@/components/ui/logo", () => ({
  Logo: () => React.createElement("span", null, "logo"),
}));

jest.mock("@/lib/api", () => ({
  apiFetch: jest.fn(),
}));

describe("GeneralChatPanel", () => {
  it("renders the hero state with the five suggested prompts", () => {
    const markup = renderToStaticMarkup(<GeneralChatPanel />);

    expect(markup).toContain("Ask anything about your meetings.");
    expect(GENERAL_CHAT_SUGGESTED_PROMPTS).toHaveLength(5);
    for (const item of GENERAL_CHAT_SUGGESTED_PROMPTS) {
      expect(markup).toContain(
        item.prompt.replace(/'/g, "&#x27;").replace(/"/g, "&quot;")
      );
    }
    expect(markup).toContain("Which tasks are overdue?");
  });
});

describe("resolveSourceHref", () => {
  const base = { title: "T", snippet: "S" } as const;

  it("links meeting and transcript sources to the meeting page", () => {
    expect(
      resolveSourceHref({ ...base, sourceType: "meeting", sourceId: "m1" })
    ).toBe("/meetings/m1");
    expect(
      resolveSourceHref({ ...base, sourceType: "transcript", sourceId: "m2" })
    ).toBe("/meetings/m2");
  });

  it("links person and client sources to the people page", () => {
    expect(
      resolveSourceHref({ ...base, sourceType: "person", sourceId: "p1" })
    ).toBe("/people/p1");
    expect(
      resolveSourceHref({ ...base, sourceType: "client", sourceId: "c1" })
    ).toBe("/people/c1");
  });

  it("links task sources to their source meeting when available, else review", () => {
    expect(
      resolveSourceHref({
        ...base,
        sourceType: "task",
        sourceId: "t1",
        sourceSessionId: "m3",
      })
    ).toBe("/meetings/m3");
    expect(
      resolveSourceHref({ ...base, sourceType: "task", sourceId: "t1" })
    ).toBe("/review");
  });

  it("returns null for meeting sources without an id", () => {
    expect(
      resolveSourceHref({ ...base, sourceType: "meeting", sourceId: "" })
    ).toBeNull();
  });
});

describe("normalizeGeneralChatAnswer", () => {
  it("passes through a well-formed contract payload", () => {
    const answer = normalizeGeneralChatAnswer({
      answer: "Grounded answer.",
      confidence: "high",
      sources: [
        {
          sourceType: "meeting",
          sourceId: "m1",
          title: "Kickoff",
          snippet: "We agreed on scope.",
          timestamp: "00:12:03",
        },
      ],
      suggestedActions: [
        { label: "Open meeting", actionType: "open_meeting", targetId: "m1" },
      ],
    });

    expect(answer.answer).toBe("Grounded answer.");
    expect(answer.confidence).toBe("high");
    expect(answer.sources).toHaveLength(1);
    expect(answer.sources[0].timestamp).toBe("00:12:03");
    expect(answer.suggestedActions).toEqual([
      { label: "Open meeting", actionType: "open_meeting", targetId: "m1" },
    ]);
  });

  it("drops malformed sources and actions and defaults confidence to low", () => {
    const answer = normalizeGeneralChatAnswer({
      answer: "ok",
      confidence: "certain",
      sources: [
        null,
        { sourceType: "webpage", sourceId: "x", title: "bad type" },
        { sourceType: "task", title: "missing id" },
        { sourceType: "task", sourceId: "t1", title: "good" },
      ],
      suggestedActions: [
        { actionType: "open_task" },
        { label: "bad type", actionType: "explode" },
        { label: "ok", actionType: "none" },
      ],
    });

    expect(answer.confidence).toBe("low");
    expect(answer.sources).toHaveLength(1);
    expect(answer.sources[0].sourceId).toBe("t1");
    expect(answer.suggestedActions).toEqual([
      { label: "ok", actionType: "none", targetId: undefined },
    ]);
  });

  it("provides a fallback answer for empty or non-object payloads", () => {
    expect(normalizeGeneralChatAnswer(undefined).answer).toContain(
      "could not generate an answer"
    );
    expect(normalizeGeneralChatAnswer(undefined).sources).toEqual([]);
    expect(normalizeGeneralChatAnswer({ answer: "   " }).confidence).toBe("low");
  });
});

describe("stored <-> panel message mapping", () => {
  const answer = {
    answer: "Grounded answer.",
    confidence: "high" as const,
    sources: [
      {
        sourceType: "transcript" as const,
        sourceId: "m1",
        title: "Kickoff",
        snippet: "We agreed on scope.",
        timestamp: "12:30",
      },
    ],
    suggestedActions: [],
  };

  it("round-trips unified messages including the structured answer", () => {
    const panelMessages: PanelMessage[] = [
      { id: "u1", role: "user", text: "What was decided?", at: 1000 },
      { id: "a1", role: "assistant", answer, at: 2000 },
      { id: "e1", role: "error", text: "boom", question: "retry me", at: 3000 },
    ];

    const stored = panelMessagesToStoredMessages(panelMessages, {
      userName: "Vlad",
      userAvatar: "avatar.png",
    });

    // Errors are transient and never persisted.
    expect(stored).toHaveLength(2);
    expect(stored[0]).toMatchObject({
      id: "u1",
      sender: "user",
      text: "What was decided?",
      timestamp: 1000,
      name: "Vlad",
    });
    expect(stored[1]).toMatchObject({
      id: "a1",
      sender: "ai",
      text: "Grounded answer.",
      timestamp: 2000,
    });
    expect((stored[1] as StoredChatMessage).chatAnswer).toEqual(answer);
    // Legacy transcript-source shape is kept for old renderers.
    expect(stored[1].sources).toEqual([
      { timestamp: "12:30", snippet: "We agreed on scope." },
    ]);

    const restored = storedMessagesToPanelMessages(stored, "m1");
    expect(restored).toHaveLength(2);
    expect(restored[0]).toMatchObject({ id: "u1", role: "user" });
    expect(restored[1]).toMatchObject({ id: "a1", role: "assistant" });
    expect(
      (restored[1] as Extract<PanelMessage, { role: "assistant" }>).answer
    ).toEqual(answer);
  });

  it("restores legacy AI messages as low-key assistant bubbles attributed to the source meeting", () => {
    const stored: StoredChatMessage[] = [
      { id: "typing", text: "", sender: "ai", timestamp: 1, name: "TaskWise AI" },
      {
        id: "legacy-user",
        text: "Who attended?",
        sender: "user",
        timestamp: 2,
      },
      {
        id: "legacy-ai",
        text: "Stefan and Ana attended.",
        sender: "ai",
        timestamp: 3,
        sources: [{ timestamp: "01:00", snippet: "Stefan: hello" }],
      },
    ];
    // The typing indicator uses this reserved id in the legacy store.
    stored[0].id = "ai-typing-indicator";

    const restored = storedMessagesToPanelMessages(stored, "meeting-9");
    expect(restored).toHaveLength(2);
    const assistant = restored[1] as Extract<
      PanelMessage,
      { role: "assistant" }
    >;
    expect(assistant.legacy).toBe(true);
    expect(assistant.answer.answer).toBe("Stefan and Ana attended.");
    expect(assistant.answer.sources[0]).toMatchObject({
      sourceType: "transcript",
      sourceId: "meeting-9",
      snippet: "Stefan: hello",
      timestamp: "01:00",
    });
  });

  it("handles missing input safely", () => {
    expect(storedMessagesToPanelMessages(undefined)).toEqual([]);
    expect(storedMessagesToPanelMessages(null)).toEqual([]);
  });
});

describe("buildChatHistoryPayload", () => {
  it("maps prior turns, drops errors, and caps the list", () => {
    const messages: PanelMessage[] = [];
    for (let index = 0; index < 10; index += 1) {
      messages.push({ id: `u${index}`, role: "user", text: `q${index}` });
      messages.push({
        id: `a${index}`,
        role: "assistant",
        answer: {
          answer: `a${index}`,
          confidence: "high",
          sources: [],
          suggestedActions: [],
        },
      });
    }
    messages.push({ id: "err", role: "error", text: "boom", question: "q" });

    const history = buildChatHistoryPayload(messages);
    expect(history).toHaveLength(12);
    expect(history[0]).toEqual({ role: "user", text: "q4" });
    expect(history[history.length - 1]).toEqual({
      role: "assistant",
      text: "a9",
    });
    expect(history.every((entry) => entry.text.length <= 2000)).toBe(true);
  });
});
