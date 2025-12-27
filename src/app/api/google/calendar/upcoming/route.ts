import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/server-auth";
import { getGoogleAccessTokenForUser } from "@/lib/google-auth";

type CalendarEvent = {
  id: string;
  title: string;
  startTime: string;
  endTime?: string | null;
  hangoutLink?: string | null;
  location?: string | null;
  organizer?: string | null;
  attendees?: Array<{
    email: string;
    name?: string | null;
    responseStatus?: string | null;
  }>;
};

export async function GET(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const startParam = url.searchParams.get("start");
  const endParam = url.searchParams.get("end");
  const now = new Date();
  const startTime = startParam ? new Date(startParam) : now;
  const endTime = endParam ? new Date(endParam) : new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  try {
    const accessToken = await getGoogleAccessTokenForUser(userId);
    if (!accessToken) {
      return NextResponse.json({ error: "Google not connected." }, { status: 404 });
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

    const extractUrl = (value?: string | null) => {
      if (!value) return null;
      const match = value.match(/https?:\/\/\S+/i);
      return match ? match[0].replace(/[),.]+$/, "") : null;
    };

    const events: CalendarEvent[] = items
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
          item.hangoutLink || conferenceLink || locationLink || descriptionLink || null;

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
      .filter((event) => Boolean(event.startTime) && Boolean(event.hangoutLink));

    return NextResponse.json({ events });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to fetch Google Calendar events." },
      { status: 500 }
    );
  }
}
