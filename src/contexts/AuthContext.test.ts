import { isPublicPath } from "@/contexts/AuthContext";

describe("isPublicPath", () => {
  it("treats the marketing pages as public", () => {
    expect(isPublicPath("/")).toBe(true);
    expect(isPublicPath("/features")).toBe(true);
    expect(isPublicPath("/integrations")).toBe(true);
    expect(isPublicPath("/mcp")).toBe(true);
    expect(isPublicPath("/privacy")).toBe(true);
    expect(isPublicPath("/terms")).toBe(true);
  });

  it("keeps dashboard routes protected", () => {
    expect(isPublicPath("/meetings")).toBe(false);
    expect(isPublicPath("/planning")).toBe(false);
    expect(isPublicPath("/chat")).toBe(false);
  });
});
it("allows public blog pages without making similarly named or dashboard routes public", () => {
  expect(isPublicPath("/blog")).toBe(true);
  expect(isPublicPath("/blog/meeting-actions")).toBe(true);
  expect(isPublicPath("/blogger")).toBe(false);
  expect(isPublicPath("/meetings")).toBe(false);
  expect(isPublicPath("/settings")).toBe(false);
});
