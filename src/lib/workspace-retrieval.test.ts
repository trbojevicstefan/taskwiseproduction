import {
  extractTranscriptSnippets,
  scoreText,
  searchWorkspaceContext,
  tokenize,
} from "@/lib/workspace-retrieval";

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) =>
  new Date(Date.now() - days * DAY_MS).toISOString();

type FindCall = { filter: any; options: any };

const makeCursor = (docs: any[]) => {
  const cursor: any = {
    sort: jest.fn(() => cursor),
    limit: jest.fn(() => cursor),
    project: jest.fn(() => cursor),
    toArray: jest.fn(async () => docs),
  };
  return cursor;
};

const makeDb = ({
  meetings = [] as any[],
  transcripts = [] as any[],
  tasks = [] as any[],
  people = [] as any[],
} = {}) => {
  const calls: Record<"meetings" | "tasks" | "people", FindCall[]> = {
    meetings: [],
    tasks: [],
    people: [],
  };
  const collections: Record<string, any> = {
    meetings: {
      find: jest.fn((filter: any, options?: any) => {
        calls.meetings.push({ filter, options });
        if (filter?._id?.$in) {
          const ids = filter._id.$in.map(String);
          return makeCursor(
            transcripts.filter((doc: any) => ids.includes(String(doc._id)))
          );
        }
        return makeCursor(meetings);
      }),
    },
    tasks: {
      find: jest.fn((filter: any, options?: any) => {
        calls.tasks.push({ filter, options });
        return makeCursor(tasks);
      }),
    },
    people: {
      find: jest.fn((filter: any, options?: any) => {
        calls.people.push({ filter, options });
        return makeCursor(people);
      }),
    },
  };
  const db = {
    collection: jest.fn((name: string) => {
      const collection = collections[name];
      if (!collection) throw new Error(`Unexpected collection: ${name}`);
      return collection;
    }),
  } as any;
  return { db, calls };
};

const scope = {
  userId: "user-1",
  workspaceId: "ws-1",
  memberUserIds: ["user-1", "user-2"],
};

const expectedScopeOr = [
  { workspaceId: "ws-1" },
  {
    workspaceId: { $exists: false },
    userId: { $in: ["user-1", "user-2"] },
  },
];

describe("tokenize", () => {
  it("lowercases, strips punctuation, drops stopwords and short words", () => {
    const result = tokenize("What did Stefan say about the Pricing, on Q4?!");
    expect(result.tokens).toEqual(["stefan", "pricing"]);
    expect(result.phrases).toEqual([]);
  });

  it("keeps double-quoted spans as phrase tokens and folds their words into tokens", () => {
    const result = tokenize('Summarize all meetings about "the redesign project"');
    expect(result.phrases).toEqual(["the redesign project"]);
    expect(result.tokens).toEqual(
      expect.arrayContaining(["summarize", "meetings", "redesign", "project"])
    );
  });
});

describe("scoreText", () => {
  it("counts distinct query tokens present in the text", () => {
    expect(scoreText("Pricing review with Stefan", ["pricing", "stefan"])).toBe(2);
    expect(scoreText("Pricing pricing pricing", ["pricing", "stefan"])).toBe(1);
    expect(scoreText("Unrelated", ["pricing"])).toBe(0);
    expect(scoreText(null, ["pricing"])).toBe(0);
  });
});

describe("extractTranscriptSnippets", () => {
  const transcript = [
    "00:10 - Stefan: We need to finalize pricing for the enterprise tier.",
    "00:25 - Ana: Agreed, the contract depends on it.",
    "01:02 - Stefan: Separately, the roadmap needs an owner.",
    "01:40 - Ana: I'll take the roadmap item.",
  ].join("\n");

  it("returns the matching line plus its neighbor, with the timestamp parsed", () => {
    const snippets = extractTranscriptSnippets(transcript, tokenize("pricing"));
    expect(snippets).toHaveLength(1);
    expect(snippets[0].timestamp).toBe("00:10");
    expect(snippets[0].snippet).toContain("finalize pricing");
    expect(snippets[0].snippet).toContain("00:25 - Ana");
  });

  it("parses no timestamp when the line has none", () => {
    const snippets = extractTranscriptSnippets(
      "Stefan mentioned pricing without any timecode.",
      tokenize("pricing")
    );
    expect(snippets).toHaveLength(1);
    expect(snippets[0].timestamp).toBeNull();
  });

  it("caps the number of snippets and the snippet length", () => {
    const longLine = `00:05 - Bob: pricing ${"x".repeat(500)}`;
    const manyMatches = Array.from({ length: 12 }, (_, i) =>
      i === 0 ? longLine : `0${i % 10}:00 - Bob: pricing point ${i}`
    ).join("\n");
    const snippets = extractTranscriptSnippets(manyMatches, tokenize("pricing"));
    expect(snippets.length).toBeLessThanOrEqual(3);
    for (const snippet of snippets) {
      expect(snippet.snippet.length).toBeLessThanOrEqual(320);
    }
  });

  it("returns nothing for empty transcripts or empty queries", () => {
    expect(extractTranscriptSnippets("", tokenize("pricing"))).toEqual([]);
    expect(extractTranscriptSnippets(transcript, tokenize("the a of"))).toEqual([]);
  });
});

