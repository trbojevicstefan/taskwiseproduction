import {
  assertChatScopeAccess,
  resolveSessionChatScope,
} from "@/lib/chat-scope";

describe("chat scope", () => {
  const base = {
    userId: "user-1",
    workspaceId: "workspace-1",
    memberUserIds: ["user-1", "user-2"],
  };

  it("rejects invalid entity scopes before querying MongoDB", async () => {
    const collection = jest.fn();

    await expect(
      assertChatScopeAccess({
        ...base,
        db: { collection } as any,
        scope: { type: "meeting", meetingId: "" },
      })
    ).rejects.toMatchObject({
      status: 400,
      code: "invalid_chat_scope",
    });
    expect(collection).not.toHaveBeenCalled();
  });

  it.each([
    ["meeting", { type: "meeting", meetingId: "meeting-other" }, "meetings"],
    ["client", { type: "client", clientId: "client-other" }, "companies"],
    ["person", { type: "person", personId: "person-other" }, "people"],
  ] as const)(
    "rejects a cross-workspace %s scope",
    async (_label, scope, collectionName) => {
      const findOne = jest.fn().mockResolvedValue(null);
      const db = {
        collection: jest.fn((name: string) => {
          expect(name).toBe(collectionName);
          return { findOne };
        }),
      } as any;

      await expect(
        assertChatScopeAccess({ ...base, db, scope })
      ).rejects.toMatchObject({
        status: 404,
        code: "chat_scope_not_found",
      });
    }
  );

  it("validates a legacy meeting through authorized workspace member visibility", async () => {
    const findOne = jest.fn().mockResolvedValue({ _id: "meeting-1" });
    const db = {
      collection: jest.fn(() => ({ findOne })),
    } as any;

    await expect(
      assertChatScopeAccess({
        ...base,
        db,
        scope: { type: "meeting", meetingId: "meeting-1" },
      })
    ).resolves.toEqual({ type: "meeting", meetingId: "meeting-1" });
    expect(findOne).toHaveBeenCalledWith({
      $and: [
        { $or: [{ _id: "meeting-1" }, { id: "meeting-1" }] },
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
  });

  it("makes a meeting-linked session meeting-scoped", () => {
    expect(
      resolveSessionChatScope({ type: "workspace" }, "meeting-1")
    ).toEqual({ type: "meeting", meetingId: "meeting-1" });
  });
});
