import { parseFathomMeetingWebhookPayload } from "@/lib/fathom-ingest/webhook-parser";

describe("fathom-ingest/webhook-parser", () => {
  it("normalizes organizer, meeting metadata, attendees, and dedupe fingerprints", () => {
    const result = parseFathomMeetingWebhookPayload({
      organizer_email: " Host@Example.com ",
      title: "Weekly Sync",
      url: "https://example.com/meetings/123/?foo=bar",
      share_url: "https://example.com/share/abc/",
      recording_start_time: "2026-07-02T10:02:00.000Z",
      recording_end_time: "2026-07-02T10:47:00.000Z",
      duration: 2700,
      attendees: ["Ada Lovelace", { email: "grace@example.com", title: "Engineer" }],
      recording: {
        participants: [{ name: "ada lovelace", role: "mentioned" }],
      },
    });

    expect(result).toEqual({
      title: "Weekly Sync",
      recordingUrl: "https://example.com/meetings/123/?foo=bar",
      shareUrl: "https://example.com/share/abc/",
      startTime: new Date("2026-07-02T10:02:00.000Z"),
      endTime: new Date("2026-07-02T10:47:00.000Z"),
      durationSeconds: 2700,
      organizerEmail: "host@example.com",
      attendees: [
        { name: "Ada Lovelace", role: "attendee" },
        {
          name: "Grace",
          email: "grace@example.com",
          title: "Engineer",
          role: "attendee",
        },
      ],
      attendeeKeys: ["ada lovelace", "grace@example.com"],
      dedupeFingerprints: expect.arrayContaining([
        "title:weekly sync|t:5943288",
        "title:weekly sync|t:5943288|d:45",
        "recording_url:https://example.com/meetings/123?foo=bar|t:5943288",
        "share_url:https://example.com/share/abc|t:5943297",
      ]),
    });
  });
});
