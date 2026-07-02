import { analyzeMeeting } from "@/ai/flows/analyze-meeting-flow";
import { normalizeTask } from "@/lib/data";
import { extractFathomMeetingTasks } from "@/lib/fathom-ingest/task-extraction";
import {
  applyCompletionTargets,
  buildCompletionSuggestions,
} from "@/lib/task-completion";

jest.mock("@/ai/flows/analyze-meeting-flow", () => ({
  analyzeMeeting: jest.fn(),
}));

jest.mock("@/lib/data", () => ({
  normalizeTask: jest.fn((task: any) => task),
}));

jest.mock("@/lib/task-completion", () => ({
  applyCompletionTargets: jest.fn(),
  buildCompletionSuggestions: jest.fn(),
  mergeCompletionSuggestions: jest.fn((tasks: any[], suggestions: any[]) =>
    tasks.map((task: any) => {
      const suggestion = suggestions.find((item: any) => item.id === task.id);
      return suggestion ? { ...task, ...suggestion } : task;
    })
  ),
}));

const mockedAnalyzeMeeting = analyzeMeeting as jest.MockedFunction<typeof analyzeMeeting>;
const mockedNormalizeTask = normalizeTask as jest.MockedFunction<typeof normalizeTask>;
const mockedBuildCompletionSuggestions = buildCompletionSuggestions as jest.MockedFunction<
  typeof buildCompletionSuggestions
>;
const mockedApplyCompletionTargets = applyCompletionTargets as jest.MockedFunction<
  typeof applyCompletionTargets
>;

describe("fathom-ingest/task-extraction", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedNormalizeTask.mockImplementation((task: any) => task);
    mockedBuildCompletionSuggestions.mockResolvedValue([]);
  });

  it("extracts tasks and preserves meeting analysis details", async () => {
    mockedAnalyzeMeeting.mockResolvedValue({
      allTaskLevels: {
        medium: [{ id: "task-1", title: "Prepare deck" }],
      },
      attendees: [{ name: "Jane Doe", email: "jane@example.com" }],
      mentionedPeople: [],
      meetingSummary: "Discussed roadmap",
      chatResponseText: "Discussed roadmap",
      sessionTitle: "Sprint Planning",
      keyMoments: [{ timestamp: 10, label: "Intro" }],
      overallSentiment: "positive",
      speakerActivity: [{ speaker: "Jane", seconds: 42 }],
      meetingMetadata: { source: "fathom" },
    } as any);

    const result = await extractFathomMeetingTasks({
      db: { collection: jest.fn() } as any,
      userId: "user-1",
      user: {
        taskGranularityPreference: "medium",
        completionMatchThreshold: 0.6,
        autoApproveCompletedTasks: false,
      } as any,
      workspaceId: "workspace-1",
      payload: {
        attendees: [{ name: "Jane Doe", email: "jane@example.com" }],
      },
      transcriptText: "Meeting transcript",
      summaryText: "Summary",
    });

    expect(mockedAnalyzeMeeting).toHaveBeenCalledWith({
      transcript: "Meeting transcript",
      requestedDetailLevel: "medium",
    });
    expect(result.meetingTitle).toBe("Sprint Planning");
    expect(result.meetingSummary).toBe("Discussed roadmap");
    expect(result.sanitizedTasks).toEqual([{ id: "task-1", title: "Prepare deck" }]);
    expect(result.finalizedTasks).toEqual([{ id: "task-1", title: "Prepare deck" }]);
    expect(result.uniquePeople).toEqual([
      { name: "Jane Doe", email: "jane@example.com", role: "attendee" },
    ]);
    expect(result.analysisResult.keyMoments).toEqual([{ timestamp: 10, label: "Intro" }]);
  });

  it("auto-approves eligible completion suggestions", async () => {
    mockedAnalyzeMeeting.mockResolvedValue({
      allTaskLevels: {
        medium: [{ id: "task-1", title: "Prepare deck", completionSuggested: true }],
      },
      attendees: [{ name: "Jane Doe", email: "jane@example.com" }],
      mentionedPeople: [],
      meetingSummary: "Discussed roadmap",
      chatResponseText: "Discussed roadmap",
      sessionTitle: "Sprint Planning",
      keyMoments: [],
      overallSentiment: null,
      speakerActivity: [],
      meetingMetadata: {},
    } as any);
    mockedBuildCompletionSuggestions.mockResolvedValue([
      {
        id: "task-1",
        completionSuggested: true,
        completionConfidence: 0.8,
      },
    ] as any);

    const result = await extractFathomMeetingTasks({
      db: { collection: jest.fn() } as any,
      userId: "user-1",
      user: {
        taskGranularityPreference: "medium",
        completionMatchThreshold: 0.6,
        autoApproveCompletedTasks: true,
      } as any,
      workspaceId: "workspace-1",
      payload: {
        attendees: [{ name: "Jane Doe", email: "jane@example.com" }],
      },
      transcriptText: "Meeting transcript",
      summaryText: "Summary",
    });

    expect(mockedApplyCompletionTargets).toHaveBeenCalledTimes(1);
    expect(result.finalizedTasks[0]).toMatchObject({
      id: "task-1",
      status: "done",
      completionSuggested: false,
    });
  });
});
