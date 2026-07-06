/** @jest-environment jsdom */

/**
 * Priority 9 — person profile layout: the page renders the profile header,
 * relationship summary, tasks, meeting timeline, transcript mentions,
 * notes & aliases, source identities/merge state sections, and the
 * generate-report / mark-type actions.
 */

import React from "react";
import { act } from "react-dom/test-utils";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
import { createRoot, type Root } from "react-dom/client";
import PersonDetailPageContent from "@/components/dashboard/people/PersonDetailPageContent";
import { apiFetch } from "@/lib/api";
import { getPersonDetails, onTasksForPersonSnapshot } from "@/lib/data";
import { useMeetingHistory } from "@/contexts/MeetingHistoryContext";

// jsdom resolves lucide-react to its ESM build, which ts-jest does not
// transform; icons are irrelevant to these tests.
jest.mock("lucide-react", () =>
  new Proxy(
    {},
    {
      get: (_target, prop) => (prop === "__esModule" ? true : () => null),
    }
  )
);

jest.mock("framer-motion", () => ({
  motion: new Proxy(
    {},
    {
      get: () =>
        ({ children, ...props }: any) => {
          const rest = { ...props };
          delete rest.initial;
          delete rest.animate;
          delete rest.transition;
          return React.createElement("div", rest, children);
        },
    }
  ),
}));

jest.mock("next/navigation", () => ({
  useRouter: jest.fn(() => ({ push: jest.fn() })),
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...props }: any) =>
    React.createElement("a", { href, ...props }, children),
}));

jest.mock("@/lib/api", () => ({
  apiFetch: jest.fn(),
}));

jest.mock("@/lib/data", () => ({
  getPersonDetails: jest.fn(),
  onTasksForPersonSnapshot: jest.fn(),
  updatePerson: jest.fn(),
}));

jest.mock("@/lib/board-actions", () => ({
  moveTaskToBoard: jest.fn(),
}));

jest.mock("@/lib/brief-context", () => ({
  buildBriefContext: jest.fn(() => ({})),
}));

jest.mock("@/lib/task-briefs", () => ({
  generateBriefsForTasks: jest.fn(),
}));

jest.mock("@/hooks/use-workspace-boards", () => ({
  useWorkspaceBoards: jest.fn(() => ({ boards: [] })),
}));

jest.mock("@/contexts/AuthContext", () => {
  // Stable references — the component's fetch effect depends on `user`, so a
  // fresh object per render would loop forever.
  const authValue = {
    user: { uid: "user-1", workspace: { id: "workspace-1" } },
    loading: false,
  };
  return { useAuth: () => authValue };
});

jest.mock("@/contexts/IntegrationsContext", () => ({
  useIntegrations: () => ({ isSlackConnected: false }),
}));

jest.mock("@/contexts/MeetingHistoryContext", () => ({
  useMeetingHistory: jest.fn(),
}));

jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

jest.mock("@/components/dashboard/DashboardHeader", () => ({
  __esModule: true,
  default: ({ pageTitle, children }: any) => (
    <header>
      <div>{pageTitle}</div>
      <div>{children}</div>
    </header>
  ),
}));

jest.mock("@/components/dashboard/DashboardScreenSkeleton", () => ({
  __esModule: true,
  default: () => <div>loading</div>,
}));

