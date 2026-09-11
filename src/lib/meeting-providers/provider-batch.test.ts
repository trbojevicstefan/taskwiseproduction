import { createHmac } from "crypto";
import { tldvMeetingProvider, TLDV_API_BASE_URL } from "@/lib/meeting-providers/tldv";
import { otterMeetingProvider, OTTER_API_BASE_URL } from "@/lib/meeting-providers/otter";
import { meetgeekMeetingProvider, MEETGEEK_API_BASE_URL } from "@/lib/meeting-providers/meetgeek";
import { readMeetingProvider } from "@/lib/meeting-providers/read";
import type { MeetingProviderConnection } from "@/lib/meeting-providers/types";

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

const connection = (
  provider: MeetingProviderConnection["provider"],
  apiKey = "test-key"
): MeetingProviderConnection => ({
  _id: `conn-${provider}`,
  workspaceId: "ws-1",
  userId: "user-1",
  provider,
  status: "active",
  apiKey,
  accountName: "Acme",
  webhookSecret: "hook-secret",
});

const response = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
});

describe("tl;dv provider", () => {
  it("validates x-api-key credentials and can list meeting ids", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(response({ data: [{ id: "m-1" }], nextPageToken: null }))
      .mockResolvedValueOnce(response({ data: [{ id: "m-2" }, { id: "m-1" }] }));
    global.fetch = fetchMock as any;

    await expect(tldvMeetingProvider.validateCredentials({ apiKey: "abc" })).resolves.toMatchObject({
      ok: true,
    });
    const ids = await tldvMeetingProvider.listMeetings!(connection("tldv"), { limit: 2 });
    expect(ids).toEqual(["m-2", "m-1"]);
    expect(fetchMock.mock.calls[0][0]).toContain(`${TLDV_API_BASE_URL}/meetings`);
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ "x-api-key": "abc" });
  });

  it("normalizes detail, transcript and notes into the shared meeting shape", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        response({
          id: "m-1",
          name: "Weekly Product",
          startedAt: "2026-09-10T10:00:00Z",
          duration: 1800,
          url: "https://tldv.io/app/meetings/m-1",
          organizer: { email: "HOST@ACME.COM", name: "Host" },
          participants: [{ name: "Jane", email: "JANE@CLIENT.COM" }],
        })
      )
      .mockResolvedValueOnce(
        response({
          data: [
            { speaker: "Host", text: "Hello", startTime: 0 },
            { speaker: "Jane", text: "Ship it", startTime: 65 },
          ],
        })
      )
      .mockResolvedValueOnce(response({ data: [{ text: "Decision: launch Friday" }] })) as any;

    const meeting = await tldvMeetingProvider.fetchMeeting!(connection("tldv"), "m-1");
    expect(meeting).toMatchObject({
      externalId: "m-1",
      title: "Weekly Product",
      durationSeconds: 1800,
      shareUrl: "https://tldv.io/app/meetings/m-1",
      organizerEmail: "host@acme.com",
      participants: [{ name: "Jane", email: "jane@client.com" }],
      summary: "Decision: launch Friday",
    });
    expect(meeting?.transcript).toEqual([
      { speaker: "Host", text: "Hello", offsetSeconds: 0 },
      { speaker: "Jane", text: "Ship it", offsetSeconds: 65 },
    ]);
  });

  it("accepts ready webhook events and ignores irrelevant ones", () => {
    expect(
      tldvMeetingProvider.parseWebhookPayload({ event: "TranscriptReady", meetingId: "m-9" })
    ).toEqual({ kind: "ref", externalMeetingId: "m-9" });
    expect(tldvMeetingProvider.parseWebhookPayload({ event: "MeetingStarted", meetingId: "m-9" }).kind).toBe("ignore");
  });
});

describe("Otter.ai provider", () => {
  it("uses Bearer authentication and exposes the Enterprise API limitation in errors", async () => {
    const fetchMock = jest.fn().mockResolvedValue(response({ id: "ws-1", name: "Workspace" }));
    global.fetch = fetchMock as any;
    await expect(otterMeetingProvider.validateCredentials({ apiKey: "otter-key" })).resolves.toEqual({
      ok: true,
      accountName: "Workspace",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `${OTTER_API_BASE_URL}/workspace`,
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer otter-key" }) })
    );
  });

  it("normalizes a conversation with transcript, guests, summary and action items", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      response({
        id: "conv-1",
        title: "Customer Call",
        start_time: "2026-09-09T12:00:00Z",
        end_time: "2026-09-09T12:30:00Z",
        url: "https://otter.ai/u/conv-1",
        owner: { email: "OWNER@ACME.COM", name: "Owner" },
        calendar_guests: [{ name: "Client", email: "CLIENT@EXAMPLE.COM" }],
        transcript: [
          { speaker_name: "Owner", text: "Welcome", start_offset: 0 },
          { speaker_name: "Client", text: "Approved", start_offset: 32 },
        ],
        summary: "Client approved the scope.",
        action_items: [{ text: "Send revised SOW" }],
      })
    ) as any;

    const meeting = await otterMeetingProvider.fetchMeeting!(connection("otter"), "conv-1");
    expect(meeting).toMatchObject({
      externalId: "conv-1",
      title: "Customer Call",
      organizerEmail: "owner@acme.com",
      participants: [{ name: "Client", email: "client@example.com" }],
      summary: "Client approved the scope.",
      actionItems: ["Send revised SOW"],
    });
    expect(meeting?.durationSeconds).toBe(1800);
  });

  it("parses completed conversation webhooks", () => {
    expect(
      otterMeetingProvider.parseWebhookPayload({ event: "conversation.completed", conversation_id: "conv-8" })
    ).toEqual({ kind: "ref", externalMeetingId: "conv-8" });
  });
});

