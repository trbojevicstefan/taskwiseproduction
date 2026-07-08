import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

jest.mock("next/navigation", () => ({
  useRouter: jest.fn(() => ({ push: jest.fn() })),
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...props }: any) =>
    React.createElement("a", { href, ...props }, children),
}));

jest.mock("@/components/ui/logo", () => ({
  Logo: () => React.createElement("span", null, "logo"),
}));

jest.mock("@/lib/api", () => ({
  apiFetch: jest.fn(() => new Promise(() => {})),
}));

jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

jest.mock("@/components/dashboard/DashboardHeader", () => ({
  __esModule: true,
  default: ({ pageTitle, description, children }: any) =>
    React.createElement("div", null, pageTitle, description, children),
}));

import PlanningWorkspacePageContent, {
  PlanningSectionsGrid,
} from "@/components/dashboard/planning/PlanningWorkspacePageContent";
import { resolvePlanningTaskHref } from "@/components/dashboard/planning/PlanningTaskRow";
import UpcomingMeetingsSection, {
  UpcomingMeetingRow,
  resolveUpcomingMeetingHref,
} from "@/components/dashboard/planning/UpcomingMeetingsSection";
import {
  applySuggestionsToAgenda,
  type AgendaSectionDraft,
} from "@/components/dashboard/planning/AgendaWorkspacePageContent";
import {
  PLANNING_ASSISTANT_PROMPTS,
  normalizePlanningOverview,
  normalizeUpcomingMeetings,
  isPlanningOverviewEmpty,
  isPlanningWorkspaceEmpty,
  type PlanningOverview,
  type PlanningTask,
  type UpcomingMeeting,
} from "@/components/dashboard/planning/planning-overview";

const makeTask = (overrides: Partial<PlanningTask> = {}): PlanningTask => ({
  id: "t1",
  title: "Sample task",
  status: "todo",
  priority: "medium",
  projectId: "p1",
  userId: "u1",
  planningFlags: {
    overdue: false,
    blocked: false,
    waitingOnClient: false,
    needsOwner: false,
    needsDueDate: false,
  },
  ...overrides,
});

const emptyOverview = normalizePlanningOverview({});

const populatedOverview: PlanningOverview = normalizePlanningOverview({
  sections: {
    today: [
      makeTask({
        id: "t-today",
        title: "Ship the client report",
        priorityLabel: "urgent",
        dueAt: "2026-06-30T09:00:00.000Z",
        assigneeName: "Ana Kovac",
        planningFlags: {
          overdue: true,
          blocked: true,
          waitingOnClient: false,
          needsOwner: false,
          needsDueDate: false,
        },
      }),
    ],
    thisWeek: [
      makeTask({
        id: "t-week",
        title: "Draft the onboarding email",
        priorityLabel: "high",
        dueAt: "2026-07-04T09:00:00.000Z",
      }),
    ],
    blocked: [
      makeTask({
        id: "t-blocked",
        title: "Waiting on API credentials",
        planningFlags: {
          overdue: false,
          blocked: true,
          waitingOnClient: true,
          needsOwner: true,
          needsDueDate: true,
        },
      }),
    ],
    waitingOnClient: [],
    needsOwner: [],
    needsDueDate: [],
  },
  counts: {
    today: 1,
    thisWeek: 12,
    blocked: 1,
    waitingOnClient: 0,
    needsOwner: 0,
    needsDueDate: 0,
  },
});

const noop = () => {};

