import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReviewTasksPageContent from "@/components/dashboard/review/ReviewTasksPageContent";
import { useMeetingHistory } from "@/contexts/MeetingHistoryContext";
import { useRouter, useSearchParams } from "next/navigation";
import { isReviewTasksHomeEnabled } from "@/lib/simplification-flags";

jest.mock("next/navigation", () => ({
  useRouter: jest.fn(),
  useSearchParams: jest.fn(),
}));

jest.mock("@/contexts/MeetingHistoryContext", () => ({
  useMeetingHistory: jest.fn(),
}));

jest.mock("@/lib/simplification-flags", () => ({
  isReviewTasksHomeEnabled: jest.fn(),
}));

jest.mock("@/components/dashboard/DashboardHeader", () => ({
  __esModule: true,
  default: ({ children, pageTitle }: any) => (
    <header>
      <div>{pageTitle}</div>
      <div>{children}</div>
    </header>
  ),
}));

jest.mock("@/components/dashboard/DashboardScreenSkeleton", () => ({
  __esModule: true,
  default: () => <div>loading</div>,
}));

jest.mock("@/components/dashboard/home/CoreLoopStartPanel", () => ({
  __esModule: true,
  default: () => <section>core-loop-panel</section>,
}));

jest.mock("@/components/dashboard/meetings/MeetingsPageContent", () => ({
  MeetingDetailSheet: () => <aside>meeting-detail-sheet</aside>,
}));

const mockedUseRouter = useRouter as jest.MockedFunction<typeof useRouter>;
const mockedUseSearchParams = useSearchParams as jest.MockedFunction<
  typeof useSearchParams
>;
const mockedUseMeetingHistory = useMeetingHistory as jest.MockedFunction<
  typeof useMeetingHistory
>;
const mockedIsReviewTasksHomeEnabled =
  isReviewTasksHomeEnabled as jest.MockedFunction<typeof isReviewTasksHomeEnabled>;

describe("ReviewTasksPageContent", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseRouter.mockReturnValue({
      push: jest.fn(),
      replace: jest.fn(),
      prefetch: jest.fn(),
      refresh: jest.fn(),
      back: jest.fn(),
      forward: jest.fn(),
    } as any);
    mockedUseSearchParams.mockReturnValue({
      get: jest.fn().mockReturnValue(null),
    } as any);
    mockedUseMeetingHistory.mockReturnValue({
      meetings: [],
      isLoadingMeetingHistory: false,
      refreshMeetings: jest.fn(),
    } as any);
    mockedIsReviewTasksHomeEnabled.mockReturnValue(true);
  });

  it("renders the review queue without throwing", () => {
    const markup = renderToStaticMarkup(<ReviewTasksPageContent />);

    expect(markup).toContain("Review Tasks");
    expect(markup).toContain("No meetings to review");
    expect(markup).toContain("core-loop-panel");
  });
});
