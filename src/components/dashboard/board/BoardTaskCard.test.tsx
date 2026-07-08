import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import BoardTaskCard, {
  CompletionEvidenceIndicator,
  type BoardTaskCardProps,
} from "@/components/dashboard/board/BoardTaskCard";
import type { Task } from "@/types/project";

const noop = () => {};

const buildTask = (overrides: Partial<Task> = {}): Task =>
  ({
    id: "task-1",
    title: "Send the Acme proposal",
    description: "Attach the revised pricing table",
    status: "todo",
    priority: "high",
    projectId: "p1",
    userId: "u1",
    ...overrides,
  } as Task);

const renderCard = (
  overrides: Partial<BoardTaskCardProps> = {}
): string =>
  renderToStaticMarkup(
    <BoardTaskCard
      task={buildTask()}
      assigneeName="Jane Doe"
      assigneePerson={null}
      company={null}
      people={[]}
      isSelected={false}
      onToggleSelect={noop}
      onEdit={noop}
      onDelete={noop}
      onOpen={noop}
      onAssign={noop}
      onDragStart={noop}
      onDragOver={noop}
      onDrop={noop}
      onDragEnd={noop}
      isDragging={false}
      isDragOver={false}
      dragPosition={null}
      dragDisabled={false}
      {...overrides}
    />
  );

describe("BoardTaskCard", () => {
  it("renders title, description, priority badge, due date, and assignee", () => {
    const markup = renderCard({
      task: buildTask({
        dueAt: "2026-07-10T00:00:00.000Z",
        priorityLabel: "urgent",
        priorityReason: "Due soon; client commitment",
      }),
    });
    expect(markup).toContain("Send the Acme proposal");
    expect(markup).toContain("Attach the revised pricing table");
    expect(markup).toContain("Urgent");
    expect(markup).toContain("Due soon; client commitment");
    expect(markup).toContain("Jul 10");
    expect(markup).toContain("Jane Doe");
  });

  it("renders source meeting and client/company metadata", () => {
    const markup = renderCard({
      task: buildTask({ sourceSessionName: "Acme weekly sync" }),
      company: "Acme Inc",
    });
    expect(markup).toContain("Acme weekly sync");
    expect(markup).toContain("Source meeting: Acme weekly sync");
    expect(markup).toContain("Acme Inc");
    expect(markup).toContain("Client: Acme Inc");
  });

  it("omits meeting/company row when neither is present", () => {
    const markup = renderCard();
    expect(markup).not.toContain("Source meeting:");
    expect(markup).not.toContain("Client:");
  });

  it("shows the completion-evidence indicator with evidence snippets", () => {
    const markup = renderCard({
      task: buildTask({
        completionSuggested: true,
        completionEvidence: [
          { snippet: "I already sent it yesterday", speaker: "Jane" },
        ],
      }),
    });
    expect(markup).toContain('data-testid="completion-evidence"');
    expect(markup).toContain("Jane: I already sent it yesterday");
  });

  it("hides the completion-evidence indicator by default", () => {
    expect(renderCard()).not.toContain('data-testid="completion-evidence"');
  });

  it("renders the cleanup badge when the task has a cleanup suggestion", () => {
    const markup = renderCard({
      task: buildTask({
        cleanupStatus: "completed_suggested",
        cleanupReason: "Detected as done in the last meeting",
      }),
    });
    expect(markup).toContain("Done?");
    expect(markup).toContain("Detected as done in the last meeting");
  });

  it("renders an absolutely positioned drop indicator only while dragged over", () => {
    const idle = renderCard();
    expect(idle).not.toContain("drop-indicator-before");
    expect(idle).not.toContain("drop-indicator-after");

    const before = renderCard({ isDragOver: true, dragPosition: "before" });
    expect(before).toContain('data-testid="drop-indicator-before"');
    expect(before).toContain("absolute");

    const after = renderCard({ isDragOver: true, dragPosition: "after" });
    expect(after).toContain('data-testid="drop-indicator-after"');
  });
});

describe("CompletionEvidenceIndicator", () => {
  it("falls back to a generic tooltip when only the flag is set", () => {
    const markup = renderToStaticMarkup(
      <CompletionEvidenceIndicator
        task={buildTask({ completionSuggested: true })}
      />
    );
    expect(markup).toContain("Completion suggested");
  });

  it("renders nothing without a suggestion or evidence", () => {
    expect(
      renderToStaticMarkup(<CompletionEvidenceIndicator task={buildTask()} />)
    ).toBe("");
  });
});
