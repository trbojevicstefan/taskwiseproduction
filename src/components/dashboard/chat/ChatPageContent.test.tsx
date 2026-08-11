import {
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
