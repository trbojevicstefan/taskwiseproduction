import {
  fetchFathomMeetings,
  fetchFathomSummary,
  fetchFathomTranscript,
  listFathomWebhooks,
} from "@/lib/fathom/api-client";
import { recordExternalApiFailure } from "@/lib/observability-metrics";

jest.mock("@/lib/observability-metrics", () => ({
  recordExternalApiFailure: jest.fn(),
}));

const mockedRecordExternalApiFailure = recordExternalApiFailure as jest.MockedFunction<
  typeof recordExternalApiFailure
>;

describe("fathom/api-client", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("fetches meetings and normalizes fallback payload shapes", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ meetings: [{ id: "meeting-1" }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ webhooks: [{ id: "webhook-1" }] }),
      });
    global.fetch = fetchMock as any;

    await expect(fetchFathomMeetings("access-token")).resolves.toEqual([
      { id: "meeting-1" },
    ]);
    await expect(listFathomWebhooks("access-token")).resolves.toEqual([
      { id: "webhook-1" },
    ]);
    expect(mockedRecordExternalApiFailure).not.toHaveBeenCalled();
  });

  it("fetches transcripts and summaries", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ transcript: "hello" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ summary: "summary" }),
      });
    global.fetch = fetchMock as any;

    await expect(fetchFathomTranscript("recording-1", "access-token")).resolves.toBe("hello");
    await expect(fetchFathomSummary("recording-1", "access-token")).resolves.toBe("summary");
  });
});
