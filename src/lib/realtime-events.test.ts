import {
  deriveRealtimeTopicsForDomainEvent,
  parseRealtimeTopicList,
} from "@/lib/realtime-events";

describe("parseRealtimeTopicList", () => {
  it("parses, normalizes, and de-duplicates topics", () => {
    expect(parseRealtimeTopicList("tasks, board ,TASKS,invalid,meetings")).toEqual(
      ["tasks", "board", "meetings"]
    );
  });

  it("returns an empty list for empty input", () => {
    expect(parseRealtimeTopicList("")).toEqual([]);
    expect(parseRealtimeTopicList(null)).toEqual([]);
    expect(parseRealtimeTopicList(undefined)).toEqual([]);
  });
});

describe("deriveRealtimeTopicsForDomainEvent", () => {
  it("maps meeting.ingested to all affected topics", () => {
    expect(deriveRealtimeTopicsForDomainEvent("meeting.ingested", {})).toEqual([
      "meetings",
      "tasks",
      "board",
      "people",
    ]);
  });

  it("includes meetings topic for meeting task status changes", () => {
    expect(
      deriveRealtimeTopicsForDomainEvent("task.status.changed", {
        sourceSessionType: "meeting",
      })
    ).toEqual(["tasks", "board", "meetings"]);
  });

  it("omits meetings topic for non-meeting task status changes", () => {
    expect(
      deriveRealtimeTopicsForDomainEvent("task.status.changed", {
        sourceSessionType: "chat",
      })
    ).toEqual(["tasks", "board"]);
  });

  it("maps board.item.updated to board and task topics", () => {
    expect(deriveRealtimeTopicsForDomainEvent("board.item.updated", {})).toEqual(
      ["board", "tasks"]
    );
  });

  it("returns empty topics for unsupported event types", () => {
    expect(deriveRealtimeTopicsForDomainEvent("unknown.type", {})).toEqual([]);
  });
});
