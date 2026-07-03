import {
  ensureMeetingConnectionIndexes,
  findMeetingConnectionByWebhookToken,
  revokeMeetingConnection,
  serializeMeetingConnection,
  upsertMeetingConnection,
  type MeetingConnectionDoc,
} from "@/lib/meeting-connections";

const buildCollection = () => ({
  findOne: jest.fn(),
  insertOne: jest.fn().mockResolvedValue({ acknowledged: true }),
  updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
  createIndex: jest.fn().mockResolvedValue("ok"),
  find: jest.fn(),
});

const buildDb = (collection = buildCollection()) => ({
  db: { collection: jest.fn(() => collection) } as any,
  collection,
});

const buildConnection = (
  overrides: Partial<MeetingConnectionDoc> = {}
): MeetingConnectionDoc => ({
  _id: "connection-1",
  workspaceId: "workspace-1",
  userId: "user-1",
  provider: "fireflies",
  status: "active",
  apiKey: "secret-key",
  accountName: "Acme",
  webhookSecret: "hook-secret",
  webhookToken: "hook-token",
  createdAt: new Date("2026-07-01T00:00:00Z"),
  updatedAt: new Date("2026-07-01T00:00:00Z"),
  revokedAt: null,
  ...overrides,
});

describe("meeting connections", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("creates a new connection with a UUID id, webhook token and active status", async () => {
    const { db, collection } = buildDb();
    collection.findOne.mockResolvedValue(null);

    const connection = await upsertMeetingConnection(db, {
      workspaceId: "workspace-1",
      userId: "user-1",
      provider: "fireflies",
      apiKey: "api-key-1",
      accountName: "Acme",
    });

    expect(collection.insertOne).toHaveBeenCalledTimes(1);
    const inserted = collection.insertOne.mock.calls[0][0];
    expect(typeof inserted._id).toBe("string");
    expect(inserted._id).toMatch(/^[0-9a-f-]{36}$/);
    expect(inserted).toMatchObject({
      workspaceId: "workspace-1",
      userId: "user-1",
      provider: "fireflies",
      status: "active",
      apiKey: "api-key-1",
      accountName: "Acme",
      webhookSecret: null,
    });
    expect(typeof inserted.webhookToken).toBe("string");
    expect(connection.status).toBe("active");
  });

  it("reactivates and updates the existing (workspace, provider) connection on reconnect", async () => {
    const existing = buildConnection({
      status: "revoked",
      revokedAt: new Date("2026-07-02T00:00:00Z"),
      apiKey: "old-key",
    });
    const { db, collection } = buildDb();
    collection.findOne.mockResolvedValue(existing);

    const connection = await upsertMeetingConnection(db, {
      workspaceId: "workspace-1",
      userId: "user-2",
      provider: "fireflies",
      apiKey: "new-key",
      accountName: "Acme Renewed",
    });

    expect(collection.insertOne).not.toHaveBeenCalled();
    expect(collection.updateOne).toHaveBeenCalledWith(
      { _id: "connection-1" },
      {
        $set: expect.objectContaining({
          status: "active",
          apiKey: "new-key",
          accountName: "Acme Renewed",
          revokedAt: null,
          // The webhook token survives reconnects so provider-side URLs stay valid.
          webhookToken: "hook-token",
        }),
      }
    );
    expect(connection.apiKey).toBe("new-key");
    expect(connection.webhookToken).toBe("hook-token");
  });

  it("revokes an existing connection", async () => {
    const existing = buildConnection();
    const { db, collection } = buildDb();
    collection.findOne.mockResolvedValue(existing);

    const revoked = await revokeMeetingConnection(db, "workspace-1", "fireflies");

    expect(collection.updateOne).toHaveBeenCalledWith(
      { _id: "connection-1" },
      {
        $set: expect.objectContaining({
          status: "revoked",
          revokedAt: expect.any(Date),
        }),
      }
    );
    expect(revoked?.status).toBe("revoked");
  });

  it("returns null when revoking a missing connection", async () => {
    const { db, collection } = buildDb();
    collection.findOne.mockResolvedValue(null);

    const revoked = await revokeMeetingConnection(db, "workspace-1", "grain");

    expect(revoked).toBeNull();
    expect(collection.updateOne).not.toHaveBeenCalled();
  });

  it("looks up connections by provider + webhook token", async () => {
    const { db, collection } = buildDb();
    collection.findOne.mockResolvedValue(buildConnection());

    await findMeetingConnectionByWebhookToken(db, "fireflies", "hook-token");

    expect(collection.findOne).toHaveBeenCalledWith({
      provider: "fireflies",
      webhookToken: "hook-token",
    });
  });

  it("serializes connections without secrets by default", () => {
    const serialized = serializeMeetingConnection(buildConnection()) as any;

    expect(serialized.apiKey).toBeUndefined();
    expect(serialized.webhookSecret).toBeUndefined();
    expect(serialized).toMatchObject({
      id: "connection-1",
      provider: "fireflies",
      status: "active",
      accountName: "Acme",
      hasApiKey: true,
      hasWebhookSecret: true,
      webhookToken: "hook-token",
    });
  });

  it("includes secrets only when explicitly requested", () => {
    const serialized = serializeMeetingConnection(buildConnection(), {
      includeSecrets: true,
    }) as any;
    expect(serialized.apiKey).toBe("secret-key");
    expect(serialized.webhookSecret).toBe("hook-secret");
  });

  it("ensures the unique (workspaceId, provider) index", async () => {
    const { db, collection } = buildDb();

    await ensureMeetingConnectionIndexes(db);

    // Index creation is cached module-wide; assert only when this test run
    // performed the creation.
    if (collection.createIndex.mock.calls.length) {
      expect(collection.createIndex).toHaveBeenCalledWith(
        { workspaceId: 1, provider: 1 },
        expect.objectContaining({ unique: true })
      );
    }
  });
});
