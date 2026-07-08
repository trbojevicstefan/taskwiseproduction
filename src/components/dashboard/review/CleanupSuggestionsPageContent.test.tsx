import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CleanupSuggestionsPageContent from "@/components/dashboard/review/CleanupSuggestionsPageContent";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";

jest.mock("next/navigation", () => ({
  useRouter: jest.fn(),
}));

jest.mock("@/lib/api", () => ({
  apiFetch: jest.fn(),
}));

jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

jest.mock("@/components/dashboard/DashboardHeader", () => ({
  __esModule: true,
  default: ({ children, pageTitle, description }: any) => (
    <header>
      <div>{pageTitle}</div>
      <p>{description}</p>
      <div>{children}</div>
    </header>
  ),
}));

const mockedUseRouter = useRouter as jest.MockedFunction<typeof useRouter>;
const mockedApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;

describe("CleanupSuggestionsPageContent", () => {
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
    mockedApiFetch.mockResolvedValue({ suggestions: [], expired: [] } as any);
  });

  it("renders the cleanup header and scan action without throwing", () => {
    const markup = renderToStaticMarkup(<CleanupSuggestionsPageContent />);

    expect(markup).toContain("Cleanup Suggestions");
    expect(markup).toContain("Run scan");
    expect(markup).toContain("Back to review");
  });
});
