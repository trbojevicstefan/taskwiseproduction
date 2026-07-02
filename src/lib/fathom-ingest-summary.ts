import { pickFirst } from "@/lib/fathom-ingest-helpers";

export const resolveSummaryText = (payload: any, summaryPayload: any) => {
  const payloadSummary =
    payload?.default_summary?.markdown_formatted ||
    payload?.default_summary?.markdownFormatted ||
    payload?.summary ||
    payload?.recording?.summary;
  const payloadSummaryText =
    typeof payloadSummary === "string"
      ? payloadSummary
      : payloadSummary?.markdown_formatted ||
        payloadSummary?.markdownFormatted ||
        payloadSummary?.text ||
        payloadSummary?.summary ||
        null;
  const summaryText =
    typeof summaryPayload === "string"
      ? summaryPayload
      : summaryPayload?.markdown_formatted ||
        summaryPayload?.markdownFormatted ||
        summaryPayload?.text ||
        summaryPayload?.summary ||
        null;
  return pickFirst(payloadSummaryText, summaryText);
};
