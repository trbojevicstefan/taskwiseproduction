import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import MonthView from "@/components/dashboard/calendar/MonthView";
import { buildDayEntries } from "@/components/dashboard/calendar/calendar-utils";
import {
  EMPTY_CALENDAR_WARNINGS,
  type CalendarData,
  type GoogleCalendarOverlayEvent,
} from "@/components/dashboard/calendar/types";

const anchor = new Date(2026, 6, 15); // July 2026

const buildData = (): CalendarData => ({
  meetings: [
    {
      id: "meeting-1",
      title: "Weekly sync",
      startTime: new Date(2026, 6, 10, 10, 0).toISOString(),
      attendeeCount: 4,
      isClientMeeting: false,
    },
    {
      id: "meeting-2",
      title: "Acme QBR",
      startTime: new Date(2026, 6, 10, 14, 0).toISOString(),
      attendeeCount: 6,
      isClientMeeting: true,
    },
  ],
  tasks: [
    {
      id: "task-1",
      title: "Send proposal",
      dueAt: "2026-07-10",
      status: "todo",
      priorityLabel: "urgent",
      priorityScore: 90,
      cleanupStatus: null,
      assigneeName: "Ana",
      sourceSessionId: "meeting-1",
      overdue: false,
    },
    {
      id: "task-2",
      title: "Update deck",
      dueAt: "2026-07-10",
      status: "todo",
      priorityLabel: null,
      priorityScore: null,
      cleanupStatus: null,
      assigneeName: null,
      sourceSessionId: null,
      overdue: true,
    },
    {
      id: "task-3",
      title: "Lone task",
      dueAt: "2026-07-22",
      status: "todo",
      priorityLabel: "medium",
      priorityScore: 40,
      cleanupStatus: null,
      assigneeName: "Bo",
      sourceSessionId: null,
      overdue: false,
    },
  ],
  warnings: EMPTY_CALENDAR_WARNINGS,
});

const googleEvents: GoogleCalendarOverlayEvent[] = [
  {
    id: "gcal-1",
    title: "External planning call",
    startTime: new Date(2026, 6, 10, 16, 0).toISOString(),
    hangoutLink: "https://meet.google.com/abc",
  },
];

describe("MonthView", () => {
  it("renders the full Monday-start grid for July 2026 (35 day cells)", () => {
    const markup = renderToStaticMarkup(
      <MonthView
        anchor={anchor}
        entriesByDay={buildDayEntries(buildData(), [])}
        onEntryClick={jest.fn()}
      />
    );

    const cellCount = (markup.match(/data-testid="month-day-cell"/g) || [])
      .length;
    expect(cellCount).toBe(35);
    expect(markup).toContain('data-view="month"');
    expect(markup).toContain("Mon");
    expect(markup).toContain("Sun");
  });

  it("renders pills from the payload and collapses overflow into '+N more'", () => {
    const markup = renderToStaticMarkup(
      <MonthView
        anchor={anchor}
        entriesByDay={buildDayEntries(buildData(), googleEvents)}
        onEntryClick={jest.fn()}
      />
    );

    // July 10 holds 5 entries: 3 visible pills + "+2 more".
    expect(markup).toContain("Weekly sync");
    expect(markup).toContain("Acme QBR");
    expect(markup).toContain("External planning call");
    expect(markup).toContain("+2 more");
    // The single entry on July 22 renders directly, no overflow.
    expect(markup).toContain("Lone task");
    expect(markup).not.toContain("+1 more");
  });

  it("does not render pills for days without entries", () => {
    const markup = renderToStaticMarkup(
      <MonthView
        anchor={anchor}
        entriesByDay={new Map()}
        onEntryClick={jest.fn()}
      />
    );

    expect(markup).not.toContain('data-testid="calendar-entry-pill"');
    expect(markup).not.toContain("more");
  });
});
