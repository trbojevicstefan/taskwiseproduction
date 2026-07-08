import { planWorkspaceChatQuestion } from "@/lib/chat-query-planner";

describe("planWorkspaceChatQuestion", () => {
  it("routes weekly meeting count questions to the calendar agenda tool", () => {
    const plan = planWorkspaceChatQuestion(
      "How many meetings did we have this week?",
      new Date("2026-07-07T12:00:00.000Z")
    );

    expect(plan).toEqual({
      mode: "workspace_tool",
      toolName: "get_calendar_agenda",
      toolArgs: {
        from: "2026-07-06T00:00:00.000Z",
        to: "2026-07-12T23:59:59.999Z",
      },
      rationale: "meeting_count_this_week",
    });
  });

  it("keeps open-ended evidence questions on retrieval mode", () => {
    const plan = planWorkspaceChatQuestion("What did Stefan say about pricing?");

    expect(plan).toEqual({ mode: "workspace_retrieval" });
  });
});
