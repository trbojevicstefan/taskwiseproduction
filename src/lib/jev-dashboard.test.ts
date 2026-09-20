import {
  buildDeterministicAdaptiveDecision,
  evaluateAdaptiveDashboard,
  type AdaptiveDashboardSnapshot,
} from "@/lib/jev-dashboard";

const baseSnapshot = (
  overrides: Partial<AdaptiveDashboardSnapshot> = {}
): AdaptiveDashboardSnapshot => ({
  recentMeetingCount: 2,
  meetingsNeedingReview: 1,
  upcomingMeetingCount: 0,
  urgentTaskCount: 0,
  highPriorityTaskCount: 1,
  openTaskCount: 4,
  peopleFollowupCount: 1,
  recentMeetings: [
    {
      id: "m-1",
      title: "Acme onboarding",
      summary: "Agreed onboarding steps and ownership.",
      occurredAt: "2026-09-20T12:00:00.000Z",
      attendeeNames: ["Maya", "Jon"],
      extractedTaskCount: 3,
      suggestedTaskCount: 2,
    },
  ],
  topTasks: [
    {
      id: "t-1",
      title: "Send onboarding checklist",
      priorityScore: 45,
      priorityLabel: "high",
      priorityReason: "Due today",
      dueAt: "2026-09-20T18:00:00.000Z",
      assigneeName: "Jon",
      status: "todo",
    },
  ],
  peopleSignals: [
    {
      id: "p-1",
      name: "Maya",
      recentMeetingCount: 2,
      openTaskCount: 1,
      client: true,
    },
  ],
  ...overrides,
});

describe("buildDeterministicAdaptiveDecision", () => {
  it("guides setup when there is no meeting history", () => {
    const decision = buildDeterministicAdaptiveDecision(
      baseSnapshot({
        recentMeetingCount: 0,
        meetingsNeedingReview: 0,
        recentMeetings: [],
      })
    );

    expect(decision.focus).toBe("connect_meeting_source");
    expect(decision.surface).toBe("inline");
    expect(decision.primaryAction.href).toBe("/settings?section=integrations");
  });

  it("prioritizes review when recent meetings produced suggested tasks", () => {
    const decision = buildDeterministicAdaptiveDecision(baseSnapshot());

    expect(decision.focus).toBe("review_meeting");
    expect(decision.surface).toBe("popover");
    expect(decision.primaryAction.href).toBe("/review");
  });

  it("uses a digest only after meeting volume is meaningfully high", () => {
    const decision = buildDeterministicAdaptiveDecision(
      baseSnapshot({
        recentMeetingCount: 7,
        meetingsNeedingReview: 0,
        urgentTaskCount: 0,
        highPriorityTaskCount: 0,
        peopleFollowupCount: 0,
      })
    );

    expect(decision.focus).toBe("meeting_digest");
    expect(decision.surface).toBe("inline");
  });
});

describe("evaluateAdaptiveDashboard", () => {
  it("falls back without making a request when TYPESAFE_API_KEY is missing", async () => {
    const fetchImpl = jest.fn();

    const result = await evaluateAdaptiveDashboard(baseSnapshot(), {
      apiKey: "",
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.source).toBe("fallback");
    expect(result.focus).toBe("review_meeting");
  });

  it("sends one System One request with atomic Choice, Score and Noul questions", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "jev-latest",
        answers: {
          focus: {
            type: "choice",
            choice: "prioritize_tasks",
            probabilities: {
              connect_meeting_source: 0.01,
              review_meeting: 0.1,
              prioritize_tasks: 0.75,
              prepare_meeting: 0.04,
              follow_up_people: 0.03,
              meeting_digest: 0.05,
              quiet: 0.02,
            },
            confidence: 0.82,
          },
          attention: {
            type: "score",
            score: 2.1,
            legend: {
              "0": "No interruption",
              "1": "Inline guidance",
              "2": "Popover",
              "3": "Modal-worthy",
            },
            probabilities: {
              "0": 0.01,
              "1": 0.1,
              "2": 0.75,
              "3": 0.14,
            },
            confidence: 0.79,
          },
          meeting_digest_useful: { type: "noul", noul: 0.2 },
          task_focus_useful: { type: "noul", noul: 0.94 },
          people_followup_useful: { type: "noul", noul: 0.4 },
        },
      }),
    });

    const result = await evaluateAdaptiveDashboard(baseSnapshot(), {
      apiKey: "test-key",
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer test-key");

    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("jev-latest");
    expect(body.questions.focus.type).toBe("choice");
    expect(body.questions.attention.type).toBe("score");
    expect(body.questions.meeting_digest_useful.type).toBe("noul");
    expect(body.questions.task_focus_useful.type).toBe("noul");
    expect(body.questions.people_followup_useful.type).toBe("noul");
    expect(body.state).toEqual(baseSnapshot());

    expect(result.source).toBe("jev");
    expect(result.focus).toBe("prioritize_tasks");
    expect(result.surface).toBe("popover");
    expect(result.primaryAction.href).toBe("/planning");
  });

  it("never allows a low-confidence answer to open a modal", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "jev-latest",
        answers: {
          focus: {
            type: "choice",
            choice: "meeting_digest",
            probabilities: { meeting_digest: 0.3, quiet: 0.29 },
            confidence: 0.18,
          },
          attention: {
            type: "score",
            score: 3,
            legend: {
              "0": "No interruption",
              "1": "Inline guidance",
              "2": "Popover",
              "3": "Modal-worthy",
            },
            probabilities: { "3": 0.4, "2": 0.3 },
            confidence: 0.2,
          },
          meeting_digest_useful: { type: "noul", noul: 0.55 },
          task_focus_useful: { type: "noul", noul: 0.52 },
          people_followup_useful: { type: "noul", noul: 0.49 },
        },
      }),
    });

    const result = await evaluateAdaptiveDashboard(
      baseSnapshot({
        recentMeetingCount: 8,
        meetingsNeedingReview: 0,
        highPriorityTaskCount: 0,
      }),
      {
        apiKey: "test-key",
        fetchImpl: fetchImpl as typeof fetch,
      }
    );

    expect(result.surface).not.toBe("modal");
    expect(result.source).toBe("fallback");
  });

  it("falls back when the Jev response is malformed", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ answers: { focus: { choice: "surprise" } } }),
    });

    const result = await evaluateAdaptiveDashboard(baseSnapshot(), {
      apiKey: "test-key",
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(result.source).toBe("fallback");
    expect(result.focus).toBe("review_meeting");
  });
});
