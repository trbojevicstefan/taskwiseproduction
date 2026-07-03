import {
  buildMeetingDedupeFingerprints,
  buildMeetingScopeFilter,
  extractMeetingAttendeesFromPayload,
  mergeMeetingPeopleLists,
} from "@/lib/fathom-ingest-helpers";

describe("fathom-ingest-helpers", () => {
  it("builds stable dedupe fingerprints from titles, urls, and time anchors", () => {
    const fingerprints = buildMeetingDedupeFingerprints({
      title: "Weekly Sync",
      recordingUrl: "https://Example.com/meetings/123/?foo=bar",
      shareUrl: "https://example.com/share/abc/",
      startTime: new Date("2026-07-02T10:02:00.000Z"),
      endTime: new Date("2026-07-02T10:47:00.000Z"),
      durationSeconds: 2700,
    });

    expect(fingerprints).toEqual(
      expect.arrayContaining([
        "title:weekly sync|t:5943288",
        "title:weekly sync|t:5943288|d:45",
        "recording_url:https://example.com/meetings/123?foo=bar|t:5943288",
        "recording_url:https://example.com/meetings/123?foo=bar|t:5943297",
        "share_url:https://example.com/share/abc|t:5943288",
        "share_url:https://example.com/share/abc|t:5943297",
      ])
    );
  });

  it("normalizes attendee lists from mixed payload shapes", () => {
    const attendees = extractMeetingAttendeesFromPayload({
      attendees: [
        "Ada Lovelace",
        { email: "grace@example.com", title: "Engineer" },
      ],
      recording: {
        participants: [{ name: "ada lovelace", role: "mentioned" }],
      },
    });

    expect(attendees).toEqual([
      {
        name: "Ada Lovelace",
        role: "attendee",
      },
      {
        name: "Grace",
        email: "grace@example.com",
        title: "Engineer",
        role: "attendee",
      },
    ]);
  });

  it("merges attendees and upgrades mentioned people to attendees", () => {
    const merged = mergeMeetingPeopleLists(
      [
        { name: "Ada Lovelace", role: "attendee" },
        { name: "Grace Hopper", role: "mentioned" },
      ],
      [{ name: "grace hopper", role: "attendee", title: "Rear Admiral" }]
    );

    expect(merged).toEqual([
      {
        name: "Ada Lovelace",
        role: "attendee",
      },
      {
        name: "Grace Hopper",
        title: "Rear Admiral",
        role: "attendee",
      },
    ]);
  });

  it("builds workspace-scoped filters when a workspace is available", () => {
    expect(buildMeetingScopeFilter({ userId: "user-1", workspaceId: "workspace-1" })).toEqual({
      userId: "user-1",
      $or: [{ workspaceId: "workspace-1" }, { workspaceId: null }, { workspaceId: { $exists: false } }],
    });
  });

  it("builds a user-only filter when no workspace is available", () => {
    expect(buildMeetingScopeFilter({ userId: "user-1", workspaceId: null })).toEqual({
      userId: "user-1",
    });
  });
});
