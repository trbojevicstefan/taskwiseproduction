import { POST } from "@/app/api/people/merge/route";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/server-auth";
import { resolveWorkspaceScopeForUser } from "@/lib/workspace-scope";

jest.mock("@/lib/db", () => ({
  getDb: jest.fn(),
}));

jest.mock("@/lib/server-auth", () => ({
  getSessionUserId: jest.fn(),
}));

jest.mock("@/lib/workspace-scope", () => ({
  resolveWorkspaceScopeForUser: jest.fn(),
}));

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedGetSessionUserId = getSessionUserId as jest.MockedFunction<
  typeof getSessionUserId
>;
const mockedResolveWorkspaceScopeForUser =
  resolveWorkspaceScopeForUser as jest.MockedFunction<
    typeof resolveWorkspaceScopeForUser
  >;

const buildRequest = (body: any) =>
  new Request("http://localhost/api/people/merge", {
    method: "POST",
    body: JSON.stringify(body),
  });

type MockCollections = {
  peopleFindOne: jest.Mock;
  peopleUpdateOne: jest.Mock;
  peopleDeleteOne: jest.Mock;
  tasksUpdateMany: jest.Mock;
  meetingsFind: jest.Mock;
  meetingsUpdateOne: jest.Mock;
  chatSessionsFind: jest.Mock;
  chatSessionsUpdateOne: jest.Mock;
};

const buildDb = ({
  people,
  meetings = [],
  chatSessions = [],
}: {
  people: any[];
  meetings?: any[];
  chatSessions?: any[];
}): { db: any; mocks: MockCollections } => {
  const findPersonByQuery = (query: any) => {
    // Final "refreshed" lookup: { _id: "..." }
    if (typeof query?._id === "string") {
      return people.find((person) => person._id === query._id) || null;
    }
    // Scoped lookup: { $and: [scope, { $or: [{_id}, {id}, {slackId}] }] }
    const orClauses = query?.$and?.[1]?.$or || [];
    const wantedId =
      orClauses[0]?._id ?? orClauses[1]?.id ?? orClauses[2]?.slackId ?? null;
    return (
      people.find(
        (person) =>
          person._id === wantedId ||
          person.id === wantedId ||
          person.slackId === wantedId
      ) || null
    );
  };

  const mocks: MockCollections = {
    peopleFindOne: jest.fn(async (query: any) => findPersonByQuery(query)),
    peopleUpdateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    peopleDeleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    tasksUpdateMany: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    meetingsFind: jest.fn().mockReturnValue({
      project: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue(meetings),
      }),
    }),
    meetingsUpdateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    chatSessionsFind: jest.fn().mockReturnValue({
      project: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue(chatSessions),
      }),
    }),
    chatSessionsUpdateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
  };

  const db = {
    collection: jest.fn((name: string) => {
      if (name === "people") {
        return {
          findOne: mocks.peopleFindOne,
          updateOne: mocks.peopleUpdateOne,
          deleteOne: mocks.peopleDeleteOne,
        };
      }
      if (name === "tasks") {
        return { updateMany: mocks.tasksUpdateMany };
      }
      if (name === "meetings") {
        return { find: mocks.meetingsFind, updateOne: mocks.meetingsUpdateOne };
      }
      if (name === "chatSessions") {
        return {
          find: mocks.chatSessionsFind,
          updateOne: mocks.chatSessionsUpdateOne,
        };
      }
      throw new Error(`Unexpected collection in test: ${name}`);
    }),
  } as any;

  return { db, mocks };
};

const slackTarget = {
  _id: "tgt",
  userId: "user-1",
  name: "Sam Smith",
  email: "sam@acme.com",
  avatarUrl: "https://avatar/sam.png",
  slackId: "U123",
  aliases: [],
  sourceSessionIds: ["meeting-9"],
  sourceIdentities: [
    { provider: "slack", externalId: "U123", confidence: 1 },
  ],
};

const transcriptSource = {
  _id: "src",
  userId: "user-1",
  name: "Sam S",
  email: "sam@old.com",
  aliases: ["Sammy"],
  sourceSessionIds: ["meeting-1"],
  sourceIdentities: [{ provider: "fireflies", email: "sam@old.com" }],
};

