import { NextResponse } from "next/server";
import {
  deleteFathomWebhook,
  getFathomInstallation,
  getValidFathomAccessToken,
  saveFathomInstallation,
} from "@/lib/fathom";
import { getFathomIntegrationLogs } from "@/lib/fathom-logs";
import { getSessionUserId } from "@/lib/server-auth";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const installation = await getFathomInstallation(userId);
  if (!installation) {
    return NextResponse.json({ error: "Fathom integration not connected." }, { status: 400 });
  }

  const fallback = installation.webhooks?.length
    ? installation.webhooks
    : installation.webhookId || installation.webhookUrl
    ? [
        {
          id: installation.webhookId,
          url: installation.webhookUrl,
          created_at: installation.updatedAt || installation.createdAt || null,
        },
      ]
    : [];

  if (fallback.length > 0) {
    return NextResponse.json(fallback);
  }

  const logs = await getFathomIntegrationLogs(userId, 200);
  const fromLogs = logs
    .filter((entry) => entry.event === "webhook.create")
    .map((entry) => ({
      id: entry.metadata?.webhookId ?? null,
      url: entry.metadata?.destinationUrl ?? null,
      created_at: entry.createdAt,
    }))
    .filter((entry) => entry.id || entry.url);

  const unique = Array.from(
    new Map(
      fromLogs.map((entry) => [
        entry.id || entry.url || JSON.stringify(entry),
        entry,
      ])
    ).values()
  );

  return NextResponse.json(unique);
}

export async function DELETE(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { ids, deleteAll } = body || {};

  const installation = await getFathomInstallation(userId);
  if (!installation) {
    return NextResponse.json({ error: "Fathom integration not connected." }, { status: 400 });
  }

  try {
    const accessToken = await getValidFathomAccessToken(userId);
    const targets = Array.isArray(ids) ? ids : [];
    const shouldDeleteAll = Boolean(deleteAll);

    let webhookIds: any[] = shouldDeleteAll
      ? installation.webhooks?.length
        ? installation.webhooks
        : installation.webhookId || installation.webhookUrl
        ? [
            {
              id: installation.webhookId,
              url: installation.webhookUrl,
            },
          ]
        : []
      : targets;

    if (shouldDeleteAll && webhookIds.length === 0) {
      const logs = await getFathomIntegrationLogs(userId, 200);
      webhookIds = logs
        .filter((entry) => entry.event === "webhook.create")
        .map((entry) => ({
          id: entry.metadata?.webhookId ?? null,
          url: entry.metadata?.destinationUrl ?? null,
        }))
        .filter((entry) => entry.id || entry.url);
    }

    if (!webhookIds.length) {
      return NextResponse.json(
        { error: "No webhook IDs provided." },
        { status: 400 }
      );
    }

    for (const webhook of webhookIds) {
      await deleteFathomWebhook(accessToken, webhook);
    }

    const deletedIds = webhookIds
      .map((item: any) => (typeof item === "string" ? item : item?.id))
      .filter(Boolean);
    const nextWebhooks =
      installation.webhooks?.filter(
        (entry) => !deletedIds.includes(entry.id || "")
      ) || [];

    await saveFathomInstallation({
      ...installation,
      webhooks: nextWebhooks,
      webhookId:
        installation.webhookId && deletedIds.includes(installation.webhookId)
          ? null
          : installation.webhookId,
      webhookUrl:
        installation.webhookId && deletedIds.includes(installation.webhookId)
          ? null
          : installation.webhookUrl,
      updatedAt: new Date(),
    });

    return NextResponse.json({ ok: true, deleted: webhookIds.length });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete webhook(s)." },
      { status: 500 }
    );
  }
}
