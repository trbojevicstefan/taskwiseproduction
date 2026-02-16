import { runMeetingIngestionCommand } from "@/lib/services/meeting-ingestion-command";
import { publishDomainEvent } from "@/lib/domain-events";
import { applyMeetingIngestionSideEffects } from "@/lib/services/meeting-ingestion-side-effects";
import { isUnifiedMeetingIngestionCommandEnabled } from "@/lib/core-first-flags";

jest.mock("@/lib/domain-events", () => ({
  publishDomainEvent: jest.fn(),
}));

jest.mock("@/lib/services/meeting-ingestion-side-effects", () => ({
  applyMeetingIngestionSideEffects: jest.fn(),
}));

jest.mock("@/lib/core-first-flags", () => ({
  isUnifiedMeetingIngestionCommandEnabled: jest.fn(),
}));

const mockedPublishDomainEvent = publishDomainEvent as jest.MockedFunction<
  typeof publishDomainEvent
>;
const mockedApplyMeetingIngestionSideEffects =
  applyMeetingIngestionSideEffects as jest.MockedFunction<
    typeof applyMeetingIngestionSideEffects
  >;
const mockedIsUnifiedMeetingIngestionCommandEnabled =
  isUnifiedMeetingIngestionCommandEnabled as jest.MockedFunction<
    typeof isUnifiedMeetingIngestionCommandEnabled
  >;

const successResult = {
  people: { created: 1, updated: 2 },
  tasks: { upserted: 3, deleted: 0 },
  boardItemsCreated: 4,
};

describe("runMeetingIngestionCommand", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedIsUnifiedMeetingIngestionCommandEnabled.mockReturnValue(false);
    mockedPublishDomainEvent.mockResolvedValue(successResult as any);
    mockedApplyMeetingIngestionSideEffects.mockResolvedValue(successResult);
  });

  it("uses event publishing for always-event mode", async () => {
    const db = {} as any;
    const result = await runMeetingIngestionCommand(db, {
      mode: "always-event",
      userId: "user-1",
      payload: {
        meetingId: "meeting-1",
        title: "Weekly Sync",
      },
    });

    expect(result).toEqual(successResult);
    expect(mockedPublishDomainEvent).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        type: "meeting.ingested",
        userId: "user-1",
        payload: expect.objectContaining({
          meetingId: "meeting-1",
          title: "Weekly Sync",
        }),
      })
    );
    expect(mockedApplyMeetingIngestionSideEffects).not.toHaveBeenCalled();
  });

  it("uses direct side effects for flagged-event mode when flag is disabled", async () => {
    mockedIsUnifiedMeetingIngestionCommandEnabled.mockReturnValue(false);

    const db = {} as any;
    const result = await runMeetingIngestionCommand(db, {
      mode: "flagged-event",
      userId: "user-1",
      payload: {
        meetingId: "meeting-2",
      },
    });

    expect(result).toEqual(successResult);
    expect(mockedApplyMeetingIngestionSideEffects).toHaveBeenCalledWith(
      db,
      "user-1",
      expect.objectContaining({
        meetingId: "meeting-2",
      })
    );
    expect(mockedPublishDomainEvent).not.toHaveBeenCalled();
  });

  it("uses event publishing for flagged-event mode when flag is enabled", async () => {
    mockedIsUnifiedMeetingIngestionCommandEnabled.mockReturnValue(true);

    const db = {} as any;
    const result = await runMeetingIngestionCommand(db, {
      mode: "flagged-event",
      userId: "user-1",
      payload: {
        meetingId: "meeting-3",
      },
    });

    expect(result).toEqual(successResult);
    expect(mockedPublishDomainEvent).toHaveBeenCalled();
    expect(mockedApplyMeetingIngestionSideEffects).not.toHaveBeenCalled();
  });
});
