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
import {
  PLANNING_ASSISTANT_PROMPTS,
  normalizePlanningOverview,
  isPlanningOverviewEmpty,
  type PlanningOverview,
  type PlanningTask,
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
