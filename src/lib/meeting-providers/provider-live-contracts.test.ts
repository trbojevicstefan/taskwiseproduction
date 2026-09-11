import { createHmac } from "crypto";
import { meetgeekMeetingProvider } from "@/lib/meeting-providers/meetgeek";
import { readMeetingProvider } from "@/lib/meeting-providers/read";

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

const response = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

describe("documented provider live contracts", () => {
  it("verifies MeetGeek X-MG-Signature as raw-body HMAC-SHA256", () => {
    const body = JSON.stringify({
      message: "File analyzed successfully",
      meeting_id: "mg-live-1",
    });
    const secret = "meetgeek-secret";
    const signature = createHmac("sha256", secret).update(body, "utf8").digest("hex");

    expect(
      meetgeekMeetingProvider.verifyWebhookRequest(
        body,
        new Headers({ "X-MG-Signature": signature }),
        secret
      )
    ).toBe(true);
    expect(
      meetgeekMeetingProvider.verifyWebhookRequest(
        body,
        new Headers({ "X-MG-Signature": "bad" }),
        secret
      )
    ).toBe(false);
  });

  it("normalizes documented MeetGeek meeting and sentence fields", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        response({
          host_email: "HOST@ACME.COM",
          meeting_id: "mg-live-1",
          participant_emails: ["CLIENT@EXAMPLE.COM"],
          join_link: "https://meet.google.com/example",
          timestamp_start_utc: "2026-09-11T08:00:00Z",
          timestamp_end_utc: "2026-09-11T08:30:00Z",
          title: "Live contract meeting",
        })
      )
      .mockResolvedValueOnce(
        response({
          meeting_id: "mg-live-1",
          pagination: { next_cursor: null },
          sentences: [
            {
              id: 1,
              speaker: "Host",
              timestamp: "2026-09-11T08:00:10Z",
              transcript: "Welcome",
            },
          ],
        })
      ) as any;

    const meeting = await meetgeekMeetingProvider.fetchMeeting!(
      {
        _id: "conn-mg",
        workspaceId: "ws-1",
        userId: "user-1",
        provider: "meetgeek",
        status: "active",
        apiKey: "mg-key",
        accountName: null,
        webhookSecret: "meetgeek-secret",
      },
      "mg-live-1"
    );

    expect(meeting).toMatchObject({
      externalId: "mg-live-1",
      title: "Live contract meeting",
      durationSeconds: 1800,
      organizerEmail: "host@acme.com",
      participants: [{ name: "client", email: "client@example.com" }],
      shareUrl: "https://meet.google.com/example",
      transcript: [{ speaker: "Host", text: "Welcome", offsetSeconds: 10 }],
    });
  });

  it("verifies Read AI using the decoded Base64 signing key", () => {
    const body = JSON.stringify({ session_id: "read-1", trigger: "meeting_end" });
    const keyBytes = Buffer.from("read-secret-key-material", "utf8");
    const signingKey = keyBytes.toString("base64");
    const signature = createHmac("sha256", keyBytes).update(body, "utf8").digest("hex");

    expect(
      readMeetingProvider.verifyWebhookRequest(
        body,
        new Headers({ "X-Read-Signature": signature }),
        signingKey
      )
    ).toBe(true);
  });

  it("normalizes Read AI top-level session payload and speaker_blocks", () => {
    const parsed = readMeetingProvider.parseWebhookPayload({
      session_id: "read-live-1",
      trigger: "meeting_end",
      title: "Read customer call",
      start_time: "2026-09-11T09:00:00Z",
      end_time: "2026-09-11T09:20:00Z",
      owner: { name: "Alex", email: "ALEX@ACME.COM" },
      participants: [{ name: "Mia", email: "MIA@CLIENT.COM" }],
      summary: "Agreed next steps.",
      action_items: [{ text: "Send proposal" }],
      report_url: "https://app.read.ai/analytics/meetings/read-live-1",
      transcript: {
        speaker_blocks: [
          {
            start_time: String(Date.parse("2026-09-11T09:00:05Z")),
            end_time: String(Date.parse("2026-09-11T09:00:08Z")),
            speaker: { name: "Alex" },
            words: "Thanks for joining",
          },
          {
            start_time: String(Date.parse("2026-09-11T09:01:05Z")),
            end_time: String(Date.parse("2026-09-11T09:01:10Z")),
            speaker: { name: "Mia" },
            words: "Approved",
          },
        ],
      },
      request_id: "request-1",
    });

    expect(parsed.kind).toBe("meeting");
    if (parsed.kind !== "meeting") throw new Error("Expected Read meeting payload");
    expect(parsed.meeting).toMatchObject({
      externalId: "read-live-1",
      title: "Read customer call",
      durationSeconds: 1200,
      organizerEmail: "alex@acme.com",
      participants: [{ name: "Mia", email: "mia@client.com" }],
      actionItems: ["Send proposal"],
      transcript: [
        { speaker: "Alex", text: "Thanks for joining", offsetSeconds: 5 },
        { speaker: "Mia", text: "Approved", offsetSeconds: 65 },
      ],
    });
  });
});
