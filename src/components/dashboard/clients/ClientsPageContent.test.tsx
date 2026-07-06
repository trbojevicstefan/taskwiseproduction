/** @jest-environment jsdom */

/**
 * Priority 9 — clients page linking: company cards link to the first-class
 * company profile (/clients/[companyId]) and people rows link to person
 * profiles (/people/[personId]).
 */

import React from "react";
import { act } from "react-dom/test-utils";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
import { createRoot, type Root } from "react-dom/client";
import ClientsPageContent from "@/components/dashboard/clients/ClientsPageContent";
import { apiFetch } from "@/lib/api";

// jsdom resolves lucide-react to its ESM build, which ts-jest does not
// transform; icons are irrelevant to these tests.
jest.mock("lucide-react", () =>
  new Proxy(
    {},
    {
      get: (_target, prop) => (prop === "__esModule" ? true : () => null),
    }
  )
);

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...props }: any) =>
    React.createElement("a", { href, ...props }, children),
}));

jest.mock("@/lib/api", () => ({
  apiFetch: jest.fn(),
}));

jest.mock("@/lib/realtime-client", () => ({
  subscribeRealtimeUpdates: jest.fn(() => jest.fn()),
}));

jest.mock("@/lib/data", () => ({
  updatePerson: jest.fn(),
}));

jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { uid: "user-1" } }),
}));

jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

jest.mock("@/components/dashboard/DashboardHeader", () => ({
  __esModule: true,
  default: ({ pageTitle, description, children }: any) => (
    <header>
      <div>{pageTitle}</div>
      <p>{description}</p>
      <div>{children}</div>
    </header>
  ),
}));

jest.mock("@/components/dashboard/DashboardScreenSkeleton", () => ({
  __esModule: true,
  default: () => <div>loading</div>,
}));

const mockedApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;

const clientPerson = (id: string, name: string, email: string) => ({
  id,
  userId: "user-1",
  name,
  email,
  personType: "client",
  company: null,
  sourceSessionIds: [],
  taskCount: 1,
  taskCounts: { total: 2, open: 1, todo: 1, inprogress: 0, done: 1, recurring: 0 },
  overdueTaskCount: 0,
  lastMeetingAt: null,
  nextFollowUpAt: null,
  isBlocked: false,
  createdAt: null,
  lastSeenAt: null,
});

const renderPage = async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(<ClientsPageContent />);
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

describe("ClientsPageContent — company/person linking", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedApiFetch.mockImplementation(async (url: string) => {
      if (url === "/api/people?type=client") {
        return [
          clientPerson("p1", "Jane Client", "jane@acme.com"),
          clientPerson("p2", "Bob Client", "bob@acme.com"),
          clientPerson("p3", "Free Mailer", "free@gmail.com"),
        ] as any;
      }
      if (url === "/api/companies") {
        return [
          {
            id: "c1",
            workspaceId: "workspace-1",
            name: "acme.com",
            domain: "acme.com",
            aliases: [],
            peopleIds: ["p1", "p2"],
            createdAt: null,
            updatedAt: null,
          },
        ] as any;
      }
      throw new Error(`Unexpected apiFetch url in test: ${url}`);
    });
  });

  it("links the company card to its company profile", async () => {
    const { container, cleanup } = await renderPage();

    const companyLink = container.querySelector('a[href="/clients/c1"]');
    expect(companyLink).toBeTruthy();
    expect(companyLink!.textContent).toContain("acme.com");
    cleanup();
  });

  it("links each person row to their person profile", async () => {
    const { container, cleanup } = await renderPage();

    expect(container.querySelector('a[href="/people/p1"]')).toBeTruthy();
    expect(container.querySelector('a[href="/people/p2"]')).toBeTruthy();
    expect(container.querySelector('a[href="/people/p3"]')).toBeTruthy();
    cleanup();
  });

  it("groups without a company record stay unlinked", async () => {
    const { container, cleanup } = await renderPage();

    // The gmail.com group has no companies record, so no /clients/ link
    // other than the acme one exists.
    const companyLinks = Array.from(
      container.querySelectorAll('a[href^="/clients/"]')
    );
    expect(companyLinks).toHaveLength(1);
    expect(container.textContent).toContain("gmail.com");
    cleanup();
  });
});
