/** @jest-environment jsdom */

/**
 * Priority 10 interaction tests: clicking any calendar item opens the in-app
 * detail drawer first — internal meetings no longer navigate immediately and
 * Google events no longer open a new tab. Create/link actions post to the
 * calendar meeting routes.
 */

import React from "react";
import { act } from "react-dom/test-utils";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
import { createRoot, type Root } from "react-dom/client";
import CalendarPageContent from "@/components/dashboard/calendar/CalendarPageContent";
import { apiFetch } from "@/lib/api";
import { useRouter } from "next/navigation";

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

jest.mock("next/navigation", () => ({
  useRouter: jest.fn(),
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...props }: any) =>
    React.createElement("a", { href, ...props }, children),
}));

jest.mock("@/lib/api", () => ({
  apiFetch: jest.fn(),
}));

jest.mock("@/lib/realtime-client", () => ({
  subscribeRealtimeUpdates: jest.fn(() => jest.fn()),
}));

jest.mock("@/contexts/IntegrationsContext", () => ({
  useIntegrations: () => ({ isGoogleTasksConnected: true }),
}));

jest.mock("@/components/dashboard/DashboardHeader", () => ({
  __esModule: true,
  default: ({ pageTitle, description }: any) => (
    <header>
      <div>{pageTitle}</div>
      <p>{description}</p>
    </header>
  ),
}));

const mockedApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;
const mockedUseRouter = useRouter as jest.MockedFunction<typeof useRouter>;

const todayAt = (hours: number, minutes = 0) => {
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date.toISOString();
};

const calendarPayload = {
  ok: true,
  meetings: [
    {
      id: "m1",
      title: "Weekly sync",
      startTime: todayAt(10),
      attendeeCount: 2,
      isClientMeeting: false,
      calendarEventId: null,
      organizerEmail: null,
      attendees: [
        { name: "Ana", email: "ana@acme.com" },
        { name: "Bo", email: "bo@acme.com" },
      ],
    },
  ],
  tasks: [],
  reminders: [],
  warnings: { overdueCount: 0, cleanupSuggestedCount: 0, expiredCount: 0 },
};

const googleEventsPayload = {
  events: [
    {
      id: "g1",
      title: "External planning call",
      startTime: todayAt(16),
      endTime: todayAt(17),
      hangoutLink: "https://meet.google.com/abc",
      organizer: "host@client.com",
      description: "Quarterly agenda review",
      attendees: [{ email: "carla@client.com", name: "Carla" }],
    },
  ],
};

const recentMeetingsPayload = {
  data: [
    { id: "m-recent", title: "Acme retro", startTime: todayAt(9) },
    { id: "m-older", title: "Old kickoff", startTime: todayAt(8) },
  ],
  hasMore: false,
  nextCursor: null,
};

const routeApiFetch = (url: string, options?: RequestInit): Promise<any> => {
  if (url.startsWith("/api/calendar/meetings/link")) {
    return Promise.resolve({ ok: true, meetingId: "m-recent", externalEventId: "g1" });
  }
  if (url.startsWith("/api/calendar/meetings")) {
    return Promise.resolve({
      ok: true,
      created: true,
      meeting: { id: "m-created", title: "External planning call" },
    });
  }
  if (url.startsWith("/api/calendar")) {
    return Promise.resolve(calendarPayload);
  }
  if (url.startsWith("/api/google/calendar/upcoming")) {
    return Promise.resolve(googleEventsPayload);
  }
  if (url.startsWith("/api/meetings")) {
    return Promise.resolve(recentMeetingsPayload);
  }
  throw new Error(`Unexpected apiFetch in test: ${options?.method || "GET"} ${url}`);
};

const renderCalendar = async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(<CalendarPageContent />);
  });
  return {
    container,
    root,
    cleanup: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
};

