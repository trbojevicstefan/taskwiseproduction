import {
  matchGoogleEventToMeeting,
  normalizeEventTitle,
  TIME_PROXIMITY_WINDOW_MS,
  type MatchableGoogleEvent,
  type MatchableMeeting,
} from "@/lib/calendar-event-matching";

const baseEvent = (overrides: Partial<MatchableGoogleEvent> = {}): MatchableGoogleEvent => ({
  id: "gcal-1",
  title: "Weekly Sync",
  startTime: "2026-07-06T10:00:00.000Z",
  organizer: "host@acme.com",
  attendees: [{ email: "ana@acme.com", name: "Ana" }],
  ...overrides,
});

const baseMeeting = (overrides: Partial<MatchableMeeting> = {}): MatchableMeeting => ({
  id: "m-1",
  title: "Weekly Sync",
  startTime: "2026-07-06T10:00:00.000Z",
  calendarEventId: null,
  organizerEmail: null,
  attendees: [],
  ...overrides,
});

describe("normalizeEventTitle", () => {
  it("lowercases, strips punctuation, and collapses whitespace", () => {
    expect(normalizeEventTitle("  Weekly   Sync — Q3!! ")).toBe("weekly sync q3");
    expect(normalizeEventTitle(null)).toBe("");
    expect(normalizeEventTitle(undefined)).toBe("");
  });
});

describe("matchGoogleEventToMeeting", () => {
  it("matches by stored external event id first, even when times differ", () => {
    const meetings = [
      baseMeeting({ id: "m-a", title: "Totally different", startTime: null }),
      baseMeeting({
        id: "m-b",
        title: "Unrelated title",
        startTime: "2026-01-01T00:00:00.000Z",
        calendarEventId: "gcal-1",
      }),
    ];

    expect(matchGoogleEventToMeeting(baseEvent(), meetings)).toEqual({
      meetingId: "m-b",
      matchType: "external_id",
    });
  });

  it("matches by normalized title + time proximity within the window", () => {
    const meetings = [
      baseMeeting({
        id: "m-close",
        title: "weekly sync!",
        // 30 minutes after the event start — inside the 45-minute window.
        startTime: "2026-07-06T10:30:00.000Z",
      }),
    ];

    expect(matchGoogleEventToMeeting(baseEvent(), meetings)).toEqual({
      meetingId: "m-close",
      matchType: "title_time",
    });
  });

  it("matches by organizer/attendee email overlap when titles differ", () => {
    const meetings = [
      baseMeeting({
        id: "m-att",
        title: "Fathom notes",
        startTime: "2026-07-06T10:10:00.000Z",
        attendees: [{ email: "ANA@acme.com ", name: "Ana" }],
      }),
    ];

    expect(matchGoogleEventToMeeting(baseEvent(), meetings)).toEqual({
      meetingId: "m-att",
      matchType: "attendee_time",
    });
  });

  it("prefers the title match over an attendee-only match, then the closest time", () => {
    const meetings = [
      baseMeeting({
        id: "m-attendee-closest",
        title: "Different name",
        startTime: "2026-07-06T10:01:00.000Z",
        organizerEmail: "host@acme.com",
      }),
      baseMeeting({
        id: "m-title-far",
        title: "Weekly sync",
        startTime: "2026-07-06T10:40:00.000Z",
      }),
      baseMeeting({
        id: "m-title-near",
        title: "Weekly sync",
        startTime: "2026-07-06T10:05:00.000Z",
      }),
    ];

    expect(matchGoogleEventToMeeting(baseEvent(), meetings)).toEqual({
      meetingId: "m-title-near",
      matchType: "title_time",
    });
  });

  it("returns null when nothing matches", () => {
    const meetings = [
      // Same title but outside the proximity window.
      baseMeeting({
        id: "m-far",
        startTime: new Date(
          new Date("2026-07-06T10:00:00.000Z").getTime() +
            TIME_PROXIMITY_WINDOW_MS +
            60_000
        ).toISOString(),
      }),
      // Close in time but neither the title nor any attendee overlaps.
      baseMeeting({
        id: "m-stranger",
        title: "Board review",
        startTime: "2026-07-06T10:05:00.000Z",
        attendees: [{ email: "other@else.com" }],
      }),
      // Unparseable startTime is skipped, not matched.
      baseMeeting({ id: "m-bad-date", startTime: "not-a-date" }),
    ];

    expect(matchGoogleEventToMeeting(baseEvent(), meetings)).toBeNull();
    expect(matchGoogleEventToMeeting(baseEvent({ startTime: null }), meetings)).toBeNull();
    expect(matchGoogleEventToMeeting(baseEvent(), [])).toBeNull();
  });

  it("does not cross local-day boundaries even inside the window", () => {
    // 23:50 local vs 00:20 next day local — 30 minutes apart but not the same day.
    const eventStart = new Date(2026, 6, 6, 23, 50, 0);
    const meetingStart = new Date(2026, 6, 7, 0, 20, 0);
    const meetings = [
      baseMeeting({ id: "m-midnight", startTime: meetingStart.toISOString() }),
    ];

    expect(
      matchGoogleEventToMeeting(
        baseEvent({ startTime: eventStart.toISOString() }),
        meetings
      )
    ).toBeNull();
  });
});
