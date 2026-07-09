import { NextResponse } from "next/server";
import { fetchGoogleUpcomingEvents } from "@/lib/google-calendar-upcoming";
import { getSessionUserId } from "@/lib/server-auth";

export async function GET(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const startParam = url.searchParams.get("start");
  const endParam = url.searchParams.get("end");
  const allEventsParam = url.searchParams.get("allEvents");
  const includeAllEvents = allEventsParam === "1" || allEventsParam === "true";
  const now = new Date();
  const startTime = startParam ? new Date(startParam) : now;
  const endTime = endParam
    ? new Date(endParam)
    : new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  try {
    const { connected, events } = await fetchGoogleUpcomingEvents(userId, {
      start: startTime,
      end: endTime,
      includeAllEvents,
    });
    if (!connected) {
      return NextResponse.json({ error: "Google not connected." }, { status: 404 });
    }

    return NextResponse.json({ events });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to fetch Google Calendar events." },
      { status: 500 }
    );
  }
}
