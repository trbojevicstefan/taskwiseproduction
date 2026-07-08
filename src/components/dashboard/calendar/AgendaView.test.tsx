import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AgendaView from "@/components/dashboard/calendar/AgendaView";
import { buildDayEntries } from "@/components/dashboard/calendar/calendar-utils";
import {
  EMPTY_CALENDAR_DATA,
  EMPTY_CALENDAR_WARNINGS,
} from "@/components/dashboard/calendar/types";
import { addDays, endOfDay, startOfDay } from "date-fns";

const range = {
  from: startOfDay(new Date()),
  to: endOfDay(addDays(new Date(), 30)),
};

describe("AgendaView", () => {
  it("renders the warnings strip with chips linking to cleanup", () => {
    const markup = renderToStaticMarkup(
      <AgendaView
        range={range}
        warnings={{
          overdueCount: 3,
          cleanupSuggestedCount: 2,
          expiredCount: 1,
        }}
        entriesByDay={new Map()}
        onEntryClick={jest.fn()}
      />
    );

    expect(markup).toContain('data-testid="warnings-strip"');
    expect(markup).toContain("3 overdue");
    expect(markup).toContain("2 cleanup suggestions");
    expect(markup).toContain("1 expired");
    expect(markup).toContain('href="/review/cleanup"');
  });

  it("hides the warnings strip when all counts are zero", () => {
    const markup = renderToStaticMarkup(
      <AgendaView
        range={range}
        warnings={EMPTY_CALENDAR_WARNINGS}
        entriesByDay={new Map()}
        onEntryClick={jest.fn()}
      />
    );

    expect(markup).not.toContain('data-testid="warnings-strip"');
    expect(markup).toContain("Nothing scheduled or due in the next 30 days.");
  });

  it("groups entries under their day heading", () => {
    const dueTomorrow = addDays(new Date(), 1);
    const entriesByDay = buildDayEntries(
      {
        ...EMPTY_CALENDAR_DATA,
        meetings: [
          {
            id: "meeting-1",
            title: "Kickoff with client",
            startTime: new Date().toISOString(),
            attendeeCount: 3,
            isClientMeeting: true,
          },
        ],
        tasks: [
          {
            id: "task-1",
            title: "Follow up notes",
            dueAt: dueTomorrow.toISOString(),
            status: "todo",
            priorityLabel: null,
            priorityScore: null,
            cleanupStatus: null,
            assigneeName: "Ana",
            sourceSessionId: null,
            overdue: false,
          },
        ],
      },
      []
    );

    const markup = renderToStaticMarkup(
      <AgendaView
        range={range}
        warnings={EMPTY_CALENDAR_WARNINGS}
        entriesByDay={entriesByDay}
        onEntryClick={jest.fn()}
      />
    );

    const dayCount = (markup.match(/data-testid="agenda-day"/g) || []).length;
    expect(dayCount).toBe(2);
    expect(markup).toContain("Today");
    expect(markup).toContain("Kickoff with client");
    expect(markup).toContain("Follow up notes");
    expect(markup).toContain("Ana");
  });

  it("renders a reminder chip for scheduled Slack reminders", () => {
    const runAt = addDays(new Date(), 2);
    const remindersByDay = new Map([
      [
        `${runAt.getFullYear()}-${String(runAt.getMonth() + 1).padStart(2, "0")}-${String(
          runAt.getDate()
        ).padStart(2, "0")}`,
        [
          {
            id: "reminder-1",
            taskId: "task-1",
            taskTitle: "Send proposal to client",
            kind: "before_due" as const,
            runAt: runAt.toISOString(),
            status: "scheduled" as const,
          },
        ],
      ],
    ]);

    const markup = renderToStaticMarkup(
      <AgendaView
        range={range}
        warnings={EMPTY_CALENDAR_WARNINGS}
        entriesByDay={new Map()}
        remindersByDay={remindersByDay}
        onEntryClick={jest.fn()}
      />
    );

    expect(markup).toContain('data-testid="reminder-chip"');
    expect(markup).toContain("Reminder: Send proposal to client");
    expect(markup).toContain("Before due reminder");
    // The reminder-only day still renders a day section.
    expect(markup).toContain('data-testid="agenda-day"');
  });
});