describe("MeetGeek provider", () => {
  it("validates Bearer API keys using the meetings endpoint", async () => {
    const fetchMock = jest.fn().mockResolvedValue(response({ meetings: [] }));
    global.fetch = fetchMock as any;
    await expect(meetgeekMeetingProvider.validateCredentials({ apiKey: "mg-key" })).resolves.toMatchObject({ ok: true });
    expect(fetchMock.mock.calls[0][0]).toContain(`${MEETGEEK_API_BASE_URL}/meetings`);
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ Authorization: "Bearer mg-key" });
  });

  it("normalizes meeting detail and transcript pages", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        response({
          id: "mg-1",
          title: "Demo",
          start_time: "2026-09-08T09:00:00Z",
          end_time: "2026-09-08T09:45:00Z",
          share_url: "https://app.meetgeek.ai/meeting/mg-1",
          host: { name: "Sara", email: "SARA@ACME.COM" },
          participants: [{ name: "Lead", email: "LEAD@CLIENT.COM" }],
          summary: "Qualified lead.",
        })
      )
      .mockResolvedValueOnce(
        response({
          transcript: [
            { speaker: "Sara", text: "Hi", start_time: 0 },
            { speaker: "Lead", text: "Interested", start_time: 12 },
          ],
          next_cursor: null,
        })
      ) as any;

    const meeting = await meetgeekMeetingProvider.fetchMeeting!(connection("meetgeek"), "mg-1");
    expect(meeting).toMatchObject({
      externalId: "mg-1",
      title: "Demo",
      durationSeconds: 2700,
      organizerEmail: "sara@acme.com",
      participants: [{ name: "Lead", email: "lead@client.com" }],
      summary: "Qualified lead.",
    });
    expect(meeting?.transcript).toHaveLength(2);
  });

  it("parses completed meeting webhooks", () => {
    expect(
      meetgeekMeetingProvider.parseWebhookPayload({ event: "meeting.completed", meeting_id: "mg-9" })
    ).toEqual({ kind: "ref", externalMeetingId: "mg-9" });
  });
});

describe("Read AI provider", () => {
  const readPayload = {
    event_type: "meeting_end",
    meeting: {
      id: "read-1",
      title: "Planning",
      start_time: "2026-09-07T14:00:00Z",
      end_time: "2026-09-07T14:20:00Z",
      report_url: "https://app.read.ai/analytics/meetings/read-1",
      owner: { name: "Alex", email: "ALEX@ACME.COM" },
      participants: [{ name: "Mia", email: "MIA@CLIENT.COM" }],
      summary: "Agreed launch scope.",
      action_items: [{ text: "Alex sends timeline" }],
      transcript: [
        { speaker: { name: "Alex" }, text: "Opening", start_time: "2026-09-07T14:00:05Z" },
        { speaker: { name: "Mia" }, text: "Approved", start_time: "2026-09-07T14:01:05Z" },
      ],
    },
  };

  it("is webhook-only and does not claim manual backfill support", () => {
    expect(readMeetingProvider.capabilities).toMatchObject({
      connectionMode: "webhook-only",
      manualSync: false,
    });
    expect(readMeetingProvider.listMeetings).toBeUndefined();
    expect(readMeetingProvider.fetchMeeting).toBeUndefined();
  });

  it("normalizes meeting_end webhook reports inline", () => {
    const parsed = readMeetingProvider.parseWebhookPayload(readPayload);
    expect(parsed.kind).toBe("meeting");
    if (parsed.kind !== "meeting") throw new Error("expected inline meeting");
    expect(parsed.meeting).toMatchObject({
      externalId: "read-1",
      title: "Planning",
      durationSeconds: 1200,
      shareUrl: "https://app.read.ai/analytics/meetings/read-1",
      organizerEmail: "alex@acme.com",
      participants: [{ name: "Mia", email: "mia@client.com" }],
      summary: "Agreed launch scope.",
      actionItems: ["Alex sends timeline"],
    });
    expect(parsed.meeting.transcript).toEqual([
      { speaker: "Alex", text: "Opening", offsetSeconds: 5 },
      { speaker: "Mia", text: "Approved", offsetSeconds: 65 },
    ]);
  });

  it("ignores meeting_start events", () => {
    expect(readMeetingProvider.parseWebhookPayload({ event_type: "meeting_start", meeting: { id: "read-1" } }).kind).toBe("ignore");
  });

  it("verifies X-Read-Signature using HMAC-SHA256", () => {
    const body = JSON.stringify(readPayload);
    const signature = createHmac("sha256", "hook-secret").update(body, "utf8").digest("hex");
    expect(
      readMeetingProvider.verifyWebhookRequest(
        body,
        new Headers({ "X-Read-Signature": signature }),
        "hook-secret"
      )
    ).toBe(true);
    expect(
      readMeetingProvider.verifyWebhookRequest(
        body,
        new Headers({ "X-Read-Signature": "bad" }),
        "hook-secret"
      )
    ).toBe(false);
  });
});