describe("PlanningSectionsGrid", () => {
  it("renders all six sections with counts and task rows from the payload", () => {
    const markup = renderToStaticMarkup(
      <PlanningSectionsGrid
        overview={populatedOverview}
        onRequestAssign={noop}
        onSetDueDate={noop}
        onMarkDone={noop}
      />
    );

    for (const title of [
      "Today",
      "This week",
      "Blocked",
      "Waiting on client",
      "Needs owner",
      "Needs due date",
    ]) {
      expect(markup).toContain(title);
    }

    expect(markup).toContain("Ship the client report");
    expect(markup).toContain("Draft the onboarding email");
    expect(markup).toContain("Waiting on API credentials");
    expect(markup).toContain("Urgent");
    expect(markup).toContain("Ana Kovac");
    expect(markup).toContain("Unassigned");
    // Uncapped counts surface, including the "+N more" hint.
    expect(markup).toContain(">12<");
    expect(markup).toContain("+11 more not shown");
  });

  it("renders flag chips for the OTHER applicable planningFlags only", () => {
    const markup = renderToStaticMarkup(
      <PlanningSectionsGrid
        overview={populatedOverview}
        onRequestAssign={noop}
        onSetDueDate={noop}
        onMarkDone={noop}
      />
    );

    // The blocked-section task suppresses its own "Blocked" chip but keeps
    // the rest; the today-section task still shows its Blocked chip.
    expect(markup).toContain("Client");
    expect(markup).toContain("No owner");
    expect(markup).toContain("No due date");
    const blockedChips = markup.match(/>Blocked</g) || [];
    // One "Blocked" section title match is via CardTitle span; the chip from
    // the today task adds another — the blocked-section task adds none.
    expect(blockedChips.length).toBe(2);
  });

  it("renders muted empty text for sections without tasks", () => {
    const markup = renderToStaticMarkup(
      <PlanningSectionsGrid
        overview={populatedOverview}
        onRequestAssign={noop}
        onSetDueDate={noop}
        onMarkDone={noop}
      />
    );

    expect(markup).toContain("Nothing waiting on a client.");
    expect(markup).toContain("Every task has an owner.");
    expect(markup).toContain("Every task has a due date.");
  });

  it("renders the shared EmptyState when every section is empty", () => {
    expect(isPlanningOverviewEmpty(emptyOverview)).toBe(true);
    const markup = renderToStaticMarkup(
      <PlanningSectionsGrid
        overview={emptyOverview}
        onRequestAssign={noop}
        onSetDueDate={noop}
        onMarkDone={noop}
      />
    );

    expect(markup).toContain("Nothing to plan yet");
    expect(markup).toContain("Sync meetings or approve tasks first.");
    expect(markup).not.toContain("Nothing due today.");
  });
});

