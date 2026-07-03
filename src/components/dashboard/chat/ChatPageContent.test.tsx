import { createChatMessageId } from "@/components/dashboard/chat/ChatPageContent";

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
