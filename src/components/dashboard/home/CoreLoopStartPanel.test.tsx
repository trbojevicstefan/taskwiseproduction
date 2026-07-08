import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CoreLoopStartPanel from "@/components/dashboard/home/CoreLoopStartPanel";
import { usePasteAction } from "@/contexts/PasteActionContext";
import { isManualMeetingIngestEnabled } from "@/lib/simplification-flags";

jest.mock("@/contexts/IntegrationsContext", () => ({
  useIntegrations: jest.fn(),
}));

jest.mock("@/contexts/PasteActionContext", () => ({
  usePasteAction: jest.fn(),
}));

jest.mock("@/lib/simplification-flags", () => ({
  isManualMeetingIngestEnabled: jest.fn(),
}));

const mockedUseIntegrations = jest.requireMock("@/contexts/IntegrationsContext").useIntegrations as jest.Mock;
const mockedUsePasteAction = usePasteAction as jest.MockedFunction<typeof usePasteAction>;
const mockedIsManualMeetingIngestEnabled =
  isManualMeetingIngestEnabled as jest.MockedFunction<typeof isManualMeetingIngestEnabled>;

describe("CoreLoopStartPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseIntegrations.mockReturnValue({
      isFathomConnected: false,
    });
    mockedUsePasteAction.mockReturnValue({
      openPasteDialog: jest.fn(),
    } as any);
    mockedIsManualMeetingIngestEnabled.mockReturnValue(true);
  });

  it("renders the start panel without throwing", () => {
    const markup = renderToStaticMarkup(<CoreLoopStartPanel compact />);

    expect(markup).toContain("Create your first task list");
    expect(markup).toContain("Paste notes");
    expect(markup).toContain("Connect Fathom");
    expect(markup).toContain("Try sample");
  });
});
