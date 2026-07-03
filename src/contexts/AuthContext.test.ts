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
