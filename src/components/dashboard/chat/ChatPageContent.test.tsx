import {
  buildActiveChatRequest,
  createChatMessageId,
  resolveChatPanelContext,
} from "@/components/dashboard/chat/ChatPageContent";

describe("createChatMessageId", () => {
  it("returns a unique id even when called within the same millisecond", () => {
    const originalNow = Date.now;
    Date.now = jest.fn(() => 1710000000000);

    try {
      const first = createChatMessageId("msg");
      const second = createChatMessageId("msg");

      expect(first).not.toBe(second);
      expect(first).toMatch(/^msg-/);
      expect(second).toMatch(/^msg-/);
    } finally {
      Date.now = originalNow;
    }
  });
});

describe("buildActiveChatRequest", () => {
  it("uses the persisted meeting scope and preserves selected task ids", () => {
    expect(
      buildActiveChatRequest({
        question: "Mark the selected task done",
        session: {
          id: "session-1",
          sourceMeetingId: "meeting-1",
          messages: [
            { id: "u1", sender: "user", text: "What is open?", timestamp: 1 },
            {
              id: "a1",
              sender: "ai",
              text: "One task is open.",
              timestamp: 2,
            },
          ],
        },
        selectedTaskIds: new Set(["task-source-1"]),
      })
    ).toEqual({
      question: "Mark the selected task done",
      sessionId: "session-1",
      scope: { type: "meeting", meetingId: "meeting-1" },
      selectedTaskIds: ["task-source-1"],
      history: [
        { role: "user", text: "What is open?" },
        { role: "assistant", text: "One task is open." },
      ],
    });
  });

  it("keeps the persisted entity scope when client-side meeting linkage disagrees", () => {
    const clientState = {
      question: "What are we waiting on?",
      session: {
        id: "session-client",
        sourceMeetingId: null,
        scope: { type: "client", clientId: "client-1" } as const,
        messages: [],
      },
      linkedMeetingId: "meeting-from-client-state",
      selectedTaskIds: new Set<string>(),
    } satisfies Parameters<typeof buildActiveChatRequest>[0] & {
      linkedMeetingId: string;
    };

    expect(buildActiveChatRequest(clientState)).toEqual({
      question: "What are we waiting on?",
      sessionId: "session-client",
      scope: { type: "client", clientId: "client-1" },
    });
  });

  it("filters typing indicators and keeps each persisted turn once", () => {
    const payload = buildActiveChatRequest({
      question: "Follow up",
      session: {
        id: "session-1",
        messages: [
          { id: "u1", sender: "user", text: "Earlier", timestamp: 1 },
          { id: "ai-typing-indicator", sender: "ai", text: "", timestamp: 2 },
        ],
      },
      selectedTaskIds: new Set(),
    });

    expect(payload.history).toEqual([{ role: "user", text: "Earlier" }]);
  });
});

describe("resolveChatPanelContext", () => {
  it("reopens sessions with sourceMeetingId in meeting mode (reload keeps meeting context)", () => {
    expect(resolveChatPanelContext({ sourceMeetingId: "m1" })).toEqual({
      mode: "meeting",
      meetingId: "m1",
    });
  });

  it("uses the linked meeting fallback when the session has no sourceMeetingId yet", () => {
    expect(resolveChatPanelContext({ sourceMeetingId: null }, "m2")).toEqual({
      mode: "meeting",
      meetingId: "m2",
    });
  });

  it("keeps the persisted meeting scope when a different linked fallback exists", () => {
    expect(
      resolveChatPanelContext({ sourceMeetingId: "persisted-meeting" }, "fallback-meeting")
    ).toEqual({
      mode: "meeting",
      meetingId: "persisted-meeting",
    });
  });

  it("defaults to workspace mode without any meeting linkage", () => {
    expect(resolveChatPanelContext(undefined)).toEqual({ mode: "workspace" });
    expect(resolveChatPanelContext({ sourceMeetingId: null }, null)).toEqual({
      mode: "workspace",
    });
  });

  it("treats whitespace meeting ids as absent and uses a normalized fallback", () => {
    expect(resolveChatPanelContext({ sourceMeetingId: "   " })).toEqual({
      mode: "workspace",
    });
    expect(
      resolveChatPanelContext({ sourceMeetingId: "   " }, " linked-meeting ")
    ).toEqual({
      mode: "meeting",
      meetingId: "linked-meeting",
    });
  });
});
