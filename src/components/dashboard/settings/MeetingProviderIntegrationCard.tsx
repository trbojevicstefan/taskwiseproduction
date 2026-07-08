"use client";

/**
 * Phase 7 — settings card for adapter-based meeting note-taker providers
 * (Fireflies, Grain). Talks to the generic provider routes:
 *
 *   GET    /api/integrations/[provider]        -> connection status
 *   POST   /api/integrations/[provider]        -> connect { apiKey, webhookSecret? }
 *   DELETE /api/integrations/[provider]        -> disconnect
 *   POST   /api/integrations/[provider]/sync   -> enqueue a backfill sync (202)
 *
 * Modeled on the existing Fathom IntegrationCard row in SettingsPageContent
 * (same Card/Badge/Button idioms, design tokens only) and on the
 * SlackRemindersSettingsCard toast patterns. Mounted once per provider in the
 * Integrations section of SettingsPageContent.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  AudioLines,
  Check,
  Copy,
  Film,
  Loader2,
  Power,
  PowerOff,
  RefreshCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export type MeetingProviderCardProviderId = "fireflies" | "grain";

/** Serialized connection shape returned by /api/integrations/[provider]. */
export type SerializedMeetingProviderConnection = {
  id: string;
  provider: string;
  status: "active" | "revoked";
  accountName: string | null;
  hasApiKey: boolean;
  hasWebhookSecret: boolean;
  webhookToken: string | null;
};

type ProviderCopy = {
  displayName: string;
  description: string;
  icon: React.ElementType;
  apiKeyHint: string;
  webhookSecretHint: string;
};

const PROVIDER_COPY: Record<MeetingProviderCardProviderId, ProviderCopy> = {
  fireflies: {
    displayName: "Fireflies.ai",
    description: "Sync meetings and transcripts from Fireflies.ai.",
    icon: AudioLines,
    apiKeyHint:
      "Paste your Fireflies API key (Fireflies → Integrations → Fireflies API).",
    webhookSecretHint:
      "Optional: the Fireflies webhook secret, used to verify the x-hub-signature header on incoming webhooks.",
  },
  grain: {
    displayName: "Grain",
    description: "Sync recordings and transcripts from Grain.",
    icon: Film,
    apiKeyHint:
      "Paste your Grain personal access token (Grain → Settings → Personal Access Tokens).",
    webhookSecretHint:
      "Optional: the hook secret you configured in Grain, sent in the grain-hook-secret header on incoming webhooks.",
  },
};

/**
 * Builds the provider webhook URL surfaced in the card. Exported so tests can
 * assert the exact URL shape.
 */
export const buildProviderWebhookUrl = (
  origin: string,
  provider: MeetingProviderCardProviderId,
  webhookToken: string | null
): string => {
  const base = `${origin}/api/webhooks/${provider}`;
  return webhookToken
    ? `${base}?token=${encodeURIComponent(webhookToken)}`
    : base;
};

/**
 * Normalizes the connect inputs into the POST /api/integrations/[provider]
 * body — trimmed apiKey, webhookSecret only when non-empty. Exported so tests
 * can assert the exact payload shape.
 */
export const buildProviderConnectPayload = (inputs: {
  apiKeyInput: string;
  webhookSecretInput: string;
}): { apiKey: string; webhookSecret?: string } => {
  const apiKey = inputs.apiKeyInput.trim();
  const webhookSecret = inputs.webhookSecretInput.trim();
  return webhookSecret ? { apiKey, webhookSecret } : { apiKey };
};

