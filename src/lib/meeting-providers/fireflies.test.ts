import { createHmac } from "crypto";
import {
  FIREFLIES_GRAPHQL_ENDPOINT,
  firefliesMeetingProvider,
} from "@/lib/meeting-providers/fireflies";
import type { MeetingProviderConnection } from "@/lib/meeting-providers/types";

const connection: MeetingProviderConnection = {
  _id: "conn-1",
  workspaceId: "ws-1",
  userId: "user-1",
  provider: "fireflies",
  status: "active",
  apiKey: "ff-api-key",
  accountName: "Acme",
  webhookSecret: "shhh",
};

const sign = (body: string, secret: string) =>
  `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;

const graphqlResponse = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const mockFetch = (body: unknown, status = 200) => {
  const fetchMock = jest.fn().mockResolvedValue(graphqlResponse(body, status));
  global.fetch = fetchMock as any;
  return fetchMock;
};

const sentRequestBody = (fetchMock: jest.Mock) =>
  JSON.parse(String(fetchMock.mock.calls[0][1].body));

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

describe("firefliesMeetingProvider basics", () => {
  it("is registered under the fireflies id without the legacy webhook flag", () => {
    expect(firefliesMeetingProvider.provider).toBe("fireflies");
    expect(firefliesMeetingProvider.legacyWebhook).toBeUndefined();
  });
});

describe("verifyWebhookRequest", () => {
  const body = JSON.stringify({ meetingId: "abc", eventType: "Transcription completed" });

  it("accepts a valid x-hub-signature", () => {
    const headers = new Headers({ "x-hub-signature": sign(body, "shhh") });
    expect(firefliesMeetingProvider.verifyWebhookRequest(body, headers, "shhh")).toBe(true);
  });

  it("accepts uppercase hex digests", () => {
    const upper = sign(body, "shhh").replace(/^sha256=/, "").toUpperCase();
    const headers = new Headers({ "x-hub-signature": `sha256=${upper}` });
    expect(firefliesMeetingProvider.verifyWebhookRequest(body, headers, "shhh")).toBe(true);
  });

  it("rejects a signature computed with the wrong secret", () => {
    const headers = new Headers({ "x-hub-signature": sign(body, "wrong-secret") });
    expect(firefliesMeetingProvider.verifyWebhookRequest(body, headers, "shhh")).toBe(false);
  });

  it("rejects a signature over a different body", () => {
    const headers = new Headers({ "x-hub-signature": sign("tampered", "shhh") });
    expect(firefliesMeetingProvider.verifyWebhookRequest(body, headers, "shhh")).toBe(false);
  });

  it("rejects when the header is missing or malformed", () => {
    expect(
      firefliesMeetingProvider.verifyWebhookRequest(body, new Headers(), "shhh")
    ).toBe(false);
    expect(
      firefliesMeetingProvider.verifyWebhookRequest(
        body,
        new Headers({ "x-hub-signature": "md5=deadbeef" }),
        "shhh"
      )
    ).toBe(false);
    expect(
      firefliesMeetingProvider.verifyWebhookRequest(
        body,
        new Headers({ "x-hub-signature": "sha256=nothex" }),
        "shhh"
      )
    ).toBe(false);
  });

  it("accepts any request when no secret is stored (fathom precedent)", () => {
    expect(firefliesMeetingProvider.verifyWebhookRequest(body, new Headers(), null)).toBe(
      true
    );
  });
});

describe("parseWebhookPayload", () => {
  it("returns a ref for the v1 Transcription completed event", () => {
    expect(
      firefliesMeetingProvider.parseWebhookPayload({
        meetingId: "IQqtEWDVUwsF",
        eventType: "Transcription completed",
        clientReferenceId: "ref-1",
      })
    ).toEqual({ kind: "ref", externalMeetingId: "IQqtEWDVUwsF" });
  });

  it("returns a ref for v2-style event/meeting_id payloads", () => {
    expect(
      firefliesMeetingProvider.parseWebhookPayload({
        meeting_id: "abc123",
        event: "transcription.completed",
      })
    ).toEqual({ kind: "ref", externalMeetingId: "abc123" });
  });

  it("returns a ref when the event type is absent but a meeting id exists", () => {
    expect(firefliesMeetingProvider.parseWebhookPayload({ meetingId: "m-9" })).toEqual({
      kind: "ref",
      externalMeetingId: "m-9",
    });
  });

  it("ignores other event types", () => {
    const parsed = firefliesMeetingProvider.parseWebhookPayload({
      meetingId: "m-1",
      eventType: "Meeting deleted",
    });
    expect(parsed.kind).toBe("ignore");
  });

  it("ignores payloads without a meeting id", () => {
    expect(
      firefliesMeetingProvider.parseWebhookPayload({ eventType: "Transcription completed" })
        .kind
    ).toBe("ignore");
  });

  it("never throws on malformed payloads", () => {
    expect(firefliesMeetingProvider.parseWebhookPayload(null).kind).toBe("ignore");
    expect(firefliesMeetingProvider.parseWebhookPayload("boom").kind).toBe("ignore");
    expect(firefliesMeetingProvider.parseWebhookPayload([1, 2]).kind).toBe("ignore");
    expect(
      firefliesMeetingProvider.parseWebhookPayload({ meetingId: 42, eventType: {} }).kind
    ).toBe("ignore");
  });
});

describe("validateCredentials", () => {
  it("returns ok with the account name for a valid key", async () => {
    const fetchMock = mockFetch({
      data: { user: { name: "Jane Doe", email: "jane@acme.com" } },
    });

    const result = await firefliesMeetingProvider.validateCredentials({
      apiKey: "ff-api-key",
    });

    expect(result).toEqual({ ok: true, accountName: "Jane Doe" });
    expect(fetchMock).toHaveBeenCalledWith(
      FIREFLIES_GRAPHQL_ENDPOINT,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer ff-api-key",
          "Content-Type": "application/json",
        }),
      })
    );
    expect(sentRequestBody(fetchMock).query).toContain("user");
  });

  it("falls back to the email when the user has no name", async () => {
    mockFetch({ data: { user: { email: "Jane@Acme.com" } } });
    const result = await firefliesMeetingProvider.validateCredentials({
      apiKey: "ff-api-key",
    });
    expect(result).toEqual({ ok: true, accountName: "jane@acme.com" });
  });

  it("fails for an invalid key (HTTP 401 with GraphQL errors)", async () => {
    mockFetch(
      { errors: [{ message: "Invalid API key", extensions: { code: "invalid_api_key" } }] },
      401
    );
    const result = await firefliesMeetingProvider.validateCredentials({ apiKey: "bad" });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Invalid API key");
  });

  it("fails on GraphQL errors even with HTTP 200", async () => {
    mockFetch({ errors: [{ message: "Forbidden" }], data: null });
    const result = await firefliesMeetingProvider.validateCredentials({ apiKey: "bad" });
    expect(result).toEqual({ ok: false, error: "Forbidden" });
  });

  it("fails without calling fetch when the key is empty", async () => {
    const fetchMock = mockFetch({});
    const result = await firefliesMeetingProvider.validateCredentials({ apiKey: "  " });
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never throws on network errors", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("ECONNRESET")) as any;
    const result = await firefliesMeetingProvider.validateCredentials({ apiKey: "key" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("ECONNRESET");
  });
});

describe("fetchMeeting", () => {
  const fullTranscript = {
    id: "transcript-1",
    title: "  Weekly Sync  ",
    date: 1751500800000, // 2025-07-03T00:00:00.000Z
    duration: 30.5, // minutes
    transcript_url: "https://app.fireflies.ai/view/transcript-1",
    audio_url: "https://cdn.fireflies.ai/audio-1.mp3",
    video_url: "https://cdn.fireflies.ai/video-1.mp4",
    host_email: "HOST@acme.com",
    organizer_email: "Organizer@Acme.com",
    participants: ["jane@acme.com", "extra@client.com", "not-an-email"],
    meeting_attendees: [
      { displayName: "Jane Doe", email: "Jane@Acme.com", name: "Jane" },
      { displayName: null, email: "bob@acme.com", name: null },
      { displayName: null, email: null, name: null },
    ],
    sentences: [
      { speaker_name: "Jane Doe", text: "Hello everyone.", start_time: 0 },
      { speaker_name: null, text: "Hi Jane!", start_time: 65.4 },
      { speaker_name: "Bob", text: "   ", start_time: 70 },
      "garbage",
    ],
    summary: {
      overview: "Team discussed the launch.",
      action_items: "**Jane Doe**\n- Ship the release (10:00)\n* Email the client\n\n**Bob**\n1. Update the docs",
      keywords: ["launch"],
    },
  };

  it("maps a full transcript into a NormalizedProviderMeeting", async () => {
    const fetchMock = mockFetch({ data: { transcript: fullTranscript } });

    const meeting = await firefliesMeetingProvider.fetchMeeting!(
      connection,
      "transcript-1"
    );

    expect(meeting).toMatchObject({
      externalId: "transcript-1",
      title: "Weekly Sync",
      durationSeconds: 30.5 * 60,
      recordingUrl: "https://cdn.fireflies.ai/video-1.mp4",
      shareUrl: "https://app.fireflies.ai/view/transcript-1",
      organizerEmail: "organizer@acme.com",
      summary: "Team discussed the launch.",
    });
    expect(meeting!.startTime).toEqual(new Date(1751500800000));
    expect(meeting!.endTime).toEqual(new Date(1751500800000 + 30.5 * 60 * 1000));
    expect(meeting!.participants).toEqual([
      { name: "Jane Doe", email: "jane@acme.com" },
      { name: "bob", email: "bob@acme.com" },
      { name: "extra", email: "extra@client.com" },
    ]);
    expect(meeting!.transcript).toEqual([
      { speaker: "Jane Doe", text: "Hello everyone.", offsetSeconds: 0 },
      { speaker: null, text: "Hi Jane!", offsetSeconds: 65.4 },
    ]);
    expect(meeting!.actionItems).toEqual([
      "Ship the release (10:00)",
      "Email the client",
      "Update the docs",
    ]);
    expect(meeting!.raw).toBe(fullTranscript);

    const request = sentRequestBody(fetchMock);
    expect(request.variables).toEqual({ transcriptId: "transcript-1" });
    expect(request.query).toContain("transcript(id: $transcriptId)");
  });

  it("handles array-shaped action items and sparse transcripts", async () => {
    mockFetch({
      data: {
        transcript: {
          id: "transcript-2",
          title: null,
          date: "not-a-number",
          duration: null,
          summary: { overview: "  ", action_items: ["Do the thing", 7] },
        },
      },
    });

    const meeting = await firefliesMeetingProvider.fetchMeeting!(
      connection,
      "transcript-2"
    );

    expect(meeting).toMatchObject({
      externalId: "transcript-2",
      title: null,
      startTime: null,
      endTime: null,
      durationSeconds: null,
      recordingUrl: null,
      shareUrl: null,
      organizerEmail: null,
      participants: [],
      transcript: [],
      summary: null,
      actionItems: ["Do the thing"],
    });
  });

  it("falls back to the audio url when no video url exists", async () => {
    mockFetch({
      data: {
        transcript: {
          id: "transcript-3",
          audio_url: "https://cdn.fireflies.ai/audio-3.mp3",
          video_url: null,
        },
      },
    });
    const meeting = await firefliesMeetingProvider.fetchMeeting!(connection, "transcript-3");
    expect(meeting!.recordingUrl).toBe("https://cdn.fireflies.ai/audio-3.mp3");
  });

  it("returns null when the transcript does not exist", async () => {
    mockFetch({ data: { transcript: null } });
    await expect(
      firefliesMeetingProvider.fetchMeeting!(connection, "missing")
    ).resolves.toBeNull();
  });

  it("returns null on object_not_found GraphQL errors", async () => {
    mockFetch({
      errors: [
        { message: "Object not found", extensions: { code: "object_not_found" } },
      ],
    });
    await expect(
      firefliesMeetingProvider.fetchMeeting!(connection, "missing")
    ).resolves.toBeNull();
  });

  it("throws on other API failures", async () => {
    mockFetch({ errors: [{ message: "Too many requests" }] }, 429);
    await expect(
      firefliesMeetingProvider.fetchMeeting!(connection, "transcript-1")
    ).rejects.toThrow("Too many requests");
  });

  it("throws when the connection has no API key", async () => {
    const fetchMock = mockFetch({});
    await expect(
      firefliesMeetingProvider.fetchMeeting!(
        { ...connection, apiKey: null },
        "transcript-1"
      )
    ).rejects.toThrow("missing an API key");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("listMeetings", () => {
  it("lists transcript ids with a clamped limit and since filter", async () => {
    const fetchMock = mockFetch({
      data: {
        transcripts: [{ id: "t-1" }, { id: "t-2" }, { id: "t-1" }, { id: null }, "junk"],
      },
    });
    const since = new Date("2026-06-01T00:00:00.000Z");

    const ids = await firefliesMeetingProvider.listMeetings!(connection, {
      since,
      limit: 500,
    });

    expect(ids).toEqual(["t-1", "t-2"]);
    const request = sentRequestBody(fetchMock);
    expect(request.variables).toEqual({
      limit: 50,
      fromDate: "2026-06-01T00:00:00.000Z",
    });
  });

  it("defaults the limit and omits the date filter when not provided", async () => {
    const fetchMock = mockFetch({ data: { transcripts: [] } });
    const ids = await firefliesMeetingProvider.listMeetings!(connection, {});
    expect(ids).toEqual([]);
    expect(sentRequestBody(fetchMock).variables).toEqual({ limit: 25, fromDate: null });
  });

  it("throws on API failures", async () => {
    mockFetch({ errors: [{ message: "Server error" }] }, 500);
    await expect(
      firefliesMeetingProvider.listMeetings!(connection, {})
    ).rejects.toThrow("Server error");
  });
});
