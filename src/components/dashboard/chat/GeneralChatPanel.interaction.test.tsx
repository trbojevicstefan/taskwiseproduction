/** @jest-environment jsdom */

/**
 * Interaction tests for the unified chat panel: the single composer posts to
 * POST /api/ai/chat only (never task extraction), carries the meeting context
 * for every follow-up in meeting mode, and persists messages through
 * PATCH /api/chat-sessions/[id].
 */

import React from "react";
import { act } from "react-dom/test-utils";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
import { createRoot, type Root } from "react-dom/client";
import GeneralChatPanel, {
  type PanelMessage,
} from "@/components/dashboard/chat/GeneralChatPanel";
import { apiFetch } from "@/lib/api";

// jsdom resolves lucide-react to its ESM build, which ts-jest does not
// transform; icons are irrelevant to these tests.
jest.mock("lucide-react", () =>
  new Proxy(
    {},
    {
      get: (_target, prop) =>
        prop === "__esModule" ? true : () => null,
    }
  )
);

jest.mock("next/navigation", () => ({
  useRouter: jest.fn(() => ({ push: jest.fn() })),
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...props }: any) =>
    React.createElement("a", { href, ...props }, children),
}));

jest.mock("@/components/ui/logo", () => ({
  Logo: () => React.createElement("span", null, "logo"),
}));

jest.mock("@/lib/api", () => ({
  apiFetch: jest.fn(),
}));

const mockedApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;

const chatAnswerResponse = {
  ok: true,
  data: {
    answer: "Stefan said pricing is too high.",
    confidence: "high",
    sources: [
      {
        sourceType: "transcript",
        sourceId: "m1",
        title: "Kickoff",
        snippet: "12:30 - Stefan: pricing is too high",
        timestamp: "12:30",
      },
    ],
    suggestedActions: [],
  },
};

const renderPanel = async (element: React.ReactElement) => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  return {
    container,
    root,
    cleanup: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
};

const sendQuestion = async (container: HTMLElement, question: string) => {
  const input = container.querySelector("input") as HTMLInputElement;
  const form = container.querySelector("form") as HTMLFormElement;
  expect(input).toBeTruthy();
  expect(form).toBeTruthy();

  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  )!.set!;
  await act(async () => {
    nativeInputValueSetter.call(input, question);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
};

describe("GeneralChatPanel interactions", () => {
  beforeAll(() => {
    // jsdom does not implement scrollIntoView.
    window.HTMLElement.prototype.scrollIntoView = jest.fn();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockedApiFetch.mockResolvedValue(chatAnswerResponse as any);
  });

  it("meeting mode sends meetingId, sessionId, and history for follow-ups and persists messages", async () => {
    const initialMessages: PanelMessage[] = [
      { id: "u1", role: "user", text: "Summarize this meeting.", at: 1 },
      {
        id: "a1",
        role: "assistant",
        at: 2,
        answer: {
          answer: "The team discussed pricing.",
          confidence: "high",
          sources: [],
          suggestedActions: [],
        },
      },
    ];

    const onMessagesChange = jest.fn();
    const { container, cleanup } = await renderPanel(
      <GeneralChatPanel
        sessionId="s1"
        meetingId="m1"
        mode="meeting"
        initialMessages={initialMessages}
        persistMessages
        onMessagesChange={onMessagesChange}
      />
    );

    // Reloaded session renders its restored messages (meeting mode kept).
    expect(container.textContent).toContain("Summarize this meeting.");
    expect(container.textContent).toContain("The team discussed pricing.");

    await sendQuestion(container, "Who said that?");

    const chatCalls = mockedApiFetch.mock.calls.filter(
      ([url]) => url === "/api/ai/chat"
    );
    expect(chatCalls).toHaveLength(1);
    const body = JSON.parse(chatCalls[0][1]!.body as string);
    expect(body).toEqual({
      question: "Who said that?",
      sessionId: "s1",
      meetingId: "m1",
      history: [
        { role: "user", text: "Summarize this meeting." },
        { role: "assistant", text: "The team discussed pricing." },
      ],
    });

    // Messages (user + assistant) persist to the chat-sessions endpoint.
    const persistCalls = mockedApiFetch.mock.calls.filter(
      ([url]) => url === "/api/chat-sessions/s1"
    );
    expect(persistCalls.length).toBeGreaterThanOrEqual(2);
    const lastPersistBody = JSON.parse(
      persistCalls[persistCalls.length - 1][1]!.body as string
    );
    const persisted = lastPersistBody.messages;
    expect(persisted[persisted.length - 1]).toMatchObject({
      sender: "ai",
      text: "Stefan said pricing is too high.",
    });
    expect(persisted[persisted.length - 1].chatAnswer).toMatchObject({
      confidence: "high",
    });

    // The panel only ever talks to chat endpoints — a casual question never
    // triggers task extraction or any other mutation endpoint.
    const endpoints = mockedApiFetch.mock.calls.map(([url]) => url);
    expect(
      endpoints.every(
        (url) => url === "/api/ai/chat" || url === "/api/chat-sessions/s1"
      )
    ).toBe(true);

    expect(onMessagesChange).toHaveBeenCalled();
    cleanup();
  });

  it("workspace mode sends only the question (no meetingId) and does not persist without a session", async () => {
    const { container, cleanup } = await renderPanel(<GeneralChatPanel />);

    await sendQuestion(container, "Which tasks are overdue?");

    expect(mockedApiFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockedApiFetch.mock.calls[0];
    expect(url).toBe("/api/ai/chat");
    const body = JSON.parse(options!.body as string);
    expect(body).toEqual({ question: "Which tasks are overdue?" });

    expect(container.textContent).toContain(
      "Stefan said pricing is too high."
    );
    cleanup();
  });

  it("creates a session through onEnsureSession before the first persisted send", async () => {
    const onEnsureSession = jest.fn().mockResolvedValue("fresh-session");
    const { container, cleanup } = await renderPanel(
      <GeneralChatPanel persistMessages onEnsureSession={onEnsureSession} />
    );

    await sendQuestion(container, "Hello there");

    expect(onEnsureSession).toHaveBeenCalledWith("Hello there");
    const chatCalls = mockedApiFetch.mock.calls.filter(
      ([url]) => url === "/api/ai/chat"
    );
    const body = JSON.parse(chatCalls[0][1]!.body as string);
    expect(body.sessionId).toBe("fresh-session");
    const persistCalls = mockedApiFetch.mock.calls.filter(
      ([url]) => url === "/api/chat-sessions/fresh-session"
    );
    expect(persistCalls.length).toBeGreaterThanOrEqual(1);
    cleanup();
  });
});
