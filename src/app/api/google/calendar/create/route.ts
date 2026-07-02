import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-route";
import { randomUUID } from "crypto";
import { getSessionUserId } from "@/lib/server-auth";
import { getGoogleAccessTokenForUser } from "@/lib/google-auth";

const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export async function POST(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return apiError(401, "request_error", "Unauthorized");
  }

  const body = await request.json().catch(() => ({}));
  const { title, description, startTime, endTime, attendees } = body || {};

  if (!title || !startTime || !endTime) {
    return apiError(400, "request_error", "Missing title, start time, or end time.");
  }

  const attendeeList = Array.isArray(attendees)
    ? attendees.map((email: string) => String(email).trim().toLowerCase()).filter(isValidEmail)
    : [];

  if (attendeeList.length === 0) {
    return apiError(400, "request_error", "At least one attendee email is required.");
  }

  try {
    const accessToken = await getGoogleAccessTokenForUser(userId);
    if (!accessToken) {
      return apiError(404, "request_error", "Google not connected.");
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
          attendees: attendeeList.map((email: any) => ({ email })),
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



