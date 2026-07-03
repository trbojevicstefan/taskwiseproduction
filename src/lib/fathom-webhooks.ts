import { recordExternalApiFailure } from "@/lib/observability-metrics";
import { getFathomWebhookUrlPrefix } from "@/lib/fathom-utils";

const resolveWebhookDeleteUrl = (webhook: any) => {
  const candidate =
    webhook?.actions?.deleteUrl ||
    webhook?.actions?.delete_url ||
    webhook?.deleteUrl ||
    webhook?.delete_url ||
    webhook?.delete_path ||
    webhook?.deletePath ||
    null;

  if (!candidate) return null;
  if (candidate.startsWith("http")) return candidate;
  return `https://api.fathom.ai${candidate}`;
};

export const deleteFathomWebhook = async (
  accessToken: string,
  webhook: { id?: string; actions?: { deleteUrl?: string; delete_url?: string } } | string
) => {
  const webhookId = typeof webhook === "string" ? webhook : webhook?.id;
  const deleteUrl =
    typeof webhook === "string" ? null : resolveWebhookDeleteUrl(webhook);

  const url = deleteUrl || `https://api.fathom.ai/external/v1/webhooks/${webhookId}`;

  if (!webhookId && !deleteUrl) {
    throw new Error("Missing webhook identifier for deletion.");
  }

  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    void recordExternalApiFailure({
      provider: "fathom",
      operation: "webhooks.delete",
      statusCode: response.status,
      error: errorText || response.statusText,
      metadata: {
        webhookId: webhookId || null,
      },
    });
    throw new Error(
      `Fathom webhook delete failed (${response.status}): ${errorText || response.statusText}`
    );
  }
};

export const pruneFathomManagedWebhooks = async (
  accessToken: string,
  input: {
    webhookId?: string | null;
    webhookUrl?: string | null;
    managedWebhooks?: any[] | null;
  }
) => {
  const managedWebhooks = Array.isArray(input.managedWebhooks)
    ? input.managedWebhooks
    : [];
  if (!managedWebhooks.length) {
    return {
      managedWebhooks: [] as any[],
      deletedCount: 0,
      cleanupErrors: [] as string[],
    };
  }

  const primaryId = input.webhookId || null;
  const primaryUrl = input.webhookUrl || null;

  const keepIndices = new Set<number>();
  managedWebhooks.forEach((entry: any, index: number) => {
    const entryId = entry?.id || null;
    const entryUrl = entry?.url || null;
    if (primaryId && entryId === primaryId) {
      keepIndices.add(index);
      return;
    }
    if (!primaryId && primaryUrl && entryUrl === primaryUrl) {
      keepIndices.add(index);
    }
  });

  if (keepIndices.size === 0) {
    keepIndices.add(0);
  }

  const staleTargets = managedWebhooks
    .map((entry: any, index: number) => ({ entry, index }))
    .filter(({ entry, index }) => !keepIndices.has(index) && (entry?.id || entry?.url));

  const results = await Promise.allSettled(
    staleTargets.map(({ entry }) => deleteFathomWebhook(accessToken, entry as any))
  );

  const failedStaleIndices = new Set<number>();
  const cleanupErrors: string[] = [];
  results.forEach((result, idx) => {
    if (result.status === "rejected") {
      const staleEntryIndex = staleTargets[idx]?.index;
      if (typeof staleEntryIndex === "number") {
        failedStaleIndices.add(staleEntryIndex);
      }
      cleanupErrors.push(
        result.reason instanceof Error ? result.reason.message : String(result.reason)
      );
    }
  });

  const nextManagedWebhooks = managedWebhooks.filter(
    (_entry: any, index: number) => keepIndices.has(index) || failedStaleIndices.has(index)
  );

  return {
    managedWebhooks: nextManagedWebhooks,
    deletedCount: staleTargets.length - failedStaleIndices.size,
    cleanupErrors,
  };
};

export const deleteManagedFathomWebhooks = async (accessToken: string) => {
  const webhooks = await fetch("https://api.fathom.ai/external/v1/webhooks", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  }).then(async (response) => {
    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      void recordExternalApiFailure({
        provider: "fathom",
        operation: "webhooks.list",
        statusCode: response.status,
        error: errorText || response.statusText,
      });
      throw new Error(
        `Fathom webhooks list failed (${response.status}): ${errorText || response.statusText}`
      );
    }
    const payload = await response.json();
    if (Array.isArray(payload)) return payload;
    return payload?.webhooks || payload?.data || payload?.items || [];
  });

  const prefix = getFathomWebhookUrlPrefix();
  const pathMarker = "/api/fathom/webhook?token=";
  const managed = webhooks.filter((webhook: any) => {
    const url = webhook?.destination_url || webhook?.destinationUrl || webhook?.url || webhook?.webhook_url || webhook?.webhookUrl || null;
    return (
      typeof url === "string" &&
      (url.startsWith(prefix) || url.includes(pathMarker))
    );
  });

  if (!managed.length) return 0;
  await Promise.allSettled(managed.map((webhook: any) => deleteFathomWebhook(accessToken, webhook)));
  return managed.length;
};
