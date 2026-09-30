import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { UIStateProvider, useUIState } from "./UIStateContext";
function Dashboard() {
  const { uiScale } = useUIState();
  return <article data-scale={uiScale}>Dashboard</article>;
}
it("preserves the dashboard server mount gate without reading browser storage", () => {
  expect(
    renderToStaticMarkup(
      <UIStateProvider>
        <Dashboard />
      </UIStateProvider>,
    ),
  ).toBe("");
});
