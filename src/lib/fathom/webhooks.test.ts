import {
  ensureFathomConnectionWebhook,
  ensureFathomWebhook,
} from "@/lib/fathom/webhooks";
import { getDb } from "@/lib/db";
import { findFathomConnectionById, updateFathomConnectionById } from "@/lib/fathom-connections";
import { logFathomIntegration } from "@/lib/fathom-logs";
import { getFathomInstallation, saveFathomInstallation } from "@/lib/fathom/oauth";
import { deleteFathomWebhook } from "@/lib/fathom-webhooks";
import { buildConnectionWebhookUpsert, buildLegacyWebhookUpsert } from "@/lib/fathom-webhook-sync-helpers";
import { getWebhookId, getWebhookUrl } from "@/lib/fathom-webhook-helpers";
import { getFathomWebhookUrl } from "@/lib/fathom-utils";
import { listFathomWebhooks } from "@/lib/fathom/api-client";
import { recordExternalApiFailure } from "@/lib/observability-metrics";

jest.mock("@/lib/db", () => ({
  getDb: jest.fn(),
}));

jest.mock("@/lib/fathom-connections", () => ({
  findFathomConnectionById: jest.fn(),
  updateFathomConnectionById: jest.fn(),
}));

jest.mock("@/lib/fathom-logs", () => ({
  logFathomIntegration: jest.fn(),
}));

jest.mock("@/lib/fathom/oauth", () => ({
  getFathomInstallation: jest.fn(),
  saveFathomInstallation: jest.fn(),
}));

jest.mock("@/lib/fathom-webhooks", () => ({
  deleteFathomWebhook: jest.fn(),
  pruneFathomManagedWebhooks: jest.fn(),
}));

jest.mock("@/lib/fathom-webhook-sync-helpers", () => ({
  buildConnectionWebhookUpsert: jest.fn(),
  buildLegacyWebhookUpsert: jest.fn(),
}));

jest.mock("@/lib/fathom-webhook-helpers", () => ({
  buildWebhookBody: jest.fn(),
  getWebhookId: jest.fn(),
  getWebhookUrl: jest.fn(),
}));

jest.mock("@/lib/fathom-utils", () => ({
  getFathomWebhookUrl: jest.fn(),
  FATHOM_WEBHOOK_EVENT: "meeting.ingested",
  FATHOM_WEBHOOK_TRIGGERED_FOR: ["my_recordings"],
}));

jest.mock("@/lib/fathom/api-client", () => ({
  listFathomWebhooks: jest.fn(),
}));

jest.mock("@/lib/observability-metrics", () => ({
  recordExternalApiFailure: jest.fn(),
}));

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedFindFathomConnectionById = findFathomConnectionById as jest.MockedFunction<
  typeof findFathomConnectionById
>;
const mockedUpdateFathomConnectionById = updateFathomConnectionById as jest.MockedFunction<
  typeof updateFathomConnectionById
>;
const mockedLogFathomIntegration = logFathomIntegration as jest.MockedFunction<
  typeof logFathomIntegration
>;
const mockedGetFathomInstallation = getFathomInstallation as jest.MockedFunction<
  typeof getFathomInstallation
>;
const mockedSaveFathomInstallation = saveFathomInstallation as jest.MockedFunction<
  typeof saveFathomInstallation
>;
const mockedDeleteFathomWebhook = deleteFathomWebhook as jest.MockedFunction<
  typeof deleteFathomWebhook
>;
const mockedBuildConnectionWebhookUpsert = buildConnectionWebhookUpsert as jest.MockedFunction<
  typeof buildConnectionWebhookUpsert
>;
const mockedBuildLegacyWebhookUpsert = buildLegacyWebhookUpsert as jest.MockedFunction<
  typeof buildLegacyWebhookUpsert
>;
const mockedGetWebhookId = getWebhookId as jest.MockedFunction<typeof getWebhookId>;
const mockedGetWebhookUrl = getWebhookUrl as jest.MockedFunction<typeof getWebhookUrl>;
const mockedGetFathomWebhookUrl = getFathomWebhookUrl as jest.MockedFunction<
  typeof getFathomWebhookUrl
>;
const mockedListFathomWebhooks = listFathomWebhooks as jest.MockedFunction<
  typeof listFathomWebhooks
>;
const mockedRecordExternalApiFailure = recordExternalApiFailure as jest.MockedFunction<
  typeof recordExternalApiFailure
>;

