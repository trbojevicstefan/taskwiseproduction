import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CalendarPageContent from "@/components/dashboard/calendar/CalendarPageContent";
import {
  CALENDAR_VIEW_STORAGE_KEY,
  readStoredCalendarView,
  storeCalendarView,
} from "@/components/dashboard/calendar/calendar-utils";
import { useRouter } from "next/navigation";

jest.mock("next/navigation", () => ({
  useRouter: jest.fn(),
}));

jest.mock("@/lib/api", () => ({
  apiFetch: jest.fn(),
}));

jest.mock("@/lib/realtime-client", () => ({
  subscribeRealtimeUpdates: jest.fn(() => jest.fn()),
}));

jest.mock("@/contexts/IntegrationsContext", () => ({
  useIntegrations: () => ({ isGoogleTasksConnected: false }),
}));

jest.mock("@/components/dashboard/DashboardHeader", () => ({
  __esModule: true,
  default: ({ children, pageTitle, description }: any) => (
    <header>
      <div>{pageTitle}</div>
      <p>{description}</p>
      <div>{children}</div>
    </header>
  ),
}));

const mockedUseRouter = useRouter as jest.MockedFunction<typeof useRouter>;

const setFakeLocalStorage = (storedView: string | null) => {
  const storage = {
    getItem: jest.fn(() => storedView),
    setItem: jest.fn(),
  };
  (globalThis as any).localStorage = storage;
  return storage;
};

describe("CalendarPageContent", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseRouter.mockReturnValue({
      push: jest.fn(),
      replace: jest.fn(),
      prefetch: jest.fn(),
      refresh: jest.fn(),
      back: jest.fn(),
      forward: jest.fn(),
    } as any);
  });

  afterEach(() => {
    delete (globalThis as any).localStorage;
  });

  it("renders the calendar header, toolbar, and defaults to the month view", () => {
    const markup = renderToStaticMarkup(<CalendarPageContent />);

    expect(markup).toContain("Calendar");
    expect(markup).toContain(
      "See what happened, what is due, and who needs a reminder."
    );
    expect(markup).toContain("Month");
    expect(markup).toContain("Week");
    expect(markup).toContain("Agenda");
    expect(markup).toContain("Today");
    expect(markup).toContain('data-view="month"');
    expect(markup).toContain('data-testid="calendar-range-label"');
  });

  it("restores the persisted view from localStorage", () => {
    setFakeLocalStorage("week");

    const markup = renderToStaticMarkup(<CalendarPageContent />);

    expect(markup).toContain('data-view="week"');
    expect(markup).not.toContain('data-view="month"');
  });

  it("persists view changes to localStorage via storeCalendarView", () => {
    const storage = setFakeLocalStorage(null);

    storeCalendarView("agenda");

    expect(storage.setItem).toHaveBeenCalledWith(
      CALENDAR_VIEW_STORAGE_KEY,
      "agenda"
    );
  });

  it("falls back to the month view for missing or invalid stored values", () => {
    setFakeLocalStorage("bogus");
    expect(readStoredCalendarView()).toBe("month");

    delete (globalThis as any).localStorage;
    expect(readStoredCalendarView()).toBe("month");

    setFakeLocalStorage("agenda");
    expect(readStoredCalendarView()).toBe("agenda");
  });
});
