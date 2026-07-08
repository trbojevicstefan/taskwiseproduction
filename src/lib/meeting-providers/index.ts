/**
 * Phase 7 — meeting-provider registry.
 *
 * `getMeetingProviderAdapter(id)` resolves an adapter by provider id (null
 * for unknown ids); `listMeetingProviders()` returns all registered
 * adapters. Fathom is registered with `legacyWebhook: true` — its traffic
 * stays on the bespoke `/api/fathom/*` routes, so the generic
 * `/api/webhooks/[provider]` and `/api/integrations/[provider]` routes must
 * 404 for it (check `adapter.legacyWebhook`).
 */

import { fathomMeetingProvider } from "@/lib/meeting-providers/fathom";
import { firefliesMeetingProvider } from "@/lib/meeting-providers/fireflies";
import { grainMeetingProvider } from "@/lib/meeting-providers/grain";
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
  MeetingProviderConnection,
  MeetingProviderId,
  NormalizedProviderMeeting,
  NormalizedProviderParticipant,
  NormalizedTranscriptSegment,
  ParsedProviderWebhook,
} from "@/lib/meeting-providers/types";

const MEETING_PROVIDER_REGISTRY: Record<MeetingProviderId, MeetingProviderAdapter> = {
  fathom: fathomMeetingProvider,
  fireflies: firefliesMeetingProvider,
  grain: grainMeetingProvider,
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
