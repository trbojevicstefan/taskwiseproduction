/** @jest-environment jsdom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import SidebarNav from "@/components/dashboard/SidebarNav";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

jest.mock("lucide-react", () =>
  new Proxy({}, { get: (_target, prop) => (prop === "__esModule" ? true : () => null) })
);

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({
    href,
    children,
    prefetch,
    ...props
  }: React.PropsWithChildren<{ href: string; prefetch?: boolean }>) => {
    void prefetch;
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  },
}));

jest.mock("next/navigation", () => ({
  usePathname: () => "/meetings",
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { uid: "user-1", workspace: { id: "workspace-1", name: "Workspace" } },
  }),
}));

jest.mock("@/contexts/ChatHistoryContext", () => ({
  useChatHistory: () => ({
    sessions: [],
    activeSessionId: null,
    setActiveSessionId: jest.fn(),
    deleteSession: jest.fn(),
    updateSessionTitle: jest.fn(),
    updateSession: jest.fn(),
    isLoadingHistory: false,
  }),
}));

jest.mock("@/contexts/FolderContext", () => ({
  useFolders: () => ({
    folders: [],
    addFolder: jest.fn(),
    updateFolder: jest.fn(),
    deleteFolder: jest.fn(),
  }),
}));

jest.mock("@/components/ui/sidebar", () => ({
  SidebarMenu: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  SidebarMenuItem: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  SidebarMenuButton: ({ children }: React.PropsWithChildren) => <>{children}</>,
  useSidebar: () => ({ state: "expanded", toggleSidebar: jest.fn() }),
}));

jest.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));

jest.mock("@/components/ui/accordion", () => ({
  Accordion: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  AccordionContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  AccordionItem: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  AccordionTrigger: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));

jest.mock("@/components/dashboard/WorkspaceSwitcher", () => ({
  __esModule: true,
  default: () => null,
}));

const originalSimpleNavFlag = process.env.NEXT_PUBLIC_FEATURE_SIMPLE_NAV;

const renderSidebar = (simpleNavEnabled: boolean) => {
  process.env.NEXT_PUBLIC_FEATURE_SIMPLE_NAV = String(simpleNavEnabled);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  act(() => {
    root.render(<SidebarNav />);
  });

  return {
    hrefs: Array.from(container.querySelectorAll("nav a")).map((link) =>
      link.getAttribute("href")
    ),
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
};

describe("SidebarNav client navigation", () => {
  afterAll(() => {
    if (originalSimpleNavFlag === undefined) {
      delete process.env.NEXT_PUBLIC_FEATURE_SIMPLE_NAV;
    } else {
      process.env.NEXT_PUBLIC_FEATURE_SIMPLE_NAV = originalSimpleNavFlag;
    }
  });

  it("includes Clients once in the simplified top-level navigation", () => {
    const { hrefs, cleanup } = renderSidebar(true);

    expect(hrefs).toEqual([
      "/meetings",
      "/explore",
      "/review",
      "/workspaces/workspace-1/board",
      "/planning",
      "/people",
      "/clients",
      "/chat",
      "/settings",
    ]);

    cleanup();
  });

  it("includes Clients once in the legacy top-level navigation", () => {
    const { hrefs, cleanup } = renderSidebar(false);

    expect(hrefs).toEqual([
      "/meetings",
      "/chat",
      "/planning",
      "/workspaces/workspace-1/board",
      "/explore",
      "/reports",
      "/people",
      "/clients",
    ]);

    cleanup();
  });
});
