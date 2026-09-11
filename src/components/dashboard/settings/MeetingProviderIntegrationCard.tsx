"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  AudioLines,
  Bot,
  Check,
  Copy,
  Film,
  Loader2,
  Mic2,
  Power,
  PowerOff,
  Radio,
  RefreshCw,
  Video,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export type MeetingProviderCardProviderId =
  | "fireflies"
  | "grain"
  | "tldv"
  | "otter"
  | "meetgeek"
  | "read";

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
  connectionMode: "api-key" | "webhook-only";
  manualSync: boolean;
  supportsWebhookSecret: boolean;
  apiKeyHint?: string;
  webhookSecretHint?: string;
  availabilityNote?: string;
};

const PROVIDER_COPY: Record<MeetingProviderCardProviderId, ProviderCopy> = {
  fireflies: {
    displayName: "Fireflies.ai",
    description: "Sync meetings and transcripts from Fireflies.ai.",
    icon: AudioLines,
    connectionMode: "api-key",
    manualSync: true,
    supportsWebhookSecret: true,
    apiKeyHint: "Paste your Fireflies API key from Fireflies integrations settings.",
    webhookSecretHint: "Optional webhook secret used to verify x-hub-signature.",
  },
  grain: {
    displayName: "Grain",
    description: "Sync recordings and transcripts from Grain.",
    icon: Film,
    connectionMode: "api-key",
    manualSync: true,
    supportsWebhookSecret: true,
    apiKeyHint: "Paste your Grain personal access token.",
    webhookSecretHint: "Optional Grain hook secret sent in grain-hook-secret.",
  },
  tldv: {
    displayName: "tl;dv",
    description: "Import meeting details, transcripts and notes from tl;dv.",
    icon: Video,
    connectionMode: "api-key",
    manualSync: true,
    supportsWebhookSecret: false,
    apiKeyHint: "Paste your tl;dv API key. Taskwise sends it only to the tl;dv API.",
    availabilityNote: "tl;dv currently uses the unique Taskwise webhook URL as its routing credential.",
  },
  otter: {
    displayName: "Otter.ai",
    description: "Bring Otter conversations, transcripts and action items into Taskwise.",
    icon: Mic2,
    connectionMode: "api-key",
    manualSync: true,
    supportsWebhookSecret: false,
    apiKeyHint: "Paste an Otter.ai Public API key.",
    availabilityNote: "Otter Public API access requires an eligible Enterprise workspace.",
  },
  meetgeek: {
    displayName: "MeetGeek",
    description: "Sync MeetGeek meetings and paginated transcripts into Taskwise.",
    icon: Bot,
    connectionMode: "api-key",
    manualSync: true,
    supportsWebhookSecret: false,
    apiKeyHint: "Paste your MeetGeek API key. Make sure it matches your MeetGeek API region.",
    availabilityNote: "MeetGeek API keys are region-specific; Taskwise defaults to the standard API endpoint.",
  },
  read: {
    displayName: "Read AI",
    description: "Receive completed Read AI meeting reports through a signed webhook.",
    icon: Radio,
    connectionMode: "webhook-only",
    manualSync: false,
    supportsWebhookSecret: true,
    webhookSecretHint: "Required: paste the Read AI webhook signing key used for X-Read-Signature.",
    availabilityNote: "Webhook-first: no fake static API key or manual backfill is shown while Read REST uses short-lived OAuth tokens.",
  },
};

const COMPANION_PROVIDERS: MeetingProviderCardProviderId[] = [
  "tldv",
  "otter",
  "meetgeek",
  "read",
];

export const buildProviderWebhookUrl = (
  origin: string,
  provider: MeetingProviderCardProviderId,
  webhookToken: string | null
): string => {
  const base = `${origin}/api/webhooks/${provider}`;
  return webhookToken ? `${base}?token=${encodeURIComponent(webhookToken)}` : base;
};

