import {
  decideMeetingChatAction,
  mergeSelectedMeetingTaskUpdates,
  validateSelectedMeetingTaskIds,
} from "@/lib/meeting-chat";

describe("meeting chat helpers", () => {
  it("rejects selected ids that do not belong to the active meeting", () => {
    const result = validateSelectedMeetingTaskIds(
      [{ id: "m1" }, { id: "m2" }] as any,
      new Set(["m1", "m3"])
    );

    expect(result).toEqual({ valid: false, invalidTaskIds: ["m3"] });
  });

  it("merges only selected meeting task updates back into the meeting task list", () => {
    const tasks = [
      { id: "a", title: "Alpha", priority: "low" },
      { id: "b", title: "Beta", priority: "medium" },
    ] as any;

    const updated = mergeSelectedMeetingTaskUpdates(tasks, [
      { id: "b", title: "Beta renamed", priority: "high" },
    ]);

    expect(updated).toEqual([
      { id: "a", title: "Alpha", priority: "low" },
      { id: "b", title: "Beta renamed", priority: "high" },
    ]);
  });

  it("requires selected tasks before allowing a meeting task edit", () => {
    const decision = decideMeetingChatAction({
      message: "rename this task",
      selectedTaskIds: new Set(),
    });

    expect(decision.kind).toBe("needs_selection");
  });

  it("treats transcript questions as read-only when no edit is requested", () => {
    const decision = decideMeetingChatAction({
      message: "who spoke most words?",
      selectedTaskIds: new Set(),
    });

    expect(decision.kind).toBe("answer");
  });
});