describe("PlanningWorkspacePageContent", () => {
  it("mounts the AI planning assistant with the Phase 5 prompts and header actions", () => {
    const markup = renderToStaticMarkup(<PlanningWorkspacePageContent />);

    expect(markup).toContain("Plan with AI");
    expect(PLANNING_ASSISTANT_PROMPTS).toHaveLength(4);
    for (const prompt of PLANNING_ASSISTANT_PROMPTS) {
      expect(markup).toContain(
        prompt.replace(/'/g, "&#x27;").replace(/"/g, "&quot;")
      );
    }

    expect(markup).toContain("Recompute priorities");
    expect(markup).toContain("Meeting agendas");
    expect(markup).toContain('href="/planning/agendas"');
  });
});

describe("resolvePlanningTaskHref", () => {
  it("links to the source meeting when available, else the review page", () => {
    expect(
      resolvePlanningTaskHref(makeTask({ sourceSessionId: "m42" }))
    ).toBe("/meetings/m42");
    expect(resolvePlanningTaskHref(makeTask())).toBe("/review");
  });
});

describe("normalizePlanningOverview", () => {
  it("fills missing sections and derives counts from section lengths", () => {
    const overview = normalizePlanningOverview({
      sections: { today: [makeTask()], junk: "ignored" },
      counts: { thisWeek: -3 },
    });

    expect(overview.sections.today).toHaveLength(1);
    expect(overview.sections.needsDueDate).toEqual([]);
    expect(overview.counts.today).toBe(1);
    expect(overview.counts.thisWeek).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Priority 12 — upcoming meetings + empty-state logic
// ---------------------------------------------------------------------------

const makeUpcomingMeeting = (
  overrides: Partial<UpcomingMeeting> = {}
): UpcomingMeeting => ({
  id: "tw:m-1",
  source: "taskwise",
  meetingId: "m-1",
  googleEventId: null,
  title: "Weekly Sync",
  startTime: "2026-07-07T10:00:00.000Z",
  endTime: null,
  attendees: [{ name: "Alice Client", email: "alice@client.com" }],
  hangoutLink: null,
  needsAgenda: true,
  agendaSectionCount: 0,
  openTaskCount: 2,
  openTaskIds: ["t-1", "t-2"],
  ...overrides,
});

describe("isPlanningWorkspaceEmpty (empty-state rule)", () => {
  it("is empty only when tasks AND upcoming meetings are both empty", () => {
    expect(isPlanningWorkspaceEmpty(emptyOverview, [])).toBe(true);
    expect(
      isPlanningWorkspaceEmpty(emptyOverview, [makeUpcomingMeeting()])
    ).toBe(false);
    expect(isPlanningWorkspaceEmpty(populatedOverview, [])).toBe(false);
  });
});

describe("PlanningSectionsGrid empty-state control", () => {
  it("suppresses the big EmptyState when upcoming meetings exist", () => {
    const markup = renderToStaticMarkup(
      <PlanningSectionsGrid
        overview={emptyOverview}
        onRequestAssign={noop}
        onSetDueDate={noop}
        onMarkDone={noop}
        showEmptyState={false}
      />
    );

    expect(markup).not.toContain("Nothing to plan yet");
    expect(markup).toContain("No open tasks to triage yet.");
  });
});

describe("normalizeUpcomingMeetings", () => {
  it("keeps well-formed entries and drops junk", () => {
    const meetings = normalizeUpcomingMeetings({
      meetings: [
        makeUpcomingMeeting(),
        { id: "g:x" }, // missing startTime — dropped
        "junk",
        null,
      ],
    });
    expect(meetings).toHaveLength(1);
    expect(meetings[0]).toMatchObject({
      id: "tw:m-1",
      needsAgenda: true,
      openTaskCount: 2,
    });
  });

  it("returns [] for malformed payloads", () => {
    expect(normalizeUpcomingMeetings(undefined)).toEqual([]);
    expect(normalizeUpcomingMeetings({ meetings: "nope" })).toEqual([]);
  });
});

describe("UpcomingMeetingsSection", () => {
  it("renders rows with needs-agenda flag, open-task count, and agenda link", () => {
    const meetings = [
      makeUpcomingMeeting(),
      makeUpcomingMeeting({
        id: "g:gev-1",
        source: "google",
        meetingId: null,
        googleEventId: "gev-1",
        title: "Client Kickoff",
        needsAgenda: true,
        openTaskCount: 0,
        hangoutLink: "https://meet.google.com/abc",
        attendees: [],
      }),
      makeUpcomingMeeting({
        id: "tw:m-2",
        meetingId: "m-2",
        title: "Prepared Meeting",
        needsAgenda: false,
        agendaSectionCount: 3,
        openTaskCount: 0,
      }),
    ];
    const markup = renderToStaticMarkup(
      <UpcomingMeetingsSection meetings={meetings} />
    );

    expect(markup).toContain("Upcoming meetings");
    expect(markup).toContain("Weekly Sync");
    expect(markup).toContain("Client Kickoff");
    expect(markup).toContain("Needs agenda");
    expect(markup).toContain("Agenda ready (3)");
    expect(markup).toContain("2 open tasks");
    expect(markup).toContain('href="/planning/agendas/m-1"');
    expect(markup).toContain('href="https://meet.google.com/abc"');
    // 2 of the 3 rows still need an agenda.
    expect(markup).toContain("2 need agenda");
  });

  it("renders nothing when there are no upcoming meetings", () => {
    expect(
      renderToStaticMarkup(<UpcomingMeetingsSection meetings={[]} />)
    ).toBe("");
  });
});

describe("resolveUpcomingMeetingHref", () => {
  it("links taskwise rows to the agenda workspace, google-only rows to the planner", () => {
    expect(resolveUpcomingMeetingHref(makeUpcomingMeeting())).toBe(
      "/planning/agendas/m-1"
    );
    expect(
      resolveUpcomingMeetingHref(
        makeUpcomingMeeting({ meetingId: null, source: "google" })
      )
    ).toBe("/planning/agendas");
  });
});

describe("UpcomingMeetingRow", () => {
  it("labels the action by agenda state", () => {
    expect(
      renderToStaticMarkup(
        <UpcomingMeetingRow meeting={makeUpcomingMeeting()} />
      )
    ).toContain("Prepare agenda");
    expect(
      renderToStaticMarkup(
        <UpcomingMeetingRow
          meeting={makeUpcomingMeeting({
            needsAgenda: false,
            agendaSectionCount: 1,
          })}
        />
      )
    ).toContain("Edit agenda");
  });
});

describe("applySuggestionsToAgenda", () => {
  const existing: AgendaSectionDraft[] = [
    { id: "s-1", title: "Intro", notes: "", order: 0 },
  ];
  let counter = 0;
  const idFactory = () => `new-${++counter}`;

  beforeEach(() => {
    counter = 0;
  });

  it("appends only the user-checked topics and re-numbers order", () => {
    const next = applySuggestionsToAgenda(
      existing,
      [
        {
          id: "sug-1",
          title: "Review: Send proposal",
          notes: "Open task",
          source: "open_task",
        },
      ],
      idFactory
    );
    expect(next).toEqual([
      { id: "s-1", title: "Intro", notes: "", order: 0 },
      {
        id: "new-1",
        title: "Review: Send proposal",
        notes: "Open task",
        order: 1,
      },
    ]);
    // The input is not mutated.
    expect(existing).toHaveLength(1);
  });

  it("skips topics whose title already exists in the agenda", () => {
    const next = applySuggestionsToAgenda(
      existing,
      [
        { id: "sug-1", title: "intro", notes: "", source: "carry_over" },
        { id: "sug-2", title: "New topic", notes: "", source: "carry_over" },
      ],
      idFactory
    );
    expect(next.map((section) => section.title)).toEqual([
      "Intro",
      "New topic",
    ]);
  });
});
