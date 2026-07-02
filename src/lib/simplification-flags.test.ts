import {
  getSimplificationFlagSnapshot,
  isAdvancedSettingsEnabled,
  isFathomMultiConnectionUiEnabled,
  isManualMeetingIngestEnabled,
  isMcpUiAdvancedOnlyEnabled,
  isReviewTasksHomeEnabled,
  isSimpleNavEnabled,
} from "@/lib/simplification-flags";

const withEnv = (
  vars: Record<string, string | undefined>,
  fn: () => void
) => {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    previous[key] = process.env[key];
  }

  try {
    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
};

describe("simplification-flags", () => {
  describe("isSimpleNavEnabled", () => {
    it("defaults to true when env is unset", () => {
      withEnv({ NEXT_PUBLIC_FEATURE_SIMPLE_NAV: undefined }, () => {
        expect(isSimpleNavEnabled()).toBe(true);
      });
    });

    it("returns true for '1'", () => {
      withEnv({ NEXT_PUBLIC_FEATURE_SIMPLE_NAV: "1" }, () => {
        expect(isSimpleNavEnabled()).toBe(true);
      });
    });

    it("returns false for '0'", () => {
      withEnv({ NEXT_PUBLIC_FEATURE_SIMPLE_NAV: "0" }, () => {
        expect(isSimpleNavEnabled()).toBe(false);
      });
    });

    it("returns false for 'false' regardless of case", () => {
      withEnv({ NEXT_PUBLIC_FEATURE_SIMPLE_NAV: "FALSE" }, () => {
        expect(isSimpleNavEnabled()).toBe(false);
      });
    });

    it("defaults to true for unrecognized values", () => {
      withEnv({ NEXT_PUBLIC_FEATURE_SIMPLE_NAV: "maybe" }, () => {
        expect(isSimpleNavEnabled()).toBe(true);
      });
    });
  });

  describe("isReviewTasksHomeEnabled", () => {
    it("defaults to true when env is unset", () => {
      withEnv({ NEXT_PUBLIC_FEATURE_REVIEW_TASKS_HOME: undefined }, () => {
        expect(isReviewTasksHomeEnabled()).toBe(true);
      });
    });
  });

  describe("isAdvancedSettingsEnabled", () => {
    it("defaults to true when env is unset", () => {
      withEnv({ NEXT_PUBLIC_FEATURE_ADVANCED_SETTINGS: undefined }, () => {
        expect(isAdvancedSettingsEnabled()).toBe(true);
      });
    });
  });

  describe("isManualMeetingIngestEnabled", () => {
    it("defaults to true when env is unset", () => {
      withEnv({ NEXT_PUBLIC_FEATURE_MANUAL_MEETING_INGEST: undefined }, () => {
        expect(isManualMeetingIngestEnabled()).toBe(true);
      });
    });
  });

  describe("isFathomMultiConnectionUiEnabled", () => {
    it("defaults to true when env is unset", () => {
      withEnv(
        { NEXT_PUBLIC_FEATURE_FATHOM_MULTI_CONNECTION_UI: undefined },
        () => {
          expect(isFathomMultiConnectionUiEnabled()).toBe(true);
        }
      );
    });
  });

  describe("isMcpUiAdvancedOnlyEnabled", () => {
    it("defaults to true when env is unset", () => {
      withEnv({ NEXT_PUBLIC_FEATURE_MCP_UI_ADVANCED_ONLY: undefined }, () => {
        expect(isMcpUiAdvancedOnlyEnabled()).toBe(true);
      });
    });
  });

  describe("getSimplificationFlagSnapshot", () => {
    it("returns an object with all flag values", () => {
      const snapshot = getSimplificationFlagSnapshot();

      expect(snapshot).toEqual({
        simpleNav: true,
        reviewTasksHome: true,
        advancedSettings: true,
        manualMeetingIngest: true,
        fathomMultiConnectionUi: true,
        mcpUiAdvancedOnly: true,
      });
    });
  });
});