describe("POST /api/people/merge", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetSessionUserId.mockResolvedValue("user-1");
    mockedResolveWorkspaceScopeForUser.mockResolvedValue({
      workspaceId: "workspace-1",
      workspace: null as any,
      membership: null as any,
      workspaceMemberUserIds: ["user-1"],
    });
  });

  it("returns 401 when unauthorized", async () => {
    mockedGetSessionUserId.mockResolvedValue(null);
    const response = await POST(buildRequest({ sourceId: "a", targetId: "b" }));
    expect(response.status).toBe(401);
  });

  it("rejects merging an already-merged person", async () => {
    const { db } = buildDb({
      people: [
        { ...transcriptSource, mergeState: "merged", mergedIntoPersonId: "x" },
        slackTarget,
      ],
    });
    mockedGetDb.mockResolvedValue(db);

    const response = await POST(
      buildRequest({ sourceId: "src", targetId: "tgt" })
    );
    expect(response.status).toBe(400);
  });

  it("rewrites task assignees, meeting attendees, embedded task assignees and aliases, and tombstones the loser", async () => {
    const meeting = {
      _id: "meeting-1",
      attendees: [
        { name: "Sam S", email: "sam@old.com" },
        { name: "Other Person", email: "other@x.com" },
      ],
      extractedTasks: [
        {
          title: "Send proposal",
          assigneeName: "Sam S",
          assignee: { uid: "src", name: "Sam S" },
          subtasks: [{ title: "Draft", assigneeName: "Sammy" }],
        },
      ],
    };
    const chatSession = {
      _id: "chat-1",
      suggestedTasks: [{ title: "Follow up", assigneeName: "Sam S" }],
    };
    const { db, mocks } = buildDb({
      people: [transcriptSource, slackTarget],
      meetings: [meeting],
      chatSessions: [chatSession],
    });
    mockedGetDb.mockResolvedValue(db);

    const response = await POST(
      buildRequest({ sourceId: "src", targetId: "tgt" })
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.ok).toBe(true);
    expect(payload.person.id).toBe("tgt");

    // Loser is tombstoned, never deleted.
    expect(mocks.peopleDeleteOne).not.toHaveBeenCalled();
    expect(mocks.peopleUpdateOne).toHaveBeenCalledWith(
      { _id: "src" },
      {
        $set: expect.objectContaining({
          mergeState: "merged",
          mergedIntoPersonId: "tgt",
          canonicalPersonId: "tgt",
        }),
      }
    );

    // Winner unions aliases (incl. the loser's name + email) and identities.
    const targetUpdate = mocks.peopleUpdateOne.mock.calls.find(
      ([filter]: any[]) => filter._id === "tgt"
    )?.[1]?.$set;
    expect(targetUpdate.aliases).toEqual(
      expect.arrayContaining(["Sammy", "Sam S", "sam@old.com"])
    );
    expect(targetUpdate.sourceSessionIds).toEqual(
      expect.arrayContaining(["meeting-1", "meeting-9"])
    );
    expect(targetUpdate.mergeState).toBe("active");
    expect(targetUpdate.sourceIdentities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: "slack", externalId: "U123" }),
        expect.objectContaining({ provider: "fireflies", email: "sam@old.com" }),
      ])
    );

    // Task rewrite by assignee uid.
    const targetAssignee = {
      uid: "tgt",
      name: "Sam Smith",
      email: "sam@acme.com",
      photoURL: "https://avatar/sam.png",
    };
    expect(mocks.tasksUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        $and: expect.arrayContaining([
          { "assignee.uid": { $in: expect.arrayContaining(["src"]) } },
        ]),
      }),
      {
        $set: {
          assignee: targetAssignee,
          assigneeName: "Sam Smith",
          assigneeNameKey: "sam smith",
        },
      }
    );

    // Task rewrite by assignee name keys / raw names / emails.
    const nameKeyCall = mocks.tasksUpdateMany.mock.calls.find(
      ([filter]: any[]) =>
        JSON.stringify(filter).includes("assigneeNameKey")
    );
    expect(nameKeyCall).toBeTruthy();
    expect(JSON.stringify(nameKeyCall[0])).toContain("sammy");
    expect(nameKeyCall[1].$set.assigneeName).toBe("Sam Smith");

    // Meeting attendees rewritten to the surviving person.
    expect(mocks.meetingsUpdateOne).toHaveBeenCalledWith(
      { _id: "meeting-1" },
      {
        $set: expect.objectContaining({
          attendees: [
            expect.objectContaining({ name: "Sam Smith", email: "sam@acme.com" }),
            expect.objectContaining({ name: "Other Person" }),
          ],
        }),
      }
    );

    // Extracted task assignees (incl. nested subtasks) rewritten.
    const meetingSet = mocks.meetingsUpdateOne.mock.calls[0][1].$set;
    expect(meetingSet.extractedTasks[0].assigneeName).toBe("Sam Smith");
    expect(meetingSet.extractedTasks[0].assignee).toMatchObject({
      uid: "tgt",
      name: "Sam Smith",
    });
    expect(meetingSet.extractedTasks[0].subtasks[0].assigneeName).toBe(
      "Sam Smith"
    );

    // Chat session suggested tasks rewritten.
    expect(mocks.chatSessionsUpdateOne).toHaveBeenCalledWith(
      { _id: "chat-1" },
      {
        $set: {
          suggestedTasks: [
            expect.objectContaining({ assigneeName: "Sam Smith" }),
          ],
        },
      }
    );
  });

  it("keeps the Slack person as merge target even when passed as source", async () => {
    const { db, mocks } = buildDb({
      people: [transcriptSource, slackTarget],
    });
    mockedGetDb.mockResolvedValue(db);

    // Caller asks to merge the Slack person INTO the transcript person.
    const response = await POST(
      buildRequest({ sourceId: "tgt", targetId: "src" })
    );
    expect(response.status).toBe(200);
    const payload = await response.json();

    // The Slack-backed person survives.
    expect(payload.person.id).toBe("tgt");
    expect(mocks.peopleUpdateOne).toHaveBeenCalledWith(
      { _id: "src" },
      {
        $set: expect.objectContaining({
          mergeState: "merged",
          mergedIntoPersonId: "tgt",
        }),
      }
    );
    // Tasks pointing at the surviving Slack person are never rewritten away.
    for (const [filter] of mocks.tasksUpdateMany.mock.calls) {
      const serialized = JSON.stringify(filter);
      expect(serialized).not.toContain('"assignee.uid":{"$in":["tgt"');
    }
  });
});