describe("searchWorkspaceContext", () => {
  it("applies workspace scoping with the legacy fallback to every collection query", async () => {
    const { db, calls } = makeDb({
      meetings: [
        {
          _id: "m1",
          title: "Pricing sync",
          summary: "Talked pricing",
          startTime: daysAgo(2),
        },
      ],
      transcripts: [{ _id: "m1", originalTranscript: "00:01 - A: pricing" }],
      tasks: [{ _id: "t1", title: "Update pricing page", status: "todo" }],
      people: [{ _id: "p1", name: "Pricing Bot", personType: "unknown" }],
    });

    await searchWorkspaceContext(db, scope, "What about pricing?");

    // Meeting candidate query: scoped, hides hidden meetings, excludes transcript.
    const meetingCall = calls.meetings[0];
    expect(meetingCall.filter.$or).toEqual(expectedScopeOr);
    expect(meetingCall.filter.isHidden).toEqual({ $ne: true });
    expect(meetingCall.options.projection).not.toHaveProperty(
      "originalTranscript"
    );
    expect(meetingCall.options.projection).toMatchObject({ title: 1, summary: 1 });

    // Transcript fetch: scoped AND restricted to winning ids only.
    const transcriptCall = calls.meetings[1];
    expect(transcriptCall.filter.$or).toEqual(expectedScopeOr);
    expect(transcriptCall.filter._id).toEqual({ $in: ["m1"] });
    expect(transcriptCall.options.projection).toEqual({
      _id: 1,
      originalTranscript: 1,
    });

    const taskCall = calls.tasks[0];
    expect(taskCall.filter.$or).toEqual(expectedScopeOr);
    expect(taskCall.filter.taskState).toEqual({ $ne: "archived" });

    const peopleCall = calls.people[0];
    expect(peopleCall.filter.$or).toEqual(expectedScopeOr);
  });

  it("scopes by user ids only when no workspaceId is available", async () => {
    const { db, calls } = makeDb();
    await searchWorkspaceContext(
      db,
      { userId: "user-9", workspaceId: null },
      "pricing"
    );
    expect(calls.meetings[0].filter.$or).toBeUndefined();
    expect(calls.meetings[0].filter.userId).toEqual({ $in: ["user-9"] });
    expect(calls.tasks[0].filter.userId).toEqual({ $in: ["user-9"] });
    expect(calls.people[0].filter.userId).toEqual({ $in: ["user-9"] });
  });

  it("ranks title matches above summary matches", async () => {
    const { db } = makeDb({
      meetings: [
        {
          _id: "summary-match",
          title: "Weekly sync",
          summary: "We discussed pricing in depth",
          startTime: daysAgo(90),
        },
        {
          _id: "title-match",
          title: "Pricing workshop",
          summary: "General notes",
          startTime: daysAgo(90),
        },
      ],
    });

    const result = await searchWorkspaceContext(db, scope, "pricing");
    expect(result.meetings.map((m) => m.id)).toEqual([
      "title-match",
      "summary-match",
    ]);
    expect(result.meetings[0].score).toBeGreaterThan(result.meetings[1].score);
    // Summary snippet only set when the summary itself matched.
    expect(result.meetings[0].summarySnippet).toBeNull();
    expect(result.meetings[1].summarySnippet).toContain("discussed pricing");
  });

  it("boosts recent meetings over old ones with the same keyword match", async () => {
    const { db } = makeDb({
      meetings: [
        { _id: "old", title: "Pricing review", startTime: daysAgo(90) },
        { _id: "recent", title: "Pricing review", startTime: daysAgo(2) },
        { _id: "month", title: "Pricing review", startTime: daysAgo(20) },
      ],
    });

    const result = await searchWorkspaceContext(db, scope, "pricing");
    expect(result.meetings.map((m) => m.id)).toEqual(["recent", "month", "old"]);
    expect(result.meetings[0].score).toBe(result.meetings[2].score + 2);
    expect(result.meetings[1].score).toBe(result.meetings[2].score + 1);
  });

  it("does not surface unmatched meetings just because they are recent", async () => {
    const { db } = makeDb({
      meetings: [{ _id: "recent", title: "Standup", startTime: daysAgo(1) }],
    });
    const result = await searchWorkspaceContext(db, scope, "pricing");
    expect(result.meetings).toEqual([]);
  });

  it("fetches transcripts only for top meetings and attaches keyword snippets", async () => {
    const { db, calls } = makeDb({
      meetings: [
        { _id: "m1", title: "Pricing deep dive", startTime: daysAgo(3) },
        { _id: "m2", title: "Roadmap", summary: "no match here" },
      ],
      transcripts: [
        {
          _id: "m1",
          originalTranscript: [
            "00:12 - Stefan: The pricing model should be per-seat.",
            "00:30 - Ana: Per-seat pricing works for the pilot.",
            "05:00 - Ana: Unrelated closing remarks.",
          ].join("\n"),
        },
      ],
    });

    const result = await searchWorkspaceContext(db, scope, "pricing");
    expect(result.meetings).toHaveLength(1);
    expect(calls.meetings[1].filter._id).toEqual({ $in: ["m1"] });
    const snippets = result.meetings[0].transcriptSnippets;
    expect(snippets.length).toBeGreaterThan(0);
    expect(snippets.length).toBeLessThanOrEqual(3);
    expect(snippets[0].timestamp).toBe("00:12");
    expect(snippets[0].snippet).toContain("per-seat");
  });

  it("includes open overdue tasks for overdue-intent questions even without keyword overlap", async () => {
    const { db } = makeDb({
      tasks: [
        {
          _id: "t-overdue",
          title: "Ship invoice PDF",
          status: "todo",
          dueAt: daysAgo(3),
        },
        {
          _id: "t-done",
          title: "Send contract",
          status: "done",
          dueAt: daysAgo(5),
        },
        {
          _id: "t-future",
          title: "Prepare slides",
          status: "todo",
          dueAt: daysAgo(-5),
        },
      ],
    });

    const result = await searchWorkspaceContext(
      db,
      scope,
      "Which tasks are overdue?"
    );
    expect(result.tasks.map((t) => t.id)).toEqual(["t-overdue"]);
    expect(result.tasks[0].overdue).toBe(true);
  });

  it("orders overdue tasks before keyword-matched tasks under overdue intent", async () => {
    const { db } = makeDb({
      tasks: [
        {
          _id: "t-keyword",
          title: "Review the deadline policy document",
          status: "todo",
          dueAt: daysAgo(-10),
        },
        {
          _id: "t-overdue",
          title: "Ship invoice PDF",
          status: "inprogress",
          dueAt: daysAgo(1),
        },
      ],
    });

    const result = await searchWorkspaceContext(
      db,
      scope,
      "What is past the deadline?"
    );
    expect(result.tasks.map((t) => t.id)).toEqual(["t-overdue", "t-keyword"]);
  });

  it("boosts client people for client questions and normalizes personType", async () => {
    const { db } = makeDb({
      people: [
        { _id: "p-teammate", name: "Marko Novak", personType: "teammate" },
        { _id: "p-client", name: "Acme Corp", personType: "client" },
        { _id: "p-legacy", name: "Old Contact" },
      ],
    });

    const result = await searchWorkspaceContext(
      db,
      scope,
      "Which clients are waiting on us?"
    );
    expect(result.people.map((p) => p.id)).toEqual(["p-client"]);
    expect(result.people[0].personType).toBe("client");
  });

  it("ranks exact full-name matches above partial name matches", async () => {
    const { db } = makeDb({
      people: [
        {
          _id: "p-partial",
          name: "Stefan Novak",
          email: "novak@example.com",
          personType: "teammate",
        },
        {
          _id: "p-exact",
          name: "Stefan Petrovic",
          email: "petrovic@example.com",
          personType: "teammate",
        },
      ],
    });

    const result = await searchWorkspaceContext(
      db,
      scope,
      "What did Stefan Petrovic say about pricing?"
    );
    expect(result.people.map((p) => p.id)).toEqual(["p-exact", "p-partial"]);
    expect(result.people[0].score).toBeGreaterThan(result.people[1].score);
  });

  it("returns isEmpty when nothing in the workspace matches", async () => {
    const { db } = makeDb({
      meetings: [{ _id: "m1", title: "Standup", summary: "daily notes" }],
      tasks: [{ _id: "t1", title: "Water plants", status: "todo" }],
      people: [{ _id: "p1", name: "Ana", personType: "teammate" }],
    });

    const result = await searchWorkspaceContext(
      db,
      scope,
      "quarterly revenue projections for Antarctica"
    );
    expect(result.meetings).toEqual([]);
    expect(result.tasks).toEqual([]);
    expect(result.people).toEqual([]);
    expect(result.isEmpty).toBe(true);
  });

  it("respects the maxMeetings/maxTasks/maxPeople caps", async () => {
    const meetings = Array.from({ length: 8 }, (_, i) => ({
      _id: `m${i}`,
      title: "Pricing sync",
      startTime: daysAgo(60),
    }));
    const tasks = Array.from({ length: 15 }, (_, i) => ({
      _id: `t${i}`,
      title: "Pricing follow-up",
      status: "todo",
    }));
    const people = Array.from({ length: 9 }, (_, i) => ({
      _id: `p${i}`,
      name: `Pricing Person ${i}`,
      personType: "client",
    }));
    const { db } = makeDb({ meetings, tasks, people });

    const result = await searchWorkspaceContext(db, scope, "pricing", {
      maxMeetings: 2,
      maxTasks: 4,
      maxPeople: 3,
    });
    expect(result.meetings).toHaveLength(2);
    expect(result.tasks).toHaveLength(4);
    expect(result.people).toHaveLength(3);
  });
});
