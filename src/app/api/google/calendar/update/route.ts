import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-route";
import { getSessionUserId } from "@/lib/server-auth";
import { getGoogleAccessTokenForUser } from "@/lib/google-auth";

export async function PATCH(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return apiError(401, "request_error", "Unauthorized");
  }

  const body = await request.json().catch(() => ({}));
  const { eventId, description } = body || {};

  if (!eventId || typeof description !== "string") {
    return apiError(400, "request_error", "Missing eventId or description.");
  }

  try {
    const accessToken = await getGoogleAccessTokenForUser(userId);
    if (!accessToken) {
      return apiError(404, "request_error", "Google not connected.");
    }

    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ description }),
      }
    );

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error?.message || "Failed to update calendar event.");
    }

    const data = await response.json();
    return NextResponse.json({ event: data });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to update meeting description." },
      { status: 500 }
    );
  }
}


