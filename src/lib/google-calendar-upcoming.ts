// src/lib/google-calendar-upcoming.ts
//
// Server helper for reading upcoming Google Calendar events for a user.
// Extracted (behavior-preserving) from GET /api/google/calendar/upcoming so
// server-side callers (Priority 12 planning routes) can reuse the same fetch
// without going through HTTP.
//
// Contract notes:
// - By default only events with a resolvable meeting link (hangoutLink /
//   conference entry point / URL in location or description) are returned —
//   the Meeting Planner depends on this. Pass `includeAllEvents: true` to get
//   every non-cancelled event (the `?allEvents=1` opt-in of the route).
// - `connected: false` means no Google access token for the user (the route
//   maps this to 404 "Google not connected.").
// - Google API failures throw; callers decide whether that is fatal.

import { getGoogleAccessTokenForUser } from "@/lib/google-auth";

export type GoogleUpcomingAttendee = {
  email: string;
  name?: string | null;
  responseStatus?: string | null;
};

export type GoogleUpcomingEvent = {
  id: string;
  title: string;
  startTime: string;
  endTime?: string | null;
  hangoutLink?: string | null;
  location?: string | null;
  organizer?: string | null;
  description?: string | null;
  attendees: GoogleUpcomingAttendee[];
};

export type FetchGoogleUpcomingEventsOptions = {
  start?: Date;
  end?: Date;
  includeAllEvents?: boolean;
};

export type FetchGoogleUpcomingEventsResult = {
  connected: boolean;
  events: GoogleUpcomingEvent[];
};

const extractUrl = (value?: string | null) => {
  if (!value) return null;
  const match = value.match(/https?:\/\/\S+/i);
  return match ? match[0].replace(/[),.]+$/, "") : null;
};

export async function fetchGoogleUpcomingEvents(
  userId: string,
  options: FetchGoogleUpcomingEventsOptions = {}
): Promise<FetchGoogleUpcomingEventsResult> {
  const now = new Date();
  const startTime = options.start ?? now;
  const endTime =
    options.end ?? new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const includeAllEvents = options.includeAllEvents === true;

  const accessToken = await getGoogleAccessTokenForUser(userId);
  if (!accessToken) {
    return { connected: false, events: [] };
  }

  const eventsUrl = new URL(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events"
  );
  eventsUrl.searchParams.set("timeMin", startTime.toISOString());
  eventsUrl.searchParams.set("timeMax", endTime.toISOString());
  eventsUrl.searchParams.set("singleEvents", "true");
  eventsUrl.searchParams.set("orderBy", "startTime");
  eventsUrl.searchParams.set("maxResults", "250");
  eventsUrl.searchParams.set("conferenceDataVersion", "1");

  const response = await fetch(eventsUrl.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error?.message || "Google Calendar API error.");
  }

  const data = await response.json();
  const items = Array.isArray(data.items) ? data.items : [];

  const events: GoogleUpcomingEvent[] = items
    .filter((item: any) => item.status !== "cancelled")
    .map((item: any) => {
      const start = item.start?.dateTime || item.start?.date;
      const end = item.end?.dateTime || item.end?.date;
      const conferenceLink = item.conferenceData?.entryPoints?.find(
        (entry: any) => entry.uri
      )?.uri;
      const locationLink = extractUrl(item.location);
      const descriptionLink = extractUrl(item.description);
      const hangoutLink =
        item.hangoutLink ||
        conferenceLink ||
        locationLink ||
        descriptionLink ||
        null;

      return {
        id: item.id,
        title: item.summary || "Untitled Meeting",
        startTime: start,
        endTime: end,
        hangoutLink,
        location: item.location || null,
        organizer: item.organizer?.email || null,
        description: item.description || null,
        attendees: Array.isArray(item.attendees)
          ? item.attendees.map((attendee: any) => ({
              email: attendee.email,
              name: attendee.displayName || null,
              responseStatus: attendee.responseStatus || null,
            }))
          : [],
      };
    })
    .filter(
      (event: any) =>
        Boolean(event.startTime) &&
        (includeAllEvents || Boolean(event.hangoutLink))
    );

  return { connected: true, events };
}
