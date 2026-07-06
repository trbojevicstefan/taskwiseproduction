import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildCardDescription,
  buildTrelloCardsPayload,
  PushToTrelloDialogBody,
  resolveTrelloPhaseFromStatus,
  type PushToTrelloDialogBodyProps,
} from "@/components/dashboard/common/PushToTrelloDialog";
import type { ExtractedTaskSchema } from "@/types/chat";

jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

const buildTask = (
  overrides: Partial<ExtractedTaskSchema> = {}
): ExtractedTaskSchema => ({
  id: "task-1",
  title: "Send the proposal",
  priority: "medium",
  ...overrides,
});

const bodyProps = (
  overrides: Partial<PushToTrelloDialogBodyProps> = {}
): PushToTrelloDialogBodyProps => ({
  phase: "connected",
  statusMessage: null,
  authorizeUrl: "https://trello.com/1/authorize?key=k",
  isConnecting: false,
  connectError: null,
  onConnectSubmit: jest.fn(),
  onRetry: jest.fn(),
  boards: [],
  lists: [],
  boardsLoaded: false,
  listsLoaded: false,
  isFetchingBoards: false,
  isFetchingLists: false,
  selectedBoardId: null,
  selectedListId: null,
  onBoardChange: jest.fn(),
  onListChange: jest.fn(),
  ...overrides,
});

describe("resolveTrelloPhaseFromStatus", () => {
  it("maps a missing payload to the error phase", () => {
    expect(resolveTrelloPhaseFromStatus(null)).toBe("error");
  });

  it("maps an unconfigured server to the unconfigured phase", () => {
    expect(resolveTrelloPhaseFromStatus({ configured: false })).toBe(
      "unconfigured"
    );
  });

  it("maps a missing or revoked connection to disconnected", () => {
    expect(
      resolveTrelloPhaseFromStatus({ configured: true, connection: null })
    ).toBe("disconnected");
    expect(
      resolveTrelloPhaseFromStatus({
        configured: true,
        connection: { status: "revoked" },
      })
    ).toBe("disconnected");
  });

  it("maps an active connection to connected", () => {
    expect(
      resolveTrelloPhaseFromStatus({
        configured: true,
        connection: { status: "active" },
      })
    ).toBe("connected");
  });
});

describe("buildTrelloCardsPayload", () => {
  it("maps title, description, due date, assignee, source link, and subtasks", () => {
    const payload = buildTrelloCardsPayload(
      [
        buildTask({
          description: "Draft and send the Q3 proposal",
          dueAt: "2026-07-10T12:00:00.000Z",
          assigneeName: "Fallback Name",
          assignee: { displayName: "Jane Doe" } as any,
          sourceSessionId: "meeting-1",
          subtasks: [
            buildTask({ id: "sub-1", title: "Draft" }),
            buildTask({ id: "sub-2", title: "  Review  " }),
          ],
        }),
      ],
      "list12345",
      "https://app.example.com"
    );

    expect(payload.listId).toBe("list12345");
    expect(payload.cards).toHaveLength(1);
    expect(payload.cards[0]).toMatchObject({
      name: "Send the proposal",
      desc: "Draft and send the Q3 proposal",
      due: "2026-07-10T12:00:00.000Z",
      assigneeName: "Jane Doe",
      sourceMeetingUrl: "https://app.example.com/meetings/meeting-1",
      subtasks: ["Draft", "Review"],
    });
  });

  it("falls back to assigneeName and drops missing fields", () => {
    const payload = buildTrelloCardsPayload(
      [buildTask({ assigneeName: "Sam" })],
      "list12345",
      null
    );

    expect(payload.cards[0]).toEqual({
      name: "Send the proposal",
      assigneeName: "Sam",
    });
  });

  it("drops unparseable due dates and untitled subtasks", () => {
    const payload = buildTrelloCardsPayload(
      [
        buildTask({
          dueAt: "not-a-date",
          subtasks: [buildTask({ id: "sub-1", title: "   " })],
        }),
      ],
      "list12345",
      "https://app.example.com"
    );

    expect(payload.cards[0].due).toBeUndefined();
    expect(payload.cards[0].subtasks).toBeUndefined();
  });

  it("caps the number of cards at 25 and defaults empty titles", () => {
    const tasks = Array.from({ length: 30 }, (_, index) =>
      buildTask({ id: `task-${index}`, title: index === 0 ? "  " : `Task ${index}` })
    );

    const payload = buildTrelloCardsPayload(tasks, "list12345", null);

    expect(payload.cards).toHaveLength(25);
    expect(payload.cards[0].name).toBe("Untitled task");
  });

  it("includes research brief and AI assistance in the description", () => {
    const desc = buildCardDescription(
      buildTask({
        description: "Base",
        researchBrief: "Brief",
        aiAssistanceText: "Assist",
      })
    );

    expect(desc).toContain("Base");
    expect(desc).toContain("AI Research Brief:\nBrief");
    expect(desc).toContain("AI Assistance:\nAssist");
  });
});