export const buildProviderConnectPayload = (inputs: {
  apiKeyInput: string;
  webhookSecretInput: string;
}): { apiKey?: string; webhookSecret?: string } => {
  const apiKey = inputs.apiKeyInput.trim();
  const webhookSecret = inputs.webhookSecretInput.trim();
  return {
    ...(apiKey ? { apiKey } : {}),
    ...(webhookSecret ? { webhookSecret } : {}),
  };
};

function ProviderCard({
  provider,
  canManage,
  className,
  initialConnection,
}: {
  provider: MeetingProviderCardProviderId;
  canManage: boolean;
  className?: string;
  initialConnection?: SerializedMeetingProviderConnection | null;
}) {
  const copy = PROVIDER_COPY[provider];
  const Icon = copy.icon;
  const { toast } = useToast();
  const hasInitialConnection = initialConnection !== undefined;
  const [connection, setConnection] = useState<SerializedMeetingProviderConnection | null>(
    hasInitialConnection ? initialConnection : null
  );
  const [isLoading, setIsLoading] = useState(!hasInitialConnection);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [webhookSecretInput, setWebhookSecretInput] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, []);

  const loadConnection = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/integrations/${provider}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Failed to load integration.");
      setConnection(payload?.connection ?? null);
    } catch (error) {
      console.error(`Failed to load ${provider} connection:`, error);
    } finally {
      setIsLoading(false);
    }
  }, [provider]);

  useEffect(() => {
    if (!hasInitialConnection) void loadConnection();
  }, [hasInitialConnection, loadConnection]);

  const isConnected = connection?.status === "active";
  const webhookUrl = buildProviderWebhookUrl(origin, provider, connection?.webhookToken ?? null);

  const handleConnect = async () => {
    const body = buildProviderConnectPayload({ apiKeyInput, webhookSecretInput });
    if (copy.connectionMode === "api-key" && !body.apiKey) {
      toast({ title: "API key required", description: `Enter your ${copy.displayName} API key.`, variant: "destructive" });
      return;
    }
    if (copy.connectionMode === "webhook-only" && copy.supportsWebhookSecret && !body.webhookSecret) {
      toast({ title: "Signing key required", description: `Enter your ${copy.displayName} webhook signing key.`, variant: "destructive" });
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
      if (!response.ok) throw new Error(payload?.error || `Could not connect ${copy.displayName}.`);
      setConnection(payload?.connection ?? null);
      setApiKeyInput("");
      setWebhookSecretInput("");
      toast({ title: `${copy.displayName} connected`, description: "Meeting source is ready in this workspace." });
    } catch (error) {
      toast({ title: "Connection failed", description: error instanceof Error ? error.message : "Could not connect integration.", variant: "destructive" });
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    try {
      const response = await fetch(`/api/integrations/${provider}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Could not disconnect integration.");
      setConnection(payload?.connection ?? null);
      toast({ title: `${copy.displayName} disconnected` });
    } catch (error) {
      toast({ title: "Disconnect failed", description: error instanceof Error ? error.message : "Could not disconnect integration.", variant: "destructive" });
    } finally {
      setIsDisconnecting(false);
    }
  };

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      const response = await fetch(`/api/integrations/${provider}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Could not start sync.");
      toast({ title: "Sync started", description: `Recent ${copy.displayName} meetings are being imported.` });
    } catch (error) {
      toast({ title: "Sync failed", description: error instanceof Error ? error.message : "Could not start sync.", variant: "destructive" });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  return (
    <div className={cn("rounded-lg border border-border/50 bg-card p-4 space-y-4 transition-colors hover:border-primary/50", className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <div className="rounded-lg bg-background p-2"><Icon className="h-8 w-8" /></div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="font-semibold text-foreground">{copy.displayName}</h4>
              <Badge variant={isConnected ? "secondary" : "outline"} className="text-[11px]">
                {isConnected ? "Connected" : "Not connected"}
              </Badge>
              {copy.connectionMode === "webhook-only" ? <Badge variant="outline" className="text-[11px]">Webhook-first</Badge> : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{copy.description}</p>
            {copy.availabilityNote ? <p className="mt-1 text-xs text-muted-foreground">{copy.availabilityNote}</p> : null}
            {isConnected && connection?.accountName ? <p className="mt-1 text-xs text-muted-foreground">Connected as {connection.accountName}</p> : null}
          </div>
        </div>
        {isLoading ? (
          <Button variant="outline" size="sm" disabled><Loader2 className="mr-2 h-4 w-4 animate-spin" />Checking...</Button>
        ) : isConnected ? (
          <div className="flex flex-wrap gap-2">
            {copy.manualSync ? (
              <Button variant="outline" size="sm" onClick={() => void handleSync()} disabled={isSyncing || !canManage}>
                {isSyncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Sync now
              </Button>
            ) : null}
            <Button variant="secondary" size="sm" onClick={() => void handleDisconnect()} disabled={isDisconnecting || !canManage}>
              {isDisconnecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PowerOff className="mr-2 h-4 w-4 text-red-500" />}Disconnect
            </Button>
          </div>
        ) : null}
      </div>

      {!isLoading && !isConnected ? (
        <div className="space-y-3 border-t border-border/50 pt-4">
          {copy.connectionMode === "api-key" ? (
            <div className="space-y-1">
              <Label htmlFor={`${provider}-api-key`}>API key</Label>
              <Input id={`${provider}-api-key`} type="password" autoComplete="off" value={apiKeyInput} placeholder={`${copy.displayName} API key`} onChange={(event) => setApiKeyInput(event.target.value)} disabled={!canManage || isConnecting} />
              <p className="text-xs text-muted-foreground">{copy.apiKeyHint}</p>
            </div>
          ) : null}
          {copy.supportsWebhookSecret ? (
            <div className="space-y-1">
              <Label htmlFor={`${provider}-webhook-secret`}>{copy.connectionMode === "webhook-only" ? "Webhook signing key" : "Webhook secret"}</Label>
              <Input id={`${provider}-webhook-secret`} type="password" autoComplete="off" value={webhookSecretInput} placeholder={copy.connectionMode === "webhook-only" ? "Required signing key" : "Optional webhook secret"} onChange={(event) => setWebhookSecretInput(event.target.value)} disabled={!canManage || isConnecting} />
              <p className="text-xs text-muted-foreground">{copy.webhookSecretHint}</p>
            </div>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => void handleConnect()} disabled={!canManage || isConnecting}>
            {isConnecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Power className="mr-2 h-4 w-4 text-green-500" />}Connect
          </Button>
        </div>
      ) : null}

      {!isLoading && isConnected ? (
        <div className="space-y-2 border-t border-border/50 pt-4">
          <Label htmlFor={`${provider}-webhook-url`}>Webhook URL</Label>
          <div className="flex items-center gap-2">
            <Input id={`${provider}-webhook-url`} readOnly value={webhookUrl} className="font-mono text-xs" />
            <Button variant="outline" size="icon" aria-label="Copy webhook URL" onClick={() => void handleCopy()}>{copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}</Button>
          </div>
          <p className="text-xs text-muted-foreground">Paste this URL into {copy.displayName} so completed meetings reach Taskwise automatically.{copy.supportsWebhookSecret && connection?.hasWebhookSecret ? " Incoming webhooks are signature-verified." : " The unique URL token routes the event to this workspace."}</p>
        </div>
      ) : null}

      {!canManage ? <p className="text-xs text-muted-foreground">Only workspace owners and admins can manage this integration.</p> : null}
    </div>
  );
}

export default function MeetingProviderIntegrationCard(props: {
  provider: MeetingProviderCardProviderId;
  canManage: boolean;
  className?: string;
  initialConnection?: SerializedMeetingProviderConnection | null;
}) {
  return (
    <>
      <ProviderCard {...props} />
      {/* Settings historically mounts Fireflies and Grain explicitly. Grain is
          the stable generic-provider anchor, so render the new provider batch
          alongside it without widening the large SettingsPageContent surface. */}
      {props.provider === "grain" && props.initialConnection === undefined
        ? COMPANION_PROVIDERS.map((provider) => (
            <ProviderCard key={provider} provider={provider} canManage={props.canManage} />
          ))
        : null}
    </>
  );
}
