import { buildWorkspaceRoute } from "@/components/dashboard/workspace-route";

describe("buildWorkspaceRoute", () => {
  it("maps workspace-scoped deep links to the new workspace", () => {
    expect(buildWorkspaceRoute("/workspaces/ws-a/board", "ws-b")).toBe(
      "/workspaces/ws-b/board"
    );
    expect(buildWorkspaceRoute("/workspaces/ws-a/board/items", "ws-b")).toBe(
      "/workspaces/ws-b/board/items"
    );
  });

  it("keeps non-workspace routes unchanged", () => {
    expect(buildWorkspaceRoute("/meetings", "ws-b")).toBe("/meetings");
  });

  it("falls back to the board route when path is incomplete", () => {
    expect(buildWorkspaceRoute("/workspaces/", "ws-b")).toBe("/workspaces/ws-b/board");
  });
});
