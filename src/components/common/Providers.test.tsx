import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { usePathname } from "next/navigation";
import { Providers } from "./Providers";
import { AuthProvider } from "@/contexts/AuthContext";
import { SessionProvider } from "next-auth/react";
jest.mock("next/navigation", () => ({ usePathname: jest.fn() }));
const passThrough = ({ children }: { children: React.ReactNode }) => (
  <>{children}</>
);
jest.mock("next-auth/react", () => ({
  SessionProvider: jest.fn((props: any) => passThrough(props)),
}));
jest.mock("next-themes", () => ({
  ThemeProvider: (props: any) => passThrough(props),
}));
jest.mock("@/contexts/AuthContext", () => ({
  AuthProvider: jest.fn((props: any) => passThrough(props)),
}));
jest.mock("@/contexts/ChatHistoryContext", () => ({
  ChatHistoryProvider: (props: any) => passThrough(props),
}));
jest.mock("@/contexts/PlanningHistoryContext", () => ({
  PlanningHistoryProvider: (props: any) => passThrough(props),
}));
jest.mock("@/contexts/IntegrationsContext", () => ({
  IntegrationsProvider: (props: any) => passThrough(props),
}));
jest.mock("@/contexts/PasteActionContext", () => ({
  PasteActionProvider: (props: any) => passThrough(props),
}));
jest.mock("@/contexts/FolderContext", () => ({
  FolderProvider: (props: any) => passThrough(props),
}));
jest.mock("@/contexts/TaskContext", () => ({
  TaskProvider: (props: any) => passThrough(props),
}));
jest.mock("@/contexts/MeetingHistoryContext", () => ({
  MeetingHistoryProvider: (props: any) => passThrough(props),
}));
jest.mock("@/components/common/GlobalPasteHandler", () => ({
  __esModule: true,
  default: () => null,
}));
// UIStateProvider is intentionally real: effects never run during server rendering.
it.each(["/blog", "/blog/meeting-actions"])(
  "renders public blog content before hydration on %s",
  (path) => {
    (usePathname as jest.Mock).mockReturnValue(path);
    expect(
      renderToStaticMarkup(
        <Providers>
          <article>
            Public blog content
            <img src="https://example.com/cover.webp" alt="Cover" />
          </article>
        </Providers>,
      ),
    ).toMatch(/<article>[\s\S]*<img/);
  },
);
it.each(["/meetings", "/settings/integrations", "/blogger", "/", null])(
  "keeps existing mount behavior on %s",
  (path) => {
    (usePathname as jest.Mock).mockReturnValue(path);
    expect(
      renderToStaticMarkup(
        <Providers>
          <article>Existing behavior</article>
        </Providers>,
      ),
    ).toBe("");
  },
);

beforeEach(() => jest.clearAllMocks());
it.each(["/blog", "/blog/meeting-actions"])(
  "does not enter authenticated providers on public %s",
  (path) => {
    (usePathname as jest.Mock).mockReturnValue(path);
    renderToStaticMarkup(
      <Providers>
        <article>Public</article>
      </Providers>,
    );
    expect(AuthProvider).not.toHaveBeenCalled();
    expect(SessionProvider).not.toHaveBeenCalled();
  },
);


