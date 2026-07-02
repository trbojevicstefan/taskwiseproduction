import { buildCompletionSuggestions } from "@/lib/task-completion-detection";
import { getDb } from "@/lib/db";
import { detectCompletedTasks } from "@/ai/flows/detect-completed-tasks-flow";

jest.mock("@/lib/db", () => ({
  getDb: jest.fn(),
}));

jest.mock("@/ai/flows/detect-completed-tasks-flow", () => ({
  detectCompletedTasks: jest.fn(),
}));

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedDetectCompletedTasks = detectCompletedTasks as jest.MockedFunction<
  typeof detectCompletedTasks
>;

describe("task-completion-detection", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.OPENAI_EMBEDDINGS_MODEL = "text-embedding-3-small";
    mockedDetectCompletedTasks.mockResolvedValue({ completed: [] } as any);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ embedding: [1, 0] }],
        usage: { total_tokens: 1 },
      }),
    }) as any;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it("returns a direct completion suggestion for a matching completed task", async () => {
    mockedGetDb.mockResolvedValue({
      collection: jest.fn(() => ({
        find: jest.fn(() => ({
          toArray: jest.fn().mockResolvedValue([
            {
              _id: "task-1",
              title: "We shipped it",
              description: "",
              assigneeName: "Jane Doe",
              assignee: { name: "Jane Doe", email: "jane@example.com" },
              embedding: [1, 0],
              embeddingModel: "text-embedding-3-small",
            },
          ]),
        })),
        bulkWrite: jest.fn(),
      })),
    } as any);

    const result = await buildCompletionSuggestions({
      userId: "user-1",
      transcript: "12:03 - Alice: We shipped it.",
      attendees: [{ name: "Jane Doe", email: "jane@example.com" }],
      workspaceId: "workspace-1",
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      title: "We shipped it",
      completionSuggested: true,
      status: "todo",
    });
  });
});
