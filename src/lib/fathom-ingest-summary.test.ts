import { resolveSummaryText } from "@/lib/fathom-ingest-summary";

describe("fathom-ingest-summary", () => {
  it("prefers payload markdown summaries when available", () => {
    expect(
      resolveSummaryText(
        {
          default_summary: {
            markdown_formatted: "payload markdown",
          },
          summary: "payload summary",
        },
        {
          summary: "provider summary",
        }
      )
    ).toBe("payload markdown");
  });

  it("falls back to provider summary text when payload summary is missing", () => {
    expect(
      resolveSummaryText(
        {},
        {
          markdownFormatted: "provider markdown",
        }
      )
    ).toBe("provider markdown");
  });

  it("returns null when neither payload nor provider has summary text", () => {
    expect(resolveSummaryText({}, null)).toBeNull();
  });
});
