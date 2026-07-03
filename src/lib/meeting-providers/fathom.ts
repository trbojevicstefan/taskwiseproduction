/**
 * Fathom descriptor for the meeting-provider registry.
 *
 * Fathom is a LEGACY-WEBHOOK provider: it keeps its own OAuth connections
 * (`fathomConnections`), its own webhook route (`/api/fathom/webhook`), its
 * own sync job (`fathom-sync`) and its own ingest entry point
 * (`ingestFathomMeeting`). The registry only needs to know it exists so the
 * generic `/api/webhooks/[provider]` and `/api/integrations/[provider]`
 * routes can 404 for it instead of treating it as unknown.
 *
 * None of the adapter methods are used for fathom traffic; they throw so a
 * misrouted call fails loudly instead of double-ingesting.
 */

import {
  ProviderNotImplementedError,
  type MeetingProviderAdapter,
} from "@/lib/meeting-providers/types";

export const fathomMeetingProvider: MeetingProviderAdapter = {
  provider: "fathom",
  displayName: "Fathom",
  legacyWebhook: true,

  verifyWebhookRequest() {
    throw new ProviderNotImplementedError("fathom", "verifyWebhookRequest");
  },

  parseWebhookPayload() {
    throw new ProviderNotImplementedError("fathom", "parseWebhookPayload");
  },

  async validateCredentials() {
    throw new ProviderNotImplementedError("fathom", "validateCredentials");
  },
};
