import { buildCompletionSuggestions } from "@/lib/task-completion-detection";
import { buildCompletionEvidenceFingerprint } from "@/lib/task-completion-helpers";
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

  const buildDbMock = (taskDocs: any[]) => {
    const bulkWrite = jest.fn().mockResolvedValue({ ok: 1 });
    const collection = jest.fn(() => ({
      find: jest.fn(() => ({
        toArray: jest.fn().mockResolvedValue(taskDocs),
      })),
      bulkWrite,
    }));
    mockedGetDb.mockResolvedValue({ collection } as any);
    return { bulkWrite, collection };
  };

  it("returns a direct completion suggestion for a matching completed task", async () => {
    buildDbMock([
      {
        _id: "task-1",
        title: "We shipped it",
        description: "",
        assigneeName: "Jane Doe",
        assignee: { name: "Jane Doe", email: "jane@example.com" },
        embedding: [1, 0],
        embeddingModel: "text-embedding-3-small",
      },
    ]);

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

  it("suppresses suggestions whose evidence fingerprint was rejected for the task", async () => {
    const { bulkWrite } = buildDbMock([
      {
        _id: "task-1",
        title: "We shipped it",
        description: "",
        assigneeName: "Jane Doe",
        assignee: { name: "Jane Doe", email: "jane@example.com" },
        embedding: [1, 0],
        embeddingModel: "text-embedding-3-small",
        completionRejectedFingerprints: [
          buildCompletionEvidenceFingerprint("We shipped it."),
        ],
      },
    ]);

    const result = await buildCompletionSuggestions({
      userId: "user-1",
      transcript: "12:03 - Alice: We shipped it.",
      attendees: [{ name: "Jane Doe", email: "jane@example.com" }],
      workspaceId: "workspace-1",
    });

    expect(result).toEqual([]);
    // Nothing to persist either — the rejected suggestion never resurfaces.
    expect(bulkWrite).not.toHaveBeenCalled();
  });

  it("persists medium-confidence suggestions as reviewable completed_suggested cleanup entries", async () => {
    const { bulkWrite } = buildDbMock([
      {
        _id: "task-1",
        title: "Ship analytics dashboard",
        description: "",
        assigneeName: "Jane Doe",
        assignee: { name: "Jane Doe", email: "jane@example.com" },
        embedding: [1, 0],
        embeddingModel: "text-embedding-3-small",
      },
    ]);
    // Partial semantic match only (cosine 0.6) so the direct-match shortcut
    // does not fire and the snippet goes to the LLM auditor.
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ embedding: [0.6, 0.8] }],
        usage: { total_tokens: 1 },
      }),
    });
    mockedDetectCompletedTasks.mockResolvedValue({
      completed: [
        {
          groupId: "cand_1",
          confidence: 0.7,
          evidence: { snippet: "Quick update, the portal work is finished." },
        },
      ],
    } as any);

    const result = await buildCompletionSuggestions({
      userId: "user-1",
      transcript: "07:15 - Alice: Quick update, the portal work is finished.",
      attendees: [{ name: "Jane Doe", email: "jane@example.com" }],
      workspaceId: "workspace-1",
      excludeMeetingId: "meeting-9",
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      completionSuggested: true,
      completionConfidence: 0.7,
    });

    expect(bulkWrite).toHaveBeenCalledTimes(1);
    const [ops] = bulkWrite.mock.calls[0];
    expect(ops).toHaveLength(1);
    const { filter, update } = ops[0].updateOne;
    expect(filter).toMatchObject({
      userId: "user-1",
      status: { $ne: "done" },
      completionRejectedFingerprints: {
        $ne: buildCompletionEvidenceFingerprint(
          "Quick update, the portal work is finished."
        ),
      },
    });
    expect(update.$set).toMatchObject({
      cleanupStatus: "completed_suggested",
      cleanupCategory: "already_completed",
      cleanupConfidence: 0.7,
      completionReviewStatus: "suggested",
      cleanupEvidence: [
        {
          sourceType: "transcript",
          sourceId: "meeting-9",
          snippet: "Quick update, the portal work is finished.",
        },
      ],
    });
    // Review-decision fields are never written by the detection pipeline.
    expect(update.$set.completionReviewedBy).toBeUndefined();
    expect(update.$set.status).toBeUndefined();
  });
});
