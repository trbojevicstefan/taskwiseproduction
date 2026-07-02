import {
  getSimplificationFlagSnapshot,
  isAdvancedSettingsEnabled,
  isFathomMultiConnectionUiEnabled,
  isManualMeetingIngestEnabled,
  isMcpUiAdvancedOnlyEnabled,
  isReviewTasksHomeEnabled,
  isSimpleNavEnabled,
} from "@/lib/simplification-flags";

const originalEnv = process.env;

describe("simplification-flags", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("defaults all simplification flags to enabled", () => {
    delete process.env.NEXT_PUBLIC_FEATURE_SIMPLE_NAV;
    delete process.env.NEXT_PUBLIC_FEATURE_REVIEW_TASKS_HOME;
    delete process.env.NEXT_PUBLIC_FEATURE_ADVANCED_SETTINGS;
    delete process.env.NEXT_PUBLIC_FEATURE_MANUAL_MEETING_INGEST;
    delete process.env.NEXT_PUBLIC_FEATURE_FATHOM_MULTI_CONNECTION_UI;
    delete process.env.NEXT_PUBLIC_FEATURE_MCP_UI_ADVANCED_ONLY;

    expect(isSimpleNavEnabled()).toBe(true);
    expect(isReviewTasksHomeEnabled()).toBe(true);
    expect(isAdvancedSettingsEnabled()).toBe(true);
    expect(isManualMeetingIngestEnabled()).toBe(true);
    expect(isFathomMultiConnectionUiEnabled()).toBe(true);
    expect(isMcpUiAdvancedOnlyEnabled()).toBe(true);
    expect(getSimplificationFlagSnapshot()).toEqual({
      simpleNav: true,
      reviewTasksHome: true,
      advancedSettings: true,
      manualMeetingIngest: true,
      fathomMultiConnectionUi: true,
      mcpUiAdvancedOnly: true,
    });
  });

  it("honors common truthy and falsy env values", () => {
    process.env.NEXT_PUBLIC_FEATURE_SIMPLE_NAV = " off ";
    process.env.NEXT_PUBLIC_FEATURE_REVIEW_TASKS_HOME = "ON";
    process.env.NEXT_PUBLIC_FEATURE_ADVANCED_SETTINGS = "0";
    process.env.NEXT_PUBLIC_FEATURE_MANUAL_MEETING_INGEST = "yes";
    process.env.NEXT_PUBLIC_FEATURE_FATHOM_MULTI_CONNECTION_UI = "no";
    process.env.NEXT_PUBLIC_FEATURE_MCP_UI_ADVANCED_ONLY = "unexpected";

    expect(isSimpleNavEnabled()).toBe(false);
    expect(isReviewTasksHomeEnabled()).toBe(true);
    expect(isAdvancedSettingsEnabled()).toBe(false);
    expect(isManualMeetingIngestEnabled()).toBe(true);
    expect(isFathomMultiConnectionUiEnabled()).toBe(false);
    expect(isMcpUiAdvancedOnlyEnabled()).toBe(true);
  });
});
