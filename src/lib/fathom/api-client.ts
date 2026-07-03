import { recordExternalApiFailure } from "@/lib/observability-metrics";

const fathomApiFetch = async <T>(path: string, accessToken: string): Promise<T> => {
  const response = await fetch(`https://api.fathom.ai${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    void recordExternalApiFailure({
      provider: "fathom",
      operation: "api.fetch",
      statusCode: response.status,
      error: errorText || response.statusText,
      metadata: {
        path,
      },
    });
    throw new Error(`Fathom API error (${response.status}): ${errorText || response.statusText}`);
  }
  return (await response.json()) as T;
};

export const fetchFathomMeetings = async (accessToken: string) => {
  const payload = await fathomApiFetch<any>("/external/v1/meetings", accessToken);
  if (Array.isArray(payload)) return payload;
  return payload?.meetings || payload?.data || payload?.items || [];
};

export const listFathomWebhooks = async (accessToken: string) => {
  const payload = await fathomApiFetch<any>("/external/v1/webhooks", accessToken);
  if (Array.isArray(payload)) return payload;
  return payload?.webhooks || payload?.data || payload?.items || [];
};

export const fetchFathomTranscript = async (
  recordingId: string,
  accessToken: string
) => {
  const payload = await fathomApiFetch<any>(
    `/external/v1/recordings/${recordingId}/transcript`,
    accessToken
  );
  return payload?.transcript ?? payload;
};

export const fetchFathomSummary = async (
  recordingId: string,
  accessToken: string
) => {
  const payload = await fathomApiFetch<any>(
    `/external/v1/recordings/${recordingId}/summary`,
    accessToken
  );
  return payload?.summary ?? payload;
};
