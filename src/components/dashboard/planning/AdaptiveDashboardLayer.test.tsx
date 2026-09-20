import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AdaptiveDashboardPrompt,
  type AdaptiveDashboardApiPayload,
} from "@/components/dashboard/planning/AdaptiveDashboardLayer";

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...props }: any) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

jest.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: React.PropsWithChildren) => <div data-popover>{children}</div>,
  PopoverTrigger: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  PopoverContent: ({ children }: React.PropsWithChildren) => <div data-popover-content>{children}</div>,
}));

jest.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: React.PropsWithChildren) => <div data-dialog>{children}</div>,
  DialogContent: ({ children }: React.PropsWithChildren) => <div data-dialog-content>{children}</div>,
  DialogHeader: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  DialogFooter: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  DialogTitle: ({ children }: React.PropsWithChildren) => <h2>{children}</h2>,
  DialogDescription: ({ children }: React.PropsWithChildren) => <p>{children}</p>,
}));

const payload = (
  surface: "none" | "inline" | "popover" | "modal"
): AdaptiveDashboardApiPayload => ({
  decision: {
    source: "jev",
    focus: "review_meeting",
    surface,
    confidence: 0.87,
    decisionKey: `review:${surface}`,
    eyebrow: "New commitments detected",
    title: "Review what came out of your latest meetings",
    description: "Recent meetings produced suggested work.",
    primaryAction: { label: "Review tasks", href: "/review" },
    secondaryAction: { label: "Open meetings", href: "/meetings" },
  },
  context: {
    recentMeetingCount: 4,
    meetingsNeedingReview: 2,
    upcomingMeetingCount: 1,
    urgentTaskCount: 1,
    highPriorityTaskCount: 2,
    openTaskCount: 9,
    peopleFollowupCount: 2,
  },
});

describe("AdaptiveDashboardPrompt", () => {
  it("renders nothing for the quiet surface", () => {
    expect(
      renderToStaticMarkup(
        <AdaptiveDashboardPrompt payload={payload("none")} onDismiss={jest.fn()} />
      )
    ).toBe("");
  });

  it("renders an inline focus card with real Taskwise routes", () => {
    const markup = renderToStaticMarkup(
      <AdaptiveDashboardPrompt payload={payload("inline")} onDismiss={jest.fn()} />
    );

    expect(markup).toContain("Review what came out of your latest meetings");
    expect(markup).toContain("4 recent meetings");
    expect(markup).toContain("2 need review");
    expect(markup).toContain('href="/review"');
    expect(markup).toContain('href="/meetings"');
  });

  it("renders a popover intervention", () => {
    const markup = renderToStaticMarkup(
      <AdaptiveDashboardPrompt payload={payload("popover")} onDismiss={jest.fn()} />
    );

    expect(markup).toContain("data-popover");
    expect(markup).toContain("Suggested focus");
    expect(markup).toContain("Review tasks");
  });

  it("renders a modal intervention", () => {
    const markup = renderToStaticMarkup(
      <AdaptiveDashboardPrompt payload={payload("modal")} onDismiss={jest.fn()} />
    );

    expect(markup).toContain("data-dialog");
    expect(markup).toContain("Review what came out of your latest meetings");
    expect(markup).toContain("Review tasks");
  });
});
