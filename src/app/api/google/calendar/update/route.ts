import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/server-auth";
import { getGoogleAccessTokenForUser } from "@/lib/google-auth";

export async function PATCH(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { eventId, description } = body || {};

  if (!eventId || typeof description !== "string") {
    return NextResponse.json(
      { error: "Missing eventId or description." },
      { status: 400 }
    );
  }

  try {
    const accessToken = await getGoogleAccessTokenForUser(userId);
    if (!accessToken) {
      return NextResponse.json({ error: "Google not connected." }, { status: 404 });
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
