import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getSessionUserId } from "@/lib/server-auth";
import { getGoogleAccessTokenForUser } from "@/lib/google-auth";

const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export async function POST(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { title, description, startTime, endTime, attendees } = body || {};

  if (!title || !startTime || !endTime) {
    return NextResponse.json(
      { error: "Missing title, start time, or end time." },
      { status: 400 }
    );
  }

  const attendeeList = Array.isArray(attendees)
    ? attendees.map((email: string) => String(email).trim().toLowerCase()).filter(isValidEmail)
    : [];

  if (attendeeList.length === 0) {
    return NextResponse.json(
      { error: "At least one attendee email is required." },
      { status: 400 }
    );
  }

  try {
    const accessToken = await getGoogleAccessTokenForUser(userId);
    if (!accessToken) {
      return NextResponse.json({ error: "Google not connected." }, { status: 404 });
    }

    const response = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          summary: String(title).trim(),
          description: typeof description === "string" ? description.trim() : "",
          start: { dateTime: startTime },
          end: { dateTime: endTime },
          attendees: attendeeList.map((email) => ({ email })),
          conferenceData: {
            createRequest: {
              requestId: randomUUID(),
              conferenceSolutionKey: { type: "hangoutsMeet" },
            },
          },
        }),
      }
    );

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error?.message || "Failed to create calendar event.");
    }

    const data = await response.json();
    return NextResponse.json({ event: data });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to create meeting." },
      { status: 500 }
    );
  }
}