describe("PushToTrelloDialogBody", () => {
  it("renders the checking state", () => {
    const markup = renderToStaticMarkup(
      <PushToTrelloDialogBody {...bodyProps({ phase: "checking" })} />
    );

    expect(markup).toContain("Checking Trello connection...");
  });

  it("renders the unconfigured state with the missing env var", () => {
    const markup = renderToStaticMarkup(
      <PushToTrelloDialogBody {...bodyProps({ phase: "unconfigured" })} />
    );

    expect(markup).toContain("TRELLO_API_KEY");
  });

  it("renders the disconnected state with the token-paste connect flow", () => {
    const markup = renderToStaticMarkup(
      <PushToTrelloDialogBody {...bodyProps({ phase: "disconnected" })} />
    );

    expect(markup).toContain("Trello is not connected yet");
    expect(markup).toContain("Open Trello authorization");
    expect(markup).toContain("Trello token");
    expect(markup).toContain('type="password"');
    expect(markup).toContain("Connect Trello");
  });

  it("renders the auth-expired state with reconnect copy", () => {
    const markup = renderToStaticMarkup(
      <PushToTrelloDialogBody {...bodyProps({ phase: "authExpired" })} />
    );

    expect(markup).toContain("no longer valid");
    expect(markup).toContain("Reconnect Trello");
  });

  it("renders a connect error message", () => {
    const markup = renderToStaticMarkup(
      <PushToTrelloDialogBody
        {...bodyProps({
          phase: "disconnected",
          connectError: "Trello rejected this token.",
        })}
      />
    );

    expect(markup).toContain("Trello rejected this token.");
  });

  it("renders the error state with a retry action", () => {
    const markup = renderToStaticMarkup(
      <PushToTrelloDialogBody
        {...bodyProps({ phase: "error", statusMessage: "Boom happened." })}
      />
    );

    expect(markup).toContain("Boom happened.");
    expect(markup).toContain("Try again");
  });

  it("renders the no-boards message when the account has no open boards", () => {
    const markup = renderToStaticMarkup(
      <PushToTrelloDialogBody
        {...bodyProps({ phase: "connected", boardsLoaded: true, boards: [] })}
      />
    );

    expect(markup).toContain("No open boards were found");
  });

  it("renders board and list pickers when connected", () => {
    const markup = renderToStaticMarkup(
      <PushToTrelloDialogBody
        {...bodyProps({
          phase: "connected",
          boardsLoaded: true,
          boards: [{ id: "board-1", name: "Product", url: "" }],
          selectedBoardId: "board-1",
          listsLoaded: true,
          lists: [{ id: "list-1", name: "To Do" }],
          selectedListId: "list-1",
        })}
      />
    );

    expect(markup).toContain("Board");
    expect(markup).toContain("List");
    expect(markup).not.toContain("No open boards were found");
    expect(markup).not.toContain("This board has no open lists");
  });

  it("renders the no-lists message for a board without open lists", () => {
    const markup = renderToStaticMarkup(
      <PushToTrelloDialogBody
        {...bodyProps({
          phase: "connected",
          boardsLoaded: true,
          boards: [{ id: "board-1", name: "Product", url: "" }],
          selectedBoardId: "board-1",
          listsLoaded: true,
          lists: [],
        })}
      />
    );

    expect(markup).toContain("This board has no open lists");
  });
});
