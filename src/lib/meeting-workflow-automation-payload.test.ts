import {
  buildCanonicalPayload,
  buildWorkflowDeliveryBody,
} from "@/lib/meeting-workflow-automation-payload";

describe("meeting-workflow-automation-payload", () => {
  it("builds a canonical payload from meeting data with fallbacks", () => {
    const emittedAt = new Date("2026-07-02T10:30:00.000Z");
    expect(
      buildCanonicalPayload(
        "meeting.ingested",
        "workspace-1",
        {
          meetingId: "meeting-1",
          title: "Sprint Planning",
          transcript: "Discussed roadmap",
          attendees: [{ name: "Jane Doe", email: "jane@example.com" }],
          extractedTasks: [{ id: "task-1", title: "Prepare deck" }],
        },
        {
          _id: "meeting-1",
          workspaceId: "workspace-1",
          summary: "Meeting summary",
          attendees: [{ name: "Fallback Attendee", email: "fallback@example.com" }],
          extractedTasks: [{ id: "meeting-task-1", title: "Fallback task" }],
          tags: ["planning"],
          recordingUrl: "https://recording.example.com",
          shareUrl: "https://share.example.com",
          createdAt: new Date("2026-07-02T09:00:00.000Z"),
          lastActivityAt: new Date("2026-07-02T10:00:00.000Z"),
        },
        emittedAt
      )
    ).toEqual({
      event: {
        type: "meeting.ingested",
        emittedAt: "2026-07-02T10:30:00.000Z",
      },
      workspace: {
        id: "workspace-1",
      },
      meeting: {
        id: "meeting-1",
        title: "Sprint Planning",
        transcript: "Discussed roadmap",
        summary: "Meeting summary",
        attendees: [{ name: "Jane Doe", email: "jane@example.com" }],
        attendeeCount: 1,
        attendeeNames: ["Jane Doe"],
        attendeeEmails: ["jane@example.com"],
        extractedTasks: [{ id: "task-1", title: "Prepare deck" }],
        taskCount: 1,
        taskTitles: ["Prepare deck"],
        taskStatuses: [],
        taskAssignees: [],
        tags: ["planning"],
        metadata: null,
        recordingUrl: "https://recording.example.com",
        shareUrl: "https://share.example.com",
        startTime: null,
        endTime: null,
        duration: null,
        connectionId: null,
        providerSourceId: null,
        createdAt: "2026-07-02T09:00:00.000Z",
        lastActivityAt: "2026-07-02T10:00:00.000Z",
      },
    });
  });

  it("builds a workflow delivery body", () => {
    expect(
      buildWorkflowDeliveryBody(
        {
          event: { type: "meeting.ingested", emittedAt: "2026-07-02T10:30:00.000Z" },
          workspace: { id: "workspace-1" },
          meeting: {
            id: "meeting-1",
            title: "Sprint Planning",
            transcript: "Discussed roadmap",
            summary: null,
            attendees: [],
            attendeeCount: 0,
            attendeeNames: [],
            attendeeEmails: [],
            extractedTasks: [],
            taskCount: 0,
            taskTitles: [],
            taskStatuses: [],
            taskAssignees: [],
            tags: [],
            metadata: null,
            recordingUrl: null,
            shareUrl: null,
            startTime: null,
            endTime: null,
            duration: null,
            connectionId: null,
            providerSourceId: null,
            createdAt: null,
            lastActivityAt: null,
          },
        } as any,
        {
          _id: "workflow-1",
          name: "Meeting Updates",
          version: 2,
          trigger: "meeting.ingested",
        } as any,
        { transformed: true }
      )
    ).toEqual({
      event: { type: "meeting.ingested", emittedAt: "2026-07-02T10:30:00.000Z" },
      workspace: { id: "workspace-1" },
      workflow: {
        id: "workflow-1",
        name: "Meeting Updates",
        version: 2,
        trigger: "meeting.ingested",
      },
      payload: { transformed: true },
    });
  });
});