describe("fathom/webhooks", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("ensures a legacy webhook and deduplicates stale matches", async () => {
    mockedGetFathomWebhookUrl.mockReturnValue("https://public.example/webhook?token=abc");
    mockedGetFathomInstallation.mockResolvedValue({
      _id: "user-1",
      userId: "user-1",
      accessToken: "access-token",
      webhookSecret: "secret",
      webhooks: [],
    } as any);
    mockedListFathomWebhooks.mockResolvedValue([
      { id: "wh-1", url: "https://public.example/webhook?token=abc", created_at: "2026-07-02T00:00:00.000Z" },
      { id: "wh-2", url: "https://public.example/webhook?token=abc", created_at: "2026-07-01T00:00:00.000Z" },
    ] as any);
    mockedGetWebhookId.mockImplementation((webhook: any) => webhook.id || webhook.webhook_id || null);
    mockedGetWebhookUrl.mockImplementation((webhook: any) => webhook.url || webhook.webhook_url || null);
    mockedBuildLegacyWebhookUpsert.mockReturnValue({
      webhookId: "wh-1",
      createdUrl: "https://public.example/webhook?token=abc",
      merged: [{ id: "wh-1", url: "https://public.example/webhook?token=abc" }],
      createdAt: "2026-07-02T00:00:00.000Z",
    } as any);

    const result = await ensureFathomWebhook("user-1", "access-token", "token-1");

    expect(result).toEqual({
      status: "existing",
      webhookId: "wh-1",
      webhookUrl: "https://public.example/webhook?token=abc",
    });
    expect(mockedSaveFathomInstallation).toHaveBeenCalledTimes(1);
    expect(mockedDeleteFathomWebhook).toHaveBeenCalledTimes(1);
    expect(mockedLogFathomIntegration).toHaveBeenCalledWith(
      "user-1",
      "info",
      "webhook.create",
      "Webhook already exists.",
      expect.any(Object)
    );
    expect(mockedRecordExternalApiFailure).not.toHaveBeenCalled();
  });

  it("ensures a connection webhook and updates the connection record", async () => {
    mockedGetFathomWebhookUrl.mockReturnValue("https://public.example/webhook?token=abc");
    mockedGetDb.mockResolvedValue({ collection: jest.fn() } as any);
    mockedFindFathomConnectionById.mockResolvedValue({
      _id: "connection-1",
      workspaceId: "workspace-1",
      createdByUserId: "user-1",
      updatedByUserId: "user-1",
      legacyUserId: "user-1",
      oauth: {
        accessToken: "access-token",
        refreshToken: "refresh-token",
      },
      webhook: {
        token: null,
        secret: null,
        status: "not_configured",
        webhookId: null,
        webhookUrl: null,
        webhookEvent: null,
        managedWebhooks: [],
        lastSyncedAt: null,
        lastError: null,
      },
    } as any);
    mockedListFathomWebhooks.mockResolvedValue([
      { id: "wh-1", url: "https://public.example/webhook?token=abc", created_at: "2026-07-02T00:00:00.000Z" },
      { id: "wh-2", url: "https://public.example/webhook?token=abc", created_at: "2026-07-01T00:00:00.000Z" },
    ] as any);
    mockedGetWebhookId.mockImplementation((webhook: any) => webhook.id || webhook.webhook_id || null);
    mockedGetWebhookUrl.mockImplementation((webhook: any) => webhook.url || webhook.webhook_url || null);
    mockedBuildConnectionWebhookUpsert.mockReturnValue({
      webhookId: "wh-1",
      createdUrl: "https://public.example/webhook?token=abc",
      merged: [{ id: "wh-1", url: "https://public.example/webhook?token=abc" }],
      secret: "secret",
      event: "meeting.ingested",
    } as any);
    mockedUpdateFathomConnectionById.mockResolvedValue({ _id: "connection-1" } as any);

    const result = await ensureFathomConnectionWebhook("connection-1", "access-token", "token-1");

    expect(result).toEqual({
      status: "existing",
      webhookId: "wh-1",
      webhookUrl: "https://public.example/webhook?token=abc",
      webhookSecret: "secret",
      managedWebhooks: [{ id: "wh-1", url: "https://public.example/webhook?token=abc" }],
    });
    expect(mockedUpdateFathomConnectionById).toHaveBeenCalledTimes(1);
    expect(mockedDeleteFathomWebhook).toHaveBeenCalledTimes(1);
  });
});
