import { answerMeetingChat } from "@/ai/flows/meeting-chat-flow";

jest.mock("@/ai/flows/transcript-qa-flow", () => ({
  answerFromTranscript: jest.fn(),
}));

jest.mock("@/ai/flows/refine-tasks-flow", () => ({
  refineTasks: jest.fn(),
}));

describe("meeting chat flow", () => {
  it("returns needsSelection when asked to edit tasks without selected ids", async () => {
    const result = await answerMeetingChat({
      message: "rename this task",
      transcript: "00:01 Domenick: Let's start.",
      meetingTasks: [{ id: "t1", title: "Follow up" }] as any,
      selectedTaskIds: [],
    });

    expect(result.needsSelection).toBe(true);
    expect(result.kind).toBe("needs_selection");
  });
});
