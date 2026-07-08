import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import TaskwiseGsapSection from "@/components/landing/TaskwiseGsapSection";

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...props }: any) => {
    delete props.prefetch;
    return React.createElement("a", { href, ...props }, children);
  },
}));

describe("TaskwiseGsapSection", () => {
  it("renders the stacked three-panel showcase", () => {
    const html = renderToStaticMarkup(React.createElement(TaskwiseGsapSection));

    expect(html).toContain("Clarity");
    expect(html).toContain("Momentum");
    expect(html).toContain("Ease");
    expect(html).toContain("data-gsap-panel");
    expect(html).toContain("A calmer story that still feels alive.");
  });
});
