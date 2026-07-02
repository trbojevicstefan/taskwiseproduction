import {
  createAutomationWorkflow,
  ensureAutomationWorkflowIndexes,
  serializeAutomationWorkflow,
} from "@/lib/automation-workflows";

describe("automation-workflows", () => {
  it("creates indexes and applies workflow defaults", async () => {
    const createIndex = jest.fn().mockResolvedValue(undefined);
    const insertOne = jest.fn().mockResolvedValue(undefined);
    const db = {
      collection: jest.fn(() => ({
        createIndex,
        insertOne,
      })),
    } as any;

    await ensureAutomationWorkflowIndexes(db);
    const workflow = await createAutomationWorkflow(db, {
      workspaceId: "workspace-1",
      name: "Meeting Updates",
      trigger: "meeting.ingested",
      destination: {
        type: "webhook",
        url: "https://example.com/hook",
        signingSecret: "signing-secret",
      },
      createdByUserId: "user-1",
    });

    expect(createIndex).toHaveBeenCalledTimes(4);
    expect(workflow.version).toBe(1);
    expect(workflow.enabled).toBe(true);
    expect(serializeAutomationWorkflow(workflow)?.destination).not.toHaveProperty(
      "signingSecret"
    );
  });
});
