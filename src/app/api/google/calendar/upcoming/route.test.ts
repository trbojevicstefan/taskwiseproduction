import { GET } from "@/app/api/google/calendar/upcoming/route";
import { getGoogleAccessTokenForUser } from "@/lib/google-auth";
import { getSessionUserId } from "@/lib/server-auth";

jest.mock("@/lib/server-auth", () => ({
  getSessionUserId: jest.fn(),
}));

jest.mock("@/lib/google-auth", () => ({
  getGoogleAccessTokenForUser: jest.fn(),
}));

const mockedGetSessionUserId = getSessionUserId as jest.MockedFunction<
  typeof getSessionUserId
>;
const mockedGetGoogleAccessTokenForUser =
  getGoogleAccessTokenForUser as jest.MockedFunction<
    typeof getGoogleAccessTokenForUser
  >;

describe("GET /api/google/calendar/upcoming", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetSessionUserId.mockResolvedValue("user-1");
    mockedGetGoogleAccessTokenForUser.mockResolvedValue("google-token");
  });

  it("only returns actual meeting events and filters out office, non-working hours, and all-day blocks", async () => {
    const googleResponse = {
      items: [
        {
          id: "meeting-1",
          summary: "Product Sync",
          start: { dateTime: "2026-07-09T10:00:00.000Z" },
          end: { dateTime: "2026-07-09T10:30:00.000Z" },
          hangoutLink: "https://meet.google.com/abc-defg-hij",
          attendees: [{ email: "jane@example.com", displayName: "Jane Doe" }],
        },
        {
          id: "office-1",
          summary: "Office",
          start: { dateTime: "2026-07-09T12:00:00.000Z" },
          end: { dateTime: "2026-07-09T17:00:00.000Z" },
          location: "https://maps.google.com/?q=Main+Office",
          eventType: "workingLocation",
        },
        {
          id: "ooo-1",
          summary: "Non working hours",
          start: { date: "2026-07-10" },
          end: { date: "2026-07-11" },
          hangoutLink: "https://meet.google.com/ooo-break",
          eventType: "outOfOffice",
        },
      ],
    };

    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify(googleResponse), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const response = await GET(
      new Request(
        "http://localhost/api/google/calendar/upcoming?start=2026-07-09T00:00:00.000Z&end=2026-07-10T00:00:00.000Z"
      )
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const payload = await response.json();
    expect(payload.events).toEqual([
      expect.objectContaining({
        id: "meeting-1",
        title: "Product Sync",
        hangoutLink: "https://meet.google.com/abc-defg-hij",
      }),
    ]);
  });
});
