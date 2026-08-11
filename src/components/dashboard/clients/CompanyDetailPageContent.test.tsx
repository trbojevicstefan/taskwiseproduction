/** @jest-environment jsdom */

import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import CompanyDetailPageContent from "@/components/dashboard/clients/CompanyDetailPageContent";
import { apiFetch } from "@/lib/api";
import { useChatHistory } from "@/contexts/ChatHistoryContext";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

jest.mock("lucide-react", () =>
  new Proxy({}, { get: (_target, prop) => (prop === "__esModule" ? true : () => null) })
);

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...props }: any) =>
    React.createElement("a", { href, ...props }, children),
}));

jest.mock("@/lib/api", () => ({ apiFetch: jest.fn() }));
jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { uid: "user-1" } }),
}));
jest.mock("@/contexts/ChatHistoryContext", () => ({
  useChatHistory: jest.fn(),
}));
jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: jest.fn() }),
}));
jest.mock("@/components/dashboard/DashboardHeader", () => ({
  __esModule: true,
  default: ({ pageTitle, children }: any) => <header>{pageTitle}{children}</header>,
}));
jest.mock("@/components/dashboard/DashboardScreenSkeleton", () => ({
  __esModule: true,
  default: () => <div>loading</div>,
}));
jest.mock("@/components/dashboard/common/ProfileReportDialog", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/components/common/EmptyState", () => ({
  __esModule: true,
  default: ({ title }: any) => <div>{title}</div>,
}));
jest.mock("@/components/dashboard/chat/GeneralChatPanel", () => ({
  __esModule: true,
  default: (props: any) => (
    <div
      data-testid="company-chat"
      data-scope={JSON.stringify(props.scope)}
      data-scope-label={props.scopeLabel}
      data-compact={String(props.compact)}
      data-persist={String(props.persistMessages)}
    >
      <button onClick={() => void props.onEnsureSession?.("Question")}>Ensure chat</button>
    </div>
  ),
  findSessionForScope: (sessions: any[], scope: any) =>
    sessions.find(
      (session) =>
        session.scope?.type === scope.type &&
        session.scope?.clientId === scope.clientId
    ),
  storedMessagesToPanelMessages: jest.fn(() => []),
  panelMessagesToStoredMessages: jest.fn(() => []),
}));

const mockedApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;
const mockedUseChatHistory = useChatHistory as jest.MockedFunction<typeof useChatHistory>;

const profile = {
  company: {
    id: "company-canonical",
    name: "Acme Corp",
    domain: "acme.example",
    aliases: [],
  },
  people: [],
  meetings: [],
  openTasks: [],
  stats: {
    peopleCount: 0,
    openTaskCount: 0,
    overdueTaskCount: 0,
    completedTaskCount: 0,
    lastContactedAt: null,
    nextFollowUpAt: null,
  },
};

describe("CompanyDetailPageContent scoped chat", () => {
  const createNewSession = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockedApiFetch.mockResolvedValue(profile as any);
    createNewSession.mockResolvedValue({ id: "client-chat" });
    mockedUseChatHistory.mockReturnValue({
      sessions: [],
      createNewSession,
      applySessionMessagesLocal: jest.fn(),
    } as any);
  });

  it("renders a compact durable panel using the loaded canonical company identity", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    await act(async () => {
      root.render(<CompanyDetailPageContent companyId="route-alias" />);
    });

    const panel = container.querySelector('[data-testid="company-chat"]')!;
    expect(panel.getAttribute("data-scope")).toBe(
      JSON.stringify({ type: "client", clientId: "company-canonical" })
    );
    expect(panel.getAttribute("data-scope-label")).toBe("Client: Acme Corp");
    expect(panel.getAttribute("data-compact")).toBe("true");
    expect(panel.getAttribute("data-persist")).toBe("true");

    await act(async () => {
      panel.querySelector("button")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
    });
    expect(createNewSession).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: { type: "client", clientId: "company-canonical" },
      })
    );

    act(() => root.unmount());
    container.remove();
  });
});
