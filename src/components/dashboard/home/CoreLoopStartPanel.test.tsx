import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CoreLoopStartPanel from "@/components/dashboard/home/CoreLoopStartPanel";
import { usePasteAction } from "@/contexts/PasteActionContext";
import { isManualMeetingIngestEnabled } from "@/lib/simplification-flags";

jest.mock("@/contexts/PasteActionContext", () => ({
  usePasteAction: jest.fn(),
}));

jest.mock("@/lib/simplification-flags", () => ({
  isManualMeetingIngestEnabled: jest.fn(),
}));

const mockedUsePasteAction = usePasteAction as jest.MockedFunction<typeof usePasteAction>;
const mockedIsManualMeetingIngestEnabled =
  isManualMeetingIngestEnabled as jest.MockedFunction<typeof isManualMeetingIngestEnabled>;

describe("CoreLoopStartPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