const click = async (element: Element) => {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

const findEntryButton = (title: string): HTMLButtonElement => {
  const buttons = Array.from(
    document.querySelectorAll<HTMLButtonElement>(
      '[data-testid="calendar-entry-pill"], [data-testid="calendar-entry-card"]'
    )
  );
  const match = buttons.find((button) => button.textContent?.includes(title));
  expect(match).toBeTruthy();
  return match!;
};

const detailSheet = () =>
  document.querySelector('[data-testid="calendar-detail-sheet"]');

describe("CalendarPageContent event detail drawer", () => {
  let routerPush: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    routerPush = jest.fn();
    mockedUseRouter.mockReturnValue({
      push: routerPush,
      replace: jest.fn(),
      prefetch: jest.fn(),
      refresh: jest.fn(),
      back: jest.fn(),
      forward: jest.fn(),
    } as any);
    mockedApiFetch.mockImplementation(routeApiFetch as any);
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("opens the in-app drawer for internal meetings instead of navigating", async () => {
    const { cleanup } = await renderCalendar();

    await click(findEntryButton("Weekly sync"));

    const sheet = detailSheet();
    expect(sheet).toBeTruthy();
    expect(sheet!.textContent).toContain("Weekly sync");
    expect(sheet!.textContent).toContain("Ana (ana@acme.com)");
    expect(routerPush).not.toHaveBeenCalled();

    // Navigation is an explicit action: the "Open meeting" link.
    const openMeeting = sheet!.querySelector(
      '[data-testid="calendar-detail-open-meeting"]'
    ) as HTMLAnchorElement;
    expect(openMeeting).toBeTruthy();
    expect(openMeeting.getAttribute("href")).toBe("/meetings/m1");

    cleanup();
  });

  it("opens the drawer for Google events instead of a new tab; the external link is explicit", async () => {
    const openSpy = jest.spyOn(window, "open").mockImplementation(() => null);
    const { cleanup } = await renderCalendar();

    await click(findEntryButton("External planning call"));

    expect(openSpy).not.toHaveBeenCalled();
    const sheet = detailSheet();
    expect(sheet).toBeTruthy();
    expect(sheet!.textContent).toContain("External planning call");
    expect(sheet!.textContent).toContain("Quarterly agenda review");
    expect(sheet!.textContent).toContain("Carla (carla@client.com)");

    const externalLink = sheet!.querySelector(
      '[data-testid="calendar-detail-external-link"]'
    ) as HTMLAnchorElement;
    expect(externalLink).toBeTruthy();
    expect(externalLink.getAttribute("href")).toBe("https://meet.google.com/abc");
    expect(externalLink.getAttribute("target")).toBe("_blank");
    expect(externalLink.getAttribute("rel")).toContain("noopener");

    openSpy.mockRestore();
    cleanup();
  });

  it("creates a Taskwise meeting from an unmatched Google event", async () => {
    const { cleanup } = await renderCalendar();

    await click(findEntryButton("External planning call"));
    const createButton = detailSheet()!.querySelector(
      '[data-testid="calendar-detail-create-meeting"]'
    ) as HTMLButtonElement;
    expect(createButton).toBeTruthy();

    await click(createButton);

    const createCall = mockedApiFetch.mock.calls.find(
      ([url, options]) =>
        url === "/api/calendar/meetings" && (options as any)?.method === "POST"
    );
    expect(createCall).toBeTruthy();
    const body = JSON.parse((createCall![1] as any).body);
    expect(body).toMatchObject({
      title: "External planning call",
      externalEventId: "g1",
      attendees: [{ name: "Carla", email: "carla@client.com" }],
    });

    // The drawer now points at the created meeting.
    const sheet = detailSheet();
    expect(sheet!.textContent).toContain("Open Taskwise meeting");
    const openMeeting = sheet!.querySelector(
      '[data-testid="calendar-detail-open-meeting"]'
    ) as HTMLAnchorElement;
    expect(openMeeting.getAttribute("href")).toBe("/meetings/m-created");

    cleanup();
  });

  it("links a Google event to an existing meeting through the recent-meetings picker", async () => {
    const { cleanup } = await renderCalendar();

    await click(findEntryButton("External planning call"));
    await click(
      detailSheet()!.querySelector(
        '[data-testid="calendar-detail-link-existing"]'
      ) as HTMLButtonElement
    );

    expect(mockedApiFetch).toHaveBeenCalledWith(
      "/api/meetings?paginate=1&limit=20"
    );
    const options = Array.from(
      detailSheet()!.querySelectorAll<HTMLButtonElement>(
        '[data-testid="calendar-detail-picker-option"]'
      )
    );
    expect(options.map((option) => option.textContent)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Acme retro"),
        expect.stringContaining("Old kickoff"),
      ])
    );

    await click(options.find((option) => option.textContent?.includes("Acme retro"))!);

    const linkCall = mockedApiFetch.mock.calls.find(
      ([url, callOptions]) =>
        url === "/api/calendar/meetings/link" &&
        (callOptions as any)?.method === "POST"
    );
    expect(linkCall).toBeTruthy();
    expect(JSON.parse((linkCall![1] as any).body)).toEqual({
      meetingId: "m-recent",
      externalEventId: "g1",
    });

    // The drawer reflects the link immediately.
    expect(detailSheet()!.textContent).toContain("Open Taskwise meeting");
    expect(detailSheet()!.textContent).toContain("Acme retro");

    cleanup();
  });

  it("shows the matched Taskwise meeting for a Google event linked by external id", async () => {
    mockedApiFetch.mockImplementation(((url: string, options?: RequestInit) => {
      if (url.startsWith("/api/calendar?")) {
        return Promise.resolve({
          ...calendarPayload,
          meetings: [
            { ...calendarPayload.meetings[0], calendarEventId: "g1" },
          ],
        });
      }
      return routeApiFetch(url, options);
    }) as any);
    const { cleanup } = await renderCalendar();

    await click(findEntryButton("External planning call"));

    const sheet = detailSheet();
    expect(sheet!.textContent).toContain("Open Taskwise meeting");
    const openMeeting = sheet!.querySelector(
      '[data-testid="calendar-detail-open-meeting"]'
    ) as HTMLAnchorElement;
    expect(openMeeting.getAttribute("href")).toBe("/meetings/m1");
    expect(
      sheet!.querySelector('[data-testid="calendar-detail-create-meeting"]')
    ).toBeNull();

    cleanup();
  });
});
