import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TaskCleanupSettingsCard from "@/components/dashboard/settings/TaskCleanupSettingsCard";
import { useAuth } from "@/contexts/AuthContext";

jest.mock("@/contexts/AuthContext", () => ({
  useAuth: jest.fn(),
}));

jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

const mockedUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;

describe("TaskCleanupSettingsCard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseAuth.mockReturnValue({
      user: {
        id: "user-1",
        workspace: { id: "ws-1", name: "Acme" },
        activeWorkspaceRole: "owner",
        activeWorkspaceTaskCleanup: {
          enabled: true,
          strictness: "balanced",
          autoExpireDays: 14,
          categories: {
            scheduling_admin: true,
            meeting_logistics: true,
            already_completed: true,
            duplicate: true,
            low_specificity: true,
            stale_follow_up: true,
            expired_event: true,
          },
        },
      },
      updateUserProfile: jest.fn(),
    } as any);
  });

  it("renders the cleanup settings controls without throwing", () => {
    const markup = renderToStaticMarkup(<TaskCleanupSettingsCard />);

    expect(markup).toContain("Task Cleanup");
    expect(markup).toContain("Strictness");
    expect(markup).toContain("Auto-expire after");
    expect(markup).toContain("Scheduling &amp; admin");
    expect(markup).toContain("Stale follow-ups");
    expect(markup).toContain("Open cleanup suggestions");
    expect(markup).toContain("Save Cleanup Settings");
  });
});
