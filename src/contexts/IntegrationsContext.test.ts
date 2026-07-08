import {
  fetchTrelloConnectionState,
  resolveTrelloConnectionState,
} from "@/contexts/IntegrationsContext";

jest.mock("next-auth/react", () => ({
  signIn: jest.fn(),
}));

jest.mock("@/contexts/AuthContext", () => ({
  useAuth: jest.fn(() => ({ user: null, loading: true })),
}));

jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

describe("resolveTrelloConnectionState", () => {
  it("is connected only for an active connection", () => {
    expect(
      resolveTrelloConnectionState({ connection: { status: "active" } })
    ).toBe(true);
  });

  it("treats revoked, missing, and malformed connections as disconnected", () => {
    expect(
      resolveTrelloConnectionState({ connection: { status: "revoked" } })
    ).toBe(false);
    expect(resolveTrelloConnectionState({ connection: null })).toBe(false);
    expect(resolveTrelloConnectionState({})).toBe(false);
    expect(resolveTrelloConnectionState(null)).toBe(false);
    expect(resolveTrelloConnectionState("nope")).toBe(false);
    expect(resolveTrelloConnectionState({ connection: "active" })).toBe(false);
  });
});

describe("fetchTrelloConnectionState", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const mockFetchResponse = (response: Partial<Response>) => {
    const mocked = jest.fn().mockResolvedValue(response);
    global.fetch = mocked as unknown as typeof fetch;
    return mocked;
  };

  it("returns true when the API reports an active connection", async () => {
    const fetchMock = mockFetchResponse({
      ok: true,
      json: async () => ({ ok: true, connection: { status: "active" } }),
    });

    await expect(fetchTrelloConnectionState()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("/api/trello/connection");
  });

  it("returns false when the workspace has no connection", async () => {
    mockFetchResponse({
      ok: true,
      json: async () => ({ ok: true, connection: null }),
    });

    await expect(fetchTrelloConnectionState()).resolves.toBe(false);
  });

  it("returns false for a non-2xx response", async () => {
    mockFetchResponse({
      ok: false,
      json: async () => ({ ok: false, error: "Unauthorized" }),
    });

    await expect(fetchTrelloConnectionState()).resolves.toBe(false);
  });

  it("returns false when the response body is not JSON", async () => {
    mockFetchResponse({
      ok: true,
      json: async () => {
        throw new Error("bad json");
      },
    });

    await expect(fetchTrelloConnectionState()).resolves.toBe(false);
  });

  it("returns false when the network request fails", async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error("network down")) as unknown as typeof fetch;

    await expect(fetchTrelloConnectionState()).resolves.toBe(false);
  });
});
