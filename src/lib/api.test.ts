/** @jest-environment jsdom */

describe("apiFetch GET cache control", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it("bypasses and invalidates the one-second GET cache for no-store reloads", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ revision: "cached" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ revision: "forced" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ revision: "after-force" }),
      });
    global.fetch = fetchMock as typeof fetch;
    const { apiFetch } = await import("@/lib/api");

    await expect(apiFetch("/api/chat-sessions")).resolves.toEqual({
      revision: "cached",
    });
    await expect(apiFetch("/api/chat-sessions")).resolves.toEqual({
      revision: "cached",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(
      apiFetch("/api/chat-sessions", { cache: "no-store" })
    ).resolves.toEqual({ revision: "forced" });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await expect(apiFetch("/api/chat-sessions")).resolves.toEqual({
      revision: "after-force",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not let an older in-flight GET repopulate cache after a forced reload", async () => {
    let resolveStale!: (value: unknown) => void;
    const staleResponse = new Promise((resolve) => {
      resolveStale = resolve;
    });
    const fetchMock = jest
      .fn()
      .mockReturnValueOnce(staleResponse)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ revision: "forced" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ revision: "after-force" }),
      });
    global.fetch = fetchMock as typeof fetch;
    const { apiFetch } = await import("@/lib/api");

    const staleRequest = apiFetch("/api/chat-sessions");
    await expect(
      apiFetch("/api/chat-sessions", { cache: "no-store" })
    ).resolves.toEqual({ revision: "forced" });

    resolveStale({
      ok: true,
      json: async () => ({ revision: "stale" }),
    });
    await expect(staleRequest).resolves.toEqual({ revision: "stale" });

    await expect(apiFetch("/api/chat-sessions")).resolves.toEqual({
      revision: "after-force",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
