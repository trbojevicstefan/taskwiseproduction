/** Meeting-provider registry. */

import { fathomMeetingProvider } from "@/lib/meeting-providers/fathom";
import { firefliesMeetingProvider } from "@/lib/meeting-providers/fireflies";
import { grainMeetingProvider } from "@/lib/meeting-providers/grain";
import { tldvMeetingProvider } from "@/lib/meeting-providers/tldv";
import { otterMeetingProvider } from "@/lib/meeting-providers/otter";
import { meetgeekMeetingProvider } from "@/lib/meeting-providers/meetgeek";
import { readMeetingProvider } from "@/lib/meeting-providers/read";
import type {
  MeetingProviderAdapter,
  MeetingProviderId,
} from "@/lib/meeting-providers/types";

export {
  isMeetingProviderId,
  MEETING_PROVIDER_IDS,
  ProviderNotImplementedError,
} from "@/lib/meeting-providers/types";
export type {
  MeetingProviderAdapter,
  MeetingProviderCapabilities,
  MeetingProviderConnection,
  MeetingProviderConnectionMode,
  MeetingProviderId,
  NormalizedProviderMeeting,
  NormalizedProviderParticipant,
  NormalizedTranscriptSegment,
  ParsedProviderWebhook,
} from "@/lib/meeting-providers/types";

const withDefaultCapabilities = (
  adapter: MeetingProviderAdapter
): MeetingProviderAdapter => ({
  ...adapter,
  capabilities:
    adapter.capabilities ||
    (adapter.legacyWebhook
      ? undefined
      : {
          connectionMode: "api-key",
          manualSync:
            typeof adapter.listMeetings === "function" &&
            typeof adapter.fetchMeeting === "function",
          supportsWebhookSecret: true,
        }),
});

const MEETING_PROVIDER_REGISTRY: Record<MeetingProviderId, MeetingProviderAdapter> = {
  fathom: fathomMeetingProvider,
  fireflies: withDefaultCapabilities(firefliesMeetingProvider),
  grain: withDefaultCapabilities(grainMeetingProvider),
  tldv: tldvMeetingProvider,
  otter: otterMeetingProvider,
  meetgeek: meetgeekMeetingProvider,
  read: readMeetingProvider,
};

export const getMeetingProviderAdapter = (
  providerId: string | null | undefined
): MeetingProviderAdapter | null => {
  if (typeof providerId !== "string") return null;
  const normalized = providerId.trim().toLowerCase();
  return (MEETING_PROVIDER_REGISTRY as Record<string, MeetingProviderAdapter>)[
    normalized
  ] || null;
};

export const listMeetingProviders = (): MeetingProviderAdapter[] =>
  Object.values(MEETING_PROVIDER_REGISTRY);
