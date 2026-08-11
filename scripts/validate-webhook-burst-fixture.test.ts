import { ObjectId } from "mongodb";
import { findFathomConnectionByWebhookToken } from "../src/lib/fathom-connections";
import {
  buildWebhookBurstFixture,
  ensureWebhookBurstLookupIndex,
} from "./validate-webhook-burst-fixture";

const readPath = (value: Record<string, any>, path: string) =>
  path.split(".").reduce<any>((current, part) => current?.[part], value);

describe("webhook burst validator fixture", () => {
  it("creates the current Fathom connection shape discoverable by webhook token", async () => {
    const userId = new ObjectId("64b64c168b4c2e0012345678");
    const fixture = buildWebhookBurstFixture({
      userId,
      workspaceId: "workspace-burst",
      connectionId: "connection-burst",
      webhookToken: "redacted-test-token",
      now: new Date("2026-08-11T10:00:00.000Z"),
    });
    const findOne = jest.fn(async (filter: Record<string, unknown>) =>
      Object.entries(filter).every(
        ([path, expected]) => readPath(fixture.connection, path) === expected
      )
        ? fixture.connection
        : null
    );
    const db = {
      collection: jest.fn((name: string) => {
        expect(name).toBe("fathomConnections");
        return { findOne };
      }),
    } as any;

    const found = await findFathomConnectionByWebhookToken(
      db,
      "redacted-test-token"
    );

    expect(found?._id).toBe("connection-burst");
    expect(found?.legacyUserId).toBe(userId.toString());
    expect(found?.webhook).toMatchObject({
      token: "redacted-test-token",
      secret: null,
      status: "active",
    });
    expect(fixture.user._id).toBe(userId);
    expect(findOne).toHaveBeenCalledWith({
      "webhook.token": "redacted-test-token",
    });
  });

  it("ensures only the current webhook token lookup index", async () => {
    const createIndex = jest.fn(async () => "webhook.token_1");
    const db = {
      collection: jest.fn((name: string) => {
        expect(name).toBe("fathomConnections");
        return { createIndex };
      }),
    } as any;

    await ensureWebhookBurstLookupIndex(db);

    expect(createIndex).toHaveBeenCalledWith(
      { "webhook.token": 1 },
      {
        unique: true,
        partialFilterExpression: { "webhook.token": { $type: "string" } },
      }
    );
  });
});
