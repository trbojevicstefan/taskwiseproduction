/** @jest-environment jsdom */

/**
 * "Ask about this meeting" navigation contract: the meeting detail page opens
 * (or creates) the meeting-scoped chat session and routes to /chat — the same
 * navigation the meetings list / unified chat use. No second chat surface.
 */

import React from "react";
import { act } from "react-dom/test-utils";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
import { createRoot, type Root } from "react-dom/client";
import MeetingDetailPageContent from "@/components/dashboard/meetings/MeetingDetailPageContent";
import { useMeetingHistory } from "@/contexts/MeetingHistoryContext";
import { useChatHistory } from "@/contexts/ChatHistoryContext";
import { useRouter } from "next/navigation";

jest.mock("next/navigation", () => ({
  useRouter: jest.fn(),
}));

jest.mock("@/contexts/MeetingHistoryContext", () => ({
  useMeetingHistory: jest.fn(),
}));

jest.mock("@/contexts/ChatHistoryContext", () => ({
  useChatHistory: jest.fn(),
}));

jest.mock("@/hooks/use-toast", () => ({
  useToast: jest.fn(() => ({ toast: jest.fn() })),
}));

jest.mock("@/components/dashboard/DashboardScreenSkeleton", () => ({
  __esModule: true,
  default: () => React.createElement("div", null, "loading"),
}));

// The heavy detail sheet is exercised elsewhere; here we only need its
// onNavigateToChat wiring, so stub it with a button that triggers it.
jest.mock("@/components/dashboard/meetings/MeetingsPageContent", () => ({
  __esModule: true,
  MeetingDetailSheet: ({ id, onNavigateToChat }: any) =>
    React.createElement(
      "button",
      {
        "data-testid": "ask-about-meeting",
        onClick: () =>
          onNavigateToChat({
            id,
            title: "Kickoff",
            chatSessionId: null,
            attendees: [],
            extractedTasks: [],
          }),
      },
      "Ask about this meeting"
    ),
}));

const mockedUseMeetingHistory = useMeetingHistory as jest.MockedFunction<
  typeof useMeetingHistory
>;
const mockedUseChatHistory = useChatHistory as jest.MockedFunction<
  typeof useChatHistory
>;
const mockedUseRouter = useRouter as jest.MockedFunction<typeof useRouter>;

const renderPage = async (element: React.ReactElement) => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  return {
    container,
    cleanup: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
};

const clickAsk = async (container: HTMLElement) => {
  const button = container.querySelector(
    '[data-testid="ask-about-meeting"]'
  ) as HTMLButtonElement;
  expect(button).toBeTruthy();
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

describe("MeetingDetailPageContent — ask about this meeting", () => {
  const push = jest.fn();
  const updateMeeting = jest.fn().mockResolvedValue({});
  const setActiveSessionId = jest.fn();
  const createNewSession = jest.fn();

  const meeting = {
    id: "m1",
    title: "Kickoff",
    chatSessionId: null,
    attendees: [],
    extractedTasks: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseRouter.mockReturnValue({ push } as any);
    mockedUseMeetingHistory.mockReturnValue({
      meetings: [meeting],
      updateMeeting,
      loadMeetingById: jest.fn(),
      isLoadingMeetingHistory: false,
    } as any);
  });

  it("reuses the existing meeting-scoped session and routes to /chat", async () => {
    mockedUseChatHistory.mockReturnValue({
      sessions: [{ id: "s1", sourceMeetingId: "m1" }],
      createNewSession,
      setActiveSessionId,
    } as any);

    const { container, cleanup } = await renderPage(
      <MeetingDetailPageContent meetingId="m1" />
    );
    await clickAsk(container);

    expect(createNewSession).not.toHaveBeenCalled();
    expect(setActiveSessionId).toHaveBeenCalledWith("s1");
    expect(push).toHaveBeenCalledWith("/chat");
    cleanup();
  });

  it("creates a meeting-scoped session when none exists, links it, and routes to /chat", async () => {
    createNewSession.mockResolvedValue({ id: "s-new" });
    mockedUseChatHistory.mockReturnValue({
      sessions: [],
      createNewSession,
      setActiveSessionId,
    } as any);

    const { container, cleanup } = await renderPage(
      <MeetingDetailPageContent meetingId="m1" />
    );
    await clickAsk(container);

    expect(createNewSession).toHaveBeenCalledWith(
      expect.objectContaining({ sourceMeetingId: "m1" })
    );
    expect(updateMeeting).toHaveBeenCalledWith("m1", { chatSessionId: "s-new" });
    expect(setActiveSessionId).toHaveBeenCalledWith("s-new");
    expect(push).toHaveBeenCalledWith("/chat");
    cleanup();
  });
});
