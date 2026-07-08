import {
  GRAIN_WEBHOOK_SECRET_HEADER,
  grainMeetingProvider,
} from "@/lib/meeting-providers/grain";
import { parseVttTranscript } from "@/lib/meeting-providers/grain-transcript";
import type { MeetingProviderConnection } from "@/lib/meeting-providers/types";

const connection: MeetingProviderConnection = {
  _id: "conn-1",
  workspaceId: "workspace-1",
  userId: "user-1",
  provider: "grain",
  status: "active",
  apiKey: "grain-token",
  accountName: "Acme",
  webhookSecret: "hook-secret",
};

const jsonResponse = (
  body: unknown,
  { status = 200, contentType = "application/json" }: { status?: number; contentType?: string } = {}
) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? contentType : null) },
  json: async () => body,
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
});

const textResponse = (body: string, contentType = "text/vtt") =>
  jsonResponse(body, { contentType });

describe("grain meeting provider", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  describe("verifyWebhookRequest", () => {
    it("accepts any request when no secret is stored (fathom precedent)", () => {
      expect(
        grainMeetingProvider.verifyWebhookRequest("{}", new Headers(), null)
      ).toBe(true);
    });

    it("accepts a request whose grain-hook-secret header matches", () => {
      const headers = new Headers({ [GRAIN_WEBHOOK_SECRET_HEADER]: "hook-secret" });
      expect(
        grainMeetingProvider.verifyWebhookRequest("{}", headers, "hook-secret")
      ).toBe(true);
    });

    it("rejects a mismatched secret header", () => {
      const headers = new Headers({ [GRAIN_WEBHOOK_SECRET_HEADER]: "wrong" });
      expect(
        grainMeetingProvider.verifyWebhookRequest("{}", headers, "hook-secret")
      ).toBe(false);
    });

    it("rejects when the secret header is missing", () => {
      expect(
        grainMeetingProvider.verifyWebhookRequest("{}", new Headers(), "hook-secret")
      ).toBe(false);
    });
  });

  describe("parseWebhookPayload", () => {
    it("maps recording_added events to a recording ref", () => {
      expect(
        grainMeetingProvider.parseWebhookPayload({
          type: "recording_added",
          data: { id: "rec-1" },
        })
      ).toEqual({ kind: "ref", externalMeetingId: "rec-1" });
    });

    it("normalizes dotted/cased event names and prefers data.recording_id", () => {
      expect(
        grainMeetingProvider.parseWebhookPayload({
          type: "Recording.Updated",
          data: { recording_id: "rec-2", id: "hook-event-9" },
        })
      ).toEqual({ kind: "ref", externalMeetingId: "rec-2" });
    });

    it("accepts the `event` field and numeric ids", () => {
      expect(
        grainMeetingProvider.parseWebhookPayload({
          event: "recording_ready",
          data: { id: 42 },
        })
      ).toEqual({ kind: "ref", externalMeetingId: "42" });
    });

    it("ignores irrelevant event types", () => {
      const parsed = grainMeetingProvider.parseWebhookPayload({
        type: "highlight_added",
        data: { id: "hl-1" },
      });
      expect(parsed.kind).toBe("ignore");
    });

    it("ignores recording events without a recording id", () => {
      const parsed = grainMeetingProvider.parseWebhookPayload({
        type: "recording_added",
        data: {},
      });
      expect(parsed.kind).toBe("ignore");
    });

    it("never throws on malformed payloads", () => {
      for (const payload of [null, undefined, "nope", 7, [], { data: "x" }, {}]) {
        const parsed = grainMeetingProvider.parseWebhookPayload(payload);
        expect(parsed.kind).toBe("ignore");
      }
    });
  });

  describe("validateCredentials", () => {
    it("returns ok with the account name from /me", async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce(jsonResponse({ name: "Jane Doe", email: "jane@acme.com" }));
      global.fetch = fetchMock as any;

      await expect(
        grainMeetingProvider.validateCredentials({ apiKey: "grain-token" })
      ).resolves.toEqual({ ok: true, accountName: "Jane Doe" });
      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.grain.com/_/public-api/me",
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: "Bearer grain-token" }),
        })
      );
    });

    it("fails cleanly on 401 without throwing", async () => {
      global.fetch = jest.fn().mockResolvedValueOnce(jsonResponse({}, { status: 401 })) as any;
      await expect(
        grainMeetingProvider.validateCredentials({ apiKey: "bad" })
      ).resolves.toEqual({ ok: false, error: "Invalid Grain API token." });
    });

    it("fails cleanly on network errors", async () => {
      global.fetch = jest.fn().mockRejectedValueOnce(new Error("boom")) as any;
      const result = await grainMeetingProvider.validateCredentials({ apiKey: "k" });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("boom");
    });

    it("rejects empty keys without calling the API", async () => {
      const fetchMock = jest.fn();
      global.fetch = fetchMock as any;
      const result = await grainMeetingProvider.validateCredentials({ apiKey: "  " });
      expect(result.ok).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("fetchMeeting", () => {
    it("maps a full recording with JSON transcript segments", async () => {
      const recording = {
        id: "rec-1",
        title: "Weekly Sync",
        url: "https://grain.com/share/recording/rec-1",
        media_url: "https://media.grain.com/rec-1.mp4",
        start_datetime: "2026-07-01T10:00:00Z",
        end_datetime: "2026-07-01T10:30:00Z",
        owners: ["owner@acme.com"],
        participants: [
          { name: "Jane Doe", email: "Jane@Acme.com" },
          { name: "jane doe duplicate", email: "jane@acme.com" },
          { email: "bob@acme.com" },
          { name: "" },
        ],
        highlights: [{ text: "Decided to ship v2" }],
        action_items: ["Send the deck", { text: "Book follow-up" }],
        transcript_json: [
          { speaker: "Jane Doe", text: "Hello everyone", timestamp: 0 },
          { speaker: "Bob", text: "Hi Jane", timestamp: 65000 },
          { text: "" },
        ],
      };
      const fetchMock = jest.fn().mockResolvedValueOnce(jsonResponse(recording));
      global.fetch = fetchMock as any;

      const meeting = await grainMeetingProvider.fetchMeeting!(connection, "rec-1");

      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.grain.com/_/public-api/recordings/rec-1?transcript_format=json&include_highlights=true&include_participants=true",
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: "Bearer grain-token" }),
        })
      );
      expect(meeting).toMatchObject({
        externalId: "rec-1",
        title: "Weekly Sync",
        durationSeconds: 1800,
        recordingUrl: "https://media.grain.com/rec-1.mp4",
        shareUrl: "https://grain.com/share/recording/rec-1",
        organizerEmail: "owner@acme.com",
        summary: "Highlights:\n- Decided to ship v2",
        actionItems: ["Send the deck", "Book follow-up"],
      });
      expect(meeting!.startTime).toEqual(new Date("2026-07-01T10:00:00Z"));
      expect(meeting!.endTime).toEqual(new Date("2026-07-01T10:30:00Z"));
      expect(meeting!.participants).toEqual([
        { name: "Jane Doe", email: "jane@acme.com", title: null },
        { name: "bob", email: "bob@acme.com", title: null },
      ]);
      expect(meeting!.transcript).toEqual([
        { speaker: "Jane Doe", text: "Hello everyone", offsetSeconds: 0 },
        { speaker: "Bob", text: "Hi Jane", offsetSeconds: 65 },
      ]);
    });

    it("falls back to parsing inline VTT transcripts", async () => {
      const recording = {
        id: "rec-2",
        title: "VTT Meeting",
        transcript_vtt:
          "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n<v Jane Doe>Hello there\n\n00:01:05.000 --> 00:01:07.000\nBob: All good",
      };
      global.fetch = jest.fn().mockResolvedValueOnce(jsonResponse(recording)) as any;

      const meeting = await grainMeetingProvider.fetchMeeting!(connection, "rec-2");
      expect(meeting!.transcript).toEqual([
        { speaker: "Jane Doe", text: "Hello there", offsetSeconds: 1 },
        { speaker: "Bob", text: "All good", offsetSeconds: 65 },
      ]);
    });

    it("fetches transcript_url without leaking the token to foreign origins", async () => {
      const recording = {
        id: "rec-3",
        transcript_url: "https://cdn.grain.com/transcripts/rec-3.vtt",
      };
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce(jsonResponse(recording))
        .mockResolvedValueOnce(
          textResponse("WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n<v Ana>Hi")
        );
      global.fetch = fetchMock as any;

      const meeting = await grainMeetingProvider.fetchMeeting!(connection, "rec-3");
      expect(meeting!.transcript).toEqual([
        { speaker: "Ana", text: "Hi", offsetSeconds: 0 },
      ]);
      const [transcriptUrl, transcriptInit] = fetchMock.mock.calls[1];
      expect(transcriptUrl).toBe("https://cdn.grain.com/transcripts/rec-3.vtt");
      expect(transcriptInit?.headers).toBeUndefined();
    });

    it("parses JSON transcripts served from transcript_url", async () => {
      const recording = {
        id: "rec-4",
        transcript_url: "https://api.grain.com/_/public-api/recordings/rec-4/transcript",
      };
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce(jsonResponse(recording))
        .mockResolvedValueOnce(
          jsonResponse({ segments: [{ speaker: "Zed", text: "Yo", start: 3 }] })
        );
      global.fetch = fetchMock as any;

      const meeting = await grainMeetingProvider.fetchMeeting!(connection, "rec-4");
      expect(meeting!.transcript).toEqual([
        { speaker: "Zed", text: "Yo", offsetSeconds: 3 },
      ]);
      // Same-origin transcript URL keeps the Authorization header.
      const [, transcriptInit] = fetchMock.mock.calls[1];
      expect(transcriptInit?.headers).toEqual({ Authorization: "Bearer grain-token" });
    });

    it("returns an empty transcript when nothing usable exists", async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(jsonResponse({ id: "rec-5", title: "No transcript" })) as any;

      const meeting = await grainMeetingProvider.fetchMeeting!(connection, "rec-5");
      expect(meeting).toMatchObject({
        externalId: "rec-5",
        title: "No transcript",
        transcript: "",
        participants: [],
        organizerEmail: null,
        summary: null,
        durationSeconds: null,
      });
      expect(meeting!.actionItems).toBeUndefined();
    });

    it("returns null on 404 / non-JSON bodies / missing api key", async () => {
      global.fetch = jest.fn().mockResolvedValueOnce(jsonResponse({}, { status: 404 })) as any;
      await expect(grainMeetingProvider.fetchMeeting!(connection, "gone")).resolves.toBeNull();

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("not json");
        },
      }) as any;
      await expect(grainMeetingProvider.fetchMeeting!(connection, "rec-6")).resolves.toBeNull();

      const fetchMock = jest.fn();
      global.fetch = fetchMock as any;
      await expect(
        grainMeetingProvider.fetchMeeting!({ ...connection, apiKey: null }, "rec-7")
      ).resolves.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("listMeetings", () => {
    it("paginates via cursor and returns ids newest first", async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({
            recordings: [
              { id: "rec-1", start_datetime: "2026-07-02T10:00:00Z" },
              { id: "rec-2", start_datetime: "2026-07-01T10:00:00Z" },
            ],
            cursor: "next-page",
          })
        )
        .mockResolvedValueOnce(
          jsonResponse({
            recordings: [{ id: "rec-3", start_datetime: "2026-06-30T10:00:00Z" }],
            cursor: null,
          })
        );
      global.fetch = fetchMock as any;

      await expect(
        grainMeetingProvider.listMeetings!(connection, {})
      ).resolves.toEqual(["rec-1", "rec-2", "rec-3"]);
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        "https://api.grain.com/_/public-api/recordings",
        expect.anything()
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        "https://api.grain.com/_/public-api/recordings?cursor=next-page",
        expect.anything()
      );
    });

    it("applies the since filter client-side and stops paginating", async () => {
      const fetchMock = jest.fn().mockResolvedValueOnce(
        jsonResponse({
          recordings: [
            { id: "rec-1", start_datetime: "2026-07-02T10:00:00Z" },
            { id: "rec-old", start_datetime: "2026-01-01T10:00:00Z" },
          ],
          cursor: "should-not-be-fetched",
        })
      );
      global.fetch = fetchMock as any;

      await expect(
        grainMeetingProvider.listMeetings!(connection, {
          since: new Date("2026-06-01T00:00:00Z"),
        })
      ).resolves.toEqual(["rec-1"]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("respects the limit", async () => {
      global.fetch = jest.fn().mockResolvedValueOnce(
        jsonResponse({
          recordings: [{ id: "a" }, { id: "b" }, { id: "c" }],
          cursor: "more",
        })
      ) as any;

      await expect(
        grainMeetingProvider.listMeetings!(connection, { limit: 2 })
      ).resolves.toEqual(["a", "b"]);
    });

    it("throws on an API error so the sync job can surface it", async () => {
      global.fetch = jest.fn().mockResolvedValueOnce(jsonResponse({}, { status: 500 })) as any;
      await expect(grainMeetingProvider.listMeetings!(connection, {})).rejects.toThrow(
        "Grain recordings list failed with status 500."
      );
    });

    it("returns no ids for connections without an api key", async () => {
      const fetchMock = jest.fn();
      global.fetch = fetchMock as any;
      await expect(
        grainMeetingProvider.listMeetings!({ ...connection, apiKey: null }, {})
      ).resolves.toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("parseVttTranscript", () => {
    it("handles hour-long timestamps, missing speakers, and tag stripping", () => {
      const vtt = [
        "WEBVTT",
        "",
        "1",
        "01:02:03.500 --> 01:02:05.000",
        "<v Speaker One>Long meeting</v>",
        "",
        "00:00:10.000 --> 00:00:12.000",
        "Plain <b>text</b> line",
      ].join("\n");
      expect(parseVttTranscript(vtt)).toEqual([
        { speaker: "Speaker One", text: "Long meeting", offsetSeconds: 3723 },
        { speaker: null, text: "Plain text line", offsetSeconds: 10 },
      ]);
    });

    it("returns no segments for garbage input", () => {
      expect(parseVttTranscript("not a vtt file")).toEqual([]);
    });
  });
});
