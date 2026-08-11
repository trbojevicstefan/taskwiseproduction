/** @jest-environment jsdom */

import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import {
  ChatHistoryProvider,
  useChatHistory,
} from "@/contexts/ChatHistoryContext";
import { apiFetch } from "@/lib/api";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { uid: "user-1" } }),
}));
jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: jest.fn() }),
}));
jest.mock("@/lib/api", () => ({ apiFetch: jest.fn() }));

const mockedApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const session = (id: string, messages: any[] = []) => ({
  id,
  userId: "user-1",
  title: id,
  messages,
  suggestedTasks: [],
  originalAiTasks: [],
  taskRevisions: [],
  people: [],
  folderId: null,
  sourceMeetingId: null,
  scope: { type: "workspace" as const },
  createdAt: "2026-08-11T00:00:00.000Z",
  lastActivityAt: "2026-08-11T00:00:00.000Z",
});

let latestContext: ReturnType<typeof useChatHistory> | null = null;
const Harness = () => {
  latestContext = useChatHistory();
  return null;
};

const renderProvider = async () => {
  const container = document.createElement("div");
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(
      <ChatHistoryProvider>
        <Harness />
      </ChatHistoryProvider>
    );
  });
  return () => {
    act(() => root.unmount());
  };
};

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe("ChatHistoryContext durable session persistence", () => {
  beforeEach(() => {
    latestContext = null;
    jest.clearAllMocks();
  });

  it("serializes message snapshots per session so a later save cannot be overwritten", async () => {
    const firstPatch = deferred<any>();
    const secondPatch = deferred<any>();
    mockedApiFetch.mockImplementation((url, options) => {
      if (url === "/api/chat-sessions" && !options) {
        return Promise.resolve([session("s1")]) as any;
      }
      const patchCount = mockedApiFetch.mock.calls.filter(
        ([calledUrl, calledOptions]) =>
          calledUrl === "/api/chat-sessions/s1" && calledOptions?.method === "PATCH"
      ).length;
      return (patchCount === 1 ? firstPatch.promise : secondPatch.promise) as any;
    });
    const cleanup = await renderProvider();
    await flush();

    const firstMessages = [
      { id: "m1", sender: "user", text: "one", timestamp: 1 },
    ] as any;
    const secondMessages = [
      ...firstMessages,
      { id: "m2", sender: "ai", text: "two", timestamp: 2 },
    ] as any;
    let firstSave!: Promise<boolean>;
    let secondSave!: Promise<boolean>;
    await act(async () => {
      firstSave = latestContext!.persistSessionMessages("s1", firstMessages);
      secondSave = latestContext!.persistSessionMessages("s1", secondMessages);
      await Promise.resolve();
    });

    expect(
      mockedApiFetch.mock.calls.filter(
        ([url, options]) =>
          url === "/api/chat-sessions/s1" && options?.method === "PATCH"
      )
    ).toHaveLength(1);

    firstPatch.resolve(session("s1", firstMessages));
    await act(async () => {
      await firstSave;
      await Promise.resolve();
    });
    const patchCalls = mockedApiFetch.mock.calls.filter(
      ([url, options]) =>
        url === "/api/chat-sessions/s1" && options?.method === "PATCH"
    );
    expect(patchCalls).toHaveLength(2);
    expect(JSON.parse(patchCalls[1][1]!.body as string).messages).toEqual(
      secondMessages
    );

    secondPatch.resolve(session("s1", secondMessages));
    await act(async () => {
      await secondSave;
    });
    expect(latestContext!.sessions[0].messages).toEqual(secondMessages);
    cleanup();
  });

  it("does not let an older partial PATCH response replace newer local messages", async () => {
    const titlePatch = deferred<any>();
    mockedApiFetch.mockImplementation((url, options) => {
      if (url === "/api/chat-sessions" && !options) {
        return Promise.resolve([session("s1")]) as any;
      }
      const body = JSON.parse(String(options?.body || "{}"));
      if (body.title) return titlePatch.promise;
      if (body.messages) return Promise.resolve(session("s1", body.messages)) as any;
      throw new Error(`Unexpected API call: ${url}`);
    });
    const cleanup = await renderProvider();
    await flush();

    let titleSave!: Promise<void>;
    const newerMessages = [
      { id: "new", sender: "user", text: "newer", timestamp: 2 },
    ] as any;
    await act(async () => {
      titleSave = latestContext!.updateSession("s1", { title: "Renamed" });
      await latestContext!.persistSessionMessages("s1", newerMessages);
    });
    titlePatch.resolve({ ...session("s1"), title: "Renamed", messages: [] });
    await act(async () => {
      await titleSave;
    });

    expect(latestContext!.sessions[0].title).toBe("Renamed");
    expect(latestContext!.sessions[0].messages).toEqual(newerMessages);
    cleanup();
  });

  it("reloads the authoritative session after the latest message save fails", async () => {
    const serverMessages = [
      { id: "server", sender: "ai", text: "durable", timestamp: 1 },
    ];
    let listLoads = 0;
    mockedApiFetch.mockImplementation((url, options) => {
      if (url === "/api/chat-sessions" && !options) {
        listLoads += 1;
        return Promise.resolve([
          session("s1", listLoads === 1 ? [] : serverMessages),
        ]) as any;
      }
      if (url === "/api/chat-sessions/s1" && options?.method === "PATCH") {
        return Promise.reject(new Error("save failed"));
      }
      throw new Error(`Unexpected API call: ${url}`);
    });
    const cleanup = await renderProvider();
    await flush();

    let saved!: boolean;
    await act(async () => {
      saved = await latestContext!.persistSessionMessages("s1", [
        { id: "local", sender: "user", text: "optimistic", timestamp: 2 },
      ] as any);
    });

    expect(saved).toBe(false);
    expect(listLoads).toBe(2);
    expect(latestContext!.sessions[0].messages).toEqual(serverMessages);
    cleanup();
  });

  it("rolls back to the last durable snapshot when save and reconciliation both fail", async () => {
    const durableMessages = [
      { id: "durable", sender: "ai", text: "saved", timestamp: 1 },
    ];
    let initialLoadComplete = false;
    mockedApiFetch.mockImplementation((url, options) => {
      if (url === "/api/chat-sessions" && !options && !initialLoadComplete) {
        initialLoadComplete = true;
        return Promise.resolve([session("s1", durableMessages)]) as any;
      }
      return Promise.reject(new Error("offline"));
    });
    const cleanup = await renderProvider();
    await flush();

    await act(async () => {
      await latestContext!.persistSessionMessages("s1", [
        ...durableMessages,
        { id: "optimistic", sender: "user", text: "not saved", timestamp: 2 },
      ] as any);
    });

    expect(latestContext!.sessions[0].messages).toEqual(durableMessages);
    cleanup();
  });

  it("merges sessions created while the initial history request is in flight", async () => {
    const history = deferred<any[]>();
    mockedApiFetch.mockImplementation((url, options) => {
      if (url === "/api/chat-sessions" && !options) return history.promise as any;
      if (url === "/api/chat-sessions" && options?.method === "POST") {
        return Promise.resolve(session("new-session")) as any;
      }
      throw new Error(`Unexpected API call: ${url}`);
    });
    const cleanup = await renderProvider();

    await act(async () => {
      await latestContext!.createNewSession({ title: "New" });
    });
    expect(latestContext!.sessions.map(({ id }) => id)).toEqual(["new-session"]);

    history.resolve([session("old-session")]);
    await flush();
    expect(latestContext!.sessions.map(({ id }) => id).sort()).toEqual([
      "new-session",
      "old-session",
    ]);
    expect(latestContext!.activeSessionId).toBe("new-session");
    cleanup();
  });
});