jest.mock("@/components/dashboard/planning/TaskDetailDialog", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("@/components/dashboard/common/ShareToSlackDialog", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("@/components/dashboard/common/ProfileReportDialog", () => ({
  __esModule: true,
  default: ({ isOpen, endpoint }: any) =>
    isOpen ? <div data-testid="report-dialog">{endpoint}</div> : null,
}));

const mockedApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;
const mockedGetPersonDetails = getPersonDetails as jest.MockedFunction<
  typeof getPersonDetails
>;
const mockedOnTasksSnapshot = onTasksForPersonSnapshot as jest.MockedFunction<
  typeof onTasksForPersonSnapshot
>;
const mockedUseMeetingHistory = useMeetingHistory as jest.MockedFunction<
  typeof useMeetingHistory
>;

const person = {
  id: "p1",
  userId: "user-1",
  name: "Jane Client",
  email: "jane@acme.com",
  title: "CTO",
  personType: "client" as const,
  personTypeReason: "External email domain @acme.com",
  company: "Acme",
  notes: "Prefers async updates.",
  nextFollowUpAt: "2026-08-01T00:00:00.000Z",
  slackId: null,
  aliases: ["Janey"],
  sourceSessionIds: ["m1"],
  primarySource: "transcript" as const,
  mergeState: "active" as const,
  sourceIdentities: [
    {
      provider: "fathom" as const,
      email: "jane@acme.com",
      name: "Jane Client",
      lastSeenAt: "2026-06-20T00:00:00.000Z",
    },
  ],
  taskCount: 1,
  taskCounts: { total: 2, open: 1, todo: 1, inprogress: 0, done: 1, recurring: 0 },
  createdAt: null,
  lastSeenAt: null,
};

const meeting = {
  id: "m1",
  title: "Acme kickoff",
  startTime: "2026-06-29T10:00:00.000Z",
  attendees: [{ name: "Jane Client", email: "jane@acme.com" }],
  extractedTasks: [],
};

const renderPage = async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(<PersonDetailPageContent personId="p1" />);
  });
  return {
    container,
    cleanup: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
};

const findButton = (container: HTMLElement, label: string) =>
  Array.from(container.querySelectorAll("button")).find((button) =>
    (button.textContent || "").includes(label)
  );

describe("PersonDetailPageContent — profile sections", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetPersonDetails.mockResolvedValue(person as any);
    mockedOnTasksSnapshot.mockImplementation((_userId, _personId, callback) => {
      callback([]);
      return () => {};
    });
    mockedUseMeetingHistory.mockReturnValue({ meetings: [meeting] } as any);
    mockedApiFetch.mockImplementation(async (url: string) => {
      if (url === "/api/people/p1/mentions") {
        return {
          mentions: [
            {
              meetingId: "m1",
              meetingTitle: "Acme kickoff",
              startTime: "2026-06-29T10:00:00.000Z",
              snippet: "12:30 - Jane Client: we will ship Friday",
              timestamp: "12:30",
            },
          ],
        } as any;
      }
      return {} as any;
    });
  });

  it("renders every profile section", async () => {
    const { container, cleanup } = await renderPage();
    const text = container.textContent || "";

    // Profile header: name, type badge, Slack status.
    expect(text).toContain("Profile: Jane Client");
    expect(text).toContain("client");
    expect(text).toContain("No Slack");

    // Relationship summary tiles.
    expect(
      container.querySelector('[data-testid="relationship-summary"]')
    ).toBeTruthy();
    expect(text).toContain("Open tasks");
    expect(text).toContain("Overdue");
    expect(text).toContain("Last meeting");

    // Tasks section.
    expect(text).toContain("Assigned Tasks");

    // Meeting timeline lists the matched meeting and links to it.
    expect(text).toContain("Meeting Timeline");
    expect(container.querySelector('a[href="/meetings/m1"]')).toBeTruthy();
    expect(text).toContain("Acme kickoff");

    // Transcript mentions from the narrow mentions API.
    expect(text).toContain("Recent Transcript Mentions");
    expect(text).toContain("we will ship Friday");

    // Notes & aliases.
    expect(text).toContain("Notes & Aliases");
    expect(text).toContain("Prefers async updates.");

    // Source identities & merge state.
    expect(text).toContain("Source Identities & Merge State");
    expect(text).toContain("Merge state: active");
    expect(text).toContain("fathom");

    cleanup();
  });

  it("offers generate-report and mark-type actions", async () => {
    const { container, cleanup } = await renderPage();

    expect(findButton(container, "Generate report")).toBeTruthy();
    // A client can be marked as teammate but not re-marked as client.
    expect(findButton(container, "Mark as teammate")).toBeTruthy();
    expect(findButton(container, "Mark as client")).toBeFalsy();

    cleanup();
  });

  it("opens the report dialog pointed at the person report endpoint", async () => {
    const { container, cleanup } = await renderPage();

    const reportButton = findButton(container, "Generate report")!;
    await act(async () => {
      reportButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const dialog = container.querySelector('[data-testid="report-dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog!.textContent).toBe("/api/people/p1/report");

    cleanup();
  });
});
