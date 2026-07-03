import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import SlackRemindersSettingsCard, {
  buildSlackReminderSettingsPayload,
} from "@/components/dashboard/settings/SlackRemindersSettingsCard";
import { useAuth } from "@/contexts/AuthContext";
import { DEFAULT_SLACK_REMINDER_SETTINGS } from "@/lib/workspace-settings";

jest.mock("@/contexts/AuthContext", () => ({
  useAuth: jest.fn(),
}));

jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

const mockedUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;

describe("SlackRemindersSettingsCard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseAuth.mockReturnValue({
      user: {
        id: "user-1",
        workspace: { id: "ws-1", name: "Acme" },
        activeWorkspaceRole: "owner",
        activeWorkspaceSlackReminders: {
          enabled: true,
          remindDaysBefore: [1, 3],
          remindOnDue: true,
          remindOverdue: true,
          maxRemindersPerTask: 3,
          deliver: "channel",
          defaultChannelId: "C0123456789",
          quietHoursStart: 22,
          quietHoursEnd: 7,
          digest: "daily",
        },
      },
      updateUserProfile: jest.fn(),
    } as any);
  });

  it("renders the reminder settings controls without throwing", () => {
    const markup = renderToStaticMarkup(<SlackRemindersSettingsCard />);

    expect(markup).toContain("Slack Reminders");
    expect(markup).toContain("Enable Slack reminders");
    expect(markup).toContain("Remind days before due");
    expect(markup).toContain("Remind on due date");
    expect(markup).toContain("Remind when overdue");
    expect(markup).toContain("Max reminders per task");
    expect(markup).toContain("Deliver via");
    expect(markup).toContain("Quiet hours");
    expect(markup).toContain("Daily digest");
    expect(markup).toContain("Sync reminders now");
    expect(markup).toContain("Save Reminder Settings");
    expect(markup).toContain(
      "Delivery requires the background worker (npm run jobs:worker) to be running."
    );
  });

  it("shows the default channel input when delivering to a channel", () => {
    const markup = renderToStaticMarkup(<SlackRemindersSettingsCard />);
    expect(markup).toContain("Default channel ID");
    expect(markup).toContain("C0123456789");
  });

  describe("buildSlackReminderSettingsPayload (save payload shape)", () => {
    const baseSettings = {
      ...DEFAULT_SLACK_REMINDER_SETTINGS,
      enabled: true,
      deliver: "channel" as const,
      digest: "daily" as const,
      quietHoursStart: 21,
      quietHoursEnd: 8,
    };

    it("produces the workspace.settings.slackReminders payload shape", () => {
      const payload = buildSlackReminderSettingsPayload(baseSettings, {
        daysBeforeInputs: ["3", "1", ""],
        maxPerTaskInput: "5",
        defaultChannelInput: "  C0123456789  ",
      });

      expect(payload).toEqual({
        enabled: true,
        remindDaysBefore: [1, 3],
        remindOnDue: true,
        remindOverdue: true,
        maxRemindersPerTask: 5,
        deliver: "channel",
        defaultChannelId: "C0123456789",
        quietHoursStart: 21,
        quietHoursEnd: 8,
        digest: "daily",
      });
    });

    it("drops invalid day entries, dedupes, and caps at three", () => {
      const payload = buildSlackReminderSettingsPayload(baseSettings, {
        daysBeforeInputs: ["0", "31", "7", "7", "2", "5"],
        maxPerTaskInput: "3",
        defaultChannelInput: "",
      });

      expect(payload.remindDaysBefore).toEqual([2, 5, 7]);
      expect(payload.defaultChannelId).toBeNull();
    });

    it("falls back to the default lead time and clamps max per task", () => {
      const payload = buildSlackReminderSettingsPayload(baseSettings, {
        daysBeforeInputs: ["", "", ""],
        maxPerTaskInput: "42",
        defaultChannelInput: "",
      });

      expect(payload.remindDaysBefore).toEqual([1]);
      expect(payload.maxRemindersPerTask).toBe(10);
    });
  });
});
