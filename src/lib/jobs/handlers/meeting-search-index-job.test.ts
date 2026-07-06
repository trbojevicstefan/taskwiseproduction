import { runMeetingSearchIndexJob } from "@/lib/jobs/handlers/meeting-search-index-job";
import { getDb } from "@/lib/db";
import { indexMeetingSearchChunksForMeeting } from "@/lib/meeting-search-chunks";

jest.mock("@/lib/db", () => ({
  getDb: jest.fn(),
}));

jest.mock("@/lib/meeting-search-chunks", () => ({
  indexMeetingSearchChunksForMeeting: jest.fn(),
}));

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedIndex = indexMeetingSearchChunksForMeeting as jest.MockedFunction<
  typeof indexMeetingSearchChunksForMeeting
>;

describe("runMeetingSearchIndexJob", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetDb.mockResolvedValue({ fake: "db" } as any);
  });

  it("indexes the meeting's chunks and returns the status", async () => {
    mockedIndex.mockResolvedValue({ status: "indexed", chunkCount: 7 });

    const result = await runMeetingSearchIndexJob({
      userId: "user-1",
      meetingId: "meeting-1",
      workspaceId: "workspace-1",
    });

    expect(mockedIndex).toHaveBeenCalledWith(
      { fake: "db" },
      {
        meetingId: "meeting-1",
        userId: "user-1",
        workspaceId: "workspace-1",
      }
    );
    expect(result).toEqual({
      meetingId: "meeting-1",
      status: "indexed",
      chunkCount: 7,
    });
  });

  it("passes a null workspaceId through and surfaces skip statuses", async () => {
    mockedIndex.mockResolvedValue({
      status: "skipped_no_embeddings",
      chunkCount: 0,
    });

    const result = await runMeetingSearchIndexJob({
      userId: "user-1",
      meetingId: "meeting-2",
    });

    expect(mockedIndex).toHaveBeenCalledWith(
      { fake: "db" },
      {
        meetingId: "meeting-2",
        userId: "user-1",
        workspaceId: null,
      }
    );
    expect(result).toEqual({
      meetingId: "meeting-2",
      status: "skipped_no_embeddings",
      chunkCount: 0,
    });
  });
});