export default function MeetingProviderIntegrationCard({
  provider,
  canManage,
  className,
  initialConnection,
}: {
  provider: MeetingProviderCardProviderId;
  canManage: boolean;
  className?: string;
  /**
   * Test seam: when provided (including null), the initial GET status fetch
   * is skipped and the card renders this connection state directly.
   */
  initialConnection?: SerializedMeetingProviderConnection | null;
}) {
  const copy = PROVIDER_COPY[provider];
  const Icon = copy.icon;
  const { toast } = useToast();

  const hasInitialConnection = initialConnection !== undefined;
  const [connection, setConnection] =
    useState<SerializedMeetingProviderConnection | null>(
      hasInitialConnection ? initialConnection : null
    );
  const [isLoading, setIsLoading] = useState(!hasInitialConnection);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [webhookSecretInput, setWebhookSecretInput] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [copiedWebhookUrl, setCopiedWebhookUrl] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      setOrigin(window.location.origin);
    }
  }, []);

  const loadConnection = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/integrations/${provider}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to load the integration.");
      }
      setConnection(payload?.connection ?? null);
    } catch (error) {
      console.error(`Failed to load ${provider} connection:`, error);
    } finally {
      setIsLoading(false);
    }
  }, [provider]);

  useEffect(() => {
    if (!hasInitialConnection) {
      void loadConnection();
    }
  }, [hasInitialConnection, loadConnection]);

  const isConnected = connection?.status === "active";

  const handleConnect = async () => {
    const body = buildProviderConnectPayload({ apiKeyInput, webhookSecretInput });
    if (!body.apiKey) {
      toast({
        title: "API key required",
        description: `Enter your ${copy.displayName} API key to connect.`,
        variant: "destructive",
      });
      return;
    }
    setIsConnecting(true);
    try {
      const response = await fetch(`/api/integrations/${provider}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          payload?.error || `Could not connect ${copy.displayName}.`
        );
      }
      setConnection(payload?.connection ?? null);
      setApiKeyInput("");
      setWebhookSecretInput("");
      toast({
        title: `${copy.displayName} Connected!`,
        description: payload?.connection?.accountName
          ? `Connected as ${payload.connection.accountName}. New meetings will sync into TaskWiseAI.`
          : "New meetings will sync into TaskWiseAI.",
      });
    } catch (error) {
      console.error(`Failed to connect ${provider}:`, error);
      toast({
        title: "Connection Failed",
        description:
          error instanceof Error
            ? error.message
            : `Could not connect ${copy.displayName}.`,
        variant: "destructive",
      });
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    try {
      const response = await fetch(`/api/integrations/${provider}`, {
        method: "DELETE",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          payload?.error || `Could not disconnect ${copy.displayName}.`
        );
      }
      setConnection(payload?.connection ?? null);
      toast({
        title: `${copy.displayName} Disconnected`,
        description: "New meetings will no longer sync from this provider.",
      });
    } catch (error) {
      console.error(`Failed to disconnect ${provider}:`, error);
      toast({
        title: "Disconnect Failed",
        description:
          error instanceof Error
            ? error.message
            : `Could not disconnect ${copy.displayName}.`,
        variant: "destructive",
      });
    } finally {
      setIsDisconnecting(false);
    }
  };

  const handleSyncNow = async () => {
    setIsSyncing(true);
    try {
      const response = await fetch(`/api/integrations/${provider}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Could not start the sync.");
      }
      toast({
        title: "Sync Started",
        description: `Recent ${copy.displayName} meetings are being imported in the background.`,
      });
    } catch (error) {
      console.error(`Failed to sync ${provider}:`, error);
      toast({
        title: "Sync Failed",
        description:
          error instanceof Error ? error.message : "Could not start the sync.",
        variant: "destructive",
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const webhookUrl = buildProviderWebhookUrl(
    origin,
    provider,
    connection?.webhookToken ?? null
  );

  const handleCopyWebhookUrl = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopiedWebhookUrl(true);
      toast({ title: "Copied!", description: "Webhook URL copied to clipboard." });
      setTimeout(() => setCopiedWebhookUrl(false), 2000);
    } catch (error) {
      console.error("Failed to copy webhook URL:", error);
      toast({
        title: "Copy Failed",
        description: "Could not copy the webhook URL.",
        variant: "destructive",
      });
    }
  };

  return (
    <div
      className={cn(
        "rounded-lg bg-card border border-border/50 hover:border-primary/50 transition-colors p-4 space-y-4",
        className
      )}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="p-2 bg-background rounded-lg">
            <Icon className="h-8 w-8" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="font-semibold text-foreground">{copy.displayName}</h4>
              <Badge
                variant={isConnected ? "secondary" : "outline"}
                className="text-[11px]"
              >
                {isConnected ? "Connected" : "Not connected"}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">{copy.description}</p>
            {isConnected && connection?.accountName ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Connected as {connection.accountName}
              </p>
            ) : null}
          </div>
        </div>
        {isLoading ? (
          <Button variant="outline" size="sm" disabled>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Checking...
          </Button>
        ) : isConnected ? (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleSyncNow()}
              disabled={isSyncing || !canManage}
            >
              {isSyncing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Sync now
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void handleDisconnect()}
              disabled={isDisconnecting || !canManage}
            >
              {isDisconnecting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <PowerOff className="mr-2 h-4 w-4 text-red-500" />
              )}
              Disconnect
            </Button>
          </div>
        ) : null}
      </div>

      {!isLoading && !isConnected ? (
        <div className="space-y-3 border-t border-border/50 pt-4">
          <div className="space-y-1">
            <Label
              htmlFor={`${provider}-api-key`}
              className="text-sm font-medium"
            >
              API key
            </Label>
            <Input
              id={`${provider}-api-key`}
              type="password"
              autoComplete="off"
              value={apiKeyInput}
              placeholder={`${copy.displayName} API key`}
              onChange={(event) => setApiKeyInput(event.target.value)}
              disabled={!canManage || isConnecting}
            />
            <p className="text-xs text-muted-foreground">{copy.apiKeyHint}</p>
          </div>
          <div className="space-y-1">
            <Label
              htmlFor={`${provider}-webhook-secret`}
              className="text-sm font-medium"
            >
              Webhook secret
            </Label>
            <Input
              id={`${provider}-webhook-secret`}
              type="password"
              autoComplete="off"
              value={webhookSecretInput}
              placeholder="Optional webhook secret"
              onChange={(event) => setWebhookSecretInput(event.target.value)}
              disabled={!canManage || isConnecting}
            />
            <p className="text-xs text-muted-foreground">
              {copy.webhookSecretHint} Without a secret, incoming webhooks are
              accepted without signature verification.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleConnect()}
            disabled={!canManage || isConnecting}
          >
            {isConnecting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Power className="mr-2 h-4 w-4 text-green-500" />
            )}
            Connect
          </Button>
        </div>
      ) : null}

      {!isLoading && isConnected ? (
        <div className="space-y-2 border-t border-border/50 pt-4">
          <Label
            htmlFor={`${provider}-webhook-url`}
            className="text-sm font-medium"
          >
            Webhook URL
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id={`${provider}-webhook-url`}
              readOnly
              value={webhookUrl}
              className="font-mono text-xs"
            />
            <Button
              variant="outline"
              size="icon"
              aria-label="Copy webhook URL"
              onClick={() => void handleCopyWebhookUrl()}
            >
              {copiedWebhookUrl ? (
                <Check className="h-4 w-4 text-green-500" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Paste this URL into your {copy.displayName} webhook settings so new
            meetings are pushed to TaskWiseAI automatically.
            {connection?.hasWebhookSecret
              ? " Incoming webhooks are verified with your saved webhook secret."
              : " No webhook secret is saved, so incoming webhooks are accepted without signature verification."}
          </p>
        </div>
      ) : null}

      {!canManage ? (
        <p className="text-xs text-muted-foreground">
          Only workspace owners and admins can manage this integration.
        </p>
      ) : null}
    </div>
  );
}
