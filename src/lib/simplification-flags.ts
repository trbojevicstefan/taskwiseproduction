const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off"]);

const isEnabled = (value: string | undefined, defaultValue = true) => {
  if (typeof value !== "string") {
    return defaultValue;
  }
  const normalized = value.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return defaultValue;
};

export const isSimpleNavEnabled = () =>
  isEnabled(process.env.NEXT_PUBLIC_FEATURE_SIMPLE_NAV, true);

export const isReviewTasksHomeEnabled = () =>
  isEnabled(process.env.NEXT_PUBLIC_FEATURE_REVIEW_TASKS_HOME, true);

export const isAdvancedSettingsEnabled = () =>
  isEnabled(process.env.NEXT_PUBLIC_FEATURE_ADVANCED_SETTINGS, true);

export const isManualMeetingIngestEnabled = () =>
  isEnabled(process.env.NEXT_PUBLIC_FEATURE_MANUAL_MEETING_INGEST, true);

export const isFathomMultiConnectionUiEnabled = () =>
  isEnabled(process.env.NEXT_PUBLIC_FEATURE_FATHOM_MULTI_CONNECTION_UI, true);

export const isMcpUiAdvancedOnlyEnabled = () =>
  isEnabled(process.env.NEXT_PUBLIC_FEATURE_MCP_UI_ADVANCED_ONLY, true);

export const getSimplificationFlagSnapshot = () => ({
  simpleNav: isSimpleNavEnabled(),
  reviewTasksHome: isReviewTasksHomeEnabled(),
  advancedSettings: isAdvancedSettingsEnabled(),
  manualMeetingIngest: isManualMeetingIngestEnabled(),
  fathomMultiConnectionUi: isFathomMultiConnectionUiEnabled(),
  mcpUiAdvancedOnly: isMcpUiAdvancedOnlyEnabled(),
});
