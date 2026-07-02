import { getSessionUserId } from "@/lib/server-auth";

jest.mock("@/lib/db", () => ({
  getDb: jest.fn(),
}));

jest.mock("@/lib/domain-events", () => ({
  publishDomainEvent: jest.fn(),
}));

jest.mock("@/lib/slack-automation", () => ({
  postMeetingAutomationToSlack: jest.fn(),
}));

jest.mock("@/lib/task-completion", () => ({
  applyCompletionTargets: jest.fn(),
  buildCompletionSuggestions: jest.fn().mockResolvedValue([]),
  mergeCompletionSuggestions: jest.fn((tasks: any[]) => tasks),
}));

jest.mock("@/lib/workspace", () => ({
  getWorkspaceIdForUser: jest.fn().mockResolvedValue("workspace-1"),
}));

jest.mock("@/lib/server-auth", () => ({
  getSessionUserId: jest.fn(),
}));

jest.mock("@/lib/observability-metrics", () => ({
  recordRouteMetric: jest.fn(),
}));

const mockedGetSessionUserId = getSessionUserId as jest.MockedFunction<
  typeof getSessionUserId
>;

let getMeetings: typeof import("@/app/api/meetings/route").GET;
let postMeetings: typeof import("@/app/api/meetings/route").POST;
let getRealtimeStream: typeof import("@/app/api/realtime/stream/route").GET;
let getTasks: typeof import("@/app/api/tasks/route").GET;
let postTasks: typeof import("@/app/api/tasks/route").POST;

const expectUnauthorized = async (response: Response) => {
  expect(response.status).toBe(401);
  await expect(response.json()).resolves.toMatchObject({
    ok: false,
    errorCode: "request_error",
    error: "Unauthorized",
  });
};

describe("API route smoke checks", () => {
  beforeAll(async () => {
    ({ GET: getMeetings, POST: postMeetings } = await import("@/app/api/meetings/route"));
    ({ GET: getRealtimeStream } = await import("@/app/api/realtime/stream/route"));
    ({ GET: getTasks, POST: postTasks } = await import("@/app/api/tasks/route"));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetSessionUserId.mockResolvedValue(null);
  });

  it("smoke-checks tasks route handlers", async () => {
    const getResponse = await getTasks(new Request("http://localhost/api/tasks"));
    await expectUnauthorized(getResponse);

    const postResponse = await postTasks(
      new Request("http://localhost/api/tasks", {
        method: "POST",
        body: JSON.stringify({ title: "Should not matter" }),
      })
    );
    await expectUnauthorized(postResponse);
  });

  it("smoke-checks meetings route handlers", async () => {
    const getResponse = await getMeetings();
    await expectUnauthorized(getResponse);

    const postResponse = await postMeetings(
      new Request("http://localhost/api/meetings", {
        method: "POST",
        body: JSON.stringify({ title: "Should not matter" }),
      })
    );
    await expectUnauthorized(postResponse);
  });

  it("smoke-checks realtime stream route handler", async () => {
    const response = await getRealtimeStream(
      new Request("http://localhost/api/realtime/stream?topics=tasks,board")
    );
    await expectUnauthorized(response);
  });
});
