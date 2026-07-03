/** @jest-environment jsdom */

import React, { type ReactNode } from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import ErrorBoundary from "@/components/common/ErrorBoundary";

const renderIntoContainer = async (element: ReactNode) => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  await act(async () => {
    root.render(element);
  });

  return {
    container,
    root,
    cleanup: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
};

describe("ErrorBoundary", () => {
  const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

  afterEach(() => {
    consoleErrorSpy.mockClear();
  });

  afterAll(() => {
    consoleErrorSpy.mockRestore();
  });

  it("renders children normally", async () => {
    const { container, cleanup } = await renderIntoContainer(
      <ErrorBoundary fallback={<div>fallback</div>}>
        <span>safe child</span>
      </ErrorBoundary>
    );

    expect(container.textContent).toContain("safe child");
    expect(container.textContent).not.toContain("fallback");

    cleanup();
  });

  it("catches render errors and shows the fallback", async () => {
    const ThrowingChild = () => {
      throw new Error("boom");
    };

    const { container, cleanup } = await renderIntoContainer(
      <ErrorBoundary fallback={<div>fallback</div>}>
        <ThrowingChild />
      </ErrorBoundary>
    );

    expect(container.textContent).toContain("fallback");
    expect(consoleErrorSpy).toHaveBeenCalled();

    cleanup();
  });
});
