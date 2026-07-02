import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import GeneralChatPanel, {
  GENERAL_CHAT_SUGGESTED_PROMPTS,
  normalizeGeneralChatAnswer,
  resolveSourceHref,
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
