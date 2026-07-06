import {
  buildCarryOverSource,
  buildSuggestedAgendaTopics,
  findCarryOverMeeting,
  MAX_SUGGESTED_TOPICS,
} from "@/lib/agenda-suggestions";

describe("findCarryOverMeeting", () => {
  const target = {
    title: "Weekly Client Sync",
    attendees: [
      { name: "Alice Client", email: "alice@client.com" },
      { name: "Bob Internal", email: "bob@acme.com" },
    ],
  };

  it("prefers the most recent past meeting with the same normalized title", () => {
    const older = {
      _id: "m-older",
      title: "Weekly client sync",
      startTime: "2026-06-22T10:00:00.000Z",
    };
    const newer = {
      _id: "m-newer",
      title: "WEEKLY CLIENT SYNC!",
      startTime: "2026-06-29T10:00:00.000Z",
    };
    const unrelated = {
      _id: "m-unrelated",
      title: "Retro",
      startTime: "2026-07-01T10:00:00.000Z",
    };
    expect(
      findCarryOverMeeting([older, unrelated, newer], target)
    ).toBe(newer);
  });

  it("falls back to attendee overlap of at least half the smaller list", () => {
    const overlapping = {
      _id: "m-overlap",
      title: "Different title",
      startTime: "2026-06-30T10:00:00.000Z",
      attendees: [
        { name: "Alice Client", email: "alice@client.com" },
        { name: "Dana", email: "dana@other.com" },
      ],
    };
    const disjoint = {
      _id: "m-disjoint",
      title: "Also different",
      startTime: "2026-07-01T10:00:00.000Z",
      attendees: [{ name: "Zed", email: "zed@other.com" }],
    };
    expect(findCarryOverMeeting([disjoint, overlapping], target)).toBe(
      overlapping
    );
  });

  it("returns null when nothing matches", () => {
    expect(
      findCarryOverMeeting(
        [{ _id: "m", title: "Retro", attendees: [{ name: "Zed" }] }],
        target
      )
    ).toBeNull();
    expect(findCarryOverMeeting([], target)).toBeNull();
  });
});

describe("buildCarryOverSource", () => {
  it("collects agenda titles and open task titles from the past meeting", () => {
    const source = buildCarryOverSource(
      {
        _id: "m-prev",
        title: "Weekly Client Sync",
        startTime: "2026-06-29T10:00:00.000Z",
        agenda: [
          { id: "a1", title: "Pricing follow-up", order: 1 },
          { id: "a2", title: "Renewal timeline", order: 0 },
        ],
      },
      ["Send proposal", "", "  "]
    );
    expect(source.meetingId).toBe("m-prev");
    expect(source.meetingTitle).toBe("Weekly Client Sync");
    // Agenda titles come back in order-sorted sequence.
    expect(source.agendaTitles).toEqual([
      "Renewal timeline",
      "Pricing follow-up",
    ]);
    expect(source.openTaskTitles).toEqual(["Send proposal"]);
  });
});

describe("buildSuggestedAgendaTopics", () => {
  it("builds topics from open tasks and carry-over items, deduped by title", () => {
    const topics = buildSuggestedAgendaTopics({
      openTasks: [
        {
          id: "t-1",
          title: "Send proposal",
          dueAt: "2026-07-08T00:00:00.000Z",
          assigneeName: "Bob Internal",
        },
        { id: "t-2", title: "Fix invoice", dueAt: null, assigneeName: null },
        // Duplicate title (case/punctuation) — deduped.
        { id: "t-3", title: "send PROPOSAL!", dueAt: null },
      ],
      carryOver: {
        meetingId: "m-prev",
        meetingTitle: "Weekly Client Sync",
        startTime: "2026-06-29T10:00:00.000Z",
        agendaTitles: ["Renewal timeline"],
        openTaskTitles: ["Budget sign-off"],
      },
    });

    expect(topics.map((topic) => topic.title)).toEqual([
      "Review: Send proposal",
      "Review: Fix invoice",
      "Carry-over: Renewal timeline",
      "Carry-over: Budget sign-off",
    ]);
    expect(topics[0]).toMatchObject({
      id: "suggest-open-task-t-1",
      source: "open_task",
      notes: "Open task for Bob Internal due 2026-07-08",
    });
    expect(topics[2]).toMatchObject({
      source: "carry_over",
      notes: 'Carried over from "Weekly Client Sync"',
    });
    // Stable ids so a checklist UI can key on them.
    expect(new Set(topics.map((topic) => topic.id)).size).toBe(topics.length);
  });

  it("returns [] with no inputs and caps the list", () => {
    expect(buildSuggestedAgendaTopics({ openTasks: [] })).toEqual([]);

    const many = buildSuggestedAgendaTopics({
      openTasks: Array.from({ length: 20 }, (_, index) => ({
        id: `t-${index}`,
        title: `Task number ${index}`,
      })),
    });
    expect(many).toHaveLength(MAX_SUGGESTED_TOPICS);
  });

  it("is deterministic (same input, same output)", () => {
    const input = {
      openTasks: [{ id: "t-1", title: "Send proposal" }],
      carryOver: {
        meetingId: "m-prev",
        meetingTitle: "Sync",
        startTime: null,
        agendaTitles: ["Topic A"],
        openTaskTitles: [],
      },
    };
    expect(buildSuggestedAgendaTopics(input)).toEqual(
      buildSuggestedAgendaTopics(input)
    );
  });
});
