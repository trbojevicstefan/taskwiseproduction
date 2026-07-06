import {
  buildUpcomingMeetingItems,
  collectOpenTasksForAttendees,
  normalizeUpcomingAttendees,
} from "@/lib/planning-upcoming";
import { meetingNeedsAgenda } from "@/lib/meeting-agenda";
import type { GoogleUpcomingEvent } from "@/lib/google-calendar-upcoming";

const NOW = new Date("2026-07-06T12:00:00.000Z");

const googleEvent = (
  overrides: Partial<GoogleUpcomingEvent> = {}
): GoogleUpcomingEvent => ({
  id: "gev-1",
  title: "Weekly Sync",
  startTime: "2026-07-07T10:00:00.000Z",
  endTime: "2026-07-07T10:30:00.000Z",
  hangoutLink: "https://meet.google.com/abc",
  location: null,
  organizer: "host@acme.com",
  description: null,
  attendees: [
    { email: "alice@client.com", name: "Alice Client", responseStatus: null },
  ],
  ...overrides,
});

describe("normalizeUpcomingAttendees", () => {
  it("handles strings, person objects, and google attendee objects", () => {
    expect(
      normalizeUpcomingAttendees([
        "Bob Internal",
        { name: "Alice Client", email: "Alice@Client.com" },
        { displayName: "Carla", email: "carla@x.com" },
        { responseStatus: "accepted" }, // no identity — dropped
        null,
        42,
      ])
    ).toEqual([
      { name: "Bob Internal", email: null },
      { name: "Alice Client", email: "alice@client.com" },
      { name: "Carla", email: "carla@x.com" },
    ]);
  });

  it("returns [] for non-arrays", () => {
    expect(normalizeUpcomingAttendees(undefined)).toEqual([]);
    expect(normalizeUpcomingAttendees("nope")).toEqual([]);
  });
});

describe("collectOpenTasksForAttendees", () => {
  const openTasks = [
    { _id: "t-email", assignee: { email: "Alice@Client.com" } },
    { _id: "t-name", assigneeName: "Bob Internal!" },
    { _id: "t-namekey", assigneeNameKey: "carla core" },
    { _id: "t-other", assigneeName: "Someone Else" },
  ];

  it("matches by email (case-insensitive) and normalized name", () => {
    const { count, taskIds } = collectOpenTasksForAttendees(
      [
        { name: null, email: "alice@client.com" },
        { name: "bob internal", email: null },
        { name: "Carla Core", email: null },
      ],
      openTasks
    );
    expect(count).toBe(3);
    expect(taskIds).toEqual(["t-email", "t-name", "t-namekey"]);
  });

  it("returns zero when the meeting has no identifiable attendees", () => {
    expect(collectOpenTasksForAttendees([], openTasks)).toEqual({
      count: 0,
      taskIds: [],
    });
  });
});

describe("meetingNeedsAgenda", () => {
  it("is true without agenda sections and false with at least one valid one", () => {
    expect(meetingNeedsAgenda({})).toBe(true);
    expect(meetingNeedsAgenda({ agenda: [] })).toBe(true);
    expect(meetingNeedsAgenda({ agenda: [{ junk: true }] })).toBe(true);
    expect(
      meetingNeedsAgenda({
        agenda: [{ id: "a", title: "Intro", notes: "", order: 0 }],
      })
    ).toBe(false);
  });
});

describe("buildUpcomingMeetingItems", () => {
  it("merges taskwise + google, dedupes by calendarEventId, flags needsAgenda, counts open tasks", () => {
    const items = buildUpcomingMeetingItems({
      taskwiseMeetings: [
        {
          _id: "m-linked",
          title: "Weekly Sync",
          startTime: "2026-07-07T10:00:00.000Z",
          calendarEventId: "gev-1",
          attendees: [{ name: "Alice Client", email: "alice@client.com" }],
          agenda: [{ id: "a", title: "Intro", order: 0 }],
        },
        {
          _id: "m-solo",
          title: "Internal Prep",
          startTime: new Date("2026-07-08T09:00:00.000Z"),
          attendees: ["Bob Internal"],
        },
        {
          // In the past — excluded even if the query returned it.
          _id: "m-past",
          title: "Old",
          startTime: "2026-07-01T10:00:00.000Z",
        },
        {
          // No startTime — excluded.
          _id: "m-nostart",
          title: "Pasted transcript",
        },
      ],
      googleEvents: [
        googleEvent(),
        googleEvent({
          id: "gev-2",
          title: "Client Kickoff",
          startTime: "2026-07-09T14:00:00.000Z",
          attendees: [
            { email: "alice@client.com", name: "Alice Client", responseStatus: null },
          ],
        }),
      ],
      openTasks: [
        { _id: "t-1", assignee: { email: "alice@client.com" } },
        { _id: "t-2", assigneeName: "Bob Internal" },
      ],
      now: NOW,
    });

    expect(items.map((item) => item.id)).toEqual([
      "tw:m-linked",
      "tw:m-solo",
      "g:gev-2",
    ]);

    const linked = items[0];
    expect(linked.source).toBe("linked");
    expect(linked.meetingId).toBe("m-linked");
    expect(linked.googleEventId).toBe("gev-1");
    expect(linked.hangoutLink).toBe("https://meet.google.com/abc");
    expect(linked.needsAgenda).toBe(false);
    expect(linked.agendaSectionCount).toBe(1);
    expect(linked.openTaskCount).toBe(1);
    expect(linked.openTaskIds).toEqual(["t-1"]);

    const solo = items[1];
    expect(solo.source).toBe("taskwise");
    expect(solo.needsAgenda).toBe(true);
    expect(solo.openTaskCount).toBe(1);
    expect(solo.openTaskIds).toEqual(["t-2"]);

    const google = items[2];
    expect(google.source).toBe("google");
    expect(google.meetingId).toBeNull();
    expect(google.needsAgenda).toBe(true);
    expect(google.openTaskCount).toBe(1);
  });

  it("dedupes by normalized title + start within 45 minutes when no event id link exists", () => {
    const items = buildUpcomingMeetingItems({
      taskwiseMeetings: [
        {
          _id: "m-1",
          title: "Weekly  Sync!",
          startTime: "2026-07-07T10:20:00.000Z",
          attendees: [],
        },
      ],
      googleEvents: [googleEvent()],
      openTasks: [],
      now: NOW,
    });

    expect(items).toHaveLength(1);
    expect(items[0].source).toBe("linked");
    expect(items[0].googleEventId).toBe("gev-1");
    // Attendees fall back to the google event's when the meeting has none.
    expect(items[0].attendees).toEqual([
      { name: "Alice Client", email: "alice@client.com" },
    ]);
  });

  it("does NOT dedupe same-title events far apart in time", () => {
    const items = buildUpcomingMeetingItems({
      taskwiseMeetings: [
        {
          _id: "m-1",
          title: "Weekly Sync",
          startTime: "2026-07-07T16:00:00.000Z",
          attendees: [],
        },
      ],
      googleEvents: [googleEvent()],
      openTasks: [],
      now: NOW,
    });

    expect(items.map((item) => item.id)).toEqual(["g:gev-1", "tw:m-1"]);
  });

  it("sorts by startTime ascending and respects the limit", () => {
    const items = buildUpcomingMeetingItems({
      taskwiseMeetings: [
        { _id: "m-later", title: "B", startTime: "2026-07-09T10:00:00.000Z" },
        { _id: "m-sooner", title: "A", startTime: "2026-07-07T08:00:00.000Z" },
      ],
      googleEvents: [
        googleEvent({ id: "gev-mid", title: "Mid", startTime: "2026-07-08T08:00:00.000Z" }),
      ],
      openTasks: [],
      now: NOW,
      limit: 2,
    });

    expect(items.map((item) => item.id)).toEqual(["tw:m-sooner", "g:gev-mid"]);
  });

  it("filters google events that already started", () => {
    const items = buildUpcomingMeetingItems({
      taskwiseMeetings: [],
      googleEvents: [
        googleEvent({ id: "gev-past", startTime: "2026-07-06T09:00:00.000Z" }),
      ],
      openTasks: [],
      now: NOW,
    });
    expect(items).toEqual([]);
  });
});
